/**
 * 企业版报错告警（E-417 阶段 1）：每 2 分钟由 systemd timer 跑一次（安装脚本是阶段 2），看过去 10 分钟的运行记录 + 探活，
 * 命中规则就发飞书自定义群机器人。不在进程里计数：c2 多进程各写各的文件，进程挂了计数也没了，外面的定时任务还能报。
 *
 *   node scripts/ent-alert.mjs --dir <数据目录> [--dry] [--now <ISO 时刻>]
 *
 * <数据目录> 下：telemetry/（运行记录，lib/telemetry/store.ts 写的）、.alert-env（配置，权限 600）、alert-state.json（本脚本的状态）。
 * .alert-env（KEY=VALUE，# 开头是注释）：
 *   ALERT_WEBHOOK_OURS / ALERT_SECRET_OURS   我方技术群：收全部（报警、恢复、心跳）
 *   ALERT_WEBHOOK_EVEN / ALERT_SECRET_EVEN   客户群：只收 3 类（同类 ≥5 次且不止 1 人、≥3 位员工同时撞上、数据库类 ≥3 次）及其恢复；可空，空就不发
 *   ALERT_HEALTH_URLS                        探活地址，逗号分隔（每个进程端口一个，如 http://127.0.0.1:3010/api/health）；空就不探
 *   ALERT_INSTANCE                           消息里的实例名，默认「企业版」
 * 密钥空 = 不签名（群机器人没开签名校验时）。签名：timestamp(秒) + "\n" + secret 作 HmacSHA256 的 key、内容为空，取 base64。
 *
 * 规则（过去 10 分钟，先松后紧，阈值常量在下面）：
 *   R1 同一「错误名 + 错误码 + 路由」≥5 次（服务端出错 + 浏览器错误边界）→ 只有 1 个人撞上算单员工个案，只发我方；≥2 人发客户群
 *   R2 服务端出错合计 ≥15 次 → 只发我方；≥3 个不同的人碰到错 → 发客户群
 *   R3 数据库类（错误码 P20xx）合计 ≥3 次 → 发客户群
 *   R4 探活连续 2 次不通 → 只发我方（「服务挂了」不在客户群那 3 类里）
 * 去重 / 静默：同一条 60 分钟内只报一次；还在发生每满 60 分钟补一条；连续 30 分钟为 0 发「已恢复」（探活通了立即恢复）；
 * 全局每小时最多 6 条（心跳不算），超出的留到下一次；每天北京 09:00 起第一次运行发一条心跳（只发我方，带 24 小时摘要）。
 * 发送失败只写 stderr，不重试，退出码 0（不影响任何业务）。--dry：不发、不写状态，只把「将发什么」打印出来。
 * 消息里没有姓名、客户数据、号码（运行记录本来就没有，见 lib/telemetry/fields.ts）；时间写北京 + 伦敦。
 * 读运行记录复用 scripts/telemetry-daily.mjs 的 读记录 / 汇总，部署时两个文件放同一目录。只用 node 自带模块。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { 读记录, 汇总 } from "./telemetry-daily.mjs";

export const 窗口毫秒 = 10 * 60_000;
export const 阈值 = { R1次数: 5, R2总量: 15, R2人数: 3, R3次数: 3, 探活连败: 2 };
export const 重报毫秒 = 60 * 60_000;
export const 恢复毫秒 = 30 * 60_000;
export const 每小时上限 = 6;
const 数据库码 = /^P20\d{2}$/;

/* ---------------- 配置 / 状态 ---------------- */

/** .alert-env → 对象。不存在回 {}；去掉两端引号 */
export function 读配置(目录) {
  const 配置 = {};
  let 文本;
  try {
    文本 = fs.readFileSync(path.join(目录, ".alert-env"), "utf8");
  } catch {
    return 配置;
  }
  for (const 行 of 文本.split(/\r?\n/)) {
    if (行.trim().startsWith("#")) continue;
    const m = 行.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    配置[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return 配置;
}

function 读状态(目录) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(目录, "alert-state.json"), "utf8"));
    if (s && typeof s === "object") return { alerts: {}, sent: [], health: {}, heartbeatDay: "", ...s };
  } catch {
    /* 没有或坏了：当新的 */
  }
  return { alerts: {}, sent: [], health: {}, heartbeatDay: "" };
}

