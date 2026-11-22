/**
 * 客户搜索查询侧拆词、规整、搜项目名（员工反馈第 2 批 2F，11-17）。
 *
 * 员工说「按名字没找到」（客户名 4、联系人 2、项目名 1，原词待核）。原来是「连续一段包含」：
 * 词里的空格（全角空格、两个空格）、词序、全角 / 半角括号、全角字母都要和库里一模一样才中；客户列表也搜不到项目名。
 * 这里用造的名字把这几类写法逐条复现：
 *   - 规整：全角空格、多个空格归一；全角字母数字转半角，字母比的时候全角半角、大小写都算一样；
 *   - 拆词：按空格和常见括号、逗号拆开，每个词都要中（可以中在不同的列）；像号码、像客户编号、像网址的整串不拆；
 *   - 项目名：客户列表（快路径 关键词分页、老路 客户筛选条件）也比项目名，只算我能看的、不在公海的项目（P-看 系列），客户本身照旧经限定层。
 * 三字索引那条路和整表 GLOB 那条路结果一样（对拍）。
 * 用拷出来的一份库、显式单连接，不碰共用的测试库。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-kw-terms-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 我: null as null | { id: string; name: string; email: string; role: string } };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => 临时.我, getCurrentUser: async () => 临时.我 }));
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});

import { prisma as db, defaultClient as raw } from "@/lib/prisma";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 规则 } from "@/lib/enterprise/rules";
import { 客户关键词SQL, 设三字索引 } from "@/lib/search-keyword";
import { 客户筛选条件, 关键词分页, type 客户条件 } from "@/app/(app)/customers/query";
import { 设项目名候选先取 } from "@/lib/project/customer-list-projects";

const 老板 = "t_boss";
const 小王 = "t_wang";
const 外人 = "t_other";
const 人们 = { [老板]: "老板", [小王]: "小王", [外人]: "外人" } as Record<string, string>;

/** 造的客户：id → 名字、负责人 */
const 客户 = {
  acme: ["Acme Trading Ltd", 小王],
  hd: ["华东  测试贸易有限公司", 小王], // 库里中间两个空格
  jt: ["某某（集团）有限公司", 小王], // 库里是全角括号
  beta: ["ＢＥＴＡ全角科技", 小王], // 库里是全角字母
  edu: ["示例教育咨询中心", 小王],
  star: ["星辰贸易", 小王],
  far: ["远航实业", 小王],
  hide: ["隐秘客户", 外人],
} as const;
type 键 = keyof typeof 客户;

