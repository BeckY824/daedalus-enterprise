#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- 服务器上直接用 node 跑的 CommonJS 脚本（node:sqlite），不进打包 */
/**
 * 判无效待补存量统计（只读，11-20）：上线「判无效补位」之前已经最终判无效的线索，有多少条按现行条件该退名额、涉及几人。
 * 不写库、不补发：补不补由总控定，要补另写写入脚本。
 *
 *   node --no-warnings scripts/makeup-backlog-stats.cjs --db <crm.db> [--month 2026-11] [--detail]
 *
 * 口径（同 lib/project/lead-verify.ts 判死 + lib/enterprise/invalid-makeup.ts 记补位）：
 * - 最终判无效 = EntLeadVerifyLog 里 step 是「市场复核」或「总管理终判」、verdict = 「无效」的一行（销售初判即终判的不算）；
 *   月份按这一行的时刻（北京时间）算；同一条线索判过几次按最后一次
 * - 该补 = 判无效时的负责人（取项目现在的 ownerId；判死后线索流失、一般不再换人）在这条线索上有 counted = 1 的分配记录，
 *   或这条是补发给他的（EntLeadMakeup.usedProjectId，上线后才有）
 * - 另列：判了无效但没有算数分配记录的（老数据、导入、直接建给销售没补记的）——现行规则不补，供总控看要不要放宽
 * - 已有待补（EntLeadMakeup 同项目同人）的单列，表还没建（上线前）就当没有
 */
"use strict";

let sqlite;
try {
  sqlite = require("node:sqlite");
} catch {
  console.error("这个 Node 没有 node:sqlite：Node 22.5–22.12 加 --experimental-sqlite 再跑，或换 22.13 以上");
  process.exit(1);
}

const args = process.argv.slice(2);
const 取 = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dbPath = 取("--db");
if (!dbPath) { console.error("用法：--db <crm.db> [--month YYYY-MM] [--detail]"); process.exit(1); }
const 月 = 取("--month") ?? new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7);
const 明细 = args.includes("--detail");

const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
const 有表 = (n) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(n);
// 时刻列 Prisma 存毫秒整数；老行可能是文本，两种都认
const 北京月 = (列) => `strftime('%Y-%m', CASE WHEN typeof(${列}) = 'integer' THEN ${列} / 1000 ELSE strftime('%s', ${列}) END, 'unixepoch', '+8 hours')`;

const 判死 = db.prepare(`
  SELECT l.projectId, l.step, l.at, p.ownerId, p.result
  FROM EntLeadVerifyLog l JOIN Project p ON p.id = l.projectId
  WHERE l.verdict = '无效' AND l.step IN ('市场复核', '总管理终判')
    AND l.at = (SELECT MAX(at) FROM EntLeadVerifyLog x WHERE x.projectId = l.projectId AND x.verdict = '无效' AND x.step IN ('市场复核', '总管理终判'))
    AND ${北京月("l.at")} = ?
`).all(月);

const 算数行 = db.prepare("SELECT 1 FROM EntLeadAssign WHERE projectId = ? AND toUserId = ? AND counted = 1 LIMIT 1");
const 补发来 = 有表("EntLeadMakeup") ? db.prepare("SELECT 1 FROM EntLeadMakeup WHERE usedProjectId = ? AND userId = ? AND usedAt IS NOT NULL LIMIT 1") : null;
const 占过 = { get: (p, u) => 算数行.get(p, u) || 补发来?.get(p, u) };
const 已有待补 = 有表("EntLeadMakeup") ? db.prepare("SELECT 1 FROM EntLeadMakeup WHERE projectId = ? AND userId = ? LIMIT 1") : null;

const 该补 = [], 不补 = [], 已补 = [];
for (const r of 判死) {
  if (!r.ownerId) { 不补.push({ ...r, 为什么: "没负责人" }); continue; }
  if (!占过.get(r.projectId, r.ownerId)) { 不补.push({ ...r, 为什么: "没有算数的分配记录" }); continue; }
  if (已有待补?.get(r.projectId, r.ownerId)) { 已补.push(r); continue; }
  该补.push(r);
}
const 人数 = (们) => new Set(们.map((r) => r.ownerId)).size;
console.log(`月份 ${月}（北京）：最终判无效（市场复核 / 总管理终判）${判死.length} 条`);
console.log(`  按现行条件该补（占过名额）、还没有待补：${该补.length} 条，涉及 ${人数(该补)} 人`);
console.log(`  已有待补：${已补.length} 条`);
console.log(`  现行不补（没有算数分配记录等）：${不补.length} 条，涉及 ${人数(不补)} 人`);
if (明细) {
  for (const r of 该补) console.log(`  该补\t${r.projectId}\t${r.ownerId}\t${r.step}`);
  for (const r of 不补) console.log(`  不补\t${r.projectId}\t${r.ownerId}\t${r.step}\t${r.为什么}`);
}
