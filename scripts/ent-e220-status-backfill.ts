/**
 * E-220（客户 11-23，回 E-219 选 B）：库里客户状态（custStatus）为空、名下有项目、不在客户公海的客户，分批把现算的状态写进库，一次性数据脚本。
 *   公海里的（CustomerPool 有行的）一家不动（E-220：「公海的随领取和项目变动自然落库」）。
 *   另一组 --set e220-7：「成交→潜在」247 家里近 90 天有跟进的 7 家，改前必须是「成交」（E-220：「按 B 的那套约束单独写一批」）。
 * 依据：E-220（11-23）「只写不在公海那 14,342 家」「只写 custStatus 一个字段」「先 1 批 200 家试点……再每批 1,000 家、每天不超过 3 批」
 *   「任一批抽查对不上，整批撤回并停下报我」「247 家只修近 90 天有跟进的 7 家」。
 *
 * 目标值不手填：读库这一半照 cust-status-auto-db.ts 重算客户状态（PR-A 这一版）、规则用 cust-status-auto.ts 算客户状态（同一个函数）：
 *   - 项目 = Project.customerId 指着它、没软删的；pooledAt 带上（在线索公海的不算在推）
 *   - 不算 = 结局线索流失 + 线索验证终判「无效线索」+ 无效原因是重复线索（dict-invalid-5 现名 + 原名，同 重复线索名们 / 重复线索不算）
 *   - 序号 → 字典 custStatus 这一项现在的名字（同 客户状态名们）
 * 额外一道（客户要补写不依赖新规则上线）：每家再用 main 上的旧规则（下面 旧规则算客户状态，逐字抄自 ent/main 3e26a613 的
 *   cust-status-auto.ts；读库那一半旧版只取 phase/node/result、不排重复线索）算一次，新旧一致才写；不一致的列出来、不写。
 *
 * 只写 custStatus 一列，不动 updatedAt（和 重算客户状态 不同：那条走 Prisma updateMany 会顶 updatedAt）。理由：
 *   客户 updatedAt 被这些地方当「最近动过」用——编辑表单乐观锁、导入撤销判断「导入后有人改过」、导出截止时刻判断、
 *   研究 / AI 助手按 updatedAt 倒序取客户。一次顶 1.4 万家会让这些地方误以为人动过；不顶则状态以外一切照旧。
 *   不顶的代价：编辑表单打开在写之前、保存在写之后，乐观锁看不出这一格变了——企业版状态按项目自动算时表单本来不交 custStatus
 *   （actions.ts 企客状态：改已有客户 = null 不写），所以不会被盖回去。AuditLog 里照样记改前的 updatedAt 备查。
 * 留痕：每改一格写一条 AuditLog（同 ent-e218-two-status-write.ts：userId/userName = --操作人 指定的账号（必填）、entity Customer、entityId 客户 id、
 *   detail 带 脚本 / 批次 / 批 / 编号 / 旧 / 新 / 依据原话）。撤回也逐格记一条（类 = 撤回、撤的批次），撤回自己另起批次「原批次-undo-xxxx」。
 *   客户 E-244（审计）：写和撤回的每条正文开头都带「[批次 <批次号> · 执行：Becky（服务商）· 依据 <E-编号>]」，detail 带 批次 / 执行 / 依据 / 对应行
 *  （ent-batch-audit-prefix.ts）；每条命令都要带 --basis；事务里回读逐条核本批日志的前缀和四个键，不对整批回滚。
 *
 * 分批（固定、可复现）：
 *   候选 = 没软删、custStatus 为空、名下有没软删的项目、不在客户公海、新旧规则一致且算出非空。
 *   批 0 = 试点 200 家：近 30 天有沟通（跟进记录 FollowUp 未删、发生时间在近 30 天）的候选里按客户编号等距取 30 家，
 *     其余候选按客户编号等距取 170 家；试点里没覆盖到的目标状态，每种补 2 家（换掉等距取的最后几家）。
 *     试点写过（AuditLog 里有没撤回的写入）就以 AuditLog 里的成员为准，不再重选。
 *   批 n（n ≥ 1）= 全集按客户编号升序、去掉试点成员后的第 (n-1)*1000 ～ n*1000 位。
 *     全集 = 现在的候选 ∪ 本脚本已写过且没撤回的客户（这样写过的批位置不动，后面的批不因前面已写而错位）。
 *     还没写的批：写之前若有候选掉出去（进了公海、项目变了被系统写了状态），后面的批会顺移，以写那次的逐行日志为准。
 *   写批 n 要求试点和 1..n-1 批都已写（没撤回）；同一北京日写的 1,000 家批（n ≥ 1）不超过 3 批。
 *
 * 用法（本机，代码副本根目录；服务器上用打包的 cjs，见 c2写入步骤.md）：
 *   （每条命令都要带 --basis <E-编号> --操作人 <userId>，下面省略）
 *   npx tsx scripts/ent-e220-status-backfill.ts <crm.db> --plan [--log <文件>]                        只读：候选数、新旧不一致名单、批数、天数
 *   npx tsx scripts/ent-e220-status-backfill.ts <crm.db> --batch <0|试点|n> --dry-run [--log <文件>]
 *   CONFIRM=yes npx tsx scripts/ent-e220-status-backfill.ts <crm.db> --batch <0|n> --write [--log <文件>]
 *   npx tsx scripts/ent-e220-status-backfill.ts <crm.db> --set e220-7 --dry-run | --write
 *   npx tsx scripts/ent-e220-status-backfill.ts <crm.db> --undo <批次号> --dry-run | --write          整批改回写前的值（空 / 成交）
 * 打包（服务器没有 tsx，只依赖 node:sqlite，Node ≥ 22.13）：
 *   npx esbuild scripts/ent-e220-status-backfill.ts --bundle --platform=node --format=cjs --target=node22 --outfile=<目录>/e220-status-backfill.cjs
 *
 * 写在一个 BEGIN IMMEDIATE 事务里：成员和目标值在事务里现算；每行 UPDATE 带改前值做条件（custStatus IS 改前、没软删），
 *   改动不是 1 行整批回滚；回读值对、AuditLog 条数 = 改动行数才提交。已是目标值的计「已完成」不写（可重复跑）。
 * 每批输出（日志里，无客户名）：逐行（北京时间、批次号、批、客户编号、负责人、改前、改后、结果）；写完后客户页「客户状态」筛选 /
 *   中栏名单按状态分组 / 看板卡片的人数变化；抽查用的 20 家编号（含近 30 天有沟通的）。
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { 算客户状态, 客户状态id, 客户状态序号, type 算状态的项目, type 客户状态序号 as 序号 } from "@/lib/enterprise/cust-status-auto";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";
import { 企业版字典, 本套名, 是交付 } from "@/lib/project/stage-dict";
import * as 前缀件 from "./ent-batch-audit-prefix";

const 脚本 = "ent-e220-status-backfill.ts";
const 件名 = "E-220 客户状态补写";
const 依据 = "E-220（11-23）：「只写不在公海那 14,342 家」「只写 custStatus 一个字段」「先 1 批 200 家试点……每批 1,000 家、每天不超过 3 批」「任一批抽查对不上，整批撤回」「247 家只修近 90 天有跟进的 7 家」";
/** 本脚本的 AuditLog 都在这之后（北京 2026-11-23 00:00），按 AuditLog_at_idx 找，不扫全表 */
const 留痕起点 = 1795363200000;
const 重复线索id = "dict-invalid-5";
const 重复线索原名 = "重复线索";
const 试点数 = 200, 试点近沟通 = 30, 每批 = 1000, 每天批数 = 3, 抽查数 = 20, 近沟通天 = 30;
/** 「成交→潜在」247 家里近 90 天有跟进的 7 家（3703 正式库副本按 B2-两类抽样.py 同一口径查出，11-23） */
const 七家 = [1478, 10911, 11248, 18816, 28649, 63213, 64338] as const;
const 七家批 = "e220-7";

