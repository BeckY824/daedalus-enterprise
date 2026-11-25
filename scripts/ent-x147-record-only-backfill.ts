/**
 * X-147 第 2 件（客户 11-18 第二轮「四件事 A/A/A/A」）：试点里判了「留在客户上、不建项目」的 962 条一次性咨询，也建项目——
 * 每位客户建 1 个「仅记录用」项目（线索 · 潜客培育，Project.source = 仅记录用来源），这位客户的这些沟通都挂到它上面。一次性数据脚本。
 *
 * 认法：客户目录 机读-多项目沟通归属-20261117.csv 里 target = keep 的行（列 customerId、followUpId），按 followUpId 对到库里。
 *   CSV 路径用 --csv 传（服务器上要和包一起上传）。
 * 每位客户（CSV 上的 customerId）：
 *   - 建 1 个项目：线索 · 潜客培育，source = 仅记录用来源（system-created.ts），importBatch = 本批批次号（同 历史分析回填 的批次号用法，数据页可按批次挑 / 排）；
 *     名字 = 客户显名（同客户页「新建项目」默认名，customer-title.ts）；负责人 = 客户负责人；创建人 = --操作人；
 *     createdAt = 这位客户挂上的 keep 沟通里最早那条的时间；项目来源（channelId）= 客户的来源；业务线 = 客户的业务线；
 *     联系人 = 客户的主要联系人（同 给客户建项目）；合同状态 = 默认合同状态（同 新项目默认值）；金额 0、CNY。
 *     起点节点变更一行（kind node，→ 线索 · 潜客培育，at = createdAt，userId = 操作人；同 导入 / 补建的起点留痕）。
 *   - 客户在客户公海里的：项目也进线索公海（同 导入给公海客户建的项目 xbm-incr-20261119-pool、历史分析回填）：
 *     ownerId 空串（pool-owner.ts 公海无负责人）、pooledAt = 客户进公海的时间（CustomerPool.at；早于项目建立时间时用写入时刻），
 *     再记一行 pool-release（fromOwnerId 空 = 谁都能领，reason = 客户进公海的原因）。日志里单独标「公海」。
 *   - 沟通：只挂「现在没挂项目（FollowUpProject 没行，沟通编号 / 阶段标记也没有）、没删、不是待办 / 提醒、在这位客户名下」的，
 *     FollowUpProject 一行（node 潜客培育，withProjectCreate false：不是建项目那一次带出的首条）。沟通编号 / 阶段标记（EntFollowUpMeta / Mark）
 *     不补（同 112家与改挂：老沟通原来就没有，没有就不建）。对不上的跳过，逐行日志写原因。
 *   - 已经有在推项目的客户照样建（客户原话「也建项目」）；汇总里单独报「其中原来就有在推项目 N 位」（在推 = 没结局、不在公海、没删、不是仅记录用，
 *     同 cust-status-auto.ts 在推）。
 *   - 客户负责人是停用账号的照建（项目挂在客户负责人名下，同客户），逐行日志标「负责人已停用」，汇总里单独列「负责人已停用 N 位」。
 *   - 不改客户（状态、三态、负责人、最后更新时间都不碰：Customer 一格不写）。
 * 可以重复跑：这位客户已有本脚本建的项目（source 仅记录用、importBatch 是本脚本批次号、没删）就不再建，已挂上的计「已完成」，
 *   还没挂上的（新冒出来的）挂到那个项目上（记在新批次）。
 *
 * 留痕：每写一行一条 AuditLog（userId / userName = --操作人；detail 带 脚本 / 批次 / 表 / 操作 / 新 / 客户编号；
 *   正文前缀「[批次 <批次号> · 执行：Becky（服务商）· 依据 <E-编号>]」和 批次 / 执行 / 依据 / 对应行 四个键，ent-batch-audit-prefix.ts）。
 *
 * 依据：11-18 第二轮答复（E-132，主题 X-147），--basis 写 E-132/X-147（E-147 是 11-19 的另一份文件，不是这件的依据）。
 * 用法（本机，代码副本根目录）：
 *   npx tsx scripts/ent-x147-record-only-backfill.ts <crm.db> --csv <机读.csv> --dry-run --basis E-132/X-147 --操作人 <userId> [--expect <项目数>/<沟通数>] [--log <文件>]
 *   CONFIRM=yes npx tsx scripts/ent-x147-record-only-backfill.ts <crm.db> --csv <机读.csv> --write --expect <项目数>/<沟通数> --basis E-132/X-147 --操作人 <userId> [--log <文件>]
 *   npx tsx scripts/ent-x147-record-only-backfill.ts <crm.db> --undo <批次号> --dry-run | --write（写要带 CONFIRM=yes）--basis E-132/X-147 --操作人 <userId> [--log <文件>]
 * --expect（写时必带）：空跑汇总里「将建项目 X 个」「将挂沟通 Y 条」照抄成 X/Y；写的那笔事务里重算出来和它不一致（空跑之后库又变了）就整批不写、退出码 1。
 *   空跑带了也核，不一致同样退出码 1。撤回不带它。
 * 不认识的参数（拼错的、脚本没有的模式、多出来的路径、缺值、给两遍）一律报错、退出码 2，库都不打开。
 * 服务器上（没有 tsx）：本机先打成一个 cjs，连同 CSV scp 过去用服务器自带 node 跑（只依赖 node:sqlite，Node ≥ 22.13）：
 *   npx esbuild scripts/ent-x147-record-only-backfill.ts --bundle --platform=node --format=cjs --target=node22 --outfile=<目录>/x147-backfill.cjs
 *
 * 写（同一个 BEGIN IMMEDIATE 事务里）：事务里重算计划、逐行写，写完回读逐项断言，任一不过整批回滚、退出码 1：
 *   项目每格是写进去的值、每条沟通挂在本客户这次的项目上、客户行（负责人 / 状态 / 最后更新时间 / 最近跟进 / 删除）和公海行一格没变、
 *   外键检查 0、日志条数 = 写的行数、逐条核前缀和四个键。
 * 撤回（--undo <批次号>）：按该批 AuditLog 记下的插入逐行删（硬删，同 112家与改挂 撤回「建的删」）：先删挂上的 FollowUpProject（沟通还原成没挂项目），
 *   再删节点变更、项目。同一事务里先逐行核：项目还是写进去的样子（节点、结局、负责人、公海、更新时间、没删）、项目上没有本批以外的东西
 *   （别的沟通、节点变更、组员、卡点……凡是带 projectId 的表）、挂上的沟通还挂在原项目上——有一行不对就整批不撤、全部报出来、退出码 1。
 *   多出来的是后面又跑的一批（重复跑补挂的沟通）挂上的：提示里写明是哪一批，「先撤后面那批」再撤这批。
 *   撤回另起批次「原批次-undo-xxxx」，每删一行一条 AuditLog（类 = 撤回、撤的批次、旧 = 删前整行）。已撤回过的批次不再撤（退出码 0）。
 * 逐行日志、出错提示只写北京时间、客户编号、项目 / 沟通 id、字段名，不写客户名、项目名、号码。
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { 仅记录用来源, 仅记录用阶段, 仅记录用节点 } from "@/lib/project/system-created";
import { 客户显名 } from "@/lib/enterprise/customer-title";
import { 默认合同状态 } from "@/lib/project/proj-fields";
import * as 前缀件 from "./ent-batch-audit-prefix";

const 脚本 = "ent-x147-record-only-backfill.ts";
const 件名 = "X-147 仅记录用补建";
const 依据 = "客户 11-18 第二轮答复（E-132，主题 X-147）「四件事 A/A/A/A」第 2 件：962 条一次性咨询也建项目，同样停潜客培育、标仅记录用";
/** 本脚本写入的批次号：x147-<北京年月日时分秒>-<6 位 hex>（撤回只认这种；撤回批次「…-undo-xxxx」不能再撤） */
const 批次式 = /^x147-\d{14}-[0-9a-f]{6}$/;
/** 本脚本的 AuditLog 都在这之后（北京 2026-11-25 00:00），按 AuditLog_at_idx 找，不扫全表 */
const 留痕起点 = Date.UTC(2026, 10, 24, 16, 0, 0);
/** 公海里的项目 ownerId 写空串（pool-owner.ts 公海无负责人；那个文件连着 prisma，这里不引） */
const 公海无负责人 = "";
/** 待办 / 提醒不挂项目（P-沟通-03：只管真正的沟通） */
const 不挂的类型 = new Set(["TASK", "REMIND"]);

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const 带值 = new Set(["--csv", "--log", "--操作人", "--basis", "--undo", "--expect"]);
// 最先核：不认识的参数直接退出码 2，库都不打开
前缀件.核参数(argv, ["--dry-run", "--write"], [...带值]);
const 取 = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const 库 = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && 带值.has(argv[i - 1])));
const 空跑 = argv.includes("--dry-run");
const 要写 = argv.includes("--write");
const 日志文件 = 取("--log");
const 撤参 = 取("--undo");
const CSV = 取("--csv");
const 期望参 = 取("--expect");
if (!库 || 空跑 === 要写) {
  console.error("用法：<crm.db> (--csv <机读.csv> | --undo <批次号>) --dry-run | --write（写要带 CONFIRM=yes） --basis <E-编号> --操作人 <userId> [--log <文件>]");
  process.exit(2);
}
if (撤参 != null && !批次式.test(撤参)) { console.error(`--undo 要填本脚本写入的批次号（x147-<14 位时间>-<6 位>，写入输出和日志里有），「${撤参}」不是`); process.exit(2); }
if (撤参 == null && !CSV) { console.error("缺 --csv <机读-多项目沟通归属.csv>（认哪些沟通），不跑"); process.exit(2); }
if (撤参 != null && CSV) { console.error("--undo 按批次撤，不要再带 --csv"); process.exit(2); }
if (撤参 != null && 期望参 != null) { console.error("--undo 按批次撤，不带 --expect"); process.exit(2); }
if (期望参 != null && !/^\d+\/\d+$/.test(期望参)) { console.error(`--expect 要写成 <项目数>/<沟通数>（空跑汇总里的「将建项目」「将挂沟通」），「${期望参}」不是`); process.exit(2); }
if (撤参 == null && 要写 && 期望参 == null) { console.error("写库要带 --expect <项目数>/<沟通数>（先空跑，照抄汇总里的「将建项目」「将挂沟通」）"); process.exit(2); }
if (要写 && process.env.CONFIRM !== "yes") { console.error("写库要带 CONFIRM=yes"); process.exit(2); }
const 期望 = 期望参 == null ? null : { 项目: Number(期望参.split("/")[0]), 沟通: Number(期望参.split("/")[1]) };
const 依据号 = 前缀件.取依据(argv);
const 操作人id = 前缀件.取操作人(argv);

