/**
 * E-218（Even 11-23）：客户状态「在推项目优先」上线后，只写两家客户的客户状态（custStatus），一次性数据脚本。
 *   NO.83028：流失 → 成交（名下有已流失线索，另有在推的订单阶段项目）
 *   NO.17535：页面「流失」→ 潜在（库里没存，详情章按旧公式现算「流失」；名下另有在推线索）
 * 依据：Even 11-23（E-218）「空跑通过，只写 2 家」「就写这两家，走老规矩：备份 → 空跑 → 报时间 → 写入 → 抽查，附逐行日志」。
 * 1,350 家历史不一致不在本脚本范围（Even：不做全量重算）。
 *
 * 目标值不手填：用代码里新规则的同一个函数算（cust-status-auto.ts 算客户状态 / 客户状态id），读库这一半照
 * cust-status-auto-db.ts 重算客户状态（PR #424 这一版）：
 *   - 项目 = Project.customerId 指着它、没软删的；pooledAt 带上（在线索公海的不算在推）
 *   - 不算 = 结局线索流失 + 线索验证终判「无效线索」+ 无效原因是重复线索（字典 dict-invalid-5 现名 + 原名「重复线索」，同 重复线索名们 / 重复线索不算）
 *   - 序号 → 字典 custStatus 这一项现在的名字（dict-custStatus-<序号>，表里没有用 字典定义 默认名，同 客户状态名们）
 *   - 写 custStatus + updatedAt（Prisma updateMany 带 @updatedAt，同 重算客户状态）
 * 留痕：照 11-20 起批量写正式库的规矩（Even 11-19「凡批量写正式库，逐批留操作记录」），每改一格写一条 AuditLog
 *   （userId/userName = 操作人，默认第一个启用的系统管理员；entity Customer、entityId 客户 id；detail 带 脚本 / 批次 / 编号 / 旧 / 新 / 依据），
 *   格式同 草稿-写入-20261121 的 112 家、79119 两个脚本。重算客户状态 本身不写 AuditLog，这里多记这一条是数据脚本的规矩。
 *
 * 用法（本机，代码副本根目录）：
 *   npx tsx scripts/ent-e218-two-status-write.ts <crm.db> --dry-run [--log <文件>]
 *   CONFIRM=yes npx tsx scripts/ent-e218-two-status-write.ts <crm.db> --write [--log <文件>] [--操作人 <userId>]
 * 服务器上（没有 tsx）：本机先打成一个 cjs，scp 过去用服务器自带 node 跑（只依赖 node:sqlite，Node ≥ 22.13）：
 *   npx esbuild scripts/ent-e218-two-status-write.ts --bundle --platform=node --format=cjs --target=node22 --outfile=<目录>/e218-two-status.cjs
 *   CONFIRM=yes /opt/crm-enterprise/node/bin/node --no-warnings e218-two-status.cjs /opt/crm-enterprise/data/crm.db --write --log <文件>
 *
 * 写之前（同一个 BEGIN IMMEDIATE 事务里）逐家断言，任一家不过整批不写、退出码 1：
 *   - 客户编号唯一、没软删
 *   - 库里现存值是预期的改前值（两家都是：空，或已被存成「流失」——这两种页面上都显示「流失」；库里没存时详情按旧公式现算）
 *   - 按新规则算出来的值 = 预期（83028 成交、17535 潜在）
 * 已经是目标值的那家计「已完成」、不写；两家都已完成 = 0 行、退出码 0（可重复跑）。
 *
 * 输出逐行日志（北京时间、客户编号、字段、改前、改后、原因），不含客户名。
 * 撤回（Even 要撤时）：按日志里的批次，把两家 custStatus 改回「改前」（17535 改前是空就写 NULL），并各补一条 AuditLog；或按写前备份处理。
 */
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { 算客户状态, 客户状态id, type 算状态的项目 } from "@/lib/enterprise/cust-status-auto";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";

const 脚本 = "ent-e218-two-status-write.ts";
const 件名 = "E-218 客户状态在推优先·两家";
const 依据 = "Even 11-23（E-218）：「空跑通过，只写 2 家」「就写这两家，走老规矩：备份 → 空跑 → 报时间 → 写入 → 抽查，附逐行日志」";
/** 重复线索：同 cust-status-auto-db.ts 重复线索id / 重复线索原名 */
const 重复线索id = "dict-invalid-5";
const 重复线索原名 = "重复线索";

type 目标 = { 客户编号: number; 允许改前: readonly (string | null)[]; 预期: string; 原因: string };
const 两家: readonly 目标[] = [
  { 客户编号: 83028, 允许改前: [null, "流失"], 预期: "成交", 原因: "在推优先：名下有已流失线索，另有在推的订单阶段项目，已结束的流失不再压过在推项目" },
  { 客户编号: 17535, 允许改前: [null, "流失"], 预期: "潜在", 原因: "在推优先：名下有流失线索，另有在推线索，已结束的流失不再压过在推项目（库里原没存，详情按旧公式现算显示流失）" },
];

/* ---------- 参数 ---------- */
const argv = process.argv.slice(2);
const 取 = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const 带值 = new Set(["--log", "--操作人"]);
const 库 = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && 带值.has(argv[i - 1])));
const 空跑 = argv.includes("--dry-run");
const 要写 = argv.includes("--write");
const 日志文件 = 取("--log");
if (!库 || 空跑 === 要写) {
  console.error("用法：<crm.db> --dry-run | --write（写要带 CONFIRM=yes） [--log <文件>] [--操作人 <userId>]");
  process.exit(2);
}
if (要写 && process.env.CONFIRM !== "yes") { console.error("写库要带 CONFIRM=yes"); process.exit(2); }

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

const OP = (取("--操作人")
  ? 一("SELECT id, name FROM User WHERE id = ?", 取("--操作人")!)
  : 一("SELECT id, name FROM User WHERE role = 'ADMIN' AND active = 1 ORDER BY createdAt LIMIT 1")) as { id: string; name: string } | undefined;
if (!OP) 停("找不到操作人（系统管理员），用 --操作人 <userId> 指定");

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

/* ---------- 主流程 ---------- */
const 开始 = performance.now();
记(`# ${件名} · ${要写 ? "写" : "空跑（只读）"} · 北京 ${北京(现在)} · 库 ${库} · 操作人 ${OP!.name}${要写 ? ` · 批次 ${批次}` : ""}`);
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
        `[${件名} NO.${r.t.客户编号}] 客户状态（按在推优先重算）：custStatus ${显(r.改前)} → ${r.改后}`,
        JSON.stringify({ 脚本, 批次, 编号: `NO.${r.t.客户编号}`, 客户编号: r.t.客户编号, 表: "Customer", 键列: "id", 格: "客户状态（按在推优先重算）", 操作: "update",
          列: ["custStatus", "updatedAt"], 旧: { custStatus: r.改前, updatedAt: r.updatedAt }, 新: { custStatus: r.改后, updatedAt: T }, 原因: r.t.原因, 依据 }));
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
    db.exec("COMMIT");
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch { /* 已回滚 */ }
    停(`出错，已回滚，库不变：${(e as Error).message}`);
  }
}
const 耗时 = Math.round(performance.now() - 开始);
记(要写 ? `已写：${写了} 行，操作日志（AuditLog，批次 ${批次}）${写了} 条；耗时 ${耗时} ms` : `空跑结束，一行没写；耗时 ${耗时} ms`);
落盘();
db.close();