/* ---------- main 上的旧规则（ent/main 3e26a613 src/lib/enterprise/cust-status-auto.ts 算客户状态，逐字） ---------- */
type 旧项目 = { phase: string; node: string; result: string | null; deletedAt?: Date | null };
function 旧付了首款(p: 旧项目): boolean {
  return p.result == null && (p.phase === "订单" || (p.phase === "商机" && 本套名(p.node, 企业版字典) === "首款到账"));
}
function 旧在商机(p: 旧项目): boolean {
  return p.result == null && p.phase === "商机";
}
function 旧规则算客户状态(项目们: readonly 旧项目[]): 序号 | null {
  const 在的 = 项目们.filter((p) => !p.deletedAt);
  if (!在的.length) return null;
  const 交付数 = 在的.filter((p) => 是交付(p.result)).length;
  if (交付数 >= 3) return 客户状态序号.忠诚;
  if (交付数 === 2) return 客户状态序号.复购;
  if (交付数 === 1) return 客户状态序号.交付;
  if (在的.some((p) => p.result === "异常状态")) return 客户状态序号.异常;
  if (在的.some((p) => p.result === "丢单")) return 客户状态序号.丢单;
  if (在的.some((p) => p.result === "线索流失")) return 客户状态序号.流失;
  if (在的.some(旧付了首款)) return 客户状态序号.成交;
  if (在的.some(旧在商机)) return 客户状态序号.意向;
  return 客户状态序号.潜在;
}

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const 带值 = new Set(["--log", "--操作人", "--batch", "--set", "--undo", "--basis"]);
// 不认识的参数（拼错的、多出来的路径）直接退出码 2，库都不打开（3704 实操 r64 第 6 条，同 e218）
前缀件.核参数(argv, ["--plan", "--dry-run", "--write"], [...带值]);
const 取 = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const 库 = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && 带值.has(argv[i - 1])));
const 看计划 = argv.includes("--plan");
const 空跑 = argv.includes("--dry-run");
const 要写 = argv.includes("--write");
const 日志文件 = 取("--log");
const 批参 = 取("--batch"), 组参 = 取("--set"), 撤参 = 取("--undo");
const 用法 = "用法：<crm.db> --plan | --batch <0|试点|n> (--dry-run|--write) | --set e220-7 (--dry-run|--write) | --undo <批次号> (--dry-run|--write)；写要带 CONFIRM=yes；必带 --basis <E-编号，如 E-220/E-223> --操作人 <userId>；可选 --log <文件>";
const 模式数 = [看计划, 批参 != null, 组参 != null, 撤参 != null].filter(Boolean).length;
if (!库 || 模式数 !== 1 || (!看计划 && 空跑 === 要写) || (看计划 && 要写)) { console.error(用法); process.exit(2); }
if (组参 != null && 组参 !== 七家批) { console.error(`--set 只认 ${七家批}`); process.exit(2); }
const 批号 = 批参 == null ? null : 批参 === "试点" ? 0 : /^\d+$/.test(批参) ? Number(批参) : NaN;
if (批参 != null && !Number.isInteger(批号)) { console.error(用法); process.exit(2); }
if (要写 && process.env.CONFIRM !== "yes") { console.error("写库要带 CONFIRM=yes"); process.exit(2); }
const 依据号 = 前缀件.取依据(argv);
const 操作人id = 前缀件.取操作人(argv);