function 写状态(目录, 状态) {
  const 文件 = path.join(目录, "alert-state.json");
  const 临时 = `${文件}.tmp${process.pid}`;
  fs.writeFileSync(临时, JSON.stringify(状态));
  fs.renameSync(临时, 文件);
}

/* ---------------- 时间 ---------------- */

const 北京 = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(5, 16).replace("T", " ");
function 伦敦(ms) {
  try {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
        .formatToParts(ms)
        .map((x) => [x.type, x.value]),
    );
    return `${p.month}-${p.day} ${p.hour}:${p.minute}`;
  } catch {
    return `${new Date(ms).toISOString().slice(5, 16).replace("T", " ")} UTC`;
  }
}
const 双时区 = (ms) => `北京 ${北京(ms)} / 伦敦 ${伦敦(ms)}`;
const 北京日 = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
const 北京时 = (ms) => new Date(ms + 8 * 3600_000).getUTCHours();

/* ---------------- 规则 ---------------- */

/** 进规则的记录：服务端出错 + 浏览器错误边界 */
const 算数 = (x) => x.k === "err" && (x.src === "server" || (x.src === "browser" && x.type === "错误边界"));
const 组键 = (x) => `${x.name ?? ""}|${x.code ?? ""}|${x.route ?? "?"}`;
const 计 = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const 角色串 = (rs) => {
  const m = new Map();
  for (const x of rs) 计(m, x.role ?? "?");
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(" ") || "—";
};
const 人数 = (rs) => new Set(rs.filter((x) => x.u).map((x) => x.u)).size;
const 样例 = (rs) => [...rs].reverse().find((x) => x.digest)?.digest;
const 时刻 = (t) => Date.parse(t);

function 明细(rs, 行们) {
  const ts = rs.map((x) => 时刻(x.t));
  const 样 = 样例(rs);
  return [...行们, `人数：${人数(rs)}　角色：${角色串(rs)}`, `首次：${双时区(Math.min(...ts))}`, `最近：${双时区(Math.max(...ts))}`, ...(样 ? [`编号样例：${样}`] : [])].join("\n");
}

/**
 * 算出现在命中的规则。
 * @param {object[]} 记录 过去 60 分钟的记录（已按 算数 过滤）
 * @param {number} 现在 毫秒
 * 回 [{ 键, 名, 客户, 近10, 近60, 内容 }]：近10 是 10 分钟窗口里的条数，近60 是 60 分钟里同一条规则对应的条数，客户 = 是否发客户群
 */
