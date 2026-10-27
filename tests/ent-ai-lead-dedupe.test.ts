/**
 * 企业版 AI 建档按全部联系方式查重（10-27 会议 agent 提示词，lib/enterprise/ai-lead-dedupe.ts）。
 *
 *   认出备注里的号码：「邮箱：」「微信：」「旺旺：」行验得过才认、整行拿掉；每种只认第一个；正文夹着的邮箱只认不删
 *   撞手机 / 撞邮箱 / 撞微信（后两样从备注认出来）：不建，回「〈原负责人〉已有该客户信息，请及时核对」；
 *     原负责人收到一条待办「〈触发人〉疑似与您负责的〈客户名〉重复，请及时核对」，挂在原客户上；同一张卡点两次只建一条
 *   公海待捞：照原提示拦，不给谁加待办
 *   不撞：创建人 = 负责人 = 录入人；邮箱、微信进联系人原有两格，备注里那几行拿掉；有电话时旺旺留在备注；没电话时按邮箱 → 微信 → 旺旺取第一个当企业号码
 *   开关关：不查、不加待办，照旧写线索表
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 认出备注里的号码 } from "@/lib/enterprise/ai-lead-dedupe";
import { 查重提示 } from "@/lib/enterprise/contact-format";
import { applyProposal } from "@/app/(app)/dashboard/apply";

type 人 = { id: string; name: string };
let 甲: 人, 乙: 人;
const 造人 = async (email: string, name: string, role = "SALES"): Promise<人> => {
  const u = await prisma.user.create({ data: { email, name, title: "", role, password: "x" } });
  return { id: u.id, name: u.name };
};
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };
let 序 = 0;
const 卡 = (补: Record<string, unknown> = {}) => ({
  id: `p${++序}`, kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
  name: "星河电子", contact: "周经理", phone: "", source: "展会", status: "待跟进", remark: "", ...补,
});
/** 甲建一位老客户：先走同一条 AI 建档，联系方式就和真实录入一样进了子表 */
async function 甲先建(补: Record<string, unknown>) {
  当(甲);
  const r = await applyProposal(卡({ name: "老客户", ...补 }) as never);
  expect(r).toMatchObject({ ok: true });
  return prisma.customer.findFirstOrThrow({ where: { name: "老客户" } });
}

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true });
  甲 = await 造人("jia", "小甲");
  乙 = await 造人("yi", "小乙");
  const 老板 = await 造人("boss", "老板", "ADMIN");
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板.id } });
});

describe("认出备注里的号码", () => {
  it("按行认，验得过才认、整行拿掉；认不出的留着", () => {
    const r = 认出备注里的号码("要样品\n邮箱：Zhou@Star.com \n微信: zhou_jl88\n旺旺：xinghe_shop\n地址：深圳");
    expect(r.号们.map((h) => [h.类型, h.值])).toEqual([["邮箱", "Zhou@Star.com"], ["微信", "zhou_jl88"], ["旺旺ID", "xinghe_shop"]]);
    expect(r.剩).toBe("要样品\n地址：深圳");
  });
  it("格式不对的不认、原样留下；同一种只认第一个", () => {
    const r = 认出备注里的号码("邮箱：不是邮箱\n邮箱：a@b.com\n邮箱：c@d.com");
    expect(r.号们.map((h) => h.值)).toEqual(["a@b.com"]);
    expect(r.剩).toBe("邮箱：不是邮箱\n邮箱：c@d.com");
  });
  it("没有邮箱行时，正文夹着的邮箱也认，只认不删", () => {
    const r = 认出备注里的号码("名片背面写着 x@y.cn 请发报价");
    expect(r.号们.map((h) => [h.类型, h.值])).toEqual([["邮箱", "x@y.cn"]]);
    expect(r.剩).toBe("名片背面写着 x@y.cn 请发报价");
  });
  it("空备注", () => {
    expect(认出备注里的号码("")).toEqual({ 号们: [], 剩: "" });
  });
});

