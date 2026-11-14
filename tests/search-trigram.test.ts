/**
 * 客户搜索的三字索引（迁移 141，2026-11-14）：搜索结果和原来整表 GLOB 一模一样。
 * 对拍：同一个关键词，强制走索引（设三字索引(true)）和强制走 GLOB（false）各拼一遍条件，命中的客户 id 逐个一致；
 * 数据经 Prisma 建、改、删（触发器跟着写索引），再拿迁移原文重跑一遍（补缺、删对不上的）。
 * 语义用例：两个字的中文（不走索引、照旧能搜）、三个字以上的中文、号码中间一段 / 后几位 / 带空格横杠括号 / +86、
 * 带大小写的字母（不走索引）、引号和 GLOB 通配符、只比名字学校（选客户弹窗）、手机号筛选、公海搜索、客户名查重的预筛
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { defaultClient as db, prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 客户关键词SQL, 客户号码SQL, 客户名索引式, 包含模式, 设三字索引, 三字可比, 名键必含字 } from "@/lib/search-keyword";
import { 号键SQL } from "@/lib/phone-dedupe";
import { 分组数SQL, 取一段SQL } from "@/lib/enterprise/unified-pool-sql";
import { 名键 } from "@/lib/enterprise-import/clean";

const 迁移 = (f: string) => fs.readFileSync(path.resolve(__dirname, "../migrations", f), "utf8");

let owner = "";
const 名字 = ["华东测试科技有限公司", "华东 测试 贸易", "示例教育咨询中心", "Acme Trading Ltd", "ACME 华东分部", "引号\"测试\"公司", "通配[符]*?号公司", "某某", "测试", "ＡＢＣ全角公司"];
const 号码 = ["13800001111", "138 0000 2222", "139-0000-3333", "（137）0000４444", "+86 13600005555", "", "02112345678", "8613500006666"];

beforeAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  await resetDb();
  owner = (await db.user.create({ data: { email: "fts@qa.local", name: "QA", password: "qa", role: "ADMIN" } })).id;
  for (let i = 0; i < 40; i++) {
    await db.customer.create({
      data: {
        id: `fts-${String(i).padStart(2, "0")}`,
        name: `${名字[i % 名字.length]}${i}`,
        phone: 号码[i % 号码.length],
        school: i % 4 === 0 ? `示例大学${i}` : null,
        major: i % 6 === 0 ? "国际贸易" : null,
        grade: i % 5 === 0 ? "高三" : null,
        remark: i % 3 === 0 ? `备注里有 1390000 和 测试科技 ${i}` : null,
        salesOwnerId: owner,
      },
    });
    if (i < 25) {
      await db.customerExtra.create({
        data: {
          customerId: `fts-${String(i).padStart(2, "0")}`,
          country: i % 2 ? "德国" : "美国",
          whatsapp: i % 3 === 0 ? `+44 7700 9${String(i).padStart(5, "0")}` : null,
          email: i % 4 === 0 ? `buyer${i}@example.com` : null,
          wechat: i % 5 === 0 ? `微信号${i}` : null,
          website: i % 6 === 0 ? `www.示例${i}.cn` : null,
          alibabaId: i % 7 === 0 ? `旺旺${i}` : null,
        },
      });
    }
    if (i % 2 === 0) await db.contact.create({ data: { customerId: `fts-${String(i).padStart(2, "0")}`, name: `联系人甲${i}`, phone: i % 4 === 0 ? `137 1111 ${String(i).padStart(4, "0")}` : null } });
    if (i % 3 === 0) await db.customerPool.create({ data: { customerId: `fts-${String(i).padStart(2, "0")}`, at: new Date(Date.UTC(2026, 9, 1 + (i % 7))) } });
  }
  // 改过、删过的行：触发器要跟上（改名后旧名搜不到、新名搜得到；删了的不出）
  await db.customer.update({ where: { id: "fts-01" }, data: { name: "改过名的测试客户", phone: "158 0000 7777" } });
  await db.customer.update({ where: { id: "fts-02" }, data: { remark: "新备注 示例词组" } });
  await db.customerExtra.update({ where: { customerId: "fts-03" }, data: { wechat: "改过的微信号", whatsapp: "+44 7700 900999" } });
  await db.customer.delete({ where: { id: "fts-05" } });
  await db.customerExtra.delete({ where: { customerId: "fts-07" } });
});
afterAll(async () => { 设三字索引(undefined); await resetDb(); await db.$disconnect(); });

async function 两边(k: string, onlyPicker = false) {
  设三字索引(false);
  const a = await 客户关键词SQL(k, onlyPicker);
  设三字索引(true);
  const b = await 客户关键词SQL(k, onlyPicker);
  设三字索引(undefined);
  if (!a || !b) return { 旧: null, 新: null, 走索引: false };
  const ids = async (w: { sql: string; values: string[] }) => (await db.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${w.sql} ORDER BY c.id`, ...w.values)).map((r) => r.id);
  return { 旧: await ids(a), 新: await ids(b), 走索引: !!b.走索引 };
}

const 关键词 = [
  // 两个字（不走索引，照旧整表比；结果当然一样）、三个字以上的中文
  "测试", "华东", "某某", "华东测试", "测试科技有限", "示例教育", "示例大学", "国际贸易", "高三", "改过名", "华东分部",
  // 号码：中间一段、后几位、前几位、带空格 / 横杠 / 括号 / 全角 / +86
  "0000", "1111", "2222", "3333", "4444", "000011", "1380000", "138 0000", "139-0000", "（137）", "+86 136", "0086 136", "8613500006666", "13500006666", "1390000", "7777", "158 0000 7777",
  // 扩展资料、联系人
  "德国", "美国", "微信号", "改过的微信", "旺旺", "示例1", "7700 9000", "900999", "联系人甲", "1111 0004",
  // 带大小写的（不走索引）、全角字母、引号、通配符、谁也不中
  "acme", "ACME", "Trading", "ＡＢＣ", "abc", "\"测试\"", "引号\"测", "[符]*?", "*?号", "没有这个人啊",
];

describe("三字索引和整表 GLOB 命中同一批客户", () => {
  it.each(关键词)("「%s」", async (k) => {
    const 列表 = await 两边(k);
    expect(列表.新).toEqual(列表.旧);
    const 弹窗 = await 两边(k, true);
    expect(弹窗.新).toEqual(弹窗.旧);
  });

  it("对拍不是空对空：三个字以上的中文、号码真走了索引且有命中；两个字、带大小写的照旧走 GLOB", async () => {
    for (const k of ["华东测试", "0000", "138 0000", "微信号", "联系人甲"]) {
      const r = await 两边(k);
      expect({ k, 走索引: r.走索引 }).toEqual({ k, 走索引: true });
      expect(r.新!.length, k).toBeGreaterThan(0);
    }
    for (const k of ["测试", "acme", "ＡＢＣ"]) expect((await 两边(k)).走索引, k).toBe(false);
    // 改过的：旧名、旧号搜不到，新的搜得到；删了的不出
    expect((await 两边("改过名")).新).toEqual(["fts-01"]);
    expect((await 两边("示例词组")).新).toEqual(["fts-02"]);
    expect((await 两边("900999")).新).toEqual(["fts-03"]);
    expect((await 两边("华东测试")).新).not.toContain("fts-05");
    // 两个字的中文照样搜得到
    expect((await 两边("测试")).新!.length).toBeGreaterThan(5);
  });

  it("手机号筛选（客户号码SQL）：走索引和原来一样", async () => {
    for (const k of ["0000", "1111", "138 0000", "（137）0000", "+86 136", "7777", "900999", "1111 0004", "abc", "12"]) {
      设三字索引(false); const a = await 客户号码SQL(k);
      设三字索引(true); const b = await 客户号码SQL(k);
      设三字索引(undefined);
      const ids = async (w: { sql: string; values: string[] }) => (await db.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${w.sql} ORDER BY c.id`, ...w.values)).map((r) => r.id);
      expect({ k, ids: await ids(b!) }).toEqual({ k, ids: await ids(a!) });
    }
  });

  it("查询计划：走索引时客户本表、扩展资料两句读 FTS，联系人电话读号键表达式索引（迁移 142）", async () => {
    设三字索引(true);
    const w = (await 客户关键词SQL("138 0000"))!;
    设三字索引(undefined);
    const 计划 = (await prisma.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN SELECT c.id FROM "Customer" c WHERE ${w.sql} AND +c."deletedAt" IS NULL`, ...w.values)).map((r) => r.detail).join(" | ");
    expect(计划).toContain("VIRTUAL TABLE");
    expect(计划).toContain("MULTI-INDEX OR");
    expect(计划).toContain("Contact_phoneKey_idx");
  });
});

describe("公海搜索：从名字对上的名单出发和整表 GLOB 一样", () => {
  it.each(["华东测试", "示例教育", "测试", "acme", "改过名", "没有这个人啊"])("「%s」", async (raw) => {
    const 词 = raw.toLowerCase();
    设三字索引(true);
    const 式 = await 客户名索引式(词);
    设三字索引(undefined);
    expect(!!式).toBe(三字可比(词));
    const 底筛 = { 商机: ["fts-00"], 订单: ["fts-03"], 排掉: ["fts-06"], 词: { 名: 包含模式(词), 项目对上: ["fts-09", "fts-12"] } };
    const 跑 = async (筛: typeof 底筛 & { 词: { 索引式?: string | null } }) => {
      const g = 分组数SQL(筛), q = 取一段SQL(筛, { 排序: "pooled", 跳过: 0, 取几: 50 });
      return [await db.$queryRawUnsafe(g.sql, ...g.值), await db.$queryRawUnsafe(q.sql, ...q.值)].map((r) => JSON.stringify(r, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
    };
    expect(await 跑({ ...底筛, 词: { ...底筛.词, 索引式: 式 } })).toEqual(await 跑(底筛));
  });
});

describe("迁移 141 / 142", () => {
  it("号键列的式子和 号键SQL 原样一致（触发器、回填都是）；142 的索引式子和 号键SQL('\"phone\"') 一致", () => {
    const sql = 迁移("141-search-trigram.sql");
    expect(sql).toContain(号键SQL('new."phone"'));
    expect(sql).toContain(号键SQL('x."phone"'));
    expect(sql).toContain(号键SQL('new."whatsapp"'));
    expect(sql).toContain(号键SQL('x."whatsapp"'));
    expect(迁移("142-contact-phone-key.sql")).toContain(`ON "Contact"(${号键SQL('"phone"')});`);
  });

  it("索引表和源表一一对应；丢了的行、对不上的行，重跑迁移就补齐 / 删掉，第二遍不多不少", async () => {
    const 数 = async () => (await db.$queryRawUnsafe<{ a: number; b: number; c: number; d: number }[]>(
      `SELECT (SELECT COUNT(*) FROM "CustomerSearch") AS a, (SELECT COUNT(*) FROM "Customer") AS b, (SELECT COUNT(*) FROM "CustomerExtraSearch") AS c, (SELECT COUNT(*) FROM "CustomerExtra") AS d`))[0];
    const 对上 = async () => Number((await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM "CustomerSearch" s JOIN "Customer" c ON c.rowid = s.rowid AND c.id = s.cid`))[0].n);
    const 起 = await 数();
    expect(Number(起.a)).toBe(Number(起.b));
    expect(Number(起.c)).toBe(Number(起.d));
    // 弄坏：删掉几行、把一行的 cid 改成别人（像整库重建后 rowid 重排）
    await db.$executeRawUnsafe(`DELETE FROM "CustomerSearch" WHERE rowid IN (SELECT rowid FROM "CustomerSearch" LIMIT 3)`);
    await db.$executeRawUnsafe(`DELETE FROM "CustomerExtraSearch" WHERE rowid IN (SELECT rowid FROM "CustomerExtraSearch" LIMIT 2)`);
    const 一行 = (await db.$queryRawUnsafe<{ r: number }[]>(`SELECT rowid AS r FROM "CustomerSearch" LIMIT 1`))[0].r;
    await db.$executeRawUnsafe(`UPDATE "CustomerSearch" SET cid = 'someone-else' WHERE rowid = ?`, 一行);
    const 重跑 = async () => { for (const l of 迁移("141-search-trigram.sql").split("\n")) if (l.trim() && !l.startsWith("--")) await db.$executeRawUnsafe(l); };
    await 重跑();
    await 重跑();
    const 后 = await 数();
    expect(Number(后.a)).toBe(Number(后.b));
    expect(Number(后.c)).toBe(Number(后.d));
    expect(await 对上()).toBe(Number(后.b));
    expect((await 两边("华东测试")).新).toEqual((await 两边("华东测试")).旧);
  });
});

describe("客户名查重的预筛（名键必含字）", () => {
  it("只挑稳定的字：汉字留下，ASCII、全角字母、空白、有大小写的字不挑，最多 3 个", () => {
    expect(名键必含字(名键("华东 测试科技"))).toEqual(["华", "东", "测"]);
    expect(名键必含字(名键("Acme Trading"))).toEqual([]);
    expect(名键必含字(名键("ＡＢＣ全角"))).toEqual(["全", "角"]);
    expect(名键必含字(名键("Ωmega 公司"))).toEqual(["公", "司"]);
    expect(名键必含字("i̇x中")).toEqual(["中"]);
  });

  it("名键相同的写法（加空格、全角、大小写）原名里都含这几个字：预筛不漏人", () => {
    const 原 = ["华东测试科技有限公司", "示例 教育 咨询", "ACME 华东分部", "ＡＢＣ全角公司１２"];
    for (const n of 原) {
      const 变 = [n, ` ${n} `, [...n].join(" "), n.toLowerCase(), n.toUpperCase(), n.replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)), n.replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))];
      for (const v of 变) {
        expect(名键(v)).toBe(名键(n));
        for (const 字 of 名键必含字(名键(n))) expect(v.includes(字), `${v} 应含 ${字}`).toBe(true);
      }
    }
  });
});
