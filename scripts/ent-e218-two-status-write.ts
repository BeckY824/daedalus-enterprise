/**
 * E-218（客户 11-23）：客户状态「在推项目优先」上线后，只写两家客户的客户状态（custStatus），一次性数据脚本。
 *   NO.83028：流失 → 成交（名下有已流失线索，另有在推的订单阶段项目）
 *   NO.17535：页面「流失」→ 潜在（库里没存，详情章按旧公式现算「流失」；名下另有在推线索）
 * 依据：E-218（11-23）「空跑通过，只写 2 家」「就写这两家，走老规矩：备份 → 空跑 → 报时间 → 写入 → 抽查，附逐行日志」。
 * 1,350 家历史不一致不在本脚本范围（E-218：不做全量重算）。
 *
 * 目标值不手填：用代码里新规则的同一个函数算（cust-status-auto.ts 算客户状态 / 客户状态id），读库这一半照
 * cust-status-auto-db.ts 重算客户状态（PR #424 这一版）：
 *   - 项目 = Project.customerId 指着它、没软删的；pooledAt 带上（在线索公海的不算在推）
 *   - 不算 = 结局线索流失 + 线索验证终判「无效线索」+ 无效原因是重复线索（字典 dict-invalid-5 现名 + 原名「重复线索」，同 重复线索名们 / 重复线索不算）
 *   - 序号 → 字典 custStatus 这一项现在的名字（dict-custStatus-<序号>，表里没有用 字典定义 默认名，同 客户状态名们）
 *   - 写 custStatus + updatedAt（Prisma updateMany 带 @updatedAt，同 重算客户状态）
 * 留痕：照 11-20 起批量写正式库的规矩（客户 11-19「凡批量写正式库，逐批留操作记录」），每改一格写一条 AuditLog
 *   （userId/userName = --操作人 指定的账号，必填；entity Customer、entityId 客户 id；detail 带 脚本 / 批次 / 编号 / 旧 / 新 / 依据原话），
 *   格式同 草稿-写入-20261121 的 112 家、79119 两个脚本。重算客户状态 本身不写 AuditLog，这里多记这一条是数据脚本的规矩。
 *   客户 E-244（审计）：正文开头带「[批次 <批次号> · 执行：Becky（服务商）· 依据 <E-编号>]」，detail 带 批次 / 执行 / 依据 / 对应行（ent-batch-audit-prefix.ts）；
 *   --basis 必填；事务里回读逐条核本批日志的前缀和四个键，不对整批回滚。
 *
 * 用法（本机，代码副本根目录）：
 *   npx tsx scripts/ent-e218-two-status-write.ts <crm.db> --dry-run --basis E-218 --操作人 <userId> [--log <文件>]
 *   CONFIRM=yes npx tsx scripts/ent-e218-two-status-write.ts <crm.db> --write --basis E-218 --操作人 <userId> [--log <文件>]
 *   npx tsx scripts/ent-e218-two-status-write.ts <crm.db> --undo <批次号> --dry-run | --write（写要带 CONFIRM=yes）--basis E-218 --操作人 <userId> [--log <文件>]
 * 不认识的参数（拼错的、脚本没有的模式、多出来的路径）一律报错、退出码 2，库都不打开（3704 实操 r64 第 6 条：原来带 --undo 被当成空跑）。
 * 服务器上（没有 tsx）：本机先打成一个 cjs，scp 过去用服务器自带 node 跑（只依赖 node:sqlite，Node ≥ 22.13）：
 *   npx esbuild scripts/ent-e218-two-status-write.ts --bundle --platform=node --format=cjs --target=node22 --outfile=<目录>/e218-two-status.cjs
 *   CONFIRM=yes /opt/crm-enterprise/node/bin/node --no-warnings e218-two-status.cjs /opt/crm-enterprise/data/crm.db --write --basis E-218 --操作人 <userId> --log <文件>
 *
 * 写之前（同一个 BEGIN IMMEDIATE 事务里）逐家断言，任一家不过整批不写、退出码 1：
 *   - 客户编号唯一、没软删
 *   - 库里现存值是预期的改前值（两家都是：空，或已被存成「流失」——这两种页面上都显示「流失」；库里没存时详情按旧公式现算）
 *   - 按新规则算出来的值 = 预期（83028 成交、17535 潜在）
 * 已经是目标值的那家计「已完成」、不写；两家都已完成 = 0 行、退出码 0（可重复跑）。
 *
 * 输出逐行日志（北京时间、客户编号、字段、改前、改后、原因），不含客户名。
 * 撤回（--undo <批次号>，照 ent-e220-status-backfill.ts 的撤回）：按该批次 AuditLog 记下的改前值（detail.旧.custStatus，空就写回 NULL）逐行恢复，
 *   同一个 BEGIN IMMEDIATE 事务里先逐行核：现在的值仍等于该批次写入的新值（detail.新.custStatus）——有一行不等（写后被系统 / 人改过）就整批不写、
 *   报出是哪一行、退出码 1（空跑同样报出、退出码 1）。updatedAt 顶成撤回这一刻（同写入，Prisma @updatedAt 的口径；改前改后都记在日志里）。
 *   撤回另起批次「原批次-undo-xxxx」，每改一格记一条 AuditLog（类 = 撤回、撤的批次），正文同样带「[批次 … · 执行：Becky（服务商）· 依据 <E-编号>]」前缀、
 *   detail 带 批次 / 执行 / 依据 / 对应行；事务里回读值、日志条数、逐条核前缀和四个键，不对整批回滚。已撤回过的批次不再撤（退出码 0）。
 *   兜底：按写前备份恢复。
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { 算客户状态, 客户状态id, type 算状态的项目 } from "@/lib/enterprise/cust-status-auto";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";
import * as 前缀件 from "./ent-batch-audit-prefix";

const 脚本 = "ent-e218-two-status-write.ts";
const 件名 = "E-218 客户状态在推优先·两家";
const 依据 = "E-218（11-23）：「空跑通过，只写 2 家」「就写这两家，走老规矩：备份 → 空跑 → 报时间 → 写入 → 抽查，附逐行日志」";
/** 重复线索：同 cust-status-auto-db.ts 重复线索id / 重复线索原名 */
const 重复线索id = "dict-invalid-5";
const 重复线索原名 = "重复线索";

