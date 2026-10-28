/* eslint-disable @typescript-eslint/no-require-imports -- 经 stdin 交给 node - 跑，只能是 CommonJS */
/* global legacyTables, LEGACY_KEEP -- 来自前面拼上的 legacy.js */
// 【我方用】每张表的行数，一行一张「表名 行数」，按表名排好（tools/verify-upgrade.sh 调，前面拼上 legacy.js）。
// 企业版清理会删的老表不列；附件、对照行只数清理不碰的那部分（见 legacy.js）。
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(`${process.env.DATA_DIR || "/data"}/crm.db`, { readOnly: true });
const gone = legacyTables(db);
const out = [];
for (const { name: t } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()) {
  if (gone.has(t)) continue;
  let where = "";
  if (LEGACY_KEEP[t]) {
    // 老表这时已经被删了（新版本）也照样能跑：子查询对着空表
    try { db.prepare(`SELECT 1 FROM "${t}" WHERE ${LEGACY_KEEP[t]} LIMIT 1`).all(); where = ` WHERE ${LEGACY_KEEP[t]}`; } catch { /* 列不在就整表数 */ }
  }
  out.push(`${t} ${db.prepare(`SELECT COUNT(*) AS n FROM "${t}"${where}`).get().n}`);
}
db.close();
process.stdout.write(out.join("\n") + "\n");
