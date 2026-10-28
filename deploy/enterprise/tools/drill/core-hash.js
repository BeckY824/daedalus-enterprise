/* eslint-disable @typescript-eslint/no-require-imports -- 经 stdin 交给 node - 跑，只能是 CommonJS */
// 【我方用】核心业务表的内容哈希：在 crm 容器里用 node --experimental-sqlite 跑（tools/verify-upgrade.sh 调）。
// 升级会加列、回滚后库里留着新列，所以只按「起点时就有的列」算：
//   第一次（BASE 为 null）：第一行打出起点各表的列 JSON，后面每行「hash 表名 行数 sha256」
//   之后（脚本在前面拼上 const BASE = <第一行的 JSON>;）：按这些列再算一遍，三次必须相等
// 行哈希排序后再哈希，和 snapshot.js 一样不依赖物理顺序。
// 前面还拼着 legacy.js：企业版启动时有意清掉的老数据不比（附件只比清理不碰的，指向老表的外键列不算）。
// 只比起点就有的行（按 id）：企业版启动时会把老线索转成项目，新加客户、联系人、项目，这是有意的；行数没少由行数那步管。
/* global legacyTables, legacyCols, legacyKeep */
const { DatabaseSync } = require("node:sqlite");
const crypto = require("node:crypto");

// 客户真正的业务数据。日志、会话、设置、迁移记录启动时可能被写，不算；商机、合同、订单、供应商见 legacy.js
const CORE = ["User", "Customer", "Contact", "Lead", "FollowUp", "Task", "Attachment", "Project", "ProjectMember",
  "CustomerPool", "Channel"];
const SKIP = new Set((process.env.CORE_SKIP || "").split(/\s+/).filter(Boolean));

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const val = (v) =>
  v instanceof Uint8Array ? { blob: Buffer.from(v).toString("base64") }
  : typeof v === "bigint" ? { int: v.toString() }
  : v;
const q = (n) => `"${n.replace(/"/g, '""')}"`;

const db = new DatabaseSync(`${process.env.DATA_DIR || "/data"}/crm.db`, { readOnly: true });
let { cols, ids } = typeof BASE === "undefined" ? {} : BASE;
const out = [];
if (!cols) {
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name));
  const gone = legacyTables(db);
  cols = {};
  ids = {};
  for (const t of CORE) {
    if (!have.has(t) || SKIP.has(t) || gone.has(t)) continue;
    const drop = legacyCols(db, gone, t);
    cols[t] = db.prepare(`PRAGMA table_info(${q(t)})`).all().map((c) => c.name).filter((c) => !drop.has(c));
    if (cols[t].includes("id")) ids[t] = db.prepare(`SELECT "id" FROM ${q(t)}`).all().map((r) => r.id);
  }
  out.push(JSON.stringify({ cols, ids }));
}
for (const [t, cs] of Object.entries(cols)) {
  if (SKIP.has(t)) continue;
  const where = legacyKeep(db, t);
  const st = db.prepare(`SELECT ${cs.map(q).join(",")} FROM ${q(t)}${where ? ` WHERE ${where}` : ""}`);
  st.setReadBigInts(true);
  const keep = ids[t] && new Set(ids[t]);
  const hs = [];
  for (const row of st.iterate()) if (!keep || keep.has(row.id)) hs.push(sha(JSON.stringify(cs.map((c) => val(row[c])))));
  hs.sort();
  out.push(`hash ${t} ${hs.length} ${sha(hs.join("\n"))}`);
}
db.close();
process.stdout.write(out.join("\n") + "\n");
