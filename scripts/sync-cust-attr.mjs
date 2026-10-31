/**
 * 企业版「客户属性」字典同步（2026-10-31 会议，F-客户-04 / A-17）：已部署的库里换成定好的 10 项。
 *
 *   node --no-warnings scripts/sync-cust-attr.mjs <crm.db>            # 演练：只打印要改什么，库不动
 *   node --no-warnings scripts/sync-cust-attr.mjs <crm.db> --apply    # 真写（先整库备份）
 *
 * 字典在 EntDictItem 表，kind = "custAttr"（src/lib/enterprise/dict-kinds.ts）。做的事：
 * - 定好的 10 项：没有就建（固定 id dict-custAttr-<序号>，被占了就另起一个），有就启用；排序 0–9 按定好的顺序。
 * - 这一类里别的项（旧的那几项、之前自己加的）：停用，排在 10 项后面、相互顺序不变。**不删**。
 * - 客户身上存的值（Customer.customerAttr）一格不碰：用了旧值的客户原值照留，页面上照样显示。
 * 可重复跑：第二遍演练应该是「没有要改的」。一个事务，演练结束 ROLLBACK。
 * 只用 node 自带的 node:sqlite，服务器上不用装别的：scp 这一个文件过去跑，跑完删掉。
 * 定好的 10 项和 dict-kinds.ts 的 custAttr 默认是同一份（tests/ent-cust-attr.test.ts 钉着）。
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

export const 种类 = "custAttr";
export const 定好的 = ["自用非商用", "个人投资者", "个体工商户", "商贸代理公司", "文旅商业公司", "文旅主管单位", "科教文体单位", "国企国资平台", "园区管委会", "招标代理商"];

/**
 * 纯算：现有这一类的行 → 要建、要改的。行按 sort、createdAt 排好再给（同 dict.ts 企业字典 的读法）。
 * @param {{ id: string; name: string; sort: number; active: boolean }[]} 现有
 * @param {readonly string[]} [名单]
 * @returns {{ 建: { id: string | null; name: string; sort: number }[]; 改: { id: string; name: string; 从: { sort: number; active: boolean }; 到: { sort: number; active: boolean } }[] }}
 */
export function 同步计划(现有, 名单 = 定好的) {
  const 建 = [];
  const 改 = [];
  const 占着的id = new Set(现有.map((x) => x.id));
  const 记改 = (行, 到) => {
    if (行.sort !== 到.sort || Boolean(行.active) !== 到.active) 改.push({ id: 行.id, name: 行.name, 从: { sort: 行.sort, active: Boolean(行.active) }, 到 });
  };
  for (const [i, name] of 名单.entries()) {
    const 行 = 现有.find((x) => x.name === name);
    if (行) 记改(行, { sort: i, active: true });
    else {
      const id = `dict-${种类}-${i}`;
      建.push({ id: 占着的id.has(id) ? null : id, name, sort: i });
    }
  }
  let 后 = 名单.length;
  for (const 行 of 现有) {
    if (名单.includes(行.name)) continue;
    记改(行, { sort: 后++, active: false });
  }
  return { 建, 改 };
}

/**
 * 在一个 node:sqlite 库上跑：读、算、（--apply 才）写。返回计划，演练和真写一样返回
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ 写: boolean }} 选项
 */
export function 同步客户属性(db, { 写 }) {
  db.exec("BEGIN");
  try {
    const 现有 = db.prepare(`SELECT id, name, sort, active, createdAt FROM "EntDictItem" WHERE kind = ? ORDER BY sort ASC, createdAt ASC`).all(种类)
      .map((r) => ({ id: String(r.id), name: String(r.name), sort: Number(r.sort), active: Boolean(r.active), createdAt: r.createdAt }));
    const 计划 = 同步计划(现有);
    if (写) {
      // createdAt 跟库里已有的行一个存法（Prisma 在 SQLite 里存毫秒数）；表里一行都没有就按毫秒数
      const 样 = db.prepare(`SELECT createdAt FROM "EntDictItem" LIMIT 1`).get();
      const 现在 = 样 && typeof 样.createdAt === "string" ? new Date().toISOString() : Date.now();
      const 建 = db.prepare(`INSERT INTO "EntDictItem" (id, kind, name, sort, active, createdAt) VALUES (?, ?, ?, ?, 1, ?)`);
      for (const x of 计划.建) 建.run(x.id ?? `dict-${种类}-${x.sort}-${Date.now().toString(36)}`, 种类, x.name, x.sort, 现在);
      const 改 = db.prepare(`UPDATE "EntDictItem" SET sort = ?, active = ? WHERE id = ?`);
      for (const x of 计划.改) 改.run(x.到.sort, x.到.active ? 1 : 0, x.id);
      db.exec("COMMIT");
    } else db.exec("ROLLBACK");
    return 计划;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** @param {ReturnType<typeof 同步计划>} 计划 */
export function 报告(计划) {
  const 行们 = [];
  for (const x of 计划.建) 行们.push(`新建  ${x.name}（排第 ${x.sort + 1}，启用）`);
  for (const x of 计划.改) {
    const 话 = [];
    if (x.从.active !== x.到.active) 话.push(x.到.active ? "启用" : "停用");
    if (x.从.sort !== x.到.sort) 话.push(`排序 ${x.从.sort} → ${x.到.sort}`);
    行们.push(`改    ${x.name}：${话.join("，")}`);
  }
  return 行们.length ? 行们.join("\n") : "没有要改的（已经是定好的 10 项）";
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const 写 = args.includes("--apply");
  const 库 = args.find((a) => !a.startsWith("--"));
  if (!库) {
    console.error("用法：node --no-warnings scripts/sync-cust-attr.mjs <crm.db> [--apply]");
    process.exit(2);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(库);
  try {
    const 各类 = db.prepare(`SELECT kind, COUNT(*) AS n, SUM(active) AS on_n FROM "EntDictItem" GROUP BY kind ORDER BY kind`).all();
    console.log("字典各类（kind：共几项 / 启用几项）：" + 各类.map((r) => `${r.kind}:${r.n}/${r.on_n}`).join("  "));
    const 计划 = 同步客户属性(db, { 写 });
    console.log(写 ? "已写入：" : "演练（库没动，确认后加 --apply）：");
    console.log(报告(计划));
    const 用着 = db.prepare(`SELECT customerAttr AS v, COUNT(*) AS n FROM "Customer" WHERE customerAttr IS NOT NULL AND customerAttr <> '' GROUP BY customerAttr ORDER BY n DESC`).all();
    console.log("客户上存的客户属性（不改）：" + (用着.length ? 用着.map((r) => `${r.v} ${r.n}`).join("，") : "没有"));
  } finally {
    db.close();
  }
}