type 目标 = { 客户编号: number; 允许改前: readonly (string | null)[]; 预期: string; 原因: string };
const 两家: readonly 目标[] = [
  { 客户编号: 83028, 允许改前: [null, "流失"], 预期: "成交", 原因: "在推优先：名下有已流失线索，另有在推的订单阶段项目，已结束的流失不再压过在推项目" },
  { 客户编号: 17535, 允许改前: [null, "流失"], 预期: "潜在", 原因: "在推优先：名下有流失线索，另有在推线索，已结束的流失不再压过在推项目（库里原没存，详情按旧公式现算显示流失）" },
];

/** 本脚本的 AuditLog 都在这之后（北京 2026-11-23 00:00，同 e220 留痕起点），按 AuditLog_at_idx 找，不扫全表 */
const 留痕起点 = 1795363200000;
/** 本脚本写入的批次号：e218-<北京年月日时分秒>-<6 位 hex>（撤回只认这种，撤回批次「…-undo-xxxx」不能再撤） */
const 批次式 = /^e218-\d{14}-[0-9a-f]{6}$/;

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const 带值 = new Set(["--log", "--操作人", "--basis", "--undo"]);
// 最先核：不认识的参数直接退出码 2，库都不打开
前缀件.核参数(argv, ["--dry-run", "--write"], [...带值]);
const 取 = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const 库 = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && 带值.has(argv[i - 1])));
const 空跑 = argv.includes("--dry-run");
const 要写 = argv.includes("--write");
const 日志文件 = 取("--log");
const 撤参 = 取("--undo");
if (!库 || 空跑 === 要写) {
  console.error("用法：<crm.db> [--undo <批次号>] --dry-run | --write（写要带 CONFIRM=yes） --basis <E-编号，如 E-218> --操作人 <userId> [--log <文件>]");
  process.exit(2);
}
if (撤参 != null && !批次式.test(撤参)) { console.error(`--undo 要填本脚本写入的批次号（e218-<14 位时间>-<6 位>，写入输出和日志里有），「${撤参}」不是`); process.exit(2); }
if (要写 && process.env.CONFIRM !== "yes") { console.error("写库要带 CONFIRM=yes"); process.exit(2); }
const 依据号 = 前缀件.取依据(argv);
const 操作人id = 前缀件.取操作人(argv);