const 打开 = DatabaseSync as unknown as new (路径: string, 选项: { readOnly: boolean }) => DatabaseSync;
const db = new 打开(库, { readOnly: !要写 });
db.exec("PRAGMA busy_timeout = 15000");

type 行 = Record<string, unknown>;
type 参 = string | number | null;
const 一 = (sql: string, ...p: 参[]) => db.prepare(sql).get(...p) as 行 | undefined;
const 全 = (sql: string, ...p: 参[]) => db.prepare(sql).all(...p) as 行[];
const 北京 = (ms: number) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
const 北京日 = (ms: number) => 北京(ms).slice(0, 10);
const 显 = (v: string | null) => v ?? "空";
const 千 = (n: number) => n.toLocaleString("en-US");
const 现在 = Date.now();
const 批名 = (n: number | string) => (n === 0 ? "试点" : String(n));
const 本次批次 = (标: string) => `e220-${标}-${北京(现在).replace(/[-: ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
const 日志行们: string[] = [];
const 记 = (s: string) => { console.log(s); 日志行们.push(s); };
const 停 = (m: string): never => { 记(`停：${m}`); 落盘(); process.exit(1); };
function 落盘() {
  if (!日志文件) return;
  mkdirSync(dirname(日志文件), { recursive: true });
  appendFileSync(日志文件, 日志行们.join("\n") + "\n");
  日志行们.length = 0;
}

const OP = 一("SELECT id, name FROM User WHERE id = ?", 操作人id) as { id: string; name: string } | undefined;
if (!OP) 停(`找不到操作人「${操作人id}」（--操作人 要填账号的 userId）`);

function 状态名们(): string[] {
  const 名 = new Map(全("SELECT id, name FROM EntDictItem WHERE kind = 'custStatus'").map((r) => [String(r.id), String(r.name)]));
  return 字典定义.custStatus.默认.map((n, i) => 名.get(客户状态id(i)) ?? n);
}
function 重复名们(): string[] {
  const 现 = (一("SELECT name FROM EntDictItem WHERE id = ?", 重复线索id)?.name as string | undefined)?.trim();
  return [...new Set([重复线索原名, ...(现 ? [现] : [])])];
}
const 人名 = new Map(全("SELECT id, name FROM User").map((r) => [String(r.id), String(r.name)]));

/* ---------- 算：一组客户 id → 新旧两种规则的值 ---------- */
type 算出 = { 新: string | null; 旧: string | null };
function 按项目算(ids: readonly string[]): Map<string, 算出> {
  const 名们 = 状态名们();
  const 重复 = 重复名们();
  const 出 = new Map<string, 算出>();
  for (let i = 0; i < ids.length; i += 500) {
    const 这批 = ids.slice(i, i + 500);
    const 占 = 这批.map(() => "?").join(",");
    const 项目行 = 全(`SELECT id, customerId, phase, node, result, pooledAt FROM Project WHERE customerId IN (${占}) AND deletedAt IS NULL`, ...这批);
    const 流失的 = 项目行.filter((p) => p.result === "线索流失").map((p) => String(p.id));
    const 不算 = new Set<string>();
    for (let j = 0; j < 流失的.length; j += 500) {
      const 段 = 流失的.slice(j, j + 500);
      for (const r of 全(`SELECT projectId FROM EntLeadVerify WHERE finalResult = '无效线索' AND invalidReason IN (${重复.map(() => "?").join(",")}) AND projectId IN (${段.map(() => "?").join(",")})`, ...重复, ...段)) 不算.add(String(r.projectId));
    }
    const 按客户 = new Map<string, 行[]>();
    for (const p of 项目行) { const k = String(p.customerId); const l = 按客户.get(k); if (l) l.push(p); else 按客户.set(k, [p]); }
    for (const id of 这批) {
      const ps = 按客户.get(id) ?? [];
      const 新项: 算状态的项目[] = ps.map((p) => ({
        phase: String(p.phase), node: String(p.node), result: (p.result as string | null) ?? null,
        pooledAt: p.pooledAt == null ? null : new Date(Number(p.pooledAt)),
        ...(不算.has(String(p.id)) ? { 不算: true } : {}),
      }));
      const 旧项: 旧项目[] = ps.map((p) => ({ phase: String(p.phase), node: String(p.node), result: (p.result as string | null) ?? null }));
      const a = 算客户状态(新项), b = 旧规则算客户状态(旧项);
      出.set(id, { 新: a == null ? null : 名们[a], 旧: b == null ? null : 名们[b] });
    }
  }
  return 出;
}

/* ---------- 本脚本写过的（AuditLog） ---------- */
type 写过 = { 批次: string; 批: string; 客户id: string; 客户编号: number; 旧: string | null; 新: string };
function 读留痕(): { 写: 写过[]; 已撤批次: Set<string> } {
  const 行们 = 全(`SELECT entityId, detail FROM AuditLog WHERE at >= ? AND entity = 'Customer' AND json_valid(detail) AND json_extract(detail, '$.脚本') = ?`, 留痕起点, 脚本);
  const 写: 写过[] = [];
  const 已撤批次 = new Set<string>();
  for (const r of 行们) {
    const d = JSON.parse(String(r.detail));
    if (d.类 === "写") 写.push({ 批次: d.批次, 批: String(d.批), 客户id: String(r.entityId), 客户编号: Number(d.客户编号), 旧: d.旧?.custStatus ?? null, 新: d.新?.custStatus });
    else if (d.类 === "撤回") 已撤批次.add(String(d.撤的批次));
  }
  return { 写, 已撤批次 };
}
/** 没撤回的写入，按 批 分组：批 → 批次们（一般一个） */
function 有效写入(): { 按批: Map<string, 写过[]>; 全部: 写过[] } {
  const { 写, 已撤批次 } = 读留痕();
  const 有效 = 写.filter((w) => !已撤批次.has(w.批次));
  const 按批 = new Map<string, 写过[]>();
  for (const w of 有效) { const l = 按批.get(w.批); if (l) l.push(w); else 按批.set(w.批, [w]); }
  return { 按批, 全部: 有效 };
}

/* ---------- 候选 ---------- */
type 客户 = { id: string; no: number; 负责人: string; 存: string | null; updatedAt: number; 新: string | null; 旧: string | null; 近沟通: boolean; 在公海: boolean; 删了: boolean; 有项目: boolean };
const 近沟通起 = 现在 - 近沟通天 * 86400e3;
function 读客户(ids: readonly string[]): Map<string, 客户> {
  const 出 = new Map<string, 客户>();
  for (let i = 0; i < ids.length; i += 500) {
    const 这批 = ids.slice(i, i + 500);
    const 占 = 这批.map(() => "?").join(",");
    const 算 = 按项目算(这批);
    const 近 = new Set(全(`SELECT DISTINCT customerId FROM FollowUp WHERE customerId IN (${占}) AND deletedAt IS NULL AND occurredAt >= ? AND occurredAt <= ?`, ...这批, 近沟通起, 现在).map((r) => String(r.customerId)));
    for (const c of 全(`SELECT c.id, c.customerNo, c.salesOwnerId, c.custStatus, c.updatedAt, c.deletedAt,
        EXISTS(SELECT 1 FROM CustomerPool cp WHERE cp.customerId = c.id) AS 池,
        EXISTS(SELECT 1 FROM Project p WHERE p.customerId = c.id AND p.deletedAt IS NULL) AS 项 FROM Customer c WHERE c.id IN (${占})`, ...这批)) {
      const id = String(c.id);
      const s = 算.get(id)!;
      出.set(id, { id, no: Number(c.customerNo), 负责人: 人名.get(String(c.salesOwnerId)) ?? "—", 存: (c.custStatus as string | null) || null, updatedAt: Number(c.updatedAt),
        新: s.新, 旧: s.旧, 近沟通: 近.has(id), 在公海: !!c.池, 删了: c.deletedAt != null, 有项目: !!c.项 });
    }
  }
  return 出;
}
/** 范围内的全部（空、有项目、不在公海、没删），分成：可写候选 / 新旧不一致 / 算出为空 */
function 范围(): { 候选: 客户[]; 不一致: 客户[]; 算空: 客户[]; 总: number } {
  const ids = 全(`SELECT c.id FROM Customer c WHERE c.deletedAt IS NULL AND (c.custStatus IS NULL OR c.custStatus = '')
      AND EXISTS(SELECT 1 FROM Project p WHERE p.customerId = c.id AND p.deletedAt IS NULL)
      AND NOT EXISTS(SELECT 1 FROM CustomerPool cp WHERE cp.customerId = c.id)`).map((r) => String(r.id));
  const 们 = [...读客户(ids).values()].sort((a, b) => a.no - b.no);
  if (们.some((c) => !Number.isFinite(c.no))) 停("范围内有客户没有客户编号，没法按编号排批");
  return { 候选: 们.filter((c) => c.新 != null && c.新 === c.旧), 不一致: 们.filter((c) => c.新 !== c.旧), 算空: 们.filter((c) => c.新 == null && c.旧 == null), 总: 们.length };
}

/** 有序列表里等距取 k 个 */
function 等距(列: readonly 客户[], k: number): 客户[] {
  if (列.length <= k) return [...列];
  return Array.from({ length: k }, (_, i) => 列[Math.floor((i * 列.length) / k)]);
}
function 选试点(候选: readonly 客户[]): 客户[] {
  const 近 = 等距(候选.filter((c) => c.近沟通), 试点近沟通);
  const 已 = new Set(近.map((c) => c.id));
  const 余 = 候选.filter((c) => !已.has(c.id));
  let 其余 = 等距(余, 试点数 - 近.length);
  const 有 = new Set([...近, ...其余].map((c) => c.新));
  const 补: 客户[] = [];
  for (const s of new Set(候选.map((c) => c.新))) if (!有.has(s)) 补.push(...余.filter((c) => c.新 === s).slice(0, 2));
  if (补.length) 其余 = [...其余.slice(0, 其余.length - 补.length), ...补];
  return [...近, ...其余].sort((a, b) => a.no - b.no);
}

/** 批 n 的成员（客户 id，按编号升序） */
function 批成员(n: number, 范: ReturnType<typeof 范围>, 写入: ReturnType<typeof 有效写入>): { 成员: string[]; 总批数: number; 试点: string[] } {
  const 试点写过 = 写入.按批.get("试点");
  const 试点 = 试点写过?.length ? 试点写过.map((w) => w.客户id) : 选试点(范.候选).map((c) => c.id);
  const 试点集 = new Set(试点);
  const 编号 = new Map<string, number>();
  for (const c of 范.候选) 编号.set(c.id, c.no);
  for (const w of 写入.全部) if (/^\d+$/.test(w.批)) 编号.set(w.客户id, w.客户编号);
  const 全集 = [...编号.entries()].filter(([id]) => !试点集.has(id)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
  const 总批数 = Math.ceil(全集.length / 每批);
  if (n === 0) return { 成员: 试点, 总批数, 试点 };
  return { 成员: 全集.slice((n - 1) * 每批, n * 每批), 总批数, 试点 };
}

/** 现在客户页（不在公海、没删）各客户状态多少家；看全部的人（系统管理员 / 总管理）看到的数 */
function 页签各状态(): Map<string, number> {
  return new Map(全(`SELECT COALESCE(NULLIF(c.custStatus, ''), '—') s, count(*) n FROM Customer c WHERE c.deletedAt IS NULL
      AND NOT EXISTS(SELECT 1 FROM CustomerPool cp WHERE cp.customerId = c.id) GROUP BY 1`).map((r) => [String(r.s), Number(r.n)]));
}
function 人数变化(改: readonly { 改前: string | null; 改后: string | null }[], 前 = 页签各状态()) {
  const 增 = new Map<string, number>();
  for (const r of 改) { const a = r.改后 ?? "—", b = r.改前 ?? "—"; 增.set(a, (增.get(a) ?? 0) + 1); 增.set(b, (增.get(b) ?? 0) - 1); }
  const 顺 = [...状态名们(), "—"];
  const 段 = 顺.filter((s) => 增.get(s)).map((s) => `${s} ${千(前.get(s) ?? 0)}→${千((前.get(s) ?? 0) + 增.get(s)!)}（${增.get(s)! > 0 ? "+" : ""}${增.get(s)}）`);
  记(`人数变化（客户页、不含公海，看全部的人看到的数；只按负责人看的人按各自范围同向变）：${段.join("；") || "不变"}`);
  记("  · 「客户状态」筛选的条数按上面变；中栏名单按客户状态分组同此（「—」组即「未填写」）。看板：企业版项目模式下是按节点分列的项目看板，不读客户状态，各列数不变"
    + "（不开项目模式时的按客户属性分列看板，列数也不变，只是卡片上的客户状态由「—」变成对应状态）。详情页本来就按项目现算显示这个值，写后改读库里存的，显示不变。");
}

/** 抽查 20 家：近 30 天有沟通的先取（最多一半），再按目标状态轮流取，覆盖每种状态 */
function 抽查(们: readonly { 客户: 客户; 改后: string }[]): string {
  const 近 = 等距(们.filter((r) => r.客户.近沟通).map((r) => r.客户), 抽查数 / 2);
  const 已 = new Set(近.map((c) => c.id));
  const 按态 = new Map<string, 客户[]>();
  for (const r of 们) if (!已.has(r.客户.id)) { const l = 按态.get(r.改后); if (l) l.push(r.客户); else 按态.set(r.改后, [r.客户]); }
  const 每态 = Math.ceil((抽查数 - 近.length) / Math.max(1, 按态.size));
  const 列 = [...按态.values()].map((l) => 等距(l, 每态));
  const 选: 客户[] = [...近];
  for (let i = 0; 选.length < 抽查数 && 列.some((l) => i < l.length); i++) for (const l of 列) if (i < l.length && 选.length < 抽查数) 选.push(l[i]);
  const 改后 = new Map(们.map((r) => [r.客户.id, r.改后]));
  return 选.sort((a, b) => a.no - b.no).map((c) => `NO.${c.no}(${改后.get(c.id)}${c.近沟通 ? "·近30天有沟通" : ""})`).join(" ");
}

/* ---------- 计划行 ---------- */
type 计划行 = { 客户: 客户; 改前: string | null; 改后: string; 结果: "写" | "已完成" | "跳过"; 原因: string };
function 批计划(n: number): { 行们: 计划行[]; 总批数: number } {
  const 范 = 范围();
  const 写入 = 有效写入();
  const { 成员, 总批数 } = 批成员(n, 范, 写入);
  if (!成员.length) 停(`没有第 ${n} 批（按现在的数 1,000 家批共 ${总批数} 批）`);
  const 已写过 = new Map(写入.全部.map((w) => [w.客户id, w]));
  const 客 = 读客户(成员);
  const 行们 = 成员.map((id): 计划行 => {
    const c = 客.get(id)!;
    const w = 已写过.get(id);
    if (w && c.存 === w.新) return { 客户: c, 改前: null, 改后: w.新, 结果: "已完成", 原因: `已由 ${w.批次} 写过` };
    const 跳 = (原因: string): 计划行 => ({ 客户: c, 改前: c.存, 改后: c.新 ?? "空", 结果: "跳过", 原因 });
    if (c.删了) return 跳("客户已删");
    if (c.在公海) return 跳("已进客户公海");
    if (c.存 != null) return 跳(`库里已有值「${c.存}」（系统或人写过）`);
    if (!c.有项目 || c.新 == null) return 跳("名下没有算数的项目");
    if (c.新 !== c.旧) return 跳(`新旧规则不一致（旧 ${显(c.旧)} / 新 ${显(c.新)}）`);
    return { 客户: c, 改前: null, 改后: c.新, 结果: "写", 原因: c.近沟通 ? "近30天有沟通" : "" };
  });
  return { 行们, 总批数 };
}
function 七家计划(): 计划行[] {
  const ids = 七家.map((no) => {
    const 们 = 全("SELECT id FROM Customer WHERE customerNo = ?", no);
    if (们.length !== 1) 停(`NO.${no} 有 ${们.length} 位客户，应为 1`);
    return String(们[0].id);
  });
  const 客 = 读客户(ids);
  const 写入 = 有效写入();
  return ids.map((id) => {
    const c = 客.get(id)!;
    if (c.删了) 停(`NO.${c.no} 在回收站`);
    if (c.在公海) 停(`NO.${c.no} 已进客户公海（E-220：公海的不动）`);
    if (c.新 !== c.旧) 停(`NO.${c.no} 新旧规则不一致（旧 ${显(c.旧)} / 新 ${显(c.新)}）`);
    if (c.新 !== "潜在") 停(`NO.${c.no} 现算是「${显(c.新)}」，预期「潜在」（项目这几天动过，先报客户）`);
    if (c.存 === "潜在" && 写入.全部.some((w) => w.客户id === id)) return { 客户: c, 改前: "成交", 改后: "潜在", 结果: "已完成", 原因: "已写过" } as 计划行;
    if (c.存 !== "成交") 停(`NO.${c.no} 库里现在是「${显(c.存)}」，不是预期的改前值「成交」`);
    return { 客户: c, 改前: "成交", 改后: "潜在", 结果: "写", 原因: "成交→潜在，近90天有跟进（E-220 只修这 7 家）" } as 计划行;
  });
}

/* ---------- 写 / 撤 ---------- */
const 新日志id = (T: number) => "c" + (T.toString(36) + randomBytes(10).toString("hex")).slice(0, 24);
function 写入(行们: 计划行[], 批: string, 批次: string): number {
  const T = Date.now();
  const 写客户 = db.prepare("UPDATE Customer SET custStatus = ? WHERE id = ? AND custStatus IS ? AND deletedAt IS NULL");
  const 写日志 = db.prepare("INSERT INTO AuditLog (id, at, userId, userName, action, entity, entityId, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  let 写了 = 0;
  for (const r of 行们) {
    if (r.结果 !== "写") continue;
    if (Number((写客户.run(r.改后, r.客户.id, r.改前) as { changes: number | bigint }).changes) !== 1) throw new Error(`NO.${r.客户.no} 改动不是 1 行`);
    写日志.run(新日志id(T), T, OP!.id, OP!.name, "update", "Customer", r.客户.id,
      前缀件.加前缀(批次, 依据号, `[${件名} 批${批} NO.${r.客户.no}] 客户状态（按项目现算补写）：custStatus ${显(r.改前)} → ${r.改后}`),
      JSON.stringify(前缀件.加键({ 脚本, 类: "写", 批次, 批, 编号: `NO.${r.客户.no}`, 客户编号: r.客户.no, 表: "Customer", 键列: "id", 格: "客户状态（按项目现算补写）", 操作: "update",
        列: ["custStatus"], 旧: { custStatus: r.改前, updatedAt: r.客户.updatedAt }, 新: { custStatus: r.改后 }, 新旧规则: { 旧: r.客户.旧, 新: r.客户.新 }, 原因: r.原因 || "按项目现算补写", 依据 }, 批次, 依据号, { Customer: r.客户.id })));
    写了 += 1;
  }
  for (const r of 行们) {
    if (r.结果 === "跳过") continue;
    const x = 一("SELECT custStatus FROM Customer WHERE id = ?", r.客户.id);
    if (x?.custStatus !== r.改后) throw new Error(`回读 NO.${r.客户.no} 是「${显((x?.custStatus as string | null) ?? null)}」，应为「${r.改后}」`);
  }
  const 日志数 = Number(一("SELECT count(*) n FROM AuditLog WHERE at >= ? AND entity = 'Customer' AND json_valid(detail) AND json_extract(detail, '$.批次') = ?", 留痕起点, 批次)?.n);
  if (日志数 !== 写了) throw new Error(`操作日志 ${日志数} 条 ≠ 改动 ${写了} 行`);
  // 客户 E-244：本批每条日志正文带前缀、detail 带 批次 / 执行 / 依据，逐条核，不对整批回滚
  const 核 = 前缀件.核本批(db, 批次, 依据号, T);
  if (核.条数 !== 写了 || 核.错) throw new Error(`本批日志前缀 / 批次·执行·依据 不对 ${核.错} 条（共 ${核.条数} 条）`);
  return 写了;
}

function 印行(T: number, 批次: string, 批: string, 行们: 计划行[], 写: boolean) {
  记("北京时间\t批次号\t批\t客户编号\t负责人\t改前\t改后\t结果\t说明");
  for (const r of 行们) {
    const 果 = r.结果 === "写" ? (写 ? "已写" : "将写（空跑）") : r.结果;
    记(`${北京(T)}\t${批次}\t${批}\tNO.${r.客户.no}\t${r.客户.负责人}\t${显(r.改前)}\t${r.改后}\t${果}\t${r.原因}`);
  }
}
function 小结(行们: 计划行[]) {
  const 计 = (k: 计划行["结果"]) => 行们.filter((r) => r.结果 === k).length;
  const 按态 = new Map<string, number>();
  for (const r of 行们) if (r.结果 === "写") 按态.set(r.改后, (按态.get(r.改后) ?? 0) + 1);
  记(`小结：成员 ${行们.length} 家；要写 ${计("写")}（${[...按态].map(([s, n]) => `${s} ${n}`).join("、") || "无"}）；已完成 ${计("已完成")}；跳过 ${计("跳过")}；其中近 30 天有沟通 ${行们.filter((r) => r.结果 !== "跳过" && r.客户.近沟通).length} 家`);
}

function 跑批(批: string, 取计划: () => { 行们: 计划行[]; 总批数?: number }, 守?: () => void) {
  const 批次 = 本次批次(批 === 七家批 ? "7" : 批 === "试点" ? "p" : `b${批}`);
  记(`# ${件名} · 批 ${批} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}（执行：${前缀件.执行}）· 依据 ${依据号}${要写 ? ` · 批次号 ${批次}` : ""}`);
  记(`日志前缀${要写 ? "" : "（写时）"}：${前缀件.前缀(批次, 依据号)}`);
  if (!要写) {
    const { 行们, 总批数 } = 取计划();
    if (总批数 != null) 记(`（1,000 家批按现在的数共 ${总批数} 批）`);
    小结(行们);
    人数变化(行们.filter((r) => r.结果 === "写"));
    记(`抽查 20 家：${抽查(行们.filter((r) => r.结果 === "写").map((r) => ({ 客户: r.客户, 改后: r.改后 })))}`);
    印行(现在, "（空跑）", 批, 行们, false);
    return;
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    守?.();
    const { 行们 } = 取计划();
    const 要 = 行们.filter((r) => r.结果 === "写");
    小结(行们);
    人数变化(要);
    const 写了 = 写入(行们, 批, 批次);
    记(`抽查 20 家：${抽查(要.map((r) => ({ 客户: r.客户, 改后: r.改后 })))}`);
    印行(Date.now(), 批次, 批, 行们, true);
    db.exec("COMMIT");
    记(`已写：${写了} 行，操作日志（AuditLog，批次号 ${批次}）${写了} 条。撤回：--undo ${批次}`);
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    停(`出错，已回滚，库不变：${(e as Error).message}`);
  }
}