export function 评规则(记录, 现在) {
  const 近 = 记录.filter((x) => 时刻(x.t) >= 现在 - 窗口毫秒);
  const 出 = [];
  // R1
  const 组 = new Map();
  for (const x of 近) {
    const k = 组键(x);
    if (!组.has(k)) 组.set(k, []);
    组.get(k).push(x);
  }
  for (const [k, rs] of 组) {
    if (rs.length < 阈值.R1次数) continue;
    // 0 人（未登录 / 认不出员工）和 1 人都算「不够人」：只发我方，不发客户群
    const 人 = 人数(rs);
    const 不够人 = 人 < 2;
    const x = rs[0];
    出.push({
      键: `R1:${k}`,
      名: "同类错误连发",
      客户: !不够人,
      近10: rs.length,
      近60: 记录.filter((y) => 组键(y) === k).length,
      内容: 明细(rs, [`规则：同一类错误 10 分钟内 ${rs.length} 次（线 ${阈值.R1次数}）${不够人 ? (人 === 0 ? "，认不出员工" : "，仅 1 位员工（个案）") : ""}`, `错误：${x.name || "?"}${x.code ? ` / ${x.code}` : ""}　路由：${x.route ?? "?"}`]),
    });
  }
  // R2：总量（只我方）、人数（客户）
  const 服务端 = 近.filter((x) => x.src === "server");
  if (服务端.length >= 阈值.R2总量) {
    出.push({ 键: "R2:total", 名: "服务端报错总量突增", 客户: false, 近10: 服务端.length, 近60: 记录.filter((x) => x.src === "server").length, 内容: 明细(服务端, [`规则：服务端出错 10 分钟内合计 ${服务端.length} 次（线 ${阈值.R2总量}）`]) });
  }
  if (人数(近) >= 阈值.R2人数) {
    出.push({ 键: "R2:people", 名: "多位员工同时撞上报错", 客户: true, 近10: 近.length, 近60: 记录.length, 内容: 明细(近, [`规则：10 分钟内 ${人数(近)} 位员工碰到报错（线 ${阈值.R2人数}），共 ${近.length} 次`]) });
  }
  // R3
  const 库 = 近.filter((x) => 数据库码.test(x.code ?? ""));
  if (库.length >= 阈值.R3次数) {
    const m = new Map();
    for (const x of 库) 计(m, x.code);
    const 码串 = [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(" ");
    出.push({ 键: "R3:db", 名: "数据库类报错", 客户: true, 近10: 库.length, 近60: 记录.filter((x) => 数据库码.test(x.code ?? "")).length, 内容: 明细(库, [`规则：数据库类错误码 10 分钟内 ${库.length} 次（线 ${阈值.R3次数}）`, `错误码：${码串}`]) });
  }
  return 出;
}

/** 键对应的「最近 30 分钟还有没有记录」：恢复判断用 */
function 键还在发生(键, 记录, 现在) {
  const 近 = 记录.filter((x) => 时刻(x.t) >= 现在 - 恢复毫秒);
  if (键.startsWith("R1:")) return 近.some((x) => `R1:${组键(x)}` === 键);
  if (键 === "R2:total") return 近.some((x) => x.src === "server");
  if (键 === "R2:people") return 近.length > 0;
  if (键 === "R3:db") return 近.some((x) => 数据库码.test(x.code ?? ""));
  return false;
}

/* ---------------- 发送 ---------------- */

/** 飞书自定义机器人签名：timestamp + "\n" + secret 作 key 的 HmacSHA256（内容空），base64 */
export function 签名(timestamp, secret) {
  return crypto.createHmac("sha256", `${timestamp}\n${secret}`).update("").digest("base64");
}

/** 发一条文本；失败（网络、非 2xx、飞书 code≠0）只写 stderr，不抛、不重试 */
export async function 发(取, 地址, 密钥, 文本, 现在, 谁) {
  try {
    const body = { msg_type: "text", content: { text: 文本 } };
    if (密钥) {
      const ts = String(Math.floor(现在 / 1000));
      body.timestamp = ts;
      body.sign = 签名(ts, 密钥);
    }
    const r = await 取(地址, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    let j = null;
    try {
      j = await r.json();
    } catch {
      /* 非 JSON 也行 */
    }
    if (!r.ok || (j && typeof j.code === "number" && j.code !== 0)) {
      console.error(`[ent-alert] 发往${谁}失败：HTTP ${r.status}${j && j.code ? ` code ${j.code}` : ""}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[ent-alert] 发往${谁}失败：${e && e.name ? e.name : "Error"}`);
    return false;
  }
}

async function 探活(取, 地址) {
  try {
    const r = await 取(地址, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/* ---------------- 主流程 ---------------- */

const 规则名 = { "R2:total": "服务端报错总量", "R2:people": "多位员工撞上报错", "R3:db": "数据库类报错" };

/**
 * @param {{ 目录: string; dry?: boolean; 现在?: number; 取?: typeof fetch; 输出?: (s: string) => void }} 选项
 * @returns {Promise<{ 发出: { 内容: string; 客户: boolean }[] }>} 本次发的（dry 时是将发的）
 */
export async function 运行(选项) {
  const { 目录, dry = false, 现在 = Date.now(), 取 = fetch, 输出 = (s) => console.log(s) } = 选项;
  const 配置 = 读配置(目录);
  const 实例 = 配置.ALERT_INSTANCE || "企业版";
  const 状态 = 读状态(目录);
  const 待发 = []; // { 优先, 内容, 客户, 应用() }

  // 记录
  let 记录 = [];
  const 遥测目录 = path.join(目录, "telemetry");
  try {
    记录 = 读记录(遥测目录, 现在 - 重报毫秒, 现在).记录.filter(算数);
  } catch (e) {
    console.error(`[ent-alert] 读不了运行记录 ${遥测目录}：${e && e.code ? e.code : "Error"}`);
  }

  // 探活
  const 地址们 = (配置.ALERT_HEALTH_URLS || "").split(",").map((x) => x.trim()).filter(Boolean);
  const 新健康 = {};
  for (const u of 地址们) {
    const 好 = await 探活(取, u);
    新健康[u] = { fails: 好 ? 0 : (状态.health[u]?.fails ?? 0) + 1 };
  }
  const 端口 = (u) => {
    try {
      return new URL(u).host;
    } catch {
      return u;
    }
  };
  for (const u of 地址们) {
    const 键 = `R4:${u}`;
    const 条 = 状态.alerts[键];
    const 败 = 新健康[u].fails;
    if (败 >= 阈值.探活连败 && !条) {
      待发.push({ 优先: 0, 内容: `[告警] ${实例} 服务挂了\n探活连续 ${败} 次不通：${端口(u)}\n时间：${双时区(现在)}`, 客户: false, 应用: () => (状态.alerts[键] = { 客户: false, 首次: 现在, 上次发: 现在 }) });
    } else if (败 >= 阈值.探活连败 && 条 && 现在 - 条.上次发 >= 重报毫秒) {
      待发.push({ 优先: 0, 内容: `[告警·仍在发生] ${实例} 服务仍然不通\n${端口(u)} 已连续 ${败} 次探活不通，首次 ${双时区(条.首次)}\n时间：${双时区(现在)}`, 客户: false, 应用: () => (条.上次发 = 现在) });
    } else if (败 === 0 && 条) {
      待发.push({ 优先: 2, 内容: `[已恢复] ${实例} 服务探活恢复\n${端口(u)}，首次不通 ${双时区(条.首次)}\n时间：${双时区(现在)}`, 客户: false, 应用: () => delete 状态.alerts[键] });
    }
  }

  // 规则
  const 命中 = 评规则(记录, 现在);
  const 命中键 = new Set(命中.map((h) => h.键));
  for (const h of 命中) {
    const 条 = 状态.alerts[h.键];
    const 客户 = h.客户 || !!条?.客户;
    if (!条) {
      待发.push({ 优先: 1, 内容: `[告警] ${实例} ${h.名}\n${h.内容}`, 客户, 应用: () => (状态.alerts[h.键] = { 客户, 首次: 现在, 上次发: 现在 }) });
    } else if (!条.客户 && 客户) {
      // 之前只发过我方，现在升级成要发客户群：不等 60 分钟去重，当次立即按新告警发（我方 + 客户群）
      待发.push({
        优先: 1,
        内容: `[告警] ${实例} ${h.名}\n${h.内容}`,
        客户,
        应用: () => {
          条.客户 = true;
          条.上次发 = 现在;
        },
      });
    } else if (现在 - 条.上次发 >= 重报毫秒) {
      待发.push({
        优先: 1,
        内容: `[告警·仍在发生] ${实例} ${h.名}，过去 60 分钟 ${h.近60} 次\n${h.内容}`,
        客户,
        应用: () => {
          条.上次发 = 现在;
          条.客户 = 客户;
        },
      });
    }
  }
  // 恢复（探活的上面已处理）
  for (const [键, 条] of Object.entries(状态.alerts)) {
    if (键.startsWith("R4:") || 命中键.has(键)) continue;
    if (!键还在发生(键, 记录, 现在)) {
      const 谁 = 键.startsWith("R1:") ? `同类错误：${键.slice(3).replace(/\|/g, " / ")}` : (规则名[键] ?? 键);
      待发.push({ 优先: 2, 内容: `[已恢复] ${实例} 过去 30 分钟没有再出现\n${谁}\n首次 ${双时区(条.首次)}\n时间：${双时区(现在)}`, 客户: !!条.客户, 应用: () => delete 状态.alerts[键] });
    }
  }

  // 状态写不了（磁盘满 / 无写权限）：去重、上限、心跳都失效，照常发会每轮刷屏，所以先试写一次
  if (!dry) {
    try {
      写状态(目录, 状态);
    } catch (e) {
      const 码 = e && e.code ? e.code : "Error";
      console.error(`[ent-alert] 状态写不了：${码}`);
      // 本轮不发客户群、不发常规告警，也不发心跳；只往我方群发一条「状态写不了」。
      // 这条自己的限频不能靠状态文件，退路用系统临时目录里按数据目录区分的小文件，记上次发的时刻，满 60 分钟才再发。
      // 选临时目录而不是「只在整点那次发」：timer 间隔不一定踩中整点，整点法可能一整小时一条都发不出，也可能同一整点发两次。
      // 临时目录也写不了时宁可不发（只写 stderr），也不每 2 分钟刷我方群。
      const 退路 = path.join(os.tmpdir(), `ent-alert-unwritable-${crypto.createHash("sha1").update(path.resolve(目录)).digest("hex").slice(0, 12)}`);
      let 上次 = 0;
      try {
        上次 = Number(fs.readFileSync(退路, "utf8")) || 0;
      } catch {
        /* 没有：当没发过 */
      }
      if (现在 - 上次 >= 重报毫秒 || 现在 < 上次) {
        let 记上 = false;
        try {
          fs.writeFileSync(退路, String(现在));
          记上 = true;
        } catch {
          /* 退路也写不了：不发 */
        }
        if (记上 && 配置.ALERT_WEBHOOK_OURS) {
          const 内容 = `[告警] ${实例} 告警状态写不了（${码}）\n数据目录磁盘满或无写权限；去重和限频失效，已暂停常规告警和客户群通知，每小时提醒一次，请尽快处理。\n时间：${双时区(现在)}`;
          await 发(取, 配置.ALERT_WEBHOOK_OURS, 配置.ALERT_SECRET_OURS, 内容, 现在, "我方群");
          return { 发出: [{ 内容, 客户: false }] };
        }
      }
      return { 发出: [] };
    }
  }

  // 每小时上限
  状态.sent = (状态.sent ?? []).filter((t) => t > 现在 - 3600_000);
  const 余 = Math.max(0, 每小时上限 - 状态.sent.length);
  待发.sort((a, b) => a.优先 - b.优先);
  const 本次 = 待发.slice(0, 余);
  if (待发.length > 余) console.error(`[ent-alert] 每小时上限 ${每小时上限} 条，本次 ${待发.length - 余} 条留到下次`);

  const 发出 = [];
  for (const 项 of 本次) {
    发出.push({ 内容: 项.内容, 客户: 项.客户 });
    if (dry) {
      输出(`--- 将发${项.客户 ? "：我方 + 客户群" : "：仅我方"} ---\n${项.内容}`);
      continue;
    }
    if (配置.ALERT_WEBHOOK_OURS) await 发(取, 配置.ALERT_WEBHOOK_OURS, 配置.ALERT_SECRET_OURS, 项.内容, 现在, "我方群");
    if (项.客户 && 配置.ALERT_WEBHOOK_EVEN) await 发(取, 配置.ALERT_WEBHOOK_EVEN, 配置.ALERT_SECRET_EVEN, 项.内容, 现在, "客户群");
    项.应用();
    状态.sent.push(现在);
  }

  // 心跳：北京 09:00 起当天第一次，只发我方
  const 今天 = 北京日(现在);
  if (北京时(现在) >= 9 && 状态.heartbeatDay !== 今天) {
    let 摘要 = "";
    try {
      const 起 = 现在 - 24 * 3600_000;
      摘要 = 汇总(读记录(遥测目录, 起, 现在).记录, { 起, 止: 现在, top: 8 });
    } catch {
      摘要 = "（运行记录读不了）";
    }
    if (摘要.length > 3000) 摘要 = `${摘要.slice(0, 3000)}\n…（已截断）`;
    const 内容 = `[心跳] ${实例} 告警通道正常\n时间：${双时区(现在)}${地址们.length ? `\n探活：${地址们.map((u) => `${端口(u)} ${新健康[u].fails ? "不通" : "正常"}`).join("；")}` : ""}\n\n${摘要}`;
    发出.push({ 内容, 客户: false });
    if (dry) 输出(`--- 将发：仅我方（心跳）---\n${内容}`);
    else {
      if (配置.ALERT_WEBHOOK_OURS) await 发(取, 配置.ALERT_WEBHOOK_OURS, 配置.ALERT_SECRET_OURS, 内容, 现在, "我方群");
      状态.heartbeatDay = 今天;
    }
  }

  if (!dry) {
    状态.health = 新健康;
    try {
      写状态(目录, 状态);
    } catch (e) {
      console.error(`[ent-alert] 状态写不了：${e && e.code ? e.code : "Error"}`);
    }
  }
  return { 发出 };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const 参数 = process.argv.slice(2);
  const 取值 = (名) => {
    const i = 参数.indexOf(名);
    return i >= 0 ? 参数[i + 1] : undefined;
  };
  const 目录 = 取值("--dir");
  const 现在 = 取值("--now") ? Date.parse(取值("--now")) : Date.now();
  if (!目录 || !Number.isFinite(现在)) {
    console.error("用法：node scripts/ent-alert.mjs --dir <数据目录> [--dry] [--now <ISO 时刻>]");
    process.exit(2);
  }
  try {
    await 运行({ 目录, dry: 参数.includes("--dry"), 现在 });
  } catch (e) {
    console.error(`[ent-alert] 出错：${e && e.message ? e.message : e}`);
  }
  process.exit(0);
}
