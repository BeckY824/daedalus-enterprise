/**
 * 首页新线索卡和「新建项目」同一套（11-04 用户：首页录入要和新建项目 / 新建客户一致，含必填项；国家 / 地区放进对应字段，分不清的交给用户判断）。
 *
 *   分配：销售选个人自持 → 创建人 = 负责人 = 自己；市场选暂不分配 → 负责人 = 自己、潜客培育、待分配；
 *         市场选指定分配 → 负责人 = 那位销售、客户跟着走；市场选自动分配 → 按业务线分给那条线的销售
 *   国家 / 城市：卡上勾哪几格填哪几格（客户地址 / 联系人地址 / 项目所在地），不进备注；老卡没勾照旧只进客户
 *   必填：分配方式、指定时的负责人、业务线、进程、明确回复、进程过了有效线索要明确回复、有国家要选填到哪
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "", email: "t", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 自动分配不参与key } from "@/lib/enterprise/lead-assign";
import { 规则 } from "@/lib/enterprise/rules";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { missingFields } from "@/lib/agent/proposals";
import { 企业版字典 } from "@/lib/project/stage-dict";
import { 缺有效沟通 } from "@/lib/project/stage-gates";

type 人 = { id: string; name: string };
let 老板: 人, 市场: 人, 乙: 人, 丙: 人;
async function 造人(email: string, name: string): Promise<人> {
  const u = await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } });
  return { id: u.id, name: u.name };
}
const 当 = (u: 人) => { mocks.user = { ...mocks.user, id: u.id, name: u.name }; };
let 序 = 0;
const 卡 = (补: Record<string, unknown> = {}) => ({
  id: `p${++序}`, kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
  name: `星河电子${序}`, contact: "周经理", phone: `1380000${String(序).padStart(4, "0")}`, source: "展会", status: "待跟进", remark: "",
  业务线: "内贸", 节点: "潜客培育", 明确回复: false, ...补,
});
const 唯一项目 = () => prisma.project.findFirstOrThrow({ include: { customer: true } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  老板 = await 造人("boss", "老板");
  市场 = await 造人("mkt", "市场");
  乙 = await 造人("yi", "乙");
  丙 = await 造人("bing", "丙");
  await prisma.entMember.createMany({
    data: [
      { userId: 老板.id, bizRole: "director" },
      { userId: 市场.id, bizRole: "marketing_mgr" },
      { userId: 乙.id, bizRole: "sales", line: "内贸" },
      { userId: 丙.id, bizRole: "sales", line: "外贸" },
    ],
  });
  await setSetting("business", { projectMode: true });
  await setSetting(规则.线索分配.key, true);
  // 老板不参与自动分配：内贸只剩乙一个人
  await setSetting(自动分配不参与key, { [老板.id]: "禁止" });
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板.id } });
});
afterEach(() => { vi.unstubAllEnvs(); 忘掉企业版范围(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("新线索卡：分配方式 × 角色", () => {
  it("销售 + 个人自持：创建人 = 负责人 = 自己，客户也在自己名下", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([乙.id, 乙.id, 乙.id, "个人自持"]);
  });

  it("市场 + 暂不分配：负责人 = 自己、潜客培育、标待分配", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 3 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.node, p.assignMode]).toEqual([市场.id, 市场.id, 市场.id, "潜客培育", "暂不分配"]);
    expect(p.awaitAssignAt).not.toBeNull();
  });

  it("市场 + 指定分配：负责人 = 选的那位销售，客户跟着走，创建人还是自己", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 0, ownerId: 丙.id, 业务线: "外贸" }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode]).toEqual([市场.id, 丙.id, 丙.id, "指定分配"]);
  });

  it("市场 + 自动分配：按业务线分给那条线的销售（内贸 → 乙），不待分配", async () => {
    当(市场);
    expect(await applyProposal(卡({ 分配方式: 1 }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.creatorId, p.ownerId, p.customer.salesOwnerId, p.assignMode, p.awaitAssignAt]).toEqual([市场.id, 乙.id, 乙.id, "自动分配", null]);
  });

  it("销售不能用的方式（公海捞取）拦下，不建", async () => {
    当(乙);
    const r = await applyProposal(卡({ 分配方式: 2 }) as never);
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.project.count()).toBe(0);
    expect(await prisma.customer.count()).toBe(0);
  });
});

describe("新线索卡：国家 / 城市填到哪", () => {
  it("勾客户：进客户地址，不进联系人、项目，也不进备注", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, country: "摩洛哥", city: "卡萨布兰卡", 区域去处: ["客户"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.customer.addrCountry, p.customer.addrCity, p.addrCountry]).toEqual(["摩洛哥", "卡萨布兰卡", null]);
    expect(p.customer.remark ?? "").not.toContain("摩洛哥");
    expect((await prisma.contact.findFirstOrThrow({ where: { customerId: p.customerId } })).address).toBeNull();
  });

  it("勾联系人 + 项目：联系人地址 = 国家 城市，项目所在地有国家城市，客户地址空着", async () => {
    当(乙);
    expect(await applyProposal(卡({ 分配方式: 4, country: "摩洛哥", city: "卡萨布兰卡", 区域去处: ["联系人", "项目"] }) as never)).toMatchObject({ ok: true });
    const p = await 唯一项目();
    expect([p.addrCountry, p.addrCity, p.customer.addrCountry]).toEqual(["摩洛哥", "卡萨布兰卡", null]);
    expect((await prisma.contact.findFirstOrThrow({ where: { customerId: p.customerId } })).address).toBe("摩洛哥 卡萨布兰卡");
  });
});

describe("新线索卡：和新建项目同一套必填", () => {
  const 企 = { 只用项目: true, 要下一步: false, 企业: { 有分配方式: true, 节点们: 企业版字典.节点们.线索 } };
  const 缺 = (补: Record<string, unknown>) => missingFields(卡({ 分配方式: 4, ...补 }) as never, undefined, 企);

  it("齐了不缺", () => expect(缺({})).toEqual([]));
  it("客户名称、联系人姓名", () => expect(缺({ name: " ", contact: "" })).toEqual(["客户名称", "联系人姓名"]));
  it("分配方式", () => expect(缺({ 分配方式: undefined })).toEqual(["分配方式"]));
  it("指定分配没选负责人", () => expect(缺({ 分配方式: 0 })).toEqual(["项目负责人"]));
  it("业务线、进程、明确回复", () => expect(缺({ 业务线: undefined, 节点: "不存在的节点", 明确回复: undefined })).toEqual(["业务线", "当前进程", "客户明确回复了吗"]));
  it("进程过了有效线索、客户没明确回复", () => {
    const 后 = 企业版字典.节点们.线索[企业版字典.节点们.线索.indexOf("线索验证") + 1];
    expect(后).toBeTruthy();
    expect(缺({ 节点: 后 })).toEqual([缺有效沟通]);
    expect(缺({ 节点: 后, 明确回复: true })).toEqual([]);
  });
  it("有国家 / 城市没选填到哪", () => {
    expect(缺({ country: "摩洛哥" })).toEqual(["国家 / 城市填到哪"]);
    expect(缺({ city: "多伦多" })).toEqual(["国家 / 城市填到哪"]);
    expect(缺({ country: "摩洛哥", 区域去处: ["项目"] })).toEqual([]);
  });
  it("没有分配方式可选：不问分配方式，但要选负责人", () => {
    const 无 = { ...企, 企业: { ...企.企业, 有分配方式: false } };
    expect(missingFields(卡() as never, undefined, 无)).toEqual(["项目负责人"]);
    expect(missingFields(卡({ ownerId: "u" }) as never, undefined, 无)).toEqual([]);
  });
  it("确认时服务端也拦：缺分配方式不建", async () => {
    当(乙);
    expect(await applyProposal(卡() as never)).toMatchObject({ ok: false });
    expect(await prisma.project.count()).toBe(0);
  });
});