// 只读打开（Node 22 起支持 readOnly；同 ent-e218-two-status-write.ts）
const 打开 = DatabaseSync as unknown as new (路径: string, 选项: { readOnly: boolean }) => DatabaseSync;
const db = new 打开(库, { readOnly: !要写 });
db.exec("PRAGMA busy_timeout = 15000");

type 值 = string | number | null;
type 行 = Record<string, unknown>;
const 一 = (sql: string, ...p: 值[]) => db.prepare(sql).get(...p) as 行 | undefined;
const 全 = (sql: string, ...p: 值[]) => db.prepare(sql).all(...p) as 行[];
const 北京 = (ms: number) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
const 现在 = Date.now();
const 批次 = `x147-${北京(现在).replace(/[-: ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const 日志行们: string[] = [];
const 记 = (s: string) => { console.log(s); 日志行们.push(s); };
function 落盘() {
  if (!日志文件) return;
  mkdirSync(dirname(日志文件), { recursive: true });
  appendFileSync(日志文件, 日志行们.join("\n") + "\n");
  日志行们.length = 0;
}
const 停 = (m: string): never => { 记(`停：${m}`); 落盘(); process.exit(1); };
let 序 = 0;
const 新id = (T: number) => "c" + (T.toString(36) + (序++).toString(36).padStart(4, "0") + randomBytes(10).toString("hex")).slice(0, 24);
const 编号 = (n: unknown) => (n == null ? "（无编号）" : `NO.${n}`);

const OP = 一("SELECT id, name FROM User WHERE id = ?", 操作人id) as { id: string; name: string } | undefined;
if (!OP) 停(`找不到操作人「${操作人id}」（--操作人 要填账号的 userId）`);

/** 写一行 + 一条 AuditLog（detail 记 表 / 操作 / 新整行），撤回按它删 */
const 写日志 = () => db.prepare("INSERT INTO AuditLog (id, at, userId, userName, action, entity, entityId, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
function 插(表: string, o: Record<string, 值>, T: number, 批: string, 话: string, 附: Record<string, unknown>) {
  const k = Object.keys(o);
  const r = db.prepare(`INSERT INTO "${表}" (${k.map((c) => `"${c}"`).join(",")}) VALUES (${k.map(() => "?").join(",")})`).run(...k.map((c) => o[c])) as { changes: number | bigint };
  if (Number(r.changes) !== 1) throw new Error(`${表} 插入不是 1 行`);
  const 键 = 表 === "FollowUpProject" ? String(o.followUpId) : String(o.id);
  写日志().run(新id(T), T, OP!.id, OP!.name, "create", 表, 键, 前缀件.加前缀(批, 依据号, `[${件名}] ${话}`),
    JSON.stringify(前缀件.加键({ 脚本, 批次: 批, 表, 键列: 表 === "FollowUpProject" ? "followUpId" : "id", 操作: "insert", 新: o, ...附, 依据 }, 批, 依据号, { [表]: 键 })));
}

/* ---------- 认 CSV ---------- */
type 认行 = { customerId: string; followUpId: string };
function 读CSV(p: string): 认行[] {
  let 文: string;
  try { 文 = readFileSync(p, "utf8"); } catch (e) { return 停(`读不了 CSV「${p}」：${(e as Error).message}`); }
  const 行们 = 文.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const 头 = (行们[0] ?? "").split(",").map((s) => s.trim());
  const 位 = (k: string) => { const i = 头.indexOf(k); if (i < 0) 停(`CSV 缺列「${k}」（要 customerId、followUpId、target）`); return i; };
  const [ci, fi, ti] = [位("customerId"), 位("followUpId"), 位("target")];
  const 出: 认行[] = [];
  const 见 = new Set<string>();
  for (const l of 行们.slice(1)) {
    const v = l.split(",");
    if (v[ti]?.trim() !== "keep") continue;
    const r = { customerId: v[ci]?.trim() ?? "", followUpId: v[fi]?.trim() ?? "" };
    if (!r.customerId || !r.followUpId) 停(`CSV 有一行 keep 缺 customerId 或 followUpId：${l.slice(0, 80)}`);
    if (见.has(r.followUpId)) 停(`CSV 里同一条沟通 ${r.followUpId} 出现两次`);
    见.add(r.followUpId);
    出.push(r);
  }
  if (!出.length) 停("CSV 里没有 target = keep 的行");
  return 出;
}

/* ---------- 计划 ---------- */
type 客户行 = { id: string; customerNo: number | null; name: string | null; shortName: string | null; salesOwnerId: string; channelId: string | null; bizLine: string | null; deletedAt: number | null; updatedAt: number; custStatus: string | null; lastFollowAt: number | null };
type 跳过 = { 客户编号: number | null; followUpId: string; 原因: string };
type 一位 = {
  c: 客户行; 已有: string | null; 待挂: { id: string; occurredAt: number }[]; 已完成: number;
  公海: { at: number; reason: string } | null; 建于: number;
  /** 客户负责人是停用账号（不在公海的才看；照建，日志、汇总单独列） */
  负责人停用: boolean;
  /** 这位客户原来就有几个在推项目（没结局、不在公海、没删、不是仅记录用；同 cust-status-auto.ts 在推） */
  在推: number;
};
type 计划果 = { 们: 一位[]; 跳: 跳过[]; 认: number };

function 计划(认们: 认行[]): 计划果 {
  const 按客户 = new Map<string, string[]>();
  for (const r of 认们) 按客户.set(r.customerId, [...(按客户.get(r.customerId) ?? []), r.followUpId]);
  const 们: 一位[] = [];
  const 跳: 跳过[] = [];
  for (const [cid, fids] of 按客户) {
    const c = 一("SELECT id, customerNo, name, shortName, salesOwnerId, channelId, bizLine, deletedAt, updatedAt, custStatus, lastFollowAt FROM Customer WHERE id = ?", cid) as 客户行 | undefined;
    const 跳整位 = (原因: string, 号: number | null = null) => { for (const f of fids) 跳.push({ 客户编号: 号, followUpId: f, 原因 }); };
    if (!c) { 跳整位("客户不在库里"); continue; }
    if (c.deletedAt != null) { 跳整位("客户在回收站", c.customerNo); continue; }
    const 公海行 = 一("SELECT at, reason FROM CustomerPool WHERE customerId = ?", cid);
    if (!公海行 && !c.salesOwnerId) { 跳整位("客户没负责人又不在客户公海，项目没人可挂", c.customerNo); continue; }
    const 已有们 = 全("SELECT id FROM Project WHERE customerId = ? AND source = ? AND importBatch LIKE 'x147-%' AND deletedAt IS NULL", cid, 仅记录用来源);
    if (已有们.length > 1) 停(`${编号(c.customerNo)} 名下有 ${已有们.length} 个本脚本建的项目，应最多 1 个`);
    const 已有 = 已有们[0] ? String(已有们[0].id) : null;
    const 待挂: 一位["待挂"] = [];
    let 已完成 = 0;
    let 最早已挂: number | null = null;
    for (const fid of fids) {
      const f = 一(`SELECT f.id, f.customerId, f.type, f.deletedAt, f.occurredAt,
          (SELECT projectId FROM FollowUpProject WHERE followUpId = f.id) pid,
          (SELECT count(*) FROM EntFollowUpMeta WHERE followUpId = f.id) + (SELECT count(*) FROM EntFollowUpMark WHERE followUpId = f.id) 标
        FROM FollowUp f WHERE f.id = ?`, fid);
      const 跳一 = (原因: string) => 跳.push({ 客户编号: c.customerNo, followUpId: fid, 原因 });
      if (!f) { 跳一("库里没有这条沟通"); continue; }
      if (f.customerId !== cid) { 跳一("这条沟通现在不在这位客户名下"); continue; }
      if (f.deletedAt != null) { 跳一("沟通已删"); continue; }
      if (不挂的类型.has(String(f.type))) { 跳一(`是待办 / 提醒（${f.type}），不挂项目`); continue; }
      if (f.pid != null) {
        if (已有 && f.pid === 已有) { 已完成 += 1; 最早已挂 = Math.min(最早已挂 ?? Infinity, Number(f.occurredAt)); continue; }
        跳一("已经挂在别的项目上"); continue;
      }
      if (Number(f.标) > 0) { 跳一("没挂项目，但沟通编号 / 阶段标记还指着某个项目（数据不一致）"); continue; }
      待挂.push({ id: fid, occurredAt: Number(f.occurredAt) });
    }
    if (!已有 && !待挂.length) continue;
    const 最早 = Math.min(...待挂.map((x) => x.occurredAt), 最早已挂 ?? Infinity);
    const 负责人 = 公海行 ? undefined : 一("SELECT active FROM User WHERE id = ?", c.salesOwnerId);
    const 在推 = Number(一(`SELECT count(*) n FROM Project WHERE customerId = ? AND deletedAt IS NULL AND result IS NULL AND pooledAt IS NULL
        AND NOT (source IS NOT NULL AND source = ? AND phase = ? AND node = ?)`, cid, 仅记录用来源, 仅记录用阶段, 仅记录用节点)?.n ?? 0);
    们.push({
      c, 已有, 待挂, 已完成, 公海: 公海行 ? { at: Number(公海行.at), reason: String(公海行.reason ?? "") } : null, 建于: 最早,
      负责人停用: !!负责人 && Number(负责人.active) === 0, 在推,
    });
  }
  们.sort((a, b) => (a.c.customerNo ?? 0) - (b.c.customerNo ?? 0));
  跳.sort((a, b) => (a.客户编号 ?? 0) - (b.客户编号 ?? 0) || a.followUpId.localeCompare(b.followUpId));
  return { 们, 跳, 认: 认们.length };
}

/** Project 上非空、没默认值的列都得有（库结构和代码不一致时先停，不写半截） */
function 核项目列(o: Record<string, 值>) {
  const 缺 = 全("SELECT name, \"notnull\" nn, dflt_value d FROM pragma_table_info('Project')").filter((r) => Number(r.nn) === 1 && r.d == null && !(String(r.name) in o));
  if (缺.length) throw new Error(`Project 有非空列没给值：${缺.map((r) => r.name).join("、")}`);
}

/** 这次要建几个项目、挂几条沟通（--expect 核的就是这两个数） */
function 数(P: 计划果): { 项目: number; 沟通: number } {
  return { 项目: P.们.filter((x) => !x.已有).length, 沟通: P.们.reduce((s, x) => s + x.待挂.length, 0) };
}
/** --expect 和算出来的不一致：返回一句话；一致 / 没带 = null */
function 核期望(P: 计划果): string | null {
  if (!期望) return null;
  const n = 数(P);
  return n.项目 === 期望.项目 && n.沟通 === 期望.沟通 ? null
    : `--expect ${期望参} 和算出来的不一致：项目 ${n.项目} 个、沟通 ${n.沟通} 条（应为 ${期望.项目} / ${期望.沟通}），整批不写`;
}

function 汇总(P: 计划果, 写: boolean) {
  const 新建 = P.们.filter((x) => !x.已有);
  const 挂 = P.们.reduce((s, x) => s + x.待挂.length, 0);
  const 停用们 = 新建.filter((x) => x.负责人停用);
  const 有在推 = P.们.filter((x) => x.在推 > 0);
  const 已完成沟通 = P.们.reduce((s, x) => s + x.已完成, 0);
  const 原因们 = new Map<string, number>();
  for (const s of P.跳) 原因们.set(s.原因, (原因们.get(s.原因) ?? 0) + 1);
  记(`认 keep ${P.认} 条（${new Set(P.们.map((x) => x.c.id)).size} 位客户有活）；${写 ? "" : "将"}建项目 ${新建.length} 个（其中客户在公海、项目进线索公海 ${新建.filter((x) => x.公海).length} 个），` +
    `${写 ? "" : "将"}挂沟通 ${挂} 条；已完成：项目 ${P.们.length - 新建.length} 个、沟通 ${已完成沟通} 条；跳过 ${P.跳.length} 条` +
    (原因们.size ? `（${[...原因们].map(([k, v]) => `${k} ${v}`).join("；")}）` : ""));
  记(`${P.们.length} 位客户里原来就有在推项目 ${有在推.length} 位（照样建，在推 = 没结局、不在公海、不是仅记录用）`);
  记(`负责人已停用 ${停用们.length} 位${停用们.length ? `（照建，项目挂在停用账号名下：${停用们.map((x) => 编号(x.c.customerNo)).join("、")}）` : ""}`);
  if (!写) 记(`写入时带：--expect ${新建.length}/${挂}`);
}

/* ---------- 写 ---------- */
type 写果 = { 行: number; 项目: number; 挂: number };
function 写入(P: 计划果, T: number): 写果 {
  let 行 = 0, 项目 = 0, 挂 = 0;
  const 前客户 = new Map(P.们.map((x) => [x.c.id, JSON.stringify(一("SELECT salesOwnerId, custStatus, updatedAt, lastFollowAt, deletedAt, (SELECT at FROM CustomerPool WHERE customerId = Customer.id) poolAt FROM Customer WHERE id = ?", x.c.id))]));
  const 期望: { 项目: Map<string, Record<string, 值>>; 挂: Map<string, string> } = { 项目: new Map(), 挂: new Map() };
  for (const x of P.们) {
    const 号 = x.c.customerNo;
    let pid = x.已有;
    if (!pid) {
      pid = 新id(T);
      const 主联系人 = 一("SELECT id FROM Contact WHERE customerId = ? AND isPrimary = 1 ORDER BY id LIMIT 1", x.c.id);
      const 进海 = x.公海 ? (x.公海.at >= x.建于 ? x.公海.at : T) : null;
      const p: Record<string, 值> = {
        id: pid, name: 客户显名(x.c), customerId: x.c.id, contactId: 主联系人 ? String(主联系人.id) : null,
        ownerId: x.公海 ? 公海无负责人 : x.c.salesOwnerId, creatorId: OP!.id, phase: 仅记录用阶段, node: 仅记录用节点,
        pooledAt: 进海, amount: 0, currency: "CNY", balanceSettled: 0, acceptancePassed: 0, contractStatus: 默认合同状态,
        channelId: x.c.channelId, bizLine: x.c.bizLine, source: 仅记录用来源, importBatch: 批次, createdAt: x.建于, updatedAt: T,
      };
      核项目列(p);
      插("Project", p, T, 批次, `${编号(号)} 建仅记录用项目（线索 · 潜客培育${x.公海 ? "，客户在公海、项目进线索公海" : ""}）`, { 客户编号: 号, 类: "建项目", 公海: !!x.公海 });
      期望.项目.set(pid, p);
      行 += 1; 项目 += 1;
      插("ProjectNodeLog", { id: 新id(T), projectId: pid, userId: OP!.id, at: x.建于, kind: "node", toPhase: 仅记录用阶段, toNode: 仅记录用节点 }, T, 批次,
        `${编号(号)} 项目起点：→ 线索 · 潜客培育`, { 客户编号: 号, 类: "起点" });
      行 += 1;
      if (x.公海) {
        插("ProjectNodeLog", {
          id: 新id(T), projectId: pid, userId: OP!.id, at: 进海, kind: "pool-release", reason: x.公海.reason || null, fromOwnerId: null, toOwnerId: null,
          fromPhase: 仅记录用阶段, fromNode: 仅记录用节点, fromResult: null, toPhase: 仅记录用阶段, toNode: 仅记录用节点, toResult: null,
        }, T, 批次, `${编号(号)} 客户在公海：项目随客户进线索公海`, { 客户编号: 号, 类: "进公海" });
        行 += 1;
      }
      记(`${北京(T)}\t${编号(号)}\t建项目\t${x.公海 ? `公海（项目进线索公海，pooledAt 北京 ${北京(进海!)}${进海 === T ? "，客户进公海早于项目建立时间，用写入时刻" : ""}）` : `客户负责人名下${x.负责人停用 ? "（负责人已停用）" : ""}`}\t建于 北京 ${北京(x.建于)}\t挂 ${x.待挂.length} 条`);
    } else {
      记(`${北京(T)}\t${编号(号)}\t已有本脚本建的项目\t已挂 ${x.已完成} 条（已完成）\t补挂 ${x.待挂.length} 条`);
    }
    for (const f of x.待挂) {
      插("FollowUpProject", { followUpId: f.id, projectId: pid, node: 仅记录用节点, withProjectCreate: 0 }, T, 批次, `${编号(号)} 沟通 ${f.id} 挂到仅记录用项目`, { 客户编号: 号, 类: "挂沟通" });
      期望.挂.set(f.id, pid);
      行 += 1; 挂 += 1;
      记(`${北京(T)}\t${编号(号)}\t挂沟通\t${f.id}\t沟通时间 北京 ${北京(f.occurredAt)}`);
    }
  }
  // 事务里回读，逐项断言
  for (const [pid, p] of 期望.项目) {
    const r = 一("SELECT * FROM Project WHERE id = ?", pid);
    if (!r) throw new Error(`回读：项目 ${pid} 不在`);
    // 只报字段名，不带值（name 是客户显名，出错提示不带客户名 / 项目名）
    for (const [k, v] of Object.entries(p)) if (String(r[k] ?? "∅") !== String(v ?? "∅")) throw new Error(`回读：项目 ${pid} 的字段 ${k} 和写入的值不一致`);
  }
  for (const [fid, pid] of 期望.挂) {
    const r = 一("SELECT fp.projectId, fp.node, f.customerId fc, p.customerId pc FROM FollowUpProject fp JOIN FollowUp f ON f.id = fp.followUpId JOIN Project p ON p.id = fp.projectId WHERE fp.followUpId = ?", fid);
    if (!r || r.projectId !== pid || r.node !== 仅记录用节点 || r.fc !== r.pc) throw new Error(`回读：沟通 ${fid} 没挂在本客户这次的项目上`);
  }
  for (const [cid, 前] of 前客户) {
    const 后 = JSON.stringify(一("SELECT salesOwnerId, custStatus, updatedAt, lastFollowAt, deletedAt, (SELECT at FROM CustomerPool WHERE customerId = Customer.id) poolAt FROM Customer WHERE id = ?", cid));
    if (后 !== 前) throw new Error(`回读：客户 ${cid} 的负责人 / 状态 / 更新时间 / 公海变了`);
  }
  for (const t of ["Project", "ProjectNodeLog", "FollowUpProject"]) {
    const 坏 = 全(`PRAGMA foreign_key_check("${t}")`);
    if (坏.length) throw new Error(`外键检查 ${t} 有 ${坏.length} 行不对`);
  }
  const 日志数 = Number(一("SELECT count(*) n FROM AuditLog WHERE at >= ? AND json_valid(detail) AND json_extract(detail, '$.批次') = ?", T, 批次)?.n);
  if (日志数 !== 行) throw new Error(`操作日志 ${日志数} 条 ≠ 写的 ${行} 行`);
  const 核 = 前缀件.核本批(db, 批次, 依据号, T);
  if (核.条数 !== 行 || 核.错) throw new Error(`本批日志前缀 / 批次·执行·依据 不对 ${核.错} 条（共 ${核.条数} 条）`);
  return { 行, 项目, 挂 };
}

/* ---------- 撤回 ---------- */
type 插过 = { 日志id: string; 表: string; 键: string; 新: Record<string, 值>; 客户编号: number | null };
function 撤(批次号: string): number {
  记(`# ${件名} · 撤回 ${批次号} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}（执行：${前缀件.执行}）· 依据 ${依据号}`);
  const 本脚本的 = (批: string, 键: "批次" | "撤的批次") => 全(
    `SELECT id, detail FROM AuditLog WHERE at >= ? AND json_valid(detail) AND json_extract(detail, '$.脚本') = ? AND json_extract(detail, '$.${键}') = ?`,
    留痕起点, 脚本, 批,
  );
  const 跑 = (): number => {
    const 这批: 插过[] = 本脚本的(批次号, "批次").flatMap((r) => {
      const d = JSON.parse(String(r.detail)) as { 类?: string; 操作?: string; 表: string; 新: Record<string, 值>; 客户编号?: number | null; 对应行?: Record<string, string> };
      if (d.操作 !== "insert") return [];
      return [{ 日志id: String(r.id), 表: d.表, 键: d.表 === "FollowUpProject" ? String(d.新.followUpId) : String(d.新.id), 新: d.新, 客户编号: d.客户编号 ?? null }];
    });
    if (!这批.length) throw new Error(`AuditLog 里没有批次 ${批次号} 的写入`);
    const 撤过 = 本脚本的(批次号, "撤的批次");
    if (撤过.length) {
      记(`批次 ${批次号} 已撤回过（${[...new Set(撤过.map((r) => String(JSON.parse(String(r.detail)).批次)))].join("、")}），不再撤`);
      return 0;
    }
    const 撤号 = `${批次号}-undo-${randomBytes(2).toString("hex")}`;
    记(`日志前缀${要写 ? "" : "（写时）"}：${前缀件.前缀(撤号, 依据号)}`);
    const 项目们 = 这批.filter((x) => x.表 === "Project");
    const 痕们 = 这批.filter((x) => x.表 === "ProjectNodeLog");
    const 挂们 = 这批.filter((x) => x.表 === "FollowUpProject");
    const 本批键 = new Set(这批.map((x) => x.键));
    // 先逐行核：写后被改过的、项目上多了本批以外的东西的，整批不撤，全部报出来
    const 不对: string[] = [];
    const 后面的批 = new Set<string>();
    const 带项目的表 = 全("SELECT m.name t FROM sqlite_master m WHERE m.type = 'table' AND EXISTS (SELECT 1 FROM pragma_table_info(m.name) WHERE name = 'projectId')").map((r) => String(r.t));
    for (const x of 项目们) {
      const r = 一("SELECT * FROM Project WHERE id = ?", x.键);
      if (!r) { 不对.push(`${编号(x.客户编号)} 项目 ${x.键} 不在了`); continue; }
      for (const k of ["phase", "node", "result", "ownerId", "pooledAt", "updatedAt", "deletedAt", "customerId", "source", "importBatch"]) {
        if (String(r[k] ?? "∅") !== String(x.新[k] ?? "∅")) 不对.push(`${编号(x.客户编号)} 项目 ${x.键} 的 ${k} 写后被改过（现在「${r[k] ?? "空"}」，写入时「${x.新[k] ?? "空"}」）`);
      }
      for (const t of 带项目的表) {
        const 键列 = t === "FollowUpProject" || t === "EntFollowUpMeta" || t === "EntFollowUpMark" ? "followUpId" : "id";
        const 有键 = 全(`SELECT name FROM pragma_table_info('${t}') WHERE name = ?`, 键列).length > 0;
        const 别的 = 全(`SELECT ${有键 ? `"${键列}"` : "rowid"} k FROM "${t}" WHERE projectId = ?`, x.键).filter((y) => !(有键 && 本批键.has(String(y.k))));
        if (!别的.length) continue;
        // 多出来的沟通是不是本脚本后面又跑的一批挂上的（重复跑补挂）：是就写明哪一批，要先撤那批
        const 后批们 = t !== "FollowUpProject" ? [] : [...new Set(全(
          `SELECT json_extract(detail, '$.批次') b FROM AuditLog WHERE at >= ? AND entity = 'FollowUpProject' AND entityId IN (${别的.map(() => "?").join(",")})
             AND json_valid(detail) AND json_extract(detail, '$.脚本') = ? AND json_extract(detail, '$.操作') = 'insert' AND json_extract(detail, '$.批次') <> ?`,
          留痕起点, ...别的.map((y) => String(y.k)), 脚本, 批次号,
        ).map((r) => String(r.b)))];
        后批们.forEach((b) => 后面的批.add(b));
        不对.push(`${编号(x.客户编号)} 项目 ${x.键} 上多了本批以外的 ${t} ${别的.length} 行` +
          (后批们.length ? `（是后面又跑的批次 ${后批们.join("、")} 挂上的，先撤后面那批）` : "（写后有人在上面记了东西）"));
      }
    }
    for (const x of 挂们) {
      const r = 一("SELECT projectId, node FROM FollowUpProject WHERE followUpId = ?", x.键);
      if (!r) 不对.push(`${编号(x.客户编号)} 沟通 ${x.键} 已经不挂这个项目了（被删或改挂）`);
      else if (r.projectId !== x.新.projectId || r.node !== x.新.node) 不对.push(`${编号(x.客户编号)} 沟通 ${x.键} 写后被改挂 / 改了节点`);
    }
    for (const x of 痕们) if (!一("SELECT id FROM ProjectNodeLog WHERE id = ?", x.键)) 不对.push(`${编号(x.客户编号)} 节点变更 ${x.键} 不在了`);
    if (不对.length) {
      for (const s of 不对) 记(`${北京(Date.now())}\t不对：${s}`);
      throw new Error(`${不对.length} 处写后被改过，整批不撤` +
        (后面的批.size ? `；先撤后面那批（${[...后面的批].map((b) => `--undo ${b}`).join("、")}）再撤这批` : ""));
    }
    const T = Date.now();
    let 撤了 = 0;
    const 删 = (x: 插过, 表: string, 键列: string) => {
      const 旧 = 一(`SELECT * FROM "${表}" WHERE "${键列}" = ?`, x.键) as Record<string, 值>;
      if (要写) {
        if (Number((db.prepare(`DELETE FROM "${表}" WHERE "${键列}" = ?`).run(x.键) as { changes: number | bigint }).changes) !== 1) throw new Error(`${表} ${x.键} 删除不是 1 行`);
        写日志().run(新id(T), T, OP!.id, OP!.name, "delete", 表, x.键,
          前缀件.加前缀(撤号, 依据号, `[${件名} 撤回 ${批次号}] ${编号(x.客户编号)} 删 ${表} ${x.键}`),
          JSON.stringify(前缀件.加键({ 脚本, 类: "撤回", 批次: 撤号, 撤的批次: 批次号, 撤的日志: x.日志id, 表, 键列, 操作: "delete", 旧, 客户编号: x.客户编号, 依据 }, 撤号, 依据号, { [表]: x.键 })));
      }
      撤了 += 1;
      记(`${北京(T)}\t${编号(x.客户编号)}\t${表}\t${x.键}\t${要写 ? "已删" : "将删（空跑）"}`);
    };
    for (const x of 挂们) 删(x, "FollowUpProject", "followUpId");
    for (const x of 痕们) 删(x, "ProjectNodeLog", "id");
    for (const x of 项目们) 删(x, "Project", "id");
    if (要写) {
      for (const x of 挂们) if (一("SELECT 1 FROM FollowUpProject WHERE followUpId = ?", x.键)) throw new Error(`回读：沟通 ${x.键} 还挂着项目`);
      for (const x of 项目们) if (一("SELECT 1 FROM Project WHERE id = ?", x.键)) throw new Error(`回读：项目 ${x.键} 还在`);
      const 核 = 前缀件.核本批(db, 撤号, 依据号, T);
      if (核.条数 !== 撤了 || 核.错) throw new Error(`撤回日志 ${核.条数} 条（应 ${撤了}），前缀 / 批次·执行·依据 不对 ${核.错} 条`);
    }
    记(`${要写 ? "已撤" : "空跑：将撤"}：删项目 ${项目们.length} 个、节点变更 ${痕们.length} 行，沟通还原成没挂项目 ${挂们.length} 条（共 ${撤了} 行）${要写 ? `，撤回批次号 ${撤号}，操作日志 ${撤了} 条` : "，一行没写"}`);
    return 撤了;
  };
  if (!要写) {
    try { return 跑(); } catch (e) { return 停(`${(e as Error).message}`); }
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const n = 跑();
    db.exec("COMMIT");
    return n;
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    return 停(`出错，已回滚，库不变：${(e as Error).message}`);
  }
}

