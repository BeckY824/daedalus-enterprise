/**
 * ④ 扫库检测 第 1 阶段（E-383）：查询记录 EntScanQuery。三个入口各记一次，排除入口不记，同人同日同键一行、撞上只升不降，
 * 撞自己 / 同组 / 公海不算撞上，开关关了不记，库里没有号码 / 名字原文。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ user: null as null | { id: string; name: string; role: string; email: string } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (f: unknown) => f }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user, currentUser: async () => mocks.user, getCurrentUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { resetDb } from "./reset";
import { prisma } from "@/lib/prisma";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围, 以谁的身份 } from "@/lib/enterprise/visibility";
import { 查号码, 查客户名, 从回收站捞回 } from "@/app/(app)/customers/number-actions";
import { 键指纹, 扫库检测开关key, 记查询, 等记录落库 } from "@/lib/enterprise/scan-query";
import { 名键 } from "@/lib/enterprise-import/clean";
import { beijingDay } from "@/lib/business-clock";

type 人 = { id: string; name: string; role: string; email: string };
async function 人(id: string, name: string, bizRole: string): Promise<人> {
  const u = await prisma.user.create({ data: { id, email: `${id}@x.test`, name, title: "", role: "SALES", password: "x", active: true } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole } });
  return { id: u.id, name: u.name, email: u.email, role: "SALES" };
}
function 作为<R>(u: 人, f: () => Promise<R>): Promise<R> {
  mocks.user = u;
  忘掉企业版范围();
  // 产品路径不 await 记查询，这里等它落库再返回
  return 以谁的身份(u.id, f).finally(() => 等记录落库());
}
const 号 = "13800138000";

async function 现场() {
  const 负责人 = await 人("owner1", "小甲", "sales");
  const 乙 = await 人("sales2", "小乙", "sales");
  const 客户 = await prisma.customer.create({ data: { name: "编的客户 甲", school: "编的公司甲", phone: "", salesOwnerId: 负责人.id, contacts: { create: { name: "编的联系人", phone: 号, isPrimary: true } } } });
  return { 负责人, 乙, 客户 };
}
const 行们 = () => prisma.entScanQuery.findMany({ orderBy: { createdAt: "asc" } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true } as never);
  await setSetting(规则.按组织看客户.key, true);
  mocks.user = null;
});

describe("④ 查询记录：入口", () => {
  it("查号码记一行（「+」查重 / 向导查号码同走这一个入口），撞别组同事负责的 = 撞上", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查号码("手机号", 号));
    const 行 = await 行们();
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({ userId: x.乙.id, day: beijingDay(new Date()), keyType: "号码", hit: true });
    expect(行[0].keyHash).toBe(键指纹("号码", `手机号|${号}`));
  });

  it("没撞上也记一行（hit 假）：分母要数", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查号码("手机号", "13900001111"));
    expect(await 行们()).toMatchObject([{ keyType: "号码", hit: false }]);
  });

  it("查客户名记一行，连公司名一起查也只一行；撞上", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查客户名("编的客户甲", "编的公司甲"));
    const 行 = await 行们();
    expect(行).toHaveLength(1);
    expect(行[0]).toMatchObject({ userId: x.乙.id, keyType: "名字", hit: true });
    expect(行[0].keyHash).toBe(键指纹("名字", 名键("编的客户甲")));
  });

  it("名字的键只用名字：同名配不同公司、不配公司都是同一键；全角 / 半角 / 空白 / 大小写不同算同一键", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查客户名("编的客户甲", "编的公司甲"));
    await 作为(x.乙, () => 查客户名("编的客户甲", "别的公司"));
    await 作为(x.乙, () => 查客户名("编的客户甲"));
    await 作为(x.乙, () => 查客户名("  编的客户 甲　"));
    await 作为(x.乙, () => 查客户名("ＡＢＣ公司"));
    await 作为(x.乙, () => 查客户名("abc 公司"));
    await 作为(x.乙, () => 查客户名(" ABC公司 "));
    const 行 = await 行们();
    expect(行).toHaveLength(2);
    expect(new Set(行.map((r) => r.keyHash)).size).toBe(2);
  });

  it("名键不够 2 个字不记（空、单字、只有空白）", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查客户名("甲"));
    await 作为(x.乙, () => 查客户名("  "));
    await 作为(x.乙, () => 查客户名(" 甲 "));
    expect(await 行们()).toHaveLength(0);
  });
});

describe("④ 查询记录：排除入口不记", () => {
  it("点「建好」兜底再查同一键不新增行（服务端一律记录，没有不记的参数）", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查客户名("编的客户甲"));
    expect(await 行们()).toHaveLength(2);
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查客户名("编的客户甲"));
    expect(await 行们()).toHaveLength(2);
  });

  it("兜底参数已不存在：查号码 / 查客户名 多传一个参数类型层面报错，运行时形参个数也只有约定的", () => {
    // @ts-expect-error 查号码 只有 (类型, 值)
    void (() => 查号码("手机号", 号, true));
    // @ts-expect-error 查客户名 只有 (名, 公司?)
    void (() => 查客户名("编的客户甲", undefined, true));
    expect(查号码.length).toBe(2);
    expect(查客户名.length).toBe(2);
  });

  it("从回收站捞回里的再查不记", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 从回收站捞回("手机号", 号));
    expect(await 行们()).toHaveLength(0);
  });
});

describe("④ 查询记录：同键同日一行、撞上只升不降", () => {
  it("同人同日同号码重复查只一行；先没撞上后撞上升真，再没撞上不降", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查号码("手机号", "13700002222"));
    expect((await 行们())[0].hit).toBe(false);
    // 这个号码后来挂到别人名下
    await prisma.contact.create({ data: { customerId: x.客户.id, name: "后加", phone: "13700002222", isPrimary: false } });
    await 作为(x.乙, () => 查号码("手机号", "137 0000 2222"));
    let 行 = await 行们();
    expect(行).toHaveLength(1);
    expect(行[0].hit).toBe(true);
    await prisma.contact.deleteMany({ where: { phone: "13700002222" } });
    await 作为(x.乙, () => 查号码("手机号", "13700002222"));
    行 = await 行们();
    expect(行).toHaveLength(1);
    expect(行[0].hit).toBe(true);
  });

  it("并发两次（先没撞、后撞上）最终 hit 为真，只一行；再来没撞上也不降", async () => {
    const x = await 现场();
    const p = [
      记查询(x.乙.id, "号码", "手机号|13500003333", false),
      记查询(x.乙.id, "号码", "手机号|13500003333", true),
      记查询(x.乙.id, "号码", "手机号|13500003333", false),
    ];
    await Promise.all(p);
    const 行 = await 行们();
    expect(行).toHaveLength(1);
    expect(行[0].hit).toBe(true);
    await 记查询(x.乙.id, "号码", "手机号|13500003333", false);
    expect((await 行们())[0].hit).toBe(true);
  });

  it("不同人、不同键各自一行", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.负责人, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查号码("手机号", "13900001111"));
    expect(await 行们()).toHaveLength(3);
  });
});

describe("④ 查询记录：什么不算撞上", () => {
  it("撞自己名下不算", async () => {
    const x = await 现场();
    await 作为(x.负责人, () => 查号码("手机号", 号));
    await 作为(x.负责人, () => 查客户名("编的客户甲"));
    const 行 = await 行们();
    expect(行).toHaveLength(2);
    expect(行.every((r) => r.hit === false)).toBe(true);
  });

  it("同组（已加入那位客户的项目组）不算", async () => {
    const x = await 现场();
    const p = await prisma.project.create({ data: { name: "编的项目甲", customerId: x.客户.id, ownerId: x.负责人.id, creatorId: x.负责人.id, phase: "线索", node: "潜客培育" } });
    await prisma.projectMember.create({ data: { projectId: p.id, userId: x.乙.id, inviteStatus: "JOINED" } });
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查客户名("编的客户甲"));
    const 行 = await 行们();
    expect(行).toHaveLength(2);
    expect(行.every((r) => r.hit === false)).toBe(true);
  });

  it("公海里的客户不算", async () => {
    const x = await 现场();
    await prisma.customerPool.create({ data: { customerId: x.客户.id } });
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查客户名("编的客户甲"));
    const 行 = await 行们();
    expect(行).toHaveLength(2);
    expect(行.every((r) => r.hit === false)).toBe(true);
  });
});

describe("④ 查询记录：总开关与不存原文", () => {
  it("开关关了（enterprise.scan4.on = false）不记；打开又记", async () => {
    const x = await 现场();
    await setSetting(扫库检测开关key, false as never);
    invalidateSettingsCache();
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查客户名("编的客户甲"));
    expect(await 行们()).toHaveLength(0);
    await setSetting(扫库检测开关key, true as never);
    invalidateSettingsCache();
    await 作为(x.乙, () => 查号码("手机号", 号));
    expect(await 行们()).toHaveLength(1);
  });

  it("表里没有号码 / 名字原文，只有指纹", async () => {
    const x = await 现场();
    await 作为(x.乙, () => 查号码("手机号", 号));
    await 作为(x.乙, () => 查客户名("编的客户甲", "编的公司甲"));
    const 全 = JSON.stringify(await 行们());
    expect(全).not.toContain(号);
    expect(全).not.toContain("编的客户");
    expect(全).not.toContain("编的公司");
    for (const r of await 行们()) expect(r.keyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
