// 【我方用】企业版只用项目（10-28）：新版本启动时一次性清掉商机、合同、订单、供应商这几张老表（src/lib/enterprise/legacy-cleanup.ts），
// 子表随外键级联，挂在它们上面的附件、数据接入对照行一起删，跟进上的「挂哪个商机」置空。这是有意的。
// tools/verify-upgrade.sh 把这个文件拼在 table-counts.js / core-hash.js 前面经 stdin 交给 node：
//   老表和级联子表不比（按外键算闭包，免得以后加子表漏写）；附件、对照行只比清理不碰的那部分；指向老表的外键列（和 updatedAt）不比。
// 要用调用方打开的 db（DatabaseSync）。
/* eslint-disable @typescript-eslint/no-unused-vars -- 这里只定义，拼在后面的脚本里用 */
const LEGACY_ROOTS = ["Opportunity", "Contract", "TradeOrder", "Supplier"];

function legacyTables(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
  const gone = new Set(LEGACY_ROOTS.filter((t) => names.includes(t)));
  for (let grew = true; grew; ) {
    grew = false;
    for (const t of names) {
      if (gone.has(t)) continue;
      const fks = db.prepare(`PRAGMA foreign_key_list("${t}")`).all();
      if (fks.some((f) => gone.has(f.table) && String(f.on_delete).toUpperCase() === "CASCADE")) { gone.add(t); grew = true; }
    }
  }
  return gone;
}

// 清理会删的那部分之外（和 legacy-cleanup.ts 的条件一一对应）
const LEGACY_KEEP = {
  Attachment: `("opportunityId" IS NULL AND "orderId" IS NULL) OR "leadId" IS NOT NULL OR "contactId" IS NOT NULL`,
  EntExternalRef: `"targetId" IS NULL OR "targetId" NOT IN (SELECT "id" FROM "Opportunity")`,
};
// 留下来的表里指向老表的外键列（跟进挂商机等）：清理会置空，置空时 updatedAt 也跟着变，都不算进内容哈希
function legacyCols(db, gone, t) {
  const fk = db.prepare(`PRAGMA foreign_key_list("${t}")`).all().filter((f) => gone.has(f.table)).map((f) => f.from);
  return new Set(fk.length ? [...fk, "updatedAt"] : []);
}