/** 写批 n（n ≥ 1）之前：试点和前面的批都写过、今天 1,000 家批没满 3 批 */
function 守批(n: number) {
  const { 按批 } = 有效写入();
  if (!按批.get("试点")?.length) throw new Error("试点批还没写（或已撤回），先写试点、抽查通过");
  for (let k = 1; k < n; k++) if (!按批.get(String(k))?.length) throw new Error(`第 ${k} 批还没写（或已撤回），按顺序写`);
  if (按批.get(String(n))?.length) return;
  const 今天 = 北京日(现在);
  const 今天批 = new Set(全(`SELECT json_extract(detail, '$.批次') b, json_extract(detail, '$.批') p, min(at) t FROM AuditLog WHERE at >= ? AND entity = 'Customer' AND json_valid(detail)
      AND json_extract(detail, '$.脚本') = ? AND json_extract(detail, '$.类') = '写' GROUP BY 1, 2`, 留痕起点, 脚本)
    .filter((r) => /^\d+$/.test(String(r.p)) && 北京日(Number(r.t)) === 今天).map((r) => String(r.p)));
  if (今天批.size >= 每天批数) throw new Error(`北京 ${今天} 已写 ${今天批.size} 批 1,000 家批（${[...今天批].join("、")}），每天不超过 ${每天批数} 批`);
}

