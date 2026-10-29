#!/usr/bin/env node
/**
 * 企业版写入压测（S5 写入 + S6 登录，2026-10-29）。骨架、参数、口径照 enterprise-p95.mjs（那份一行没动）。
 *
 *   node scripts/perf/enterprise-write.mjs --out <输出目录> [--scale 10] [--duration 180] [--port 3571] [--skip-build] [--reuse-db] [--org] [--login-rounds 4]
 *   GATE=1 …   不达标就以 1 退出
 *
 * 流程：
 *   1. <输出目录>/crm.db 新建一份空库（prisma db push），enterprise-seed.ts 造 30 人 + SCALE 倍数据；
 *      --org 再跑 enterprise-org-seed.ts（组织架构 + 每 25 位 1 位进公海 + 按组织看客户）。没有 --org 就没有公海，「领取公海」这一类跳过、结果里写明。
 *      然后每次都跑 enterprise-write-seed.ts：设测试密码（明文只在 <输出目录>/.perf-password）、每人建 2 个项目、写 write-targets.json
 *   2. next build + next start，和 p95 一样按企业版部署包的样子起（CRM_ENTERPRISE=1、TZ=Asia/Shanghai、LLM_API_KEY 置空）
 *   3. 同一个 AUTH_SECRET 给 30 人签会话票据（同 p95）
 *   4. 热身：每人每类写各做一次（不计数），顺带确认每类都真能写进去；有一类写不进去就停
 *   5. S5：30 人同时写 --duration 秒，每人每次随机挑一类写、做完停 1–3 秒。四类：
 *        新建跟进   saveFollowUp       src/app/(app)/customers/[id]/actions.ts   本人名下、不在公海的客户，电话沟通 · 已完成
 *        改客户字段 patchCustomer      src/app/(app)/customers/actions.ts        本人名下的客户，改「备注」
 *        领取公海   领取               src/app/(app)/customers/pool-actions.ts   预先按人分好的公海客户（不分给原负责人），一次领一位
 *        改项目阶段 改项目节点         src/app/(app)/projects/actions.ts         本人的项目，在 商机·明确需求 ↔ 共识方案 之间来回
 *      压测进行到 25% 时管理员导入一份 2000 行的表（<输出目录>/导入-2000.csv），走抽屉同一条路：
 *        暂存导入表（分块，每块约 15 万字，和 ImportDrawer 一样）→ 预览导入 → 分段导入（每趟约 2 秒，接着调到 下一个 = null）
 *      进行到 55% 时备份一次：另起一个 node 进程对 crm.db 做 VACUUM INTO（scripts/backup.sh 的核心做法；main 上没有应用内备份接口），
 *      备份出来的库再做 quick_check、数一下客户数，对得上才算成功
 *   6. S6：先 30 人同一刻各登一次（早上齐登），再跑 --login-rounds 轮（每人在 3 秒内随机时刻登一次）
 *   7. 扫 server.log 里 SQLITE_BUSY / database is locked 的次数；前后各数一次几张表的行数
 *   8. 写 result.json、result.md
 *
 * 为什么全走 server action：这五样（跟进、改客户、领公海、改项目节点、登录、导入）界面上调的都是 server action，
 * src/app/api 下没有等价的 route.ts（/api/enterprise-import/upload 是飞书 / 钉钉迁移用的，不是客户表导入）。
 * 所以照浏览器的样子发：POST 到这个 action 所在的页面，带 Next-Action 头（action id）、Origin（Next 拿它和 Host 比，防跨站）、
 * 请求体是参数数组的 JSON（React encodeReply 对纯 JSON 参数就是这个；以 $ 开头的字符串要写成 $$，这里不造这种值）。
 * action id 每次构建都会变，从 .next/server/server-reference-manifest.json 里按「源文件 + 导出名」查。
 * 回来的是 RSC 流（text/x-component），第 1 行是 action 的返回值。
 *
 * 判定（GATE=1 时任何一条不满足以 1 退出）：
 *   每类写 p95 < 300 ms、p99 < 1000 ms、0 次出错（含返回 ok:false）；全程 0 个 5xx；
 *   响应和 server.log 里 0 个 SQLITE_BUSY / database is locked；登录 p95 < 800 ms；导入、备份都成功。
 *
 * 耗时口径同 p95：从发请求到响应体读完，本机回环。只写 <输出目录> 里新建的库，不碰正式库、不花钱。
 */