// 只读打开（Node 22 起支持 readOnly；装的 @types/node 构造函数只声明一个参数，同 ent-cust-status-dryrun.ts）
const 打开 = DatabaseSync as unknown as new (路径: string, 选项: { readOnly: boolean }) => DatabaseSync;
const db = new 打开(库, { readOnly: !要写 });
db.exec("PRAGMA busy_timeout = 15000");

type 行 = Record<string, unknown>;
const 一 = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).get(...p) as 行 | undefined;
const 全 = (sql: string, ...p: (string | number | null)[]) => db.prepare(sql).all(...p) as 行[];
const 北京 = (ms: number) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 19).replace("T", " ");
const 显 = (v: string | null) => v ?? "空";
const 现在 = Date.now();
const 批次 = `e218-${北京(现在).replace(/[-: ]/g, "").slice(0, 14)}-${randomBytes(3).toString("hex")}`;
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

/** 同 客户状态名们：序号 → 字典这一项现在的名字，表里没有用默认名 */
function 状态名们(): string[] {
  const 名 = new Map(全("SELECT id, name FROM EntDictItem WHERE kind = 'custStatus'").map((r) => [String(r.id), String(r.name)]));
  return 字典定义.custStatus.默认.map((n, i) => 名.get(客户状态id(i)) ?? n);
}
/** 同 重复线索名们 */
function 重复名们(): string[] {
  const 现 = (一("SELECT name FROM EntDictItem WHERE id = ?", 重复线索id)?.name as string | undefined)?.trim();
  return [...new Set([重复线索原名, ...(现 ? [现] : [])])];
}

type 计划行 = { t: 目标; id: string; 改前: string | null; 改后: string; updatedAt: number; 已完成: boolean; 项目: string };
/** 逐家核对 + 算目标值；有一家不过就 停 */
function 计划(): 计划行[] {
  const 名们 = 状态名们();
  const 重复 = 重复名们();
  return 两家.map((t) => {
    const 们 = 全("SELECT id, custStatus, updatedAt, deletedAt FROM Customer WHERE customerNo = ?", t.客户编号);
    if (们.length !== 1) 停(`NO.${t.客户编号} 有 ${们.length} 位客户，应为 1`);
    const c = 们[0];
    if (c.deletedAt != null) 停(`NO.${t.客户编号} 在回收站`);
    const 项目行 = 全("SELECT id, phase, node, result, pooledAt FROM Project WHERE customerId = ? AND deletedAt IS NULL", String(c.id));
    const 流失的 = 项目行.filter((p) => p.result === "线索流失").map((p) => String(p.id));
    const 不算 = new Set(流失的.length
      ? 全(`SELECT projectId FROM EntLeadVerify WHERE finalResult = '无效线索' AND invalidReason IN (${重复.map(() => "?").join(",")}) AND projectId IN (${流失的.map(() => "?").join(",")})`, ...重复, ...流失的).map((r) => String(r.projectId))
      : []);
    const 项目们: 算状态的项目[] = 项目行.map((p) => ({
      phase: String(p.phase), node: String(p.node), result: (p.result as string | null) ?? null,
      pooledAt: p.pooledAt == null ? null : new Date(Number(p.pooledAt)),
      ...(不算.has(String(p.id)) ? { 不算: true } : {}),
    }));
    const 序 = 算客户状态(项目们);
    const 改后 = 序 == null ? null : 名们[序];
    const 改前 = (c.custStatus as string | null) ?? null;
    const 项目 = 项目行.map((p) => `${p.phase}·${p.node}·${p.result ?? (p.pooledAt ? "公海中" : "在推")}${不算.has(String(p.id)) ? "（重复线索不算）" : ""}`).join("；");
    if (改后 !== t.预期) 停(`NO.${t.客户编号} 按新规则算出「${显(改后)}」，预期「${t.预期}」（名下项目：${项目}）`);
    if (改前 === 改后) return { t, id: String(c.id), 改前, 改后: 改后!, updatedAt: Number(c.updatedAt), 已完成: true, 项目 };
    if (!t.允许改前.includes(改前)) 停(`NO.${t.客户编号} 库里现在是「${显(改前)}」，不是预期的改前值（${t.允许改前.map(显).join(" / ")}）`);
    return { t, id: String(c.id), 改前, 改后: 改后!, updatedAt: Number(c.updatedAt), 已完成: false, 项目 };
  });
}