function 撤(批次: string) {
  记(`# ${件名} · 撤回 ${批次} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}（执行：${前缀件.执行}）· 依据 ${依据号}`);
  const 跑 = () => {
    const { 写, 已撤批次 } = 读留痕();
    const 这批 = 写.filter((w) => w.批次 === 批次);
    if (!这批.length) throw new Error(`AuditLog 里没有批次 ${批次} 的写入`);
    if (已撤批次.has(批次)) { 记(`批次 ${批次} 已撤回过，不再撤`); return 0; }
    const 撤号 = `${批次}-undo-${randomBytes(2).toString("hex")}`;
    const T = Date.now();
    const 改 = db.prepare("UPDATE Customer SET custStatus = ? WHERE id = ? AND custStatus IS ?");
    const 写日志 = db.prepare("INSERT INTO AuditLog (id, at, userId, userName, action, entity, entityId, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const 前 = 页签各状态();
    const 撤的: { 改前: string | null; 改后: string | null }[] = [];
    记("北京时间\t批次号\t批\t客户编号\t负责人\t现在\t改回\t结果");
    let 撤了 = 0, 不撤 = 0;
    for (const w of 这批.sort((a, b) => a.客户编号 - b.客户编号)) {
      const c = 一("SELECT custStatus, salesOwnerId FROM Customer WHERE id = ?", w.客户id);
      const 现 = (c?.custStatus as string | null) ?? null;
      const 负责人 = 人名.get(String(c?.salesOwnerId)) ?? "—";
      if (现 !== w.新) { 不撤 += 1; 记(`${北京(T)}\t${批次}\t${w.批}\tNO.${w.客户编号}\t${负责人}\t${显(现)}\t${显(w.旧)}\t不撤（写后已被改成「${显(现)}」，留着）`); continue; }
      if (要写) {
        if (Number((改.run(w.旧, w.客户id, w.新) as { changes: number | bigint }).changes) !== 1) throw new Error(`NO.${w.客户编号} 撤回改动不是 1 行`);
        写日志.run(新日志id(T), T, OP!.id, OP!.name, "update", "Customer", w.客户id,
          前缀件.加前缀(撤号, 依据号, `[${件名} 撤回 ${批次} NO.${w.客户编号}] 客户状态：custStatus ${w.新} → ${显(w.旧)}`),
          JSON.stringify(前缀件.加键({ 脚本, 类: "撤回", 批次: 撤号, 撤的批次: 批次, 批: w.批, 编号: `NO.${w.客户编号}`, 客户编号: w.客户编号, 表: "Customer", 键列: "id", 操作: "update",
            列: ["custStatus"], 旧: { custStatus: w.新 }, 新: { custStatus: w.旧 }, 依据: "E-220（11-23）：「任一批抽查对不上，整批撤回」" }, 撤号, 依据号, { Customer: w.客户id })));
      }
      撤了 += 1;
      撤的.push({ 改前: w.新, 改后: w.旧 });
      记(`${北京(T)}\t${批次}\t${w.批}\tNO.${w.客户编号}\t${负责人}\t${w.新}\t${显(w.旧)}\t${要写 ? "已撤" : "将撤（空跑）"}`);
    }
    if (要写 && 不撤 && !撤了) {
      // 全都被改过：也记一条撤回标记，免得这批还算「写过」
      写日志.run(新日志id(T), T, OP!.id, OP!.name, "update", "Customer", null, 前缀件.加前缀(撤号, 依据号, `[${件名} 撤回 ${批次}] 全部已被改过，只记撤回`),
        JSON.stringify(前缀件.加键({ 脚本, 类: "撤回", 撤的批次: 批次, 依据: "E-220 整批撤回" }, 撤号, 依据号)));
    }
    // 撤回批次的日志同样逐条核前缀和四个键，不对整批回滚
    if (要写) {
      const 核 = 前缀件.核本批(db, 撤号, 依据号, T);
      if (核.错) throw new Error(`撤回日志前缀 / 批次·执行·依据 不对 ${核.错} 条（共 ${核.条数} 条）`);
    }
    人数变化(撤的, 前);
    记(`${要写 ? "已撤" : "空跑：将撤"} ${撤了} 家；不撤 ${不撤} 家（写后已被系统或人改过）${要写 ? `；撤回批次号 ${撤号}` : ""}；日志前缀「${前缀件.前缀(撤号, 依据号)}」`);
    return 撤了;
  };
  if (!要写) { 跑(); return; }
  db.exec("BEGIN IMMEDIATE");
  try { 跑(); db.exec("COMMIT"); } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    停(`出错，已回滚，库不变：${(e as Error).message}`);
  }
}

