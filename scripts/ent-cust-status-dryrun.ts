/**
 * 客户状态「在推项目优先 + 重复线索不算」空跑（重复咨询第一步）：只读一份库，按新公式重算全库客户状态，
 * 输出页面上会变的客户（编号、负责人、改前、改后、原因），一行不写。
 *
 *   npx tsx scripts/ent-cust-status-dryrun.ts <库文件> <输出 CSV>
 *
 * 改前 = 页面现在显示的（显示用客户状态：库里存了用存的，没存按旧公式现算）；改后 = 新公式（cust-status-auto.ts 算客户状态，
 * 不算的 = 终判无效线索、无效原因是重复线索那几条，同 cust-status-auto-db.ts 标不算）。
 * 原因：在推优先 / 重复线索不算 = 这次改动带来的；库里存的是旧值 = 存的和旧公式现算本来就对不上（上次重算后项目变了没跟上、导入的老值），
 * 部署后全量重算时也会变，跟这次改动无关，单列出来
 */
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { 算客户状态, 客户状态id, type 算状态的项目, type 客户状态序号 } from "@/lib/enterprise/cust-status-auto";
import { 企业版字典, 本套名, 是交付 } from "@/lib/project/stage-dict";
import { 字典定义 } from "@/lib/enterprise/dict-kinds";

const [库, 出] = process.argv.slice(2);
if (!库 || !出) {
  console.error("用法：npx tsx scripts/ent-cust-status-dryrun.ts <库文件> <输出 CSV>");
  process.exit(2);
}
// 只读打开（Node 22 起支持 readOnly；装的 @types/node 构造函数还只声明一个参数，同 check-invariants.mjs 的用法）
const 只读打开 = DatabaseSync as unknown as new (路径: string, 选项: { readOnly: boolean }) => DatabaseSync;
const db = new 只读打开(库, { readOnly: true });

/** 旧公式（改动前的 算客户状态，原样留一份对照）：异常 > 丢单 > 流失 > 成交 > 意向 > 潜在，不看在推、不排除 */
function 旧公式(项目们: readonly 算状态的项目[]): 客户状态序号 | null {
  const 在的 = 项目们.filter((p) => !p.deletedAt);
  if (!在的.length) return null;
  const 交付数 = 在的.filter((p) => 是交付(p.result)).length;
  if (交付数 >= 3) return 5;
  if (交付数 === 2) return 4;
  if (交付数 === 1) return 3;
  if (在的.some((p) => p.result === "异常状态")) return 8;
  if (在的.some((p) => p.result === "丢单")) return 6;
  if (在的.some((p) => p.result === "线索流失")) return 7;
  if (在的.some((p) => p.result == null && (p.phase === "订单" || (p.phase === "商机" && 本套名(p.node, 企业版字典) === "首款到账")))) return 2;
  if (在的.some((p) => p.result == null && p.phase === "商机")) return 1;
  return 0;
}

const 名 = new Map((db.prepare(`SELECT id, name FROM EntDictItem WHERE kind = 'custStatus'`).all() as { id: string; name: string }[]).map((r) => [r.id, r.name]));
const 状态名们 = 字典定义.custStatus.默认.map((n, i) => 名.get(客户状态id(i)) ?? n);
const 显 = (i: number | null) => (i == null ? null : 状态名们[i]);

const 重复现名 = (db.prepare(`SELECT name FROM EntDictItem WHERE id = 'dict-invalid-5'`).get() as { name?: string } | undefined)?.name?.trim();
const 重复名们 = [...new Set(["重复线索", ...(重复现名 ? [重复现名] : [])])];
const 不算 = new Set(
  (db.prepare(`SELECT projectId FROM EntLeadVerify WHERE finalResult = '无效线索' AND invalidReason IN (${重复名们.map(() => "?").join(",")})`).all(...重复名们) as { projectId: string }[]).map((r) => r.projectId),
);

type 项 = 算状态的项目 & { id: string };
const 按客户 = new Map<string, 项[]>();
for (const p of db.prepare(`SELECT id, customerId, phase, node, result, pooledAt FROM Project WHERE deletedAt IS NULL AND customerId IS NOT NULL`).all() as { id: string; customerId: string; phase: string; node: string; result: string | null; pooledAt: number | string | null }[]) {
  const 行: 项 = { id: p.id, phase: p.phase, node: p.node, result: p.result, pooledAt: p.pooledAt == null ? null : new Date(p.pooledAt), ...(p.result === "线索流失" && 不算.has(p.id) ? { 不算: true } : {}) };
  const 列 = 按客户.get(p.customerId);
  if (列) 列.push(行);
  else 按客户.set(p.customerId, [行]);
}
const 人名 = new Map((db.prepare(`SELECT id, name FROM User`).all() as { id: string; name: string }[]).map((u) => [u.id, u.name]));
const 客户们 = db.prepare(`SELECT c.id, c.customerNo, c.salesOwnerId, c.custStatus, (SELECT 1 FROM CustomerPool cp WHERE cp.customerId = c.id) AS 公海 FROM Customer c WHERE c.deletedAt IS NULL`).all() as {
  id: string; customerNo: string | null; salesOwnerId: string | null; custStatus: string | null; 公海: number | null;
}[];

const csv = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const 行们: string[] = [["客户编号", "负责人", "在公海", "改前（页面现在显示）", "改后（在推优先重算）", "库里存的", "旧公式现算", "原因"].join(",")];
const 计 = new Map<string, number>();
const 跳 = new Map<string, number>();
let 变 = 0;
for (const c of 客户们) {
  const ps = 按客户.get(c.id) ?? [];
  const 旧 = 显(旧公式(ps));
  const 新不排 = 显(算客户状态(ps.map((p) => ({ ...p, 不算: false }))));
  const 新 = 显(算客户状态(ps));
  const 改前 = c.custStatus ?? 旧;
  if (改前 === 新) continue;
  变 += 1;
  const 因: string[] = [];
  if (新不排 !== 旧) 因.push("在推优先");
  if (新 !== 新不排) 因.push("重复线索不算");
  if (c.custStatus != null && c.custStatus !== 旧) 因.push("库里存的是旧值");
  const 因字 = 因.join("+") || "其他";
  计.set(因字, (计.get(因字) ?? 0) + 1);
  const 跳字 = `${改前 ?? "—"} → ${新 ?? "—"}`;
  跳.set(跳字, (跳.get(跳字) ?? 0) + 1);
  行们.push([c.customerNo ?? c.id, c.salesOwnerId ? 人名.get(c.salesOwnerId) ?? c.salesOwnerId : "—", c.公海 ? "是" : "", 改前 ?? "—", 新 ?? "—", c.custStatus ?? "—", 旧 ?? "—", 因字].map(csv).join(","));
}
writeFileSync(出, "﻿" + 行们.join("\n") + "\n");
db.close();
const 排 = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}：${n}`).join("\n");
console.log(`客户（未删）${客户们.length} 家，页面状态会变 ${变} 家 → ${出}\n按原因：\n${排(计)}\n按跳法：\n${排(跳)}\n重复线索认的名：${重复名们.join("、")}；终判无效原因是重复线索的项目 ${不算.size} 条`);