import { execFileSync, execFile, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const 仓库 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(仓库, "package.json"));
const { SignJWT } = require("jose");
const 异步跑 = promisify(execFile);

const 参数 = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]] : a), []));
if (!参数.out) throw new Error("要 --out <输出目录>");
const 输出 = path.resolve(参数.out);
const SCALE = Number(参数.scale ?? 10);
const 时长 = Number(参数.duration ?? 180) * 1000;
const 端口 = Number(参数.port ?? 3571);
const 登录轮数 = Number(参数["login-rounds"] ?? 4);
const 站 = `http://127.0.0.1:${端口}`;
const 库 = path.join(输出, "crm.db");
const 名单文件 = path.join(输出, "people.json");
const 种子文件 = path.join(输出, "seed.json");
const 目标文件 = path.join(输出, "write-targets.json");
const 要组织 = 参数.org === "1";
const 密钥 = "perf-only-secret-not-used-anywhere-else-0123456789";
const 门槛 = { p95: 300, p99: 1000, 登录p95: 800 };
const 导入行数 = 2000;
const 等 = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(输出, { recursive: true });

const 环境 = {
  ...process.env,
  NODE_ENV: "production",
  DATABASE_URL: `file:${库}`,
  AUTH_SECRET: 密钥,
  CRM_ENTERPRISE: "1",
  COOKIE_SECURE: "false",
  TZ: "Asia/Shanghai",
  LLM_API_KEY: "",
  NEXT_TELEMETRY_DISABLED: "1",
};
delete 环境.DESKTOP_DATA;
delete 环境.DESKTOP_LOCAL;
delete 环境.MULTI_TENANT;

const 跑 = (cmd, args, env = 环境) => execFileSync(cmd, args, { cwd: 仓库, env, stdio: "inherit" });
const 秒表 = () => { const t = Date.now(); return () => +((Date.now() - t) / 1000).toFixed(1); };
const 结果 = { at: new Date().toISOString(), scale: SCALE, users: 30, durationSec: 时长 / 1000, node: process.version, platform: `${process.platform}-${process.arch}` };

/* 另起 node 进程读写 sqlite：压测进程自己一直在计时，同步的 VACUUM / count 放在这里会把它卡住、量出来的数就不准了 */
const SQL脚本 = `
const { DatabaseSync } = require("node:sqlite");
const [做, 源, 去] = process.argv.slice(1);
const db = new DatabaseSync(源);
db.exec("PRAGMA busy_timeout = 5000");
if (做 === "数") {
  const 数 = (sql) => db.prepare(sql).get().n;
  console.log(JSON.stringify({
    客户: 数("SELECT count(*) n FROM Customer"),
    跟进: 数("SELECT count(*) n FROM FollowUp"),
    压测改过备注的客户: 数("SELECT count(*) n FROM Customer WHERE remark LIKE '压测改备注%'"),
    公海: 数("SELECT count(*) n FROM CustomerPool"),
    领取记录: 数("SELECT count(*) n FROM CustomerClaim"),
    项目: 数("SELECT count(*) n FROM Project"),
    节点变更: 数("SELECT count(*) n FROM ProjectNodeLog"),
    导入批次: 数("SELECT count(*) n FROM ImportBatch"),
    导入行: 数("SELECT count(*) n FROM ImportRow"),
    操作日志: 数("SELECT count(*) n FROM AuditLog"),
  }));
} else {
  const t = Date.now();
  db.exec("VACUUM INTO '" + 去.replaceAll("'", "''") + "'");
  const ms = Date.now() - t;
  db.close();
  const b = new DatabaseSync(去, { readOnly: true });
  console.log(JSON.stringify({ ms, quickCheck: b.prepare("PRAGMA quick_check").get().quick_check, 客户: b.prepare("SELECT count(*) n FROM Customer").get().n }));
}
`;
const 走SQL = async (...args) => JSON.parse((await 异步跑(process.execPath, ["--no-warnings", "-e", SQL脚本, ...args], { maxBuffer: 1 << 20 })).stdout.trim());