beforeAll(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["ProjectMember", "ProjectNodeLog", "Project", "AiConversation", "AiProject", "Setting", "AuditLog", "ImportBatch", "Task", "FollowPlan", "FollowUpSource", "FollowUp", "ContractOwner", "Contract", "Opportunity", "Contact", "UnassignedContact", "Lead", "CustomerExtra", "CustomerPool", "CustomerClaim", "EntMember", "EntDept"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe('UPDATE "Customer" SET referrerCustomerId = NULL, attributionCustomerId = NULL');
  for (const t of ["Customer", "Channel", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  for (const [id, name] of Object.entries(人们)) await raw.user.create({ data: { id, email: `${id}@x.com`, name, password: "x", role: id === 老板 ? "ADMIN" : "SALES" } });
  await raw.entMember.createMany({ data: [{ userId: 老板, bizRole: "director" }, { userId: 小王, bizRole: "sales" }, { userId: 外人, bizRole: "sales" }] });
  for (const [id, [name, owner]] of Object.entries(客户)) await raw.customer.create({ data: { id, name, phone: "", salesOwnerId: owner } });
  await raw.contact.create({ data: { customerId: "edu", name: "联系人丁" } });
  // 项目：小王自己的；小王的客户下外人负责的（小王看不到这个项目）；外人客户下外人的；公海里的项目不算
  await raw.project.create({ data: { name: "春季展会-灯具采购", customerId: "star", ownerId: 小王, creatorId: 小王 } });
  await raw.project.create({ data: { name: "春季展会-家具", customerId: "far", ownerId: 外人, creatorId: 外人 } });
  await raw.project.create({ data: { name: "春季展会-家具", customerId: "hide", ownerId: 外人, creatorId: 外人 } });
  await raw.project.create({ data: { name: "公海里的地毯项目", customerId: "edu", ownerId: 小王, creatorId: 小王, pooledAt: new Date() } });
  await raw.setting.create({ data: { key: 规则.按组织看客户.key, value: JSON.stringify(true) } });
});

beforeEach(() => 忘掉企业版范围());

afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  忘掉企业版范围();
  设三字索引(undefined);
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

/** 只比客户本身那几列（不带项目名）：强制走三字索引、强制走 GLOB 各一遍，结果要一样 */
async function 搜(k: string, onlyPicker = false): Promise<string[]> {
  const 两路: string[][] = [];
  for (const 索引 of [false, true]) {
    设三字索引(索引);
    const w = await 客户关键词SQL(k, onlyPicker);
    设三字索引(undefined);
    两路.push(w ? (await raw.$queryRawUnsafe<{ id: string }[]>(`SELECT c.id FROM "Customer" c WHERE ${w.sql} ORDER BY c.id`, ...w.values)).map((r) => r.id) : []);
  }
  expect(两路[1], k).toEqual(两路[0]);
  return 两路[0];
}

/** 客户列表：快路径和老路各搜一遍（按这个人），结果一样 */
async function 列表(谁: string, keyword: string): Promise<string[]> {
  临时.我 = { id: 谁, name: 人们[谁], email: `${谁}@x.com`, role: 谁 === 老板 ? "ADMIN" : "SALES" };
  return 以谁的身份(谁, async () => {
    const sp: 客户条件 = { keyword };
    const 快 = await 关键词分页(sp, 1, 50);
    const 老 = (await db.customer.findMany({ where: await 客户筛选条件(sp), select: { id: true } })).map((r) => r.id).sort();
    expect(快, keyword).not.toBeNull();
    expect({ keyword, ids: 快!.ids.slice().sort() }).toEqual({ keyword, ids: 老 });
    return 老;
  });
}

const 只 = (...ks: 键[]) => ks.slice().sort();

describe("写法不一样也搜得到（复现：改前这几条都是空的）", () => {
  it.each<[string, 键[]]>([
    ["Acme　Trading", ["acme"]], // 全角空格
    ["Acme   Trading", ["acme"]], // 多个空格
    ["Trading Acme", ["acme"]], // 词序反了
    ["华东 测试贸易", ["hd"]], // 库里两个空格、输入一个
    ["某某(集团)", ["jt"]], // 输入半角括号、库里全角
    ["ＡＣＭＥ", ["acme"]], // 输入全角字母
    ["beta全角", ["beta"]], // 库里全角字母、输入半角
    ["联系人丁 示例教育", ["edu"]], // 一个词中联系人、一个中客户名
  ])("「%s」", async (k, 应) => {
    expect(await 搜(k)).toEqual(只(...应));
  });

  it("每个词都要中：有一个词哪儿都没有就不出", async () => {
    expect(await 搜("Acme 没有这个词")).toEqual([]);
    expect(await 搜("华东 Acme")).toEqual([]);
  });

  it("像号码、像客户编号的整串不拆：「138 0000」照旧按号码比", async () => {
    await raw.customer.update({ where: { id: "far" }, data: { phone: "13800001234" } });
    try {
      expect(await 搜("138 0000")).toEqual(["far"]);
      expect(await 搜("（138）0000")).toEqual(["far"]);
    } finally {
      await raw.customer.update({ where: { id: "far" }, data: { phone: "" } });
    }
  });

  it("选客户弹窗、全局搜索（只比名字、学校）也拆词", async () => {
    expect(await 搜("Trading Acme", true)).toEqual(["acme"]);
  });
});

describe("客户列表搜项目名（只算我能看的、不在公海的项目）", () => {
  it("小王搜自己项目的名字：出那位客户；客户名 + 项目名两个词也中", async () => {
    expect(await 列表(小王, "灯具采购")).toEqual(["star"]);
    expect(await 列表(小王, "星辰 灯具")).toEqual(["star"]);
  });

  it("看不到的项目不算：小王的客户下别人负责的项目、别人的客户都不出；老板都出", async () => {
    expect(await 列表(小王, "家具")).toEqual([]);
    expect(await 列表(老板, "家具")).toEqual(只("far", "hide"));
  });

  it("宽词（候选超过先取的行数）走另一条路：结果一样", async () => {
    设项目名候选先取(0);
    try {
      expect(await 列表(小王, "春季展会")).toEqual(["star"]);
      expect(await 列表(老板, "春季展会")).toEqual(只("star", "far", "hide"));
    } finally {
      设项目名候选先取(2000);
    }
    expect(await 列表(小王, "春季展会")).toEqual(["star"]);
    expect(await 列表(老板, "春季展会")).toEqual(只("star", "far", "hide"));
  });

  it("项目组员（点了同意）看得到别人负责的项目：搜得到；邀请着的不算", async () => {
    const p = await raw.project.findFirstOrThrow({ where: { customerId: "far" }, select: { id: true } });
    await raw.projectMember.create({ data: { projectId: p.id, userId: 小王, inviteStatus: "INVITED" } });
    try {
      expect(await 列表(小王, "家具")).toEqual([]);
      await raw.projectMember.updateMany({ where: { projectId: p.id, userId: 小王 }, data: { inviteStatus: "JOINED" } });
      忘掉企业版范围();
      expect(await 列表(小王, "家具")).toEqual(["far"]);
    } finally {
      await raw.projectMember.deleteMany({ where: { projectId: p.id } });
      忘掉企业版范围();
    }
  });

  it("公海里的项目不算", async () => {
    expect(await 列表(小王, "地毯")).toEqual([]);
    expect(await 列表(老板, "地毯")).toEqual([]);
  });

  it("没开企业版不比项目名", async () => {
    delete process.env.CRM_ENTERPRISE;
    忘掉企业版范围();
    try {
      expect((await 客户关键词SQL("灯具采购"))).not.toBeNull();
      expect((await db.customer.findMany({ where: await 客户筛选条件({ keyword: "灯具采购" }), select: { id: true } }))).toEqual([]);
    } finally {
      process.env.CRM_ENTERPRISE = "1";
      忘掉企业版范围();
    }
  });
});

describe("搜索命中的项目多（32C：过 999 个参数）", () => {
  // 复现：受限身份（销售）搜一个宽词，能看的项目过 999 个，再经限定层核一遍时 id IN (…) 一句带不下，范围层的否定条件又让 Prisma 拆不了批，
  // 改前报 P2029、整页「这一页没能打开」。这里造 1200 个小王的项目（名字都带「批量」），小王搜「批量」要照常出来
  const 个数 = 1200;
  beforeAll(async () => {
    await raw.customer.create({ data: { id: "bulk", name: "批量客户甲", phone: "", salesOwnerId: 小王 } });
    await raw.customer.create({ data: { id: "bulk2", name: "某乙", phone: "", salesOwnerId: 小王 } });
    await raw.project.createMany({ data: Array.from({ length: 个数 }, (_, i) => ({ name: `批量项目${i}`, customerId: i % 2 ? "bulk" : "bulk2", ownerId: 小王, creatorId: 小王 })) });
  });
  afterAll(async () => {
    await raw.project.deleteMany({ where: { customerId: { in: ["bulk", "bulk2"] } } });
    await raw.customer.deleteMany({ where: { id: { in: ["bulk", "bulk2"] } } });
  });

  it("小王（受限）搜「批量」：不报错，两位客户都出；老板也一样", async () => {
    expect(await 列表(小王, "批量")).toEqual(["bulk", "bulk2"]);
    expect(await 列表(老板, "批量")).toEqual(["bulk", "bulk2"]);
  });

  it("候选超过先取的行数（宽词另一条路）也不报错", async () => {
    设项目名候选先取(100);
    try {
      expect(await 列表(小王, "批量")).toEqual(["bulk", "bulk2"]);
    } finally {
      设项目名候选先取(2000);
    }
  });
});

describe("「我参与的」挂的客户多（同类：过 999 个参数）", () => {
  // 复现：同 32C，客户范围条件 的「我参与的」把组员客户整份塞进一句 id IN (…)，受限身份经限定层带否定条件，过 999 位报 P2029、整页打不开。
  // 这里造 1100 位外人负责的客户，每位挂一个外人负责、小王已加入的项目；小王选「我参与的」要照常列出全部
  const 个数 = 1100;
  const 号 = (i: number) => `joined${String(i).padStart(4, "0")}`;
  beforeAll(async () => {
    await raw.customer.createMany({ data: Array.from({ length: 个数 }, (_, i) => ({ id: 号(i), name: `参与客户${i}`, phone: "", salesOwnerId: 外人 })) });
    await raw.project.createMany({ data: Array.from({ length: 个数 }, (_, i) => ({ id: `p-${号(i)}`, name: `参与项目${i}`, customerId: 号(i), ownerId: 外人, creatorId: 外人 })) });
    await raw.projectMember.createMany({ data: Array.from({ length: 个数 }, (_, i) => ({ projectId: `p-${号(i)}`, userId: 小王, inviteStatus: "JOINED" })) });
  });
  afterAll(async () => {
    await raw.projectMember.deleteMany({ where: { userId: 小王, projectId: { startsWith: "p-joined" } } });
    await raw.project.deleteMany({ where: { id: { startsWith: "p-joined" } } });
    await raw.customer.deleteMany({ where: { id: { startsWith: "joined" } } });
  });

  it("小王（受限）选「我参与的」：不报错，1100 位都列出", async () => {
    临时.我 = { id: 小王, name: 人们[小王], email: `${小王}@x.com`, role: "SALES" };
    const ids = await 以谁的身份(小王, async () => (await db.customer.findMany({ where: await 客户筛选条件({ scope: "joined" }), select: { id: true } })).map((r) => r.id));
    expect(ids.length).toBe(个数);
    expect(ids.every((id) => id.startsWith("joined"))).toBe(true);
  });
});