describe("撞了：不建、提醒原负责人", () => {
  it.each([
    ["手机", { phone: "13700001234" }, { phone: "137 0000-1234" }],
    ["邮箱（备注里认出）", { remark: "邮箱：zhou@star.com" }, { remark: "邮箱：ZHOU@star.com" }],
    ["微信（备注里认出）", { remark: "微信：zhou_jl88" }, { remark: "要样品\n微信：zhou_jl88" }],
  ])("撞%s：回纪要原句，客户数不变，原负责人收到一条待办", async (_名, 老, 新) => {
    const 老客户 = await 甲先建(老);
    当(乙);
    const r = await applyProposal(卡({ name: "星河电子", ...新 }) as never);
    expect(r).toEqual({ ok: false, error: 查重提示.AI建档重复("小甲") });
    expect(查重提示.AI建档重复("小甲")).toBe("小甲已有该客户信息，请及时核对");
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.project.count()).toBe(1);
    const 待办 = await prisma.task.findMany();
    expect(待办).toHaveLength(1);
    expect(待办[0]).toMatchObject({ title: "小乙疑似与您负责的老客户重复，请及时核对", ownerId: 甲.id, customerId: 老客户.id, done: false });
  });

  it("同一张卡点两次：只建一条待办", async () => {
    await 甲先建({ phone: "13700001234" });
    当(乙);
    await applyProposal(卡({ phone: "13700001234" }) as never);
    await applyProposal(卡({ phone: "13700001234" }) as never);
    expect(await prisma.task.count()).toBe(1);
  });

  it("公海待捞：照原提示拦，不加待办", async () => {
    const 老客户 = await 甲先建({ phone: "13700001234" });
    await prisma.customerPool.create({ data: { customerId: 老客户.id, userId: 甲.id } });
    当(乙);
    const r = await applyProposal(卡({ phone: "13700001234" }) as never);
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).not.toContain("已有该客户信息");
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.task.count()).toBe(0);
  });
});

describe("不撞：建成", () => {
  it("负责人都是我；邮箱、微信进联系人，备注里那几行拿掉；有电话时旺旺留在备注", async () => {
    当(乙);
    const r = await applyProposal(卡({ phone: "13700001234", remark: "要样品\n邮箱：zhou@star.com\n微信：zhou_jl88\n旺旺：xinghe_shop" }) as never);
    expect(r).toMatchObject({ ok: true });
    const p = await prisma.project.findFirstOrThrow({ include: { customer: true } });
    expect(p.ownerId).toBe(乙.id);
    expect(p.customer).toMatchObject({ salesOwnerId: 乙.id, remark: "要样品\n旺旺：xinghe_shop" });
    expect(await prisma.contact.findFirstOrThrow({ where: { customerId: p.customerId } })).toMatchObject({
      name: "周经理", phone: "13700001234", email: "zhou@star.com", wechat: "zhou_jl88",
    });
    expect(await prisma.task.count()).toBe(0);
  });

  it("没电话、有旺旺：旺旺当企业号码，再来一张同旺旺的卡被拦", async () => {
    当(甲);
    expect(await applyProposal(卡({ name: "老客户", remark: "旺旺：xinghe_shop" }) as never)).toMatchObject({ ok: true });
    expect((await prisma.customer.findFirstOrThrow()).remark).toBeNull();
    当(乙);
    expect(await applyProposal(卡({ remark: "旺旺：xinghe_shop" }) as never)).toEqual({ ok: false, error: 查重提示.AI建档重复("小甲") });
    expect(await prisma.customer.count()).toBe(1);
  });
});

describe("开关关", () => {
  it("不查、不加待办，照旧写线索表", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    当(甲);
    await applyProposal(卡({ phone: "13700001234" }) as never);
    当(乙);
    await applyProposal(卡({ phone: "13700001234" }) as never);
    expect(await prisma.task.count()).toBe(0);
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.lead.count()).toBeGreaterThanOrEqual(1);
  });
});