/* ---------- 1. 库和数据 ---------- */
if (!参数["reuse-db"] || !fs.existsSync(库)) {
  for (const f of [库, `${库}-journal`, `${库}-wal`, `${库}-shm`, 种子文件]) fs.rmSync(f, { force: true });
  const 计 = 秒表();
  跑("npx", ["prisma", "db", "push", "--skip-generate"], { ...环境, NODE_ENV: "development" });
  跑("npx", ["tsx", "scripts/perf/enterprise-seed.ts"], { ...环境, NODE_ENV: "development", SCALE: String(SCALE), OUT: 名单文件, EXTRA: "" });
  if (要组织) 跑("npx", ["tsx", "scripts/perf/enterprise-org-seed.ts"], { ...环境, NODE_ENV: "development", SEED: 种子文件 });
  结果.seedSec = 计();
}
const 种子 = fs.existsSync(种子文件) ? JSON.parse(fs.readFileSync(种子文件, "utf8")) : {};
if (!!种子.extra) throw new Error(`${库} 是带 --extra 造的（p95 那份），这里要不带的：换个输出目录`);
if (!!种子.org !== 要组织) throw new Error(`${库} ${种子.org ? "有" : "没有"}组织架构，这次${要组织 ? "带了" : "没带"} --org：去掉 --reuse-db 重造，或换个输出目录`);
跑("npx", ["tsx", "scripts/perf/enterprise-write-seed.ts"], { ...环境, NODE_ENV: "development", OUT_DIR: 输出 });
结果.seed = 种子;
结果.dbMB = +(fs.statSync(库).size / 1048576).toFixed(1);
const 目标 = JSON.parse(fs.readFileSync(目标文件, "utf8"));
const 名单 = 目标.users;
const 测试密码 = fs.readFileSync(path.join(输出, ".perf-password"), "utf8");
结果.rowsBefore = await 走SQL("数", 库);

/* ---------- 2. 生产构建 + 启动 ---------- */
if (!参数["skip-build"]) {
  const 计 = 秒表();
  跑("npx", ["next", "build"]);
  结果.buildSec = 计();
}

/* 从构建产物里按「源文件 + 导出名」查 action id（每次构建都变）。查不到就停：说明函数改了名或挪了文件，脚本要跟着改 */
const 清单 = JSON.parse(fs.readFileSync(path.join(仓库, ".next/server/server-reference-manifest.json"), "utf8"));
function 动作(文件, 名) {
  const 中 = Object.entries(清单.node ?? {}).filter(([, v]) => v.filename === 文件 && v.exportedName === 名);
  if (中.length !== 1) throw new Error(`构建产物里找到 ${中.length} 个 ${文件} 的 ${名}（要正好 1 个）`);
  return { id: 中[0][0], 名, 文件, workers: Object.keys(中[0][1].workers ?? {}) };
}
const A = {
  跟进: 动作("src/app/(app)/customers/[id]/actions.ts", "saveFollowUp"),
  改客户: 动作("src/app/(app)/customers/actions.ts", "patchCustomer"),
  领取: 动作("src/app/(app)/customers/pool-actions.ts", "领取"),
  改阶段: 动作("src/app/(app)/projects/actions.ts", "改项目节点"),
  登录: 动作("src/app/login/actions.ts", "login"),
  暂存: 动作("src/app/(app)/customers/import-actions.ts", "暂存导入表"),
  预览: 动作("src/app/(app)/customers/import-actions.ts", "预览导入"),
  分段: 动作("src/app/(app)/customers/import-actions.ts", "分段导入"),
};
结果.actions = Object.fromEntries(Object.entries(A).map(([k, v]) => [k, { 文件: v.文件, 导出名: v.名, workers: v.workers }]));

const 服务 = spawn("npx", ["next", "start", "--port", String(端口)], { cwd: 仓库, env: 环境, stdio: ["ignore", "pipe", "pipe"], detached: true });
const 服务日志 = fs.createWriteStream(path.join(输出, "server.log"));
服务.stdout.pipe(服务日志);
服务.stderr.pipe(服务日志);
// 按进程组 pid 收（next start 是 npx 起的，子进程在同一组里）；不按名字杀
const 收尾 = () => { try { process.kill(-服务.pid, "SIGTERM"); } catch { /* 已经退了 */ } };
process.on("exit", 收尾);
process.on("SIGINT", () => process.exit(130));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });

for (let i = 0; ; i++) {
  if (i > 120) throw new Error("服务 60 秒没起来，看 server.log");
  try { if ((await fetch(`${站}/login`)).ok) break; } catch { /* 还没起来 */ }
  await 等(500);
}

/* ---------- 3. 会话票据 ---------- */
const 钥 = new TextEncoder().encode(密钥);
for (const u of 名单) {
  u.cookie = `crm_session=${await new SignJWT({ sub: u.id, ims: Date.now() }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(钥)}`;
}

/* ---------- 调一次 server action ---------- */
const 忙 = /SQLITE_BUSY|database is locked/i;
/** RSC 流一行一条：`<号>:<JSON>`。第 1 行是返回值（第 0 行是 {a:"$@1", b:构建号…}）；对纯 JSON 返回值只要还原 $$ 和 $undefined */
function 读返回(文) {
  const 行们 = new Map();
  for (const 行 of 文.split("\n")) { const m = /^([0-9a-f]+):(.*)$/.exec(行); if (m) 行们.set(m[1], m[2]); }
  const 还原 = (v) => (typeof v === "string" ? (v === "$undefined" ? undefined : v.startsWith("$$") ? v.slice(1) : v)
    : Array.isArray(v) ? v.map(还原) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, 还原(x)])) : v);
  for (const 号 of ["1", "0"]) {
    if (!行们.has(号)) continue;
    try {
      const v = JSON.parse(行们.get(号));
      if (号 === "0" && v && typeof v === "object" && "a" in v && typeof v.a !== "string") return 还原(v.a);
      if (号 === "1") return 还原(v);
    } catch { /* 不是 JSON（报错行之类），往下看 */ }
  }
  return undefined;
}
async function 调(u, 动, 路径, args) {
  const headers = { "Next-Action": 动.id, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", Origin: 站 };
  if (u?.cookie) headers.cookie = u.cookie;
  const t = performance.now();
  try {
    const r = await fetch(`${站}${路径}`, { method: "POST", headers, body: JSON.stringify(args), redirect: "manual" });
    const 文 = await r.text();
    const ms = performance.now() - t;
    const 值 = r.status === 200 ? 读返回(文) : undefined;
    const busy = 忙.test(文);
    const ok = r.status === 200 && 值 != null && 值.ok !== false && !busy;
    const err = ok ? undefined : r.status !== 200 ? `HTTP ${r.status}` : busy ? "SQLITE_BUSY" : 值?.error ? String(值.error).slice(0, 80) : `看不懂的返回：${文.slice(0, 80)}`;
    return { ms, ok, status: r.status, busy, err, 值, setCookie: r.headers.get("set-cookie") ?? "" };
  } catch (e) {
    return { ms: performance.now() - t, ok: false, status: String(e?.cause?.code ?? e), err: String(e?.cause?.code ?? e) };
  }
}

/* ---------- 四类写 ---------- */
let 序 = 0;
const 有公海 = 目标.org && 目标.pool > 0;
const 写法 = {
  新建跟进: { 能做: (u) => u.follow.length > 0, 做: (u) => {
    const cid = u.follow[Math.floor(Math.random() * u.follow.length)];
    return 调(u, A.跟进, `/customers/${cid}`, [{ customerId: cid, type: "PHONE", title: "", content: `压测跟进 ${++序}：电话聊了报价和交期`, status: "已完成", occurredAt: new Date(Date.now() - 60_000).toISOString() }]);
  } },
  改客户字段: { 能做: (u) => u.patch.length > 0, 做: (u) => {
    const cid = u.patch[Math.floor(Math.random() * u.patch.length)];
    return 调(u, A.改客户, "/customers", [cid, "remark", `压测改备注 ${++序}`]);
  } },
  领取公海: { 能做: (u) => 有公海 && u.pool.length > 0, 做: async (u) => {
    const cid = u.pool.shift();
    const r = await 调(u, A.领取, "/customers", [[cid]]);
    // 分好的不会被别人领走：领到 0 位说明哪里不对，算出错
    if (r.ok && r.值?.updated !== 1) Object.assign(r, { ok: false, err: `领到 ${r.值?.updated} 位` });
    return r;
  } },
  改项目阶段: { 能做: (u) => u.projects.length > 0, 做: async (u) => {
    const 项 = u.projects[Math.floor(Math.random() * u.projects.length)];
    const 去 = 项.node === "明确需求" ? "共识方案" : "明确需求";
    const r = await 调(u, A.改阶段, `/projects/${项.id}`, [项.id, { phase: "商机", node: 去 }]);
    if (r.ok) 项.node = 去;
    return r;
  } },
};
const 写类 = Object.keys(写法);
结果.skipped = 有公海 ? [] : [`领取公海：库里${目标.org ? "公海是空的" : "没有组织架构（没带 --org），企业版的公海客户是 enterprise-org-seed.ts 放进去的"}，这一类跳过`];

/* 热身：每人每类各一次，不计数；也确认每类都写得进去 */
const 坏 = [];
for (const u of 名单) for (const 类 of 写类) {
  if (!写法[类].能做(u)) continue;
  const r = await 写法[类].做(u);
  if (!r.ok) 坏.push(`${u.id} ${类} → ${r.err}`);
}
if (坏.length) { console.error("热身有写入没成：\n" + 坏.slice(0, 20).join("\n")); process.exit(1); }

/* ---------- 导入（2000 行）和备份，压测中途各一次 ---------- */
const 导入表 = path.join(输出, `导入-${导入行数}.csv`);
fs.writeFileSync(导入表, ["姓名,手机号,公司,备注", ...Array.from({ length: 导入行数 }, (_, i) => `导入压测${i},139${String(10_000_000 + i).slice(-8)},压测导入公司${i % 50},第 ${i} 行`)].join("\n"));
async function 导入一次() {
  const 管理员 = 名单.find((u) => u.role === "ADMIN");
  const [表头, ...行] = fs.readFileSync(导入表, "utf8").split("\n").map((l) => l.split(","));
  const 号 = `perf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const t = performance.now();
  const 记 = { rows: 行.length, ok: false, chunks: 0, segments: 0 };
  try {
    // 和 ImportDrawer 的 送表 一样按字数切块
    for (let 起 = 0; 起 < 行.length;) {
      let 止 = 起, 字 = 0;
      while (止 < 行.length && (止 === 起 || 字 < 150_000)) 字 += 行[止++].reduce((n, x) => n + x.length + 4, 0);
      const r = await 调(管理员, A.暂存, "/customers", [号, { 起, 数据: 行.slice(起, 止) }, ...(起 === 0 ? [{ 表头, 共: 行.length }] : [])]);
      if (!r.ok) throw new Error(`暂存第 ${起} 行起：${r.err}`);
      记.chunks++;
      起 = 止;
    }
    const 方案 = { 表头, 数据: [], 映射: ["name", "phone", "school", "remark"], 改过: {}, 重复行: "跳过", 没对上的列: "并进备注", 暂存: 号 };
    const tp = performance.now();
    const 预 = await 调(管理员, A.预览, "/customers", [方案]);
    if (!预.ok) throw new Error(`预览：${预.err}`);
    记.previewMs = Math.round(performance.now() - tp);
    记.preview = { 新建: 预.值.预览.新建, 跳过: 预.值.预览.跳过, 进不了: 预.值.预览.进不了 };
    记.segmentMs = [];
    let 续 = { 起: 0 };
    for (;;) {
      const r = await 调(管理员, A.分段, "/customers", [方案, path.basename(导入表), 续]);
      if (!r.ok) throw new Error(`分段导入（从第 ${续.起} 条）：${r.err}`);
      记.segments++;
      记.segmentMs.push(Math.round(r.ms));
      if (r.值.下一个 == null) { Object.assign(记, { 新建: r.值.新建, 补空: r.值.补空, 跳过: r.值.跳过, 进不了: r.值.进不了 }); break; }
      续 = { batchId: r.值.batchId, 起: r.值.下一个 };
    }
    记.ok = 记.新建 + 记.跳过 + 记.补空 + 记.进不了 === 行.length && 记.进不了 === 0;
    if (!记.ok) 记.error = "条数对不上或有进不了的行";
  } catch (e) {
    记.error = String(e?.message ?? e);
  }
  记.ms = Math.round(performance.now() - t);
  return 记;
}
async function 备份一次() {
  const 去 = path.join(输出, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  const t = performance.now();
  try {
    const r = await 走SQL("备份", 库, 去);
    const 记 = { ms: Math.round(performance.now() - t), vacuumMs: r.ms, file: 去, mb: +(fs.statSync(去).size / 1048576).toFixed(1), quickCheck: r.quickCheck, 客户: r.客户 };
    return { ...记, ok: r.quickCheck === "ok" && r.客户 > 0 };
  } catch (e) {
    return { ms: Math.round(performance.now() - t), ok: false, error: String(e?.stderr || e?.message || e).slice(0, 300) };
  }
}

/* ---------- 5. S5：30 人同时写 ---------- */
const 内存 = [];
const 量内存 = () => {
  try {
    const 表 = execFileSync("ps", ["-A", "-o", "pid=,ppid=,rss="], { encoding: "utf8" }).trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
    const 子孙 = new Set([服务.pid]);
    for (let 变 = true; 变;) { 变 = false; for (const [pid, ppid] of 表) if (子孙.has(ppid) && !子孙.has(pid)) { 子孙.add(pid); 变 = true; } }
    内存.push(表.filter(([pid]) => 子孙.has(pid)).reduce((s, [, , rss]) => s + rss, 0) / 1024);
  } catch { /* 量不到就算了 */ }
};
const 内存表 = setInterval(量内存, 5000);
const 样本 = [];
const 开始 = Date.now();
const 截止 = 开始 + 时长;
const 旁路 = [
  等(时长 * 0.25).then(async () => { const at = Math.round((Date.now() - 开始) / 1000); 结果.import = { atSec: at, ...(await 导入一次()) }; }),
  等(时长 * 0.55).then(async () => { const at = Math.round((Date.now() - 开始) / 1000); 结果.backup = { atSec: at, ...(await 备份一次()) }; }),
];
await Promise.all(名单.map(async (u) => {
  await 等(Math.random() * 2000);
  while (Date.now() < 截止) {
    const 可 = 写类.filter((k) => 写法[k].能做(u));
    if (!可.length) break;
    const 类 = 可[Math.floor(Math.random() * 可.length)];
    const r = await 写法[类].做(u);
    样本.push({ ms: r.ms, ok: r.ok, status: r.status, busy: !!r.busy, err: r.err, 类, role: u.role, t: Date.now() - 开始 });
    await 等(1000 + Math.random() * 2000);
  }
}));
await Promise.all(旁路);
clearInterval(内存表);
量内存();
结果.poolLeft = 名单.reduce((s, u) => s + u.pool.length, 0);

const 分位 = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)].toFixed(1); };
const 汇总 = (样) => ({ n: 样.length, errors: 样.filter((x) => !x.ok).length, busy: 样.filter((x) => x.busy).length, http5xx: 样.filter((x) => typeof x.status === "number" && x.status >= 500).length, p50: 分位(样.map((x) => x.ms), 0.5), p95: 分位(样.map((x) => x.ms), 0.95), p99: 分位(样.map((x) => x.ms), 0.99), max: 分位(样.map((x) => x.ms), 1) });

结果.write = { all: 汇总(样本), kinds: {}, byRole: {} };
for (const 类 of 写类) 结果.write.kinds[类] = 汇总(样本.filter((x) => x.类 === 类));
for (const role of ["ADMIN", "MANAGER", "SALES"]) 结果.write.byRole[role] = 汇总(样本.filter((x) => x.role === role));
结果.write.rps = +(样本.length / (时长 / 1000)).toFixed(1);
// 导入、备份那几秒里的写入单独看：p99 要是被它俩拖上去，这里看得出来
// 窗口至少 3 秒：备份往往几十毫秒就完了，窗口太窄只落进一两个样本，看不出影响
const 窗 = (起, 长) => (起 == null ? null : 汇总(样本.filter((x) => x.t >= 起 && x.t <= 起 + Math.max(长, 3000))));
结果.write.duringImport = 结果.import ? 窗(结果.import.atSec * 1000, 结果.import.ms) : null;
结果.write.duringBackup = 结果.backup ? 窗(结果.backup.atSec * 1000, 结果.backup.ms) : null;
结果.write.errorsSample = [...new Set(样本.filter((x) => !x.ok).map((x) => `${x.类} → ${x.err}`))].slice(0, 10);

/* ---------- 6. S6：登录 ---------- */
const 登一次 = async (u) => {
  const r = await 调(null, A.登录, "/login", [u.email, 测试密码]);
  // 返回 ok 之外还得真发了会话 cookie
  if (r.ok && !/crm_session=/.test(r.setCookie)) Object.assign(r, { ok: false, err: "没发会话 cookie" });
  return { ms: r.ms, ok: r.ok, status: r.status, busy: !!r.busy, err: r.err };
};
const 齐登 = await Promise.all(名单.map(登一次));
const 错开 = [];
for (let 轮 = 0; 轮 < 登录轮数; 轮++) 错开.push(...(await Promise.all(名单.map(async (u) => { await 等(Math.random() * 3000); return 登一次(u); }))));
结果.login = { all: 汇总([...齐登, ...错开]), 齐登: 汇总(齐登), 错开: 汇总(错开), rounds: 登录轮数, errorsSample: [...new Set([...齐登, ...错开].filter((x) => !x.ok).map((x) => x.err))].slice(0, 5) };

/* ---------- 7. 日志和行数 ---------- */
await new Promise((r) => 服务日志.write("", r));
const 日志 = fs.readFileSync(path.join(输出, "server.log"), "utf8");
结果.serverLog = {
  SQLITE_BUSY: (日志.match(/SQLITE_BUSY/g) ?? []).length,
  databaseIsLocked: (日志.match(/database is locked/gi) ?? []).length,
  errorLines: [...new Set(日志.split("\n").filter((l) => /error/i.test(l)).map((l) => l.slice(0, 160)))].slice(0, 8),
};
结果.rowsAfter = await 走SQL("数", 库);
结果.serverRssMB = { max: 内存.length ? Math.round(Math.max(...内存)) : null, last: 内存.length ? Math.round(内存.at(-1)) : null };

const 不达标 = [];
for (const [类, v] of Object.entries(结果.write.kinds)) {
  if (!v.n) continue;
  if (v.p95 >= 门槛.p95) 不达标.push(`${类} p95 ${v.p95} ms`);
  if (v.p99 >= 门槛.p99) 不达标.push(`${类} p99 ${v.p99} ms`);
  if (v.errors) 不达标.push(`${类} 出错 ${v.errors} 次`);
}
const 五 = 结果.write.all.http5xx + 结果.login.all.http5xx;
const 锁 = 结果.write.all.busy + 结果.login.all.busy + 结果.serverLog.SQLITE_BUSY + 结果.serverLog.databaseIsLocked;
if (五) 不达标.push(`5xx ${五} 次`);
if (锁) 不达标.push(`SQLITE_BUSY / database is locked ${锁} 处`);
if (结果.login.all.p95 >= 门槛.登录p95) 不达标.push(`登录 p95 ${结果.login.all.p95} ms`);
if (结果.login.all.errors) 不达标.push(`登录出错 ${结果.login.all.errors} 次`);
if (!结果.import?.ok) 不达标.push(`导入没成：${结果.import?.error ?? "没跑到"}`);
if (!结果.backup?.ok) 不达标.push(`备份没成：${结果.backup?.error ?? "没跑到"}`);
结果.pass = 不达标.length === 0;
结果.over = 不达标;
fs.writeFileSync(path.join(输出, "result.json"), JSON.stringify(结果, null, 2));

/* ---------- 8. 报告 ---------- */
const 行 = (k, v) => `| ${k} | ${v.n} | ${v.p50} | **${v.p95}** | ${v.p99} | ${v.max} | ${v.errors} |`;
const 表头行 = ["| 写入 | 次数 | p50 | p95 | p99 | 最慢 | 出错 |", "|---|---|---|---|---|---|---|"];
const 前 = 结果.rowsBefore, 后 = 结果.rowsAfter;
const 导 = 结果.import, 备 = 结果.backup;
const md = [
  `# 企业版写入压测：30 人 × ${SCALE} 倍数据`,
  "",
  `${结果.at}，${结果.platform}，Node ${结果.node}。数据：${目标.org ? `带组织架构（公海 ${目标.pool} 位）` : "不带组织架构"}，项目 ${名单.reduce((s, u) => s + u.projects.length, 0)} 个。库 ${结果.dbMB} MB；压测 ${时长 / 1000} 秒，${结果.write.rps} 次写/秒；服务端内存峰值 ${结果.serverRssMB.max} MB。`,
  "",
  `**裁判：每类写 p95 < ${门槛.p95} ms、p99 < ${门槛.p99} ms、不出错；0 个 5xx；0 个 SQLITE_BUSY；登录 p95 < ${门槛.登录p95} ms；导入、备份都成 → ${结果.pass ? "绿" : "红"}**${不达标.length ? `（${不达标.join("；")}）` : ""}`,
  ...(结果.skipped.length ? ["", ...结果.skipped.map((s) => `- 跳过：${s}`)] : []),
  "",
  "## S5 30 人同时写（ms，响应体读完为止）",
  "",
  ...表头行,
  ...Object.entries(结果.write.kinds).filter(([, v]) => v.n).map(([k, v]) => 行(k, v)),
  行("合计", 结果.write.all),
  ...(结果.write.duringImport ? [行("其中导入那几秒", 结果.write.duringImport)] : []),
  ...(结果.write.duringBackup ? [行("其中备份那几秒", 结果.write.duringBackup)] : []),
  "",
  "按角色：" + Object.entries(结果.write.byRole).map(([k, v]) => `${k} p95 ${v.p95} ms（${v.n} 次）`).join("；"),
  ...(结果.write.errorsSample.length ? ["", `出错举例：${结果.write.errorsSample.join("；")}`] : []),
  "",
  "## 压测中途的导入和备份",
  "",
  "| 事 | 开始于 | 耗时 | 成没成 | 说明 |",
  "|---|---|---|---|---|",
  导 ? `| 导入 ${导.rows} 行 | 第 ${导.atSec} 秒 | ${(导.ms / 1000).toFixed(1)} 秒 | ${导.ok ? "成" : "没成"} | ${导.ok ? `暂存 ${导.chunks} 块、预览 ${导.previewMs} ms、分段 ${导.segments} 趟（${导.segmentMs.join(" / ")} ms）；新建 ${导.新建}、跳过 ${导.跳过}、补空 ${导.补空}、进不了 ${导.进不了}` : 导.error} |` : "| 导入 | — | — | 没跑到 | — |",
  备 ? `| 备份（VACUUM INTO） | 第 ${备.atSec} 秒 | ${(备.ms / 1000).toFixed(1)} 秒 | ${备.ok ? "成" : "没成"} | ${备.ok ? `VACUUM ${备.vacuumMs} ms，${备.mb} MB，quick_check ${备.quickCheck}，客户 ${备.客户} 位` : 备.error ?? `quick_check ${备.quickCheck}`} |` : "| 备份 | — | — | 没跑到 | — |",
  "",
  "## S6 登录（30 人，ms）",
  "",
  "| 登录 | 次数 | p50 | p95 | p99 | 最慢 | 出错 |",
  "|---|---|---|---|---|---|---|",
  行("30 人同一刻", 结果.login.齐登),
  行(`错开（${登录轮数} 轮，每人 3 秒内随机）`, 结果.login.错开),
  行("合计", 结果.login.all),
  ...(结果.login.errorsSample.length ? ["", `出错举例：${结果.login.errorsSample.join("；")}`] : []),
  "",
  "## 库和日志",
  "",
  `server.log：SQLITE_BUSY ${结果.serverLog.SQLITE_BUSY} 处，database is locked ${结果.serverLog.databaseIsLocked} 处。`,
  "",
  "| 表 | 压测前 | 压测后 | 变化 |",
  "|---|---|---|---|",
  ...Object.keys(后).map((k) => `| ${k} | ${前[k]} | ${后[k]} | ${后[k] - 前[k] >= 0 ? "+" : ""}${后[k] - 前[k]} |`),
  "",
  "压测前是热身之前；热身每人每类各写一次，也算在变化里。",
  "",
].join("\n");
fs.writeFileSync(path.join(输出, "result.md"), md);
console.log(md);
if (process.env.GATE === "1" && !结果.pass) process.exit(1);
process.exit(0);