/* ---------- 主流程 ---------- */
const 开始 = performance.now();
if (看计划) {
  记(`# ${件名} · 计划（只读） · 北京 ${北京(现在)} · 库 ${库}`);
  const 范 = 范围();
  const 写入 = 有效写入();
  const { 总批数, 试点 } = 批成员(1, 范, 写入);
  const 近 = 范.候选.filter((c) => c.近沟通).length;
  const 按态 = new Map<string, number>();
  for (const c of 范.候选) 按态.set(c.新!, (按态.get(c.新!) ?? 0) + 1);
  记(`范围（没删、客户状态空、名下有项目、不在客户公海）：${千(范.总)} 家`);
  记(`  可写候选（新旧规则一致、算出非空）：${千(范.候选.length)} 家（${[...按态].map(([s, n]) => `${s} ${千(n)}`).join("、")}）；其中近 ${近沟通天} 天有沟通 ${千(近)} 家`);
  记(`  新旧规则不一致、不写：${千(范.不一致.length)} 家；两种规则都算出空（项目全是重复线索之类）：${范.算空.length} 家`);
  记(`  已写（没撤回）：${千(写入.全部.length)} 家（${[...写入.按批].map(([b, l]) => `批${b} ${l.length}`).join("、") || "无"}）`);
  记(`  试点 ${试点.length} 家 + 1,000 家批 ${总批数} 批；每天 ≤ ${每天批数} 批 → 试点 1 天 + ${Math.ceil(总批数 / 每天批数)} 天`);
  if (范.不一致.length) {
    记("新旧规则不一致名单：客户编号\t负责人\t旧规则\t新规则（PR-A）");
    for (const c of 范.不一致) 记(`NO.${c.no}\t${c.负责人}\t${显(c.旧)}\t${显(c.新)}`);
  }
} else if (批号 != null) {
  跑批(批名(批号), () => 批计划(批号), 批号 >= 1 ? () => 守批(批号) : undefined);
} else if (组参 != null) {
  跑批(七家批, () => ({ 行们: 七家计划() }));
} else {
  撤(撤参!);
}
记(`耗时 ${Math.round(performance.now() - 开始)} ms`);
落盘();
db.close();