/* ---------- 撤回 ---------- */
type 写过 = { 日志id: string; 客户id: string; 客户编号: number; 旧: string | null; 新: string };
const 新日志id = (T: number) => "c" + (T.toString(36) + randomBytes(10).toString("hex")).slice(0, 24);
/** 撤回：整批照 AuditLog 改回改前值；有一行现在不是写入的新值 = 整批不写（停，退出码 1）。返回撤了几行 */
function 撤(批次号: string): number {
  记(`# ${件名} · 撤回 ${批次号} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}（执行：${前缀件.执行}）· 依据 ${依据号}`);
  const 本脚本的 = (批: string, 键: "批次" | "撤的批次") => 全(
    `SELECT id, entityId, detail FROM AuditLog WHERE at >= ? AND entity = 'Customer' AND json_valid(detail) AND json_extract(detail, '$.脚本') = ? AND json_extract(detail, '$.${键}') = ?`,
    留痕起点, 脚本, 批,
  );
  const 跑 = (): number => {
    const 这批: 写过[] = 本脚本的(批次号, "批次").flatMap((r) => {
      const d = JSON.parse(String(r.detail)) as { 类?: string; 客户编号: number; 旧?: { custStatus?: string | null }; 新?: { custStatus?: string } };
      return d.类 === "撤回" ? [] : [{ 日志id: String(r.id), 客户id: String(r.entityId), 客户编号: Number(d.客户编号), 旧: d.旧?.custStatus ?? null, 新: String(d.新?.custStatus) }];
    }).sort((a, b) => a.客户编号 - b.客户编号);
    if (!这批.length) throw new Error(`AuditLog 里没有批次 ${批次号} 的写入`);
    const 撤过 = 本脚本的(批次号, "撤的批次");
    if (撤过.length) {
      记(`批次 ${批次号} 已撤回过（${[...new Set(撤过.map((r) => String(JSON.parse(String(r.detail)).批次)))].join("、")}），不再撤`);
      return 0;
    }
    const 撤号 = `${批次号}-undo-${randomBytes(2).toString("hex")}`;
    记(`日志前缀${要写 ? "" : "（写时）"}：${前缀件.前缀(撤号, 依据号)}`);
    记("北京时间\t客户编号\t字段\t现在\t改回\t结果");
    // 先逐行核：现在仍是该批写入的新值。有不等的整批不写，全部报出来
    const 现们 = 这批.map((w) => {
      const c = 一("SELECT custStatus, updatedAt, deletedAt FROM Customer WHERE id = ?", w.客户id);
      return { w, 在: !!c, 删了: c?.deletedAt != null, 现: (c?.custStatus as string | null) ?? null, updatedAt: Number(c?.updatedAt) };
    });
    const 不对 = 现们.filter((x) => !x.在 || x.删了 || x.现 !== x.w.新);
    if (不对.length) {
      for (const x of 不对) 记(`${北京(Date.now())}\tNO.${x.w.客户编号}\tcustStatus（客户状态）\t${x.在 ? 显(x.现) : "（客户不在了）"}\t${显(x.w.旧)}\t不对：${!x.在 ? "找不到这位客户" : x.删了 ? "客户在回收站" : `写后已被改成「${显(x.现)}」，不是本批写入的「${x.w.新}」`}`);
      throw new Error(`${不对.length} 行现在的值不是本批写入的新值（${不对.map((x) => `NO.${x.w.客户编号}`).join("、")}），整批不撤`);
    }
    const T = Date.now();
    const 改 = db.prepare("UPDATE Customer SET custStatus = ?, updatedAt = ? WHERE id = ? AND custStatus IS ? AND deletedAt IS NULL");
    const 写日志 = db.prepare("INSERT INTO AuditLog (id, at, userId, userName, action, entity, entityId, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    let 撤了 = 0;
    for (const { w, 现, updatedAt } of 现们) {
      if (要写) {
        if (Number((改.run(w.旧, T, w.客户id, w.新) as { changes: number | bigint }).changes) !== 1) throw new Error(`NO.${w.客户编号} 撤回改动不是 1 行`);
        写日志.run(新日志id(T), T, OP!.id, OP!.name, "update", "Customer", w.客户id,
          前缀件.加前缀(撤号, 依据号, `[${件名} 撤回 ${批次号} NO.${w.客户编号}] 客户状态：custStatus ${w.新} → ${显(w.旧)}`),
          JSON.stringify(前缀件.加键({ 脚本, 类: "撤回", 批次: 撤号, 撤的批次: 批次号, 撤的日志: w.日志id, 编号: `NO.${w.客户编号}`, 客户编号: w.客户编号, 表: "Customer", 键列: "id",
            格: "客户状态（撤回在推优先重算）", 操作: "update", 列: ["custStatus", "updatedAt"],
            旧: { custStatus: 现, updatedAt }, 新: { custStatus: w.旧, updatedAt: T }, 原因: `整批撤回 ${批次号}，改回写入前的值`, 依据 }, 撤号, 依据号, { Customer: w.客户id })));
      }
      撤了 += 1;
      记(`${北京(T)}\tNO.${w.客户编号}\tcustStatus（客户状态）\t${w.新}\t${显(w.旧)}\t${要写 ? "已撤" : "将撤（空跑）"}`);
    }
    if (要写) {
      // 事务里回读：值对、日志条数 = 撤的行数、逐条核前缀和四个键
      for (const { w } of 现们) {
        const x = 一("SELECT custStatus FROM Customer WHERE id = ?", w.客户id);
        if (((x?.custStatus as string | null) ?? null) !== w.旧) throw new Error(`回读 NO.${w.客户编号} 是「${显((x?.custStatus as string | null) ?? null)}」，应为「${显(w.旧)}」`);
      }
      const 核 = 前缀件.核本批(db, 撤号, 依据号, T);
      if (核.条数 !== 撤了 || 核.错) throw new Error(`撤回日志 ${核.条数} 条（应 ${撤了}），前缀 / 批次·执行·依据 不对 ${核.错} 条`);
    }
    记(`${要写 ? "已撤" : "空跑：将撤"} ${撤了} 行${要写 ? `，撤回批次号 ${撤号}，操作日志 ${撤了} 条` : "，一行没写"}`);
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
记(`# ${件名} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}（执行：${前缀件.执行}）· 依据 ${依据号}${要写 ? ` · 批次 ${批次}` : ""}`);
记(`日志前缀${要写 ? "" : "（写时）"}：${前缀件.前缀(批次, 依据号)}`);
记("北京时间\t客户编号\t字段\t改前\t改后\t原因");
let 写了 = 0;
if (!要写) {
  for (const r of 计划()) {
    记(`${北京(现在)}\tNO.${r.t.客户编号}\tcustStatus（客户状态）\t${显(r.改前)}\t${r.改后}\t${r.已完成 ? "已完成（已是目标值，不写）" : `（空跑，未写）${r.t.原因}`}`);
    记(`  · 名下项目：${r.项目}`);
  }
} else {
  db.exec("BEGIN IMMEDIATE");
  try {
    const P = 计划();
    const T = Date.now();
    const 写客户 = db.prepare("UPDATE Customer SET custStatus = ?, updatedAt = ? WHERE id = ? AND custStatus IS ?");
    const 写日志 = db.prepare("INSERT INTO AuditLog (id, at, userId, userName, action, entity, entityId, summary, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const r of P) {
      if (r.已完成) {
        记(`${北京(T)}\tNO.${r.t.客户编号}\tcustStatus（客户状态）\t${显(r.改前)}\t${r.改后}\t已完成（已是目标值，不写）`);
        continue;
      }
      if (Number((写客户.run(r.改后, T, r.id, r.改前) as { changes: number | bigint }).changes) !== 1) throw new Error(`NO.${r.t.客户编号} 改动不是 1 行`);
      const 日志id = "c" + (T.toString(36) + randomBytes(10).toString("hex")).slice(0, 24);
      写日志.run(日志id, T, OP!.id, OP!.name, "update", "Customer", r.id,
        前缀件.加前缀(批次, 依据号, `[${件名} NO.${r.t.客户编号}] 客户状态（按在推优先重算）：custStatus ${显(r.改前)} → ${r.改后}`),
        JSON.stringify(前缀件.加键({ 脚本, 批次, 编号: `NO.${r.t.客户编号}`, 客户编号: r.t.客户编号, 表: "Customer", 键列: "id", 格: "客户状态（按在推优先重算）", 操作: "update",
          列: ["custStatus", "updatedAt"], 旧: { custStatus: r.改前, updatedAt: r.updatedAt }, 新: { custStatus: r.改后, updatedAt: T }, 原因: r.t.原因, 依据 }, 批次, 依据号, { Customer: r.id })));
      写了 += 1;
      记(`${北京(T)}\tNO.${r.t.客户编号}\tcustStatus（客户状态）\t${显(r.改前)}\t${r.改后}\t${r.t.原因}`);
    }
    // 事务里回读：值对、日志条数 = 改动行数
    for (const r of P) {
      const x = 一("SELECT custStatus FROM Customer WHERE id = ?", r.id);
      if (x?.custStatus !== r.改后) throw new Error(`回读 NO.${r.t.客户编号} 是「${显((x?.custStatus as string | null) ?? null)}」，应为「${r.改后}」`);
    }
    const 日志数 = Number(一("SELECT count(*) n FROM AuditLog WHERE entity = 'Customer' AND json_valid(detail) AND json_extract(detail, '$.批次') = ?", 批次)?.n);
    if (日志数 !== 写了) throw new Error(`操作日志 ${日志数} 条 ≠ 改动 ${写了} 行`);
    // 客户 E-244：本批每条日志正文带前缀、detail 带 批次 / 执行 / 依据，逐条核，不对整批回滚
    const 核 = 前缀件.核本批(db, 批次, 依据号, T);
    if (核.条数 !== 写了 || 核.错) throw new Error(`本批日志前缀 / 批次·执行·依据 不对 ${核.错} 条（共 ${核.条数} 条）`);
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    停(`出错，已回滚，库不变：${(e as Error).message}`);
  }
}
const 耗时 = Math.round(performance.now() - 开始);
记(要写 ? `已写：${写了} 行，操作日志（AuditLog，批次 ${批次}）${写了} 条；耗时 ${耗时} ms${写了 ? `。撤回：--undo ${批次}` : ""}` : `空跑结束，一行没写；耗时 ${耗时} ms`);
落盘();
db.close();