/* ---------- 主流程 ---------- */
const 开始 = performance.now();
if (撤参 != null) {
  撤(撤参);
  记(`耗时 ${Math.round(performance.now() - 开始)} ms`);
  落盘();
  db.close();
  process.exit(0);
}
const 认们 = 读CSV(CSV!);
记(`# ${件名} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}（执行：${前缀件.执行}）· 依据 ${依据号}${要写 ? ` · 批次 ${批次}` : ""}`);
记(`日志前缀${要写 ? "" : "（写时）"}：${前缀件.前缀(批次, 依据号)}`);
let 果: 写果 | null = null;
let P: 计划果;
if (!要写) {
  P = 计划(认们);
  for (const x of P.们) {
    if (x.已有) 记(`${北京(现在)}\t${编号(x.c.customerNo)}\t已有本脚本建的项目\t已挂 ${x.已完成} 条（已完成）\t将补挂 ${x.待挂.length} 条`);
    else 记(`${北京(现在)}\t${编号(x.c.customerNo)}\t将建项目\t${x.公海 ? "公海（项目进线索公海）" : `客户负责人名下${x.负责人停用 ? "（负责人已停用）" : ""}`}\t建于 北京 ${北京(x.建于)}\t将挂 ${x.待挂.length} 条`);
  }
} else {
  db.exec("BEGIN IMMEDIATE");
  try {
    P = 计划(认们);
    // 写前核 --expect：事务里重算的和空跑时抄下来的不一致（中间库变了）就一行不写
    const 不符 = 核期望(P);
    if (不符) throw new Error(不符);
    果 = 写入(P, Date.now());
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    P = { 们: [], 跳: [], 认: 0 };
    停(`出错，已回滚，库不变：${(e as Error).message}`);
  }
}
for (const s of P!.跳) 记(`${北京(现在)}\t${编号(s.客户编号)}\t跳过\t${s.followUpId}\t${s.原因}`);
汇总(P!, 要写);
// 空跑带了 --expect 也核：不一致退出码 1（同写时）
if (!要写) { const 不符 = 核期望(P!); if (不符) 停(不符.replace("整批不写", "写的时候会整批不写")); }
const 耗时 = Math.round(performance.now() - 开始);
记(要写 ? `已写：${果!.行} 行（项目 ${果!.项目} 个、挂沟通 ${果!.挂} 条，余为节点变更），操作日志（AuditLog，批次 ${批次}）${果!.行} 条；耗时 ${耗时} ms${果!.行 ? `。撤回：--undo ${批次}` : ""}` : `空跑结束，一行没写；耗时 ${耗时} ms`);
落盘();
db.close();
