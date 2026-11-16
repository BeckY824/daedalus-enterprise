/**
 * 客户编号回填（2026-11-17，客户抬头 S-1）：给存量客户补 Customer.customerNo，按建档时间从 1 起（页面写成 NO.00001），补完把计数表推到最大号。
 *
 *   node --no-warnings scripts/customer-no-backfill.mjs <crm.db>                 # 演练：只打印会补几位、从几号到几号，库不动
 *   node --no-warnings scripts/customer-no-backfill.mjs <crm.db> --apply         # 真写：先 VACUUM INTO 整库备份一份到库旁边，再分段写
 *   node --no-warnings scripts/customer-no-backfill.mjs <crm.db> --apply --no-backup   # 已经另做了整库备份时跳过自带的备份
 *
 * 前提：代码已经上了迁移 146（Customer.customerNo + 唯一索引）、147（计数表 CustomerNoSeq）。没上就报错退出，库不动。
 * 做的事：
 * - 编号为空的客户（含回收站里的：恢复后照样要有号）按 createdAt、id 排，接着库里已有的最大号往后编；
 *   第一次跑库里一个号都没有，就是从 1 起。已有编号的一格不碰（号不改）。
 * - 每 2000 位一个写事务（BEGIN IMMEDIATE，等锁 15 秒）：线上那份在跑时，一句占写锁的时间很短。
 * - 最后一个事务里把这期间新建、还没编号的客户一并补上，同时建（或推高）计数表那一行：n = 最大号。
 *   计数行建好之前，网页上新建的客户取不到号（lib/customer-no.ts 取客户编号），先空着、由这里补；建好之后新客户从计数表接着取。
 * - 只用 UPDATE "Customer" SET "customerNo"：不碰 updatedAt（保存冲突、导入撤销的判据不受影响），不触发三字索引的触发器。
 * 可重跑：补完再跑一遍是「没有要补的」，计数行已经不低于最大号就不动。
 * 只用 node 自带的 node:sqlite，服务器上不用装别的：scp 这一个文件过去跑，跑完删掉。纯算的部分在 编号计划（tests/customer-no.test.ts 钉着）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const 每段 = 2000;

/**
 * 纯算：要补的客户（已按 createdAt、id 排好）从 起 号往后一位一个号
 * @param {{ id: string }[]} 行们
 * @param {number} 起 第一个要发的号
 * @returns {{ id: string; no: number }[]}
 */
export function 编号计划(行们, 起) {
  return 行们.map((r, i) => ({ id: r.id, no: 起 + i }));
}

/** @param {import("node:sqlite").DatabaseSync} db */
function 有列(db) {
  const 列 = db.prepare(`PRAGMA table_info("Customer")`).all().map((r) => String(r.name));
  const 表 = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'CustomerNoSeq'`).get();
  return 列.includes("customerNo") && !!表;
}

/** @param {import("node:sqlite").DatabaseSync} db */
export function 现状(db) {
  const 号 = db.prepare(`SELECT MAX("customerNo") AS m, COUNT("customerNo") AS 有 FROM "Customer"`).get();
  const 空 = db.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN "deletedAt" IS NULL THEN 0 ELSE 1 END) AS 删 FROM "Customer" WHERE "customerNo" IS NULL`).get();
  const 计 = db.prepare(`SELECT "n" FROM "CustomerNoSeq" WHERE "id" = 1`).get();
  return {
    最大号: Number(号.m ?? 0),
    有号: Number(号.有 ?? 0),
    待补: Number(空.n ?? 0),
    待补里在回收站: Number(空.删 ?? 0),
    计数: 计 ? Number(计.n) : null,
  };
}

/** 编号为空的客户，按建档时间、id 排，取前 几 位 */
function 取一段(db, 几) {
  return db.prepare(`SELECT "id" FROM "Customer" WHERE "customerNo" IS NULL ORDER BY "createdAt" ASC, "id" ASC LIMIT ?`).all(几).map((r) => ({ id: String(r.id) }));
}

/**
 * 跑一遍：演练只读、算出计划；真写分段提交。返回 { 前, 后, 补了, 首, 尾 }
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{ 写: boolean; 每段?: number }} 选项
 */
