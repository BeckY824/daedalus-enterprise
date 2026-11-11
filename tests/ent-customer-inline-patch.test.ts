/**
 * 客户详情就地改（11-04 用户：所有字段点了直接改，不点「编辑全部」）：电话、详细地址、所在地区的服务端规矩。
 *
 *   电话：没动 / 交回打码的样子都不改；换号查重（自己不算）；原来有号码不许清空；号码不对报错
 *   详细地址：企业版才收，落库、去空白
 *   所在地区：四格一起存、没变不写不留痕、变了留痕；不是负责人改不了；非企业版不收
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "tester-id", name: "测试员", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { maskPhone } from "@/lib/utils";
import { saveCustomer, patchCustomer, patchCustomerRegion } from "@/app/(app)/customers/actions";

let 别人: string;
let 序 = 0;
const 当 = (id: string, name: string) => { mocks.user = { ...mocks.user, id, name }; 忘掉企业版范围(); };

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  当("tester-id", "测试员");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "SALES", password: "x" } });
  别人 = (await prisma.user.create({ data: { email: "o@t", name: "别人", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: "tester-id", bizRole: "sales" }, { userId: 别人, bizRole: "sales" }] });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(() => prisma.$disconnect());

async function 新建(phone: string | null = `1380000${String(1000 + ++序).slice(-4)}`) {
  const r = await saveCustomer({
    name: `测试客户${++序}`, phone, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
    salesOwnerId: "tester-id", channelId: null, referrerCustomerId: null,
    // 客户业务线必填（M-必填-13）：没另给按内贸
    企业资料: { bizLine: "内贸" },
  } as Parameters<typeof saveCustomer>[0]);
  if (!r.ok) throw new Error(r.error);
  return (await prisma.customer.findFirstOrThrow({ orderBy: { createdAt: "desc" }, select: { id: true } })).id;
}
const 读 = (id: string) => prisma.customer.findUniqueOrThrow({ where: { id } });
const 留痕数 = (id: string) => prisma.auditLog.count({ where: { entityId: id, action: "update" } });

describe("电话就地改", () => {
  it("换号落库；没动、交回打码的样子都不改", async () => {
    const id = await 新建("13800001111");
    expect(await patchCustomer(id, "phone", "13800001111")).toMatchObject({ ok: true });
    expect(await patchCustomer(id, "phone", maskPhone("13800001111"))).toMatchObject({ ok: true });
    expect((await 读(id)).phone).toBe("13800001111");
    expect(await patchCustomer(id, "phone", " 13900002222 ")).toMatchObject({ ok: true });
    expect((await 读(id)).phone).toBe("13900002222");
  });

  it("撞了别的客户的号拦下，库不变", async () => {
    await 新建("13800003333");
    const id = await 新建("13800004444");
    const r = await patchCustomer(id, "phone", "13800003333");
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain("13800003333");
    expect((await 读(id)).phone).toBe("13800004444");
  });

  it("原来有号码不许清空；号码不对报错", async () => {
    const id = await 新建("13800005555");
    expect(await patchCustomer(id, "phone", "")).toMatchObject({ ok: false });
    expect(await patchCustomer(id, "phone", "abc")).toMatchObject({ ok: false });
    expect((await 读(id)).phone).toBe("13800005555");
  });

  it("不是负责人改不了", async () => {
    const id = await 新建("13800006666");
    当(别人, "别人");
    expect(await patchCustomer(id, "phone", "13900007777")).toMatchObject({ ok: false });
    expect((await 读(id)).phone).toBe("13800006666");
  });
});

describe("详细地址就地改", () => {
  it("落库、去空白、清空存 null；非企业版不收", async () => {
    const id = await 新建();
    expect(await patchCustomer(id, "addrDetail", "  某路 1 号  ")).toMatchObject({ ok: true });
    expect((await 读(id)).addrDetail).toBe("某路 1 号");
    expect(await patchCustomer(id, "addrDetail", "")).toMatchObject({ ok: true });
    expect((await 读(id)).addrDetail).toBeNull();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await patchCustomer(id, "addrDetail", "别的")).toMatchObject({ ok: false });
  });
});

describe("所在地区就地改（patchCustomerRegion）", () => {
  it("四格一起存、变了留一条痕；再交同样的不写不留痕", async () => {
    const id = await 新建();
    const 前 = await 留痕数(id);
    const 址 = { addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市", addrDistrict: "西湖区" };
    expect(await patchCustomerRegion(id, 址)).toEqual({ ok: true });
    const c = await 读(id);
    expect([c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict]).toEqual(["中国", "浙江省", "杭州市", "西湖区"]);
    expect(await 留痕数(id)).toBe(前 + 1);
    const 痕 = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: "update" }, orderBy: { at: "desc" } });
    expect(痕.summary).toContain("所在地区");
    expect(await patchCustomerRegion(id, 址)).toEqual({ ok: true });
    expect(await 留痕数(id)).toBe(前 + 1);
  });

  it("换成外国：省 / 区跟着清掉，不存出「中国 + 别国的市」", async () => {
    const id = await 新建();
    await patchCustomerRegion(id, { addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市", addrDistrict: "西湖区" });
    expect(await patchCustomerRegion(id, { addrCountry: "摩洛哥", addrProvince: null, addrCity: "卡萨布兰卡", addrDistrict: null })).toEqual({ ok: true });
    const c = await 读(id);
    expect([c.addrCountry, c.addrProvince, c.addrCity, c.addrDistrict]).toEqual(["摩洛哥", null, "卡萨布兰卡", null]);
  });

  it("不是负责人改不了；非企业版不收；库不变", async () => {
    const id = await 新建();
    当(别人, "别人");
    expect(await patchCustomerRegion(id, { addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市", addrDistrict: null })).toMatchObject({ ok: false });
    当("tester-id", "测试员");
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await patchCustomerRegion(id, { addrCountry: "中国", addrProvince: "浙江省", addrCity: "杭州市", addrDistrict: null })).toMatchObject({ ok: false });
    expect((await 读(id)).addrCountry).toBeNull();
  });
});
