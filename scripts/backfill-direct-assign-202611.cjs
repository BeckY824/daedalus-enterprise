#!/usr/bin/env node
/**
 * 补记 2026-11（北京时间）市场成员新建时直接指定给别人的分配记录（11-18 加急，规则同 src/lib/enterprise/direct-assign.ts）。
 *
 *   node --no-warnings scripts/backfill-direct-assign-202611.cjs --db <crm.db>            # 演练（默认）：只打印，库不动
 *   node --no-warnings scripts/backfill-direct-assign-202611.cjs --db <crm.db> --write    # 真写：一个 BEGIN IMMEDIATE 事务，写前写后核条数
 *   Node 22.5–22.12 要加 --experimental-sqlite（22.13 起不用）。只用 node 自带的 node:sqlite，不要 prisma、不要 sqlite3。
 *
 * 为什么要补：客户 11-18 定「指定分配也计数」，同日补充「只针对市场成员和市场管理新建客户；销售自己新建的不适用」。
 * 以前市场成员新建客户 / 新线索时直接把负责人选成销售，只发「分给你」通知、不写 EntLeadAssign，接手人本月已分一直是 0。
 * 代码从这一版起新建时就记（direct-assign.ts）；这个脚本把本月已经发生的补上。
 *
 * 口径（和代码一致）：
 * - 以项目为单位，一个项目最多一条：企业版只用项目（新线索 = 线索阶段的项目），每个新建入口都正好落一个项目——
 *   建档向导 / 首页 AI 新线索卡 = 向导建的项目；新建客户页、只建客户 = 客户自带的潜客培育项目；客户页新增项目 = 那个项目。
 *   客户层不另记：建档向导里客户先落在市场名下、同一事务里随项目转给销售（CustomerOwnerLog 记一行 market-assign），
 *   客户、项目各记一条就把同一次分配算了两次。
 * - 本月 = 项目 createdAt 在北京时间 2026-11-01 00:00 到 12-01 00:00 之间（库里毫秒整数；>= 2026-10-31T16:00:00Z）
 * - 建的人 = Project.creatorId，要是市场成员：EntMember.bizRole（逗号串）含 marketing_mgr 或 channel_ops。只看业务角色，看的是现在的角色
 * - 初始负责人（不是现在的负责人）：这个项目最早一条换负责人留痕（ProjectNodeLog kind = transfer / pool-release / pool-claim）的 fromOwnerId；
 *   一条都没有 = 建好以后没换过人，就是现在的 ownerId。代码里所有换项目负责人的路径（分配、转让、随客户带走、进出公海、离职交接）都记这条留痕。
 *   推出来是空（公海占位、空串）的算推不出，不补，单独计数
 * - 初始负责人 ≠ 建的人才补（销售建给自己、市场建给自己再分出去的都不算；再分出去那次走分配线索，本来就有记录）
 * - 只补「新建那一下」：项目和客户是一起建的（createdAt 相差 ≤ 2 分钟：建档向导 / AI 卡 / 新建客户页 / 只建客户），
 *   或者项目带着建的人同一时刻写的首条沟通（FollowUpProject + FollowUp.ownerId = 建的人、相差 ≤ 2 分钟：客户页新增项目）。
 *   公海领取 / 分配、回收站恢复、导入时补的潜客培育项目（creatorId 也是操作人）都不满足，排掉
 * - 排掉：项目或客户已删（deletedAt）、已有分配记录（EntLeadAssign 同 projectId，或同 leadId = 项目的 sourceLeadId）、
 *   导入 / 同步来的（项目或客户出现在 EntImportRow / EntExternalRef / ImportRow，或项目 importBatch 有值）、
 *   历史分析回填（source 有值）、系统补建（creatorId = system）
 * - 新行：id cuid 风格随机串；leadId 空串；projectId；toUserId = 初始负责人；fromUserId = byUserId = 建的人；
 *   way = 分配方式字典第 0 项现在的叫法（dict-assign-0，没有就「指定分配」）；kind 营销；counted 1；
 *   month = 建档时间所在的北京月；createdAt = 项目建档时间（毫秒整数）
 * - line：项目业务线（内贸 / 外贸）→ 客户区域（客户地址空看项目所在地；大陆 内贸、非大陆含港澳台 外贸）→ 客户的号（大陆手机 内贸、别的国际区号 外贸）
 *   → 接手人的事业部（EntMember.line → 「各条线参与自动分配的部门」设置 → 往上找部门名带内贸 / 外贸）→ null。
 *   号的判法是代码 验客户电话 的简化版（只认格式，不认占位号），只影响 line 这一格，不影响补不补
 *
 * 参考：同时打印客户层的数（本月市场成员建的客户、没项目的客户），对账用；没有项目的客户不补（同代码：没有项目就没有分配记录可挂）。
 * 写的时候：BEGIN IMMEDIATE（等锁 15 秒），事务里重新算一遍计划；写前记 EntLeadAssign 总数，写后核「总数 = 写前 + 计划条数」
 * 且每个计划里的项目正好一条记录，对不上 ROLLBACK、退出码 2。
 */