export function 回填客户编号(db, { 写, 每段: 段长 = 每段 }) {
  if (!有列(db)) throw new Error("库里还没有客户编号这一列 / 计数表：先上带迁移 146、147 的代码（容器启动会跑迁移），再跑这个脚本");
  db.exec("PRAGMA busy_timeout = 15000");
  const 前 = 现状(db);
  // 接着已有的最大号往后编；计数行要是比最大号还高（发过号的客户被彻底删了），从计数往后，号不复用
  const 起 = Math.max(前.最大号, 前.计数 ?? 0) + 1;
  if (!写) {
    const 全 = 取一段(db, -1); // LIMIT -1 = 不限
    const 计划 = 编号计划(全, 起);
    return { 前, 后: 前, 补了: 0, 将补: 计划.length, 首: 计划[0] ?? null, 尾: 计划.at(-1) ?? null };
  }
  const 写号 = db.prepare(`UPDATE "Customer" SET "customerNo" = ? WHERE "id" = ? AND "customerNo" IS NULL`);
  let 补了 = 0, 首 = null, 尾 = null;
  for (;;) {
    db.exec("BEGIN IMMEDIATE");
    try {
      // 每段开头重新看最大号和计数：中间要是有人建了带号的客户（计数行已在时），接着他往后
      const 此刻 = 现状(db);
      const 从 = Math.max(此刻.最大号, 此刻.计数 ?? 0) + 1;
      const 段 = 编号计划(取一段(db, 段长), 从);
      for (const x of 段) {
        const r = 写号.run(x.no, x.id);
        if (Number(r.changes) !== 1) throw new Error(`客户 ${x.id} 写号 ${x.no} 没写上（被别人先补了？）：整段回滚，重跑即可`);
      }
      补了 += 段.length;
      首 ??= 段[0] ?? null;
      if (段.length) 尾 = 段.at(-1);
      if (段.length < 段长) {
        // 最后一段：同一个事务里建（或推高）计数行。之后新建的客户从计数表接着取号
        const 最大 = 现状(db).最大号;
        db.prepare(`INSERT INTO "CustomerNoSeq" ("id", "n") VALUES (1, ?) ON CONFLICT ("id") DO UPDATE SET "n" = MAX("n", excluded."n")`).run(最大);
        db.exec("COMMIT");
        break;
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  return { 前, 后: 现状(db), 补了, 将补: 补了, 首, 尾 };
}

const 号文字 = (n) => `NO.${String(n).padStart(5, "0")}`;

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const 写 = args.includes("--apply");
  const 库 = args.find((a) => !a.startsWith("--"));
  if (!库 || !fs.existsSync(库)) {
    console.error("用法：node --no-warnings scripts/customer-no-backfill.mjs <crm.db> [--apply] [--no-backup]");
    process.exit(2);
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(库);
  try {
    if (写 && !args.includes("--no-backup")) {
      const 备份 = path.join(path.dirname(库), `${path.basename(库, ".db")}.before-customer-no-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
      console.log(`整库备份 → ${备份}`);
      db.exec(`VACUUM INTO '${备份.replace(/'/g, "''")}'`);
    } else if (写) console.log("跳过自带备份（--no-backup）：确认已经另做了整库备份");
    const t = Date.now();
    const r = 回填客户编号(db, { 写 });
    const 秒 = ((Date.now() - t) / 1000).toFixed(1);
    const 前 = r.前;
    console.log(`现状：已有编号 ${前.有号} 位（最大 ${前.最大号 ? 号文字(前.最大号) : "—"}），待补 ${前.待补} 位（其中回收站里 ${前.待补里在回收站} 位），计数表 ${前.计数 ?? "还没建"}`);
    if (!写) {
      console.log(r.将补 ? `演练（库没动，确认后加 --apply）：将补 ${r.将补} 位，${号文字(r.首.no)}（${r.首.id}）到 ${号文字(r.尾.no)}（${r.尾.id}），补完计数表 = ${r.尾.no}` : "演练：没有要补的");
    } else {
      console.log(r.补了 ? `已补 ${r.补了} 位：${号文字(r.首.no)} 到 ${号文字(r.尾.no)}，用时 ${秒} 秒` : `没有要补的，用时 ${秒} 秒`);
      console.log(`补完：已有编号 ${r.后.有号} 位，待补 ${r.后.待补} 位，最大 ${r.后.最大号 ? 号文字(r.后.最大号) : "—"}，计数表 ${r.后.计数 ?? "还没建"}`);
    }
  } finally {
    db.close();
  }
}
