/**
 * 企业版运行记录每日摘要（批次 28-⑤）：读最近 24 小时的落盘记录（lib/telemetry/store.ts 写的 tel-YYYY-MM-DD.p<进程>.jsonl），
 * 汇总成纯文本：
 *   一、报错：错误类别 × 错误名 × 页面 × 浏览器版本 → 次数、人数、角色、最常见的那句（已脱敏）
 *   二、慢请求（服务端处理 ≥ 500 ms 的）：路由 × 种类 → 次数、p50、p95、最慢、角色
 *
 *   node scripts/telemetry-daily.mjs [目录] [--hours 24] [--now 2026-11-18T06:00:00Z] [--top 40]
 *
 * 目录不给：CRM_TELEMETRY_DIR，再没有按 DATABASE_URL 找库文件旁边的 telemetry/（同 lib/telemetry/store.ts）。
 * 只读，不改文件；只用 node 自带模块，服务器上直接跑（scp 这一个文件过去，跑完删掉）。
 * 退出码：0 正常（没有记录也是 0，会写「没有记录」）；2 用法错 / 目录读不了。
 * 文件里本来就没有用户名、id、客户数据（字段规矩见 lib/telemetry/fields.ts），摘要可以直接贴进交接。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const 文件名式 = /^tel-(\d{4}-\d{2}-\d{2})\.p\d+\.jsonl$/;
const 日 = 86_400_000;

export function 默认目录(env = process.env) {
  if (env.CRM_TELEMETRY_DIR?.trim()) return env.CRM_TELEMETRY_DIR.trim();
  const url = env.DATABASE_URL ?? "";
  const 库 = url.startsWith("file:") ? url.slice(5).split("?")[0] : "";
  return 库 ? path.join(path.dirname(path.resolve(库)), "telemetry") : null;
}

/** 读 [起, 止) 之间的记录（毫秒）。坏行跳过，回 { 记录, 坏行 } */
export function 读记录(目录, 起, 止) {
  const 最早 = new Date(起 - 日).toISOString().slice(0, 10);
  const 最晚 = new Date(止).toISOString().slice(0, 10);
  const 记录 = [];
  let 坏行 = 0;
  for (const 名 of fs.readdirSync(目录).sort()) {
    const m = 名.match(文件名式);
    if (!m || m[1] < 最早 || m[1] > 最晚) continue;
    for (const 行 of fs.readFileSync(path.join(目录, 名), "utf8").split("\n")) {
      if (!行.trim()) continue;
      let x;
      try {
        x = JSON.parse(行);
      } catch {
        坏行++;
        continue;
      }
      const t = Date.parse(x?.t);
      if (!Number.isFinite(t) || t < 起 || t >= 止) continue;
      记录.push(x);
    }
  }
  return { 记录, 坏行 };
}

/** 最近秩法分位数：从小到大排好的数组里取第 ceil(p×n) 个 */
export function 分位(排好, p) {
  if (!排好.length) return 0;
  return 排好[Math.min(排好.length - 1, Math.max(0, Math.ceil(p * 排好.length) - 1))];
}

const 计数 = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);
const 前几 = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, n);
const 角色串 = (m) => 前几(m, 3).map(([k, v]) => `${k}×${v}`).join(" ") || "—";
const 北京 = (ms) => new Date(ms + 8 * 3600_000).toISOString().slice(5, 16).replace("T", " ");
const UTC = (ms) => new Date(ms).toISOString().slice(0, 16).replace("T", " ");

/**
 * 记录 → 纯文本摘要
 * @param {Record<string, any>[]} 记录
 * @param {{ 起: number; 止: number; top?: number; 坏行?: number }} 选项 起止是毫秒
 */