"use strict";

const crypto = require("node:crypto");

let sqlite;
try {
  sqlite = require("node:sqlite");
} catch {
  console.error("这个 Node 没有 node:sqlite：Node 22.5–22.12 加 --experimental-sqlite 再跑，或换 22.13 以上");
  process.exit(1);
}

const 月 = "2026-11";
const 北京偏移 = 8 * 3600 * 1000;
const 起 = Date.UTC(2026, 10, 1) - 北京偏移; // 2026-10-31T16:00:00Z
const 止 = Date.UTC(2026, 11, 1) - 北京偏移; // 2026-11-30T16:00:00Z
const 同时 = 2 * 60 * 1000;
const 换人留痕 = ["transfer", "pool-release", "pool-claim"];

/** DateTime 列：prisma 存毫秒整数；万一是文本也认 */
const 毫秒 = (v) => (v === null || v === undefined ? null : typeof v === "number" || typeof v === "bigint" ? Number(v) : Date.parse(String(v)));
const 北京时间 = (ms) => new Date(ms + 北京偏移).toISOString().replace("T", " ").slice(0, 19);
const 北京月 = (ms) => new Date(ms + 北京偏移).toISOString().slice(0, 7);

const 拆角色 = (s) => String(s ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const 是市场成员 = (角色们) => 角色们.includes("marketing_mgr") || 角色们.includes("channel_ops");

// —— 方向（同 customer-region.ts 区域of / 电话定线 / 本人事业部）——
const 国内别名 = new Set(["中国", "中国大陆", "china", "cn", "prc"]);
const 也算中国 = /^(中國|中國大陸|中华人民共和国|中華人民共和國|大陆|people'?s\s+republic\s+of\s+china|mainland\s+china)$/i;
const 港澳台 = /^(中国|中國)?\s*(香港|澳门|澳門|台湾|臺灣)|^(hong\s*kong|macau|macao|taiwan)\b|^(hk|mo|tw)$/i;
const 格 = (x) => String(x ?? "").trim();
function 区域线(a) {
  if (!a) return null;
  const 国 = 格(a.addrCountry), 省 = 格(a.addrProvince), 市 = 格(a.addrCity), 区 = 格(a.addrDistrict);
  if (!国 && !省 && !市 && !区) return null;
  if (!国 || 国内别名.has(国.toLowerCase()) || 也算中国.test(国)) return 港澳台.test(省) || 港澳台.test(市) ? "外贸" : "内贸";
  return "外贸";
}
function 电话线(号们) {
  for (const 原 of 号们) {
    const s = String(原 ?? "").replace(/[\s\-()（）－—–.]/g, "").replace(/^＋/, "+");
    if (!s) continue;
    if (/^(?:\+86|0086|86)?1[3-9]\d{9}$/.test(s)) return "内贸";
    const 国际 = /^(?:\+|00)(\d{8,15})$/.exec(s);
    if (国际 && !国际[1].startsWith("86")) return "外贸";
  }
  return null;
}
function 事业部(人, 成员们, 部门们, 线部门) {
  const m = 成员们.get(人);
  if (!m) return null;
  if (m.line === "内贸" || m.line === "外贸") return m.line;
  if (!m.deptId) return null;
  const 下级们 = (ids) => {
    const 出 = new Set();
    const 走 = ids.filter((id) => 部门们.has(id));
    while (走.length) {
      const id = 走.pop();
      if (出.has(id)) continue;
      出.add(id);
      for (const d of 部门们.values()) if (d.parentId === id) 走.push(d.id);
    }
    return 出;
  };
  const 在 = ["内贸", "外贸"].filter((l) => 线部门[l].length && 下级们(线部门[l]).has(m.deptId));
  if (在.length === 1) return 在[0];
  const 走过 = new Set();
  for (let id = m.deptId; id && !走过.has(id); id = 部门们.get(id)?.parentId ?? null) {
    走过.add(id);
    const 名 = 部门们.get(id)?.name ?? "";
    const 内 = 名.includes("内贸"), 外 = 名.includes("外贸");
    if (内 !== 外) return 内 ? "内贸" : "外贸";
  }
  return null;
}

/** cuid 风格：c + 时间 base36 + 随机 base36，共 25 位 */
function 新id() {
  const 表 = "0123456789abcdefghijklmnopqrstuvwxyz";
  const 随 = Array.from(crypto.randomBytes(16), (b) => 表[b % 36]).join("");
  return `c${Date.now().toString(36)}${随}`.slice(0, 25);
}

function 读设置(db, key) {
  const r = db.prepare(`SELECT "value" FROM "Setting" WHERE "key" = ?`).get(key);
  if (!r) return null;
  try { return JSON.parse(String(r.value)); } catch { return null; }
}

/**
 * 算要补哪些（只读）。返回 { 计划, 排除, 客户层, 人名 }
 * @param {import("node:sqlite").DatabaseSync} db
 */
function 算计划(db) {
  const 成员们 = new Map(db.prepare(`SELECT "userId", "bizRole", "deptId", "line" FROM "EntMember"`).all()
    .map((r) => [String(r.userId), { 角色们: 拆角色(r.bizRole), deptId: r.deptId ? String(r.deptId) : null, line: r.line ? String(r.line) : null }]));
  const 市场们 = new Set([...成员们].filter(([, m]) => 是市场成员(m.角色们)).map(([id]) => id));
  const 部门们 = new Map(db.prepare(`SELECT "id", "name", "parentId" FROM "EntDept"`).all().map((d) => [String(d.id), { id: String(d.id), name: String(d.name), parentId: d.parentId ? String(d.parentId) : null }]));
  const 设 = 读设置(db, "enterprise.lead_assign.line_depts");
  const 组 = (x) => (Array.isArray(x) ? x.filter((v) => typeof v === "string" && v.trim()).map((v) => v.trim()) : []);
  const 线部门 = { 内贸: 组(设?.["内贸"]), 外贸: 组(设?.["外贸"]) };
  const 人名 = new Map(db.prepare(`SELECT "id", "name" FROM "User"`).all().map((u) => [String(u.id), String(u.name)]));
  // 公海占位账号（lib/pool.ts 无负责人占位邮箱）：不是真负责人
  const 占位 = new Set(db.prepare(`SELECT "id" FROM "User" WHERE "email" = 'no-owner@placeholder.local'`).all().map((u) => String(u.id)));
  const way = db.prepare(`SELECT "name" FROM "EntDictItem" WHERE "id" = 'dict-assign-0'`).get()?.name ?? "指定分配";

  // 本月建的项目（连客户）。时间列按毫秒比：存成文本的也换算
  const 毫 = (列) => `(CASE WHEN typeof(${列}) IN ('integer', 'real') THEN ${列} ELSE CAST(round((julianday(${列}) - 2440587.5) * 86400000) AS INTEGER) END)`;
  const 项目们 = db.prepare(`
    SELECT p."id", p."name", p."customerId", p."ownerId", p."creatorId", p."createdAt", p."deletedAt", p."bizLine", p."source", p."importBatch", p."sourceLeadId",
           p."addrCountry", p."addrProvince", p."addrCity", p."addrDistrict",
           c."createdAt" AS "cCreatedAt", c."deletedAt" AS "cDeletedAt", c."phone" AS "cPhone",
           c."addrCountry" AS "cCountry", c."addrProvince" AS "cProvince", c."addrCity" AS "cCity", c."addrDistrict" AS "cDistrict"
    FROM "Project" p JOIN "Customer" c ON c."id" = p."customerId"
    WHERE ${毫('p."createdAt"')} >= ? AND ${毫('p."createdAt"')} < ?
    ORDER BY ${毫('p."createdAt"')} ASC, p."id" ASC`).all(起, 止);

  const 有表 = (t) => !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t);
  const 导入的 = new Set();
  if (有表("EntImportRow")) for (const r of db.prepare(`SELECT DISTINCT "targetId" FROM "EntImportRow"`).all()) 导入的.add(String(r.targetId));
  if (有表("EntExternalRef")) for (const r of db.prepare(`SELECT DISTINCT "targetId" FROM "EntExternalRef"`).all()) 导入的.add(String(r.targetId));
  if (有表("ImportRow")) for (const r of db.prepare(`SELECT DISTINCT "customerId" FROM "ImportRow"`).all()) 导入的.add(String(r.customerId));

  const 已记项目 = new Set(db.prepare(`SELECT DISTINCT "projectId" FROM "EntLeadAssign" WHERE "projectId" IS NOT NULL`).all().map((r) => String(r.projectId)));
  const 已记线索 = new Set(db.prepare(`SELECT DISTINCT "leadId" FROM "EntLeadAssign" WHERE "leadId" <> ''`).all().map((r) => String(r.leadId)));
  const 首条换人 = db.prepare(`SELECT "fromOwnerId" FROM "ProjectNodeLog" WHERE "projectId" = ? AND "kind" IN (${换人留痕.map(() => "?").join(",")}) ORDER BY ${毫('"at"')} ASC, "id" ASC LIMIT 1`);
  const 首条沟通 = db.prepare(`SELECT f."createdAt" FROM "FollowUpProject" fp JOIN "FollowUp" f ON f."id" = fp."followUpId" WHERE fp."projectId" = ? AND f."ownerId" = ?`);
  const 号们of = db.prepare(`
    SELECT "value" AS v, 1 AS o, "createdAt" AS t FROM "ContactMethod" WHERE "customerId" = ? AND "kind" = 'phone'
    UNION ALL SELECT "phone", 2, "createdAt" FROM "Contact" WHERE "customerId" = ? AND "deletedAt" IS NULL AND "phone" IS NOT NULL AND "phone" <> ''
    ORDER BY 2, 3`);

  const 排除 = { 建的人不是市场成员: 0, 已删: 0, 系统补建或历史分析: 0, 导入或同步: 0, 已有分配记录: 0, 初始负责人推不出: 0, 初始负责人就是建的人: 0, 不是新建那一下: 0 };
  const 计划 = [];
  for (const p of 项目们) {
    const id = String(p.id), 建 = String(p.creatorId), 客 = String(p.customerId);
    if (!市场们.has(建)) { 排除.建的人不是市场成员++; continue; }
    if (p.deletedAt !== null || p.cDeletedAt !== null) { 排除.已删++; continue; }
    if (建 === "system" || p.source) { 排除.系统补建或历史分析++; continue; }
    if (p.importBatch || 导入的.has(id) || 导入的.has(客)) { 排除.导入或同步++; continue; }
    if (已记项目.has(id) || (p.sourceLeadId && 已记线索.has(String(p.sourceLeadId)))) { 排除.已有分配记录++; continue; }
    const 痕 = 首条换人.get(id, ...换人留痕);
    const 初始 = 痕 ? (痕.fromOwnerId ? String(痕.fromOwnerId) : "") : String(p.ownerId ?? "");
    if (!初始 || !人名.has(初始) || 占位.has(初始)) { 排除.初始负责人推不出++; continue; }
    if (初始 === 建) { 排除.初始负责人就是建的人++; continue; }
    const 建时 = 毫秒(p.createdAt);
    const 和客户一起 = Math.abs(建时 - 毫秒(p.cCreatedAt)) <= 同时;
    const 带首条 = !和客户一起 && 首条沟通.all(id, 建).some((f) => Math.abs(毫秒(f.createdAt) - 建时) <= 同时);
    if (!和客户一起 && !带首条) { 排除.不是新建那一下++; continue; }
    const line = (p.bizLine === "内贸" || p.bizLine === "外贸" ? p.bizLine : null)
      ?? 区域线({ addrCountry: p.cCountry, addrProvince: p.cProvince, addrCity: p.cCity, addrDistrict: p.cDistrict })
      ?? 区域线(p)
      ?? 电话线([p.cPhone, ...号们of.all(客, 客).map((r) => r.v)])
      ?? 事业部(初始, 成员们, 部门们, 线部门);
    计划.push({ projectId: id, customerId: 客, 项目名: String(p.name), 建的人: 建, 接手人: 初始, line, createdAt: 建时, month: 北京月(建时), way, 入口: 和客户一起 ? "和客户一起建" : "客户页新增项目" });
  }

  // 客户层参考（不补）：本月建档人是市场成员的客户（CustomerCreator；新建客户页那条路不写建档人，这里数不到）
  const 客户们 = 有表("CustomerCreator") ? db.prepare(`
    SELECT c."id", c."salesOwnerId", cc."userId" AS "creator",
           (SELECT COUNT(*) FROM "Project" p WHERE p."customerId" = c."id") AS "项目数"
    FROM "Customer" c JOIN "CustomerCreator" cc ON cc."customerId" = c."id"
    WHERE c."deletedAt" IS NULL AND ${毫('c."createdAt"')} >= ? AND ${毫('c."createdAt"')} < ?`).all(起, 止) : [];
  const 市场客户 = 客户们.filter((c) => 市场们.has(String(c.creator)));
  const 补的客户 = new Set(计划.map((x) => x.customerId));
  const 客户层 = {
    本月市场成员建档的客户: 市场客户.length,
    现负责人不是建的人: 市场客户.filter((c) => String(c.salesOwnerId) !== String(c.creator)).length,
    其中有项目要补: 市场客户.filter((c) => 补的客户.has(String(c.id))).length,
    没有项目: 市场客户.filter((c) => Number(c.项目数) === 0).map((c) => String(c.id)),
  };
  return { 计划, 排除, 客户层, 人名, 本月项目: 项目们.length };
}

function 打印(r) {
  const 名 = (id) => r.人名.get(id) ?? id;
  console.log(`本月（北京时间 ${月}）建的项目 ${r.本月项目} 个；要补 ${r.计划.length} 条`);
  console.log("排除：", JSON.stringify(r.排除));
  const 按人 = new Map();
  for (const x of r.计划) 按人.set(x.接手人, (按人.get(x.接手人) ?? 0) + 1);
  console.log("每个接手人补几条：");
  for (const [id, n] of [...按人].sort((a, b) => b[1] - a[1] || 名(a[0]).localeCompare(名(b[0])))) console.log(`  ${名(id)}\t${n}`);
  console.log(`总条数：${r.计划.length}`);
  console.log("前 20 条明细（建档时间 北京 | 项目 id | 客户 id | 建的人 | 接手人 | line | 入口）：");
  for (const x of r.计划.slice(0, 20)) console.log(`  ${北京时间(x.createdAt)} | ${x.projectId} | ${x.customerId} | ${名(x.建的人)} | ${名(x.接手人)} | ${x.line ?? "null"} | ${x.入口}`);
  const k = r.客户层;
  console.log(`客户层参考（不补）：本月市场成员建档的客户 ${k.本月市场成员建档的客户} 家，现负责人不是建的人 ${k.现负责人不是建的人} 家，其中名下有项目要补 ${k.其中有项目要补} 家；没有项目的 ${k.没有项目.length} 家${k.没有项目.length ? `：${k.没有项目.slice(0, 20).join(", ")}` : ""}`);
}

/**
 * 真写：一个事务。返回写了几条；对不上抛错（已 ROLLBACK）
 * @param {import("node:sqlite").DatabaseSync} db
 */
function 写入(db) {
  db.exec("BEGIN IMMEDIATE");
  let 开着 = true;
  try {
    const r = 算计划(db);
    const 前 = Number(db.prepare(`SELECT COUNT(*) AS n FROM "EntLeadAssign"`).get().n);
    const 插 = db.prepare(`INSERT INTO "EntLeadAssign" ("id", "leadId", "projectId", "toUserId", "fromUserId", "byUserId", "line", "kind", "way", "counted", "month", "createdAt")
      VALUES (?, '', ?, ?, ?, ?, ?, '营销', ?, 1, ?, ?)`);
    for (const x of r.计划) 插.run(新id(), x.projectId, x.接手人, x.建的人, x.建的人, x.line, x.way, x.month, x.createdAt);
    const 后 = Number(db.prepare(`SELECT COUNT(*) AS n FROM "EntLeadAssign"`).get().n);
    const 每项 = db.prepare(`SELECT COUNT(*) AS n FROM "EntLeadAssign" WHERE "projectId" = ?`);
    const 不是一条 = r.计划.filter((x) => Number(每项.get(x.projectId).n) !== 1).map((x) => x.projectId);
    if (后 !== 前 + r.计划.length || 不是一条.length) {
      db.exec("ROLLBACK");
      开着 = false;
      throw new Error(`核对没过，已回滚：写前 ${前} 条、计划 ${r.计划.length} 条、写后 ${后} 条；不是正好一条的项目 ${不是一条.length} 个 ${不是一条.slice(0, 5).join(", ")}`);
    }
    db.exec("COMMIT");
    开着 = false;
    return { r, 前, 后 };
  } catch (e) {
    if (开着) db.exec("ROLLBACK");
    throw e;
  }
}

function main(argv) {
  const i = argv.indexOf("--db");
  const 库 = i >= 0 ? argv[i + 1] : null;
  const 写 = argv.includes("--write");
  if (!库) {
    console.error("用法：node scripts/backfill-direct-assign-202611.cjs --db <crm.db> [--write]");
    return 1;
  }
  const fs = require("node:fs");
  if (!fs.existsSync(库)) {
    console.error(`库不存在：${库}`);
    return 1;
  }
  const db = new sqlite.DatabaseSync(库);
  db.exec("PRAGMA busy_timeout = 15000");
  try {
    if (!写) {
      console.log("【演练】只读，库不动；真写加 --write");
      打印(算计划(db));
      return 0;
    }
    const { r, 前, 后 } = 写入(db);
    console.log("【已写】");
    打印(r);
    console.log(`EntLeadAssign 写前 ${前} 条、写后 ${后} 条（+${后 - 前}）`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 2;
  } finally {
    db.close();
  }
}

module.exports = { 算计划, 写入, 区域线, 电话线, 新id, 起, 止 };

if (require.main === module) process.exit(main(process.argv.slice(2)));