export function 汇总(记录, 选项) {
  const { 起, 止, top = 40, 坏行 = 0 } = 选项;
  const 报错们 = 记录.filter((x) => x.k === "err");
  const 慢们 = 记录.filter((x) => x.k === "slow" && Number.isFinite(x.ms));
  const 出 = [];
  出.push(`企业版运行记录摘要  ${UTC(起)} → ${UTC(止)} UTC（北京 ${北京(起)} → ${北京(止)}）`);
  出.push(`共 ${记录.length} 条：报错 ${报错们.length} 条（浏览器 ${报错们.filter((x) => x.src === "browser").length}、服务端 ${报错们.filter((x) => x.src === "server").length}），慢请求 ${慢们.length} 条${坏行 ? `；坏行 ${坏行} 条已跳过` : ""}`);
  if (!记录.length) {
    出.push("", "没有记录。");
    return 出.join("\n");
  }

  // 一、报错
  const 组 = new Map();
  for (const x of 报错们) {
    const 键 = [x.type ?? "?", x.name ?? "", x.route ?? "?", x.br ?? "?"].join("\u0000");
    let g = 组.get(键);
    if (!g) 组.set(键, (g = { type: x.type ?? "?", name: x.name ?? "", route: x.route ?? "?", br: x.br ?? "?", 次: 0, 人: new Set(), 角色: new Map(), 话: new Map(), 系统: new Map(), 壳: new Map() }));
    g.次++;
    if (x.u) g.人.add(x.u);
    计数(g.角色, x.role ?? "?");
    if (x.msg) 计数(g.话, x.msg);
    计数(g.系统, x.os ?? "?");
    if (x.shell) 计数(g.壳, x.shell);
  }
  出.push("", `一、报错（错误类别 × 页面 × 浏览器版本，按次数排；人数 = 当天不同的人）`);
  if (!组.size) 出.push("  没有。");
  const 报错排 = [...组.values()].sort((a, b) => b.次 - a.次 || a.route.localeCompare(b.route));
  for (const g of 报错排.slice(0, top)) {
    const 壳 = g.壳.size ? ` 壳:${前几(g.壳, 2).map(([k]) => k).join("/")}` : "";
    出.push(`  ${String(g.次).padStart(4)} 次 ${String(g.人.size).padStart(3)} 人 | ${g.type}${g.name && g.name !== g.type ? `/${g.name}` : ""} | ${g.route} | ${g.br}（${前几(g.系统, 2).map(([k]) => k).join("/")}${壳}） | ${角色串(g.角色)}`);
    const 话 = 前几(g.话, 1)[0];
    if (话) 出.push(`         └ ${话[0]}${g.话.size > 1 ? `（另有 ${g.话.size - 1} 种）` : ""}`);
  }
  if (报错排.length > top) 出.push(`  …另有 ${报错排.length - top} 组，共 ${报错排.slice(top).reduce((s, g) => s + g.次, 0)} 次`);

  // 二、慢请求
  const 慢组 = new Map();
  for (const x of 慢们) {
    const 键 = `${x.route ?? "?"}\u0000${x.kind ?? "?"}`;
    let g = 慢组.get(键);
    if (!g) 慢组.set(键, (g = { route: x.route ?? "?", kind: x.kind ?? "?", ms: [], 角色: new Map(), 错: 0 }));
    g.ms.push(x.ms);
    计数(g.角色, x.role ?? "?");
    if (x.status >= 500) g.错++;
  }
  出.push("", `二、慢请求（服务端处理 ≥ 门槛的才记，p50/p95 是这些慢请求里的；按次数排）`);
  if (!慢组.size) 出.push("  没有。");
  const 慢排 = [...慢组.values()].map((g) => ({ ...g, ms: g.ms.sort((a, b) => a - b) })).sort((a, b) => b.ms.length - a.ms.length || 分位(b.ms, 0.95) - 分位(a.ms, 0.95));
  for (const g of 慢排.slice(0, top)) {
    出.push(`  ${String(g.ms.length).padStart(4)} 次 | p50 ${String(分位(g.ms, 0.5)).padStart(5)} ms | p95 ${String(分位(g.ms, 0.95)).padStart(5)} ms | 最慢 ${String(g.ms[g.ms.length - 1]).padStart(5)} ms | ${g.kind} ${g.route}${g.错 ? ` | 5xx ${g.错}` : ""} | ${角色串(g.角色)}`);
  }
  if (慢排.length > top) 出.push(`  …另有 ${慢排.length - top} 组，共 ${慢排.slice(top).reduce((s, g) => s + g.ms.length, 0)} 次`);
  return 出.join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const 参数 = process.argv.slice(2);
  const 取 = (名) => {
    const i = 参数.indexOf(名);
    return i >= 0 ? 参数[i + 1] : undefined;
  };
  const 有值的 = new Set(["--hours", "--now", "--top"]);
  const 目录 = 参数.find((a, i) => !a.startsWith("--") && !有值的.has(参数[i - 1])) ?? 默认目录();
  const 小时 = Number(取("--hours") ?? 24);
  const 止 = 取("--now") ? Date.parse(取("--now")) : Date.now();
  const top = Number(取("--top") ?? 40);
  if (!目录 || !Number.isFinite(小时) || 小时 <= 0 || !Number.isFinite(止) || !Number.isFinite(top) || top < 1) {
    console.error("用法：node scripts/telemetry-daily.mjs [目录] [--hours 24] [--now <ISO 时刻>] [--top 40]（目录不给时读 CRM_TELEMETRY_DIR 或 DATABASE_URL）");
    process.exit(2);
  }
  let 读到;
  try {
    读到 = 读记录(目录, 止 - 小时 * 3600_000, 止);
  } catch (e) {
    console.error(`读不了 ${目录}：${e.message}`);
    process.exit(2);
  }
  console.log(汇总(读到.记录, { 起: 止 - 小时 * 3600_000, 止, top, 坏行: 读到.坏行 }));
}
