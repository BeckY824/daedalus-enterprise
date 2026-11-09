/**
 * 项目详情卡片就地改（11-02）的服务端和纯逻辑。界面走 编辑项目 / 改项目沟通 这两个现成 action，这里钉的是：
 *   - 只交一格：没传的字段一个不动（打开页面后别人改的不被旧值盖回去）；null = 明说清空
 *   - 权限没有新路：不是负责人、公海、字段权限「看」都拦在服务端，界面不摆入口只是少一步
 *   - 级别、预计成交、定金能清空；金额清掉 = 0、负数报错；痛点、需求超长报错
 *   - 沟通正文改：只动正文，方式、时间、发起主体不变；版本对不上不盖
 *   - 钱格改动 / 文字格改动 / 沟通正文改动 / 合并附件 这几个纯函数
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "销售甲", email: "s1", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/shared-ws/current", async (原) => ({ ...(await 原<object>()), 当前是共享区: async () => false }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache, setSetting } from "@/lib/settings";
import { 编辑项目, 记项目沟通Action, 改项目沟通 } from "@/app/(app)/projects/actions";
import { 字段权限key } from "@/lib/enterprise/field-perm";
import { 规则 } from "@/lib/enterprise/rules";
import { 版本冲突 } from "@/lib/edit-version";
import { 文字格改动, 沟通正文改动, 钱格改动 } from "@/lib/project/inline-edit";
import { 合并附件 } from "@/lib/attachment-rules";
import { 不能改沟通话 } from "@/lib/enterprise/follow-perm";

let 销售: string, 同事: string, 客户: string, 项目: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 读 = () => prisma.project.findUniqueOrThrow({ where: { id: 项目 } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 人 = async (email: string, name: string) => {
    const id = (await prisma.user.create({ data: { email, name, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole: "sales" } });
    return id;
  };
  销售 = await 人("s1", "销售甲");
  同事 = await 人("s2", "销售乙");
  客户 = (await prisma.customer.create({ data: { name: "示例客户", phone: "13800000001", salesOwnerId: 销售 } })).id;
  项目 = (await prisma.project.create({
    data: { customerId: 客户, ownerId: 销售, creatorId: 销售, name: "示例项目", phase: "线索", node: "潜客培育", remark: "原备注", amount: 100, currency: "USD", level: "A", expectedDealAt: new Date("2026-12-01T00:00:00.000Z"), dealDemand: "原需求", depositAmount: 10, depositCurrency: "USD", painPoints: "原痛点", contractStatus: "未签约" },
  })).id;
  当(销售);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("编辑项目：只交一格", () => {
  it("改备注：别的字段全不动（客户、联系人、金额、级别、地址都还是原来的）", async () => {
    const 前 = await 读();
    const r = await 编辑项目(项目, { remark: "新备注" });
    expect(r).toEqual({ ok: true });
    const 后 = await 读();
    expect(后.remark).toBe("新备注");
    const 不看 = (x: typeof 前) => ({ ...x, remark: null, updatedAt: null, version: null });
    expect(不看(后)).toEqual(不看(前));
  });

  it("打开页面后别人改了金额：我只改需求描述，金额不被盖回去", async () => {
    await prisma.project.update({ where: { id: 项目 }, data: { amount: 999 } });
    expect((await 编辑项目(项目, { dealDemand: "新需求" })).ok).toBe(true);
    const 后 = await 读();
    expect(后.amount).toBe(999);
    expect(后.dealDemand).toBe("新需求");
  });

  it("null = 清空：级别、预计成交、定金（币种跟着清）、备注", async () => {
    expect((await 编辑项目(项目, { level: null })).ok).toBe(true);
    expect((await 编辑项目(项目, { expectedDealAt: null })).ok).toBe(true);
    expect((await 编辑项目(项目, 钱格改动("定金金额", { 数: null, 币: "USD" }))).ok).toBe(true);
    expect((await 编辑项目(项目, { remark: 文字格改动("   ") })).ok).toBe(true);
    const 后 = await 读();
    expect([后.level, 后.expectedDealAt, 后.depositAmount, 后.depositCurrency, 后.remark]).toEqual([null, null, null, null, null]);
    expect(后.amount).toBe(100);
  });

  it("金额：改数和币种；清掉存 0；负数报错且不动", async () => {
    expect((await 编辑项目(项目, 钱格改动("金额", { 数: 250.5, 币: "CNY" }))).ok).toBe(true);
    expect(await 读()).toMatchObject({ amount: 250.5, currency: "CNY" });
    const 负 = await 编辑项目(项目, 钱格改动("金额", { 数: -1, 币: "CNY" }));
    expect(负.ok).toBe(false);
    expect(await 读()).toMatchObject({ amount: 250.5 });
    expect((await 编辑项目(项目, 钱格改动("金额", { 数: null, 币: "CNY" }))).ok).toBe(true);
    expect(await 读()).toMatchObject({ amount: 0, currency: "CNY" });
  });

  it("校验还在：认不出的级别、超长备注报错，给得出原因，库不变", async () => {
    const 坏级别 = await 编辑项目(项目, { level: "Z" });
    expect(坏级别.ok).toBe(false);
    const 长 = await 编辑项目(项目, { remark: "字".repeat(501) });
    expect(长.ok).toBe(false);
    if (!长.ok) expect(长.error).toBeTruthy();
    expect(await 读()).toMatchObject({ level: "A", remark: "原备注" });
  });
});

describe("老项目历史超限", () => {
  const 长名 = `  ${"名".repeat(80)}  `, 长备注 = `  ${"备".repeat(600)}  `;
  beforeEach(async () => {
    await prisma.project.update({ where: { id: 项目 }, data: { name: 长名, remark: 长备注 } });
  });

  it("名称、备注超长又带空白：改金额能存，这两列一字不动", async () => {
    expect((await 编辑项目(项目, { amount: 500 })).ok).toBe(true);
    expect(await 读()).toMatchObject({ amount: 500, name: 长名, remark: 长备注 });
  });

  it("只改备注：校验新备注，名称不动", async () => {
    expect((await 编辑项目(项目, { remark: "短备注" })).ok).toBe(true);
    expect(await 读()).toMatchObject({ remark: "短备注", name: 长名 });
    expect((await 编辑项目(项目, { remark: "字".repeat(501) })).ok).toBe(false);
    expect((await 读()).remark).toBe("短备注");
  });

  it("传了才校验：把名称改超长、改成空都报错", async () => {
    expect((await 编辑项目(项目, { name: "名".repeat(61) })).ok).toBe(false);
    expect((await 编辑项目(项目, { name: "   " })).ok).toBe(false);
    expect((await 读()).name).toBe(长名);
  });

  it("备注传 null 还是清空", async () => {
    expect((await 编辑项目(项目, { remark: null })).ok).toBe(true);
    expect((await 读()).remark).toBeNull();
  });
});

describe("权限没有新路", () => {
  it("不是负责人：改不了，库不变", async () => {
    当(同事);
    const r = await 编辑项目(项目, { remark: "同事改的" });
    expect(r.ok).toBe(false);
    expect((await 读()).remark).toBe("原备注");
  });

  it.each(["原负责人", "别人"])("公海里的项目：%s也改不了，要先领取", async (谁) => {
    await prisma.project.update({ where: { id: 项目 }, data: { pooledAt: new Date() } });
    当(谁 === "原负责人" ? 销售 : 同事);
    const r = await 编辑项目(项目, { remark: "公海里改" });
    expect(r.ok).toBe(false);
    expect((await 读()).remark).toBe("原备注");
  });

  it.each([
    ["商机金额", { amount: 5 }],
    ["商机金额", { depositAmount: 5, depositCurrency: "USD" }],
    ["商机金额", { dealDemand: "改一下" }],
    ["痛点标注", { painPoints: "改一下" }],
    ["合同状态", { contractStatus: "已签约" }],
    ["预计签约", { expectedDealAt: "2027-01-01" }],
  ] as const)("字段权限「%s」只能看：%j 被拦，库不变", async (名, patch) => {
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { [名]: { sales: "看" } });
    const 前 = await 读();
    const r = await 编辑项目(项目, patch);
    expect(r.ok).toBe(false);
    const 后 = await 读();
    expect({ ...后, updatedAt: null }).toEqual({ ...前, updatedAt: null });
  });

  it("字段权限只锁金额：只交备注这一格照样存（整份交才会误伤）", async () => {
    await setSetting(规则.字段权限.key, true);
    await setSetting(字段权限key, { 商机金额: { sales: "看" } });
    expect((await 编辑项目(项目, { remark: "能改" })).ok).toBe(true);
    expect((await 读()).remark).toBe("能改");
  });
});

describe("沟通正文", () => {
  // M-权限-09 原口径（11-09）：管理以下（销售负责人本人也算）改不了沟通，这一组的负责人升成销售管理；销售负责人被拒见最后一条
  beforeEach(async () => { await prisma.entMember.update({ where: { userId: 销售 }, data: { bizRole: "sales_mgr" } }); });
  const 记一条 = async () => {
    const r = await 记项目沟通Action(项目, { type: "PHONE", content: "电话聊了报价", occurredAt: "2026-10-20 10:00", 阶段: "线索", 明确回复: true, 下一步: "周五前发报价单" });
    expect(r.ok).toBe(true);
    const id = (await prisma.followUpProject.findFirstOrThrow({ where: { projectId: 项目 }, orderBy: { followUp: { createdAt: "desc" } } })).followUpId;
    return prisma.followUp.findUniqueOrThrow({ where: { id } });
  };

  it("只动正文：类型、时间不变", async () => {
    const f = await 记一条();
    const 交 = 沟通正文改动({ type: f.type, method: f.method, initiator: f.initiator, occurredAt: f.occurredAt.toISOString(), 版本: f.updatedAt.toISOString() }, "改过的正文");
    if ("error" in 交) throw new Error(交.error);
    const r = await 改项目沟通(项目, f.id, 交.改动);
    expect(r.ok).toBe(true);
    const 后 = await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } });
    expect(后.content).toBe("改过的正文");
    expect(后.type).toBe(f.type);
    expect(后.occurredAt.getTime()).toBe(f.occurredAt.getTime());
  });

  it("别人刚改过（版本对不上）：不盖，回版本冲突那句话", async () => {
    const f = await 记一条();
    const 交 = 沟通正文改动({ type: f.type, occurredAt: f.occurredAt.toISOString(), 版本: "2000-01-01T00:00:00.000Z" }, "我的旧草稿");
    if ("error" in 交) throw new Error(交.error);
    const r = await 改项目沟通(项目, f.id, 交.改动);
    expect(r).toEqual({ ok: false, error: 版本冲突 });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } })).content).toBe("电话聊了报价");
  });

  it("不是负责人改不了", async () => {
    const f = await 记一条();
    当(同事);
    const 交 = 沟通正文改动({ type: f.type, occurredAt: f.occurredAt.toISOString() }, "同事改的");
    if ("error" in 交) throw new Error(交.error);
    expect((await 改项目沟通(项目, f.id, 交.改动)).ok).toBe(false);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } })).content).toBe("电话聊了报价");
  });

  it("负责人是销售（不是管理）：自己记的也改不了", async () => {
    await prisma.entMember.update({ where: { userId: 销售 }, data: { bizRole: "sales" } });
    const f = await 记一条();
    const 交 = 沟通正文改动({ type: f.type, occurredAt: f.occurredAt.toISOString(), 版本: f.updatedAt.toISOString() }, "销售改的");
    if ("error" in 交) throw new Error(交.error);
    expect(await 改项目沟通(项目, f.id, 交.改动)).toEqual({ ok: false, error: 不能改沟通话 });
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } })).content).toBe("电话聊了报价");
  });
});

describe("纯函数", () => {
  it("钱格改动：三格各去各的列；金额清掉是 0，定金、合同清掉是 null", () => {
    expect(钱格改动("金额", { 数: 1, 币: "USD" })).toEqual({ amount: 1, currency: "USD" });
    expect(钱格改动("金额", { 数: null, 币: "USD" })).toEqual({ amount: 0, currency: "USD" });
    expect(钱格改动("定金金额", { 数: null, 币: "USD" })).toEqual({ depositAmount: null, depositCurrency: "USD" });
    expect(钱格改动("合同金额", { 数: 2, 币: "CNY" })).toEqual({ contractAmount: 2, contractCurrency: "CNY" });
  });
  it("文字格改动：去空白，空 = null", () => {
    expect(文字格改动("  a b ")).toBe("a b");
    expect(文字格改动("  \n ")).toBeNull();
    expect(文字格改动(null)).toBeNull();
  });
  it("沟通正文改动：空正文给和弹窗同一句话", () => {
    expect(沟通正文改动({ type: "PHONE", occurredAt: "2026-10-20T02:00:00.000Z" }, "  ")).toEqual({ error: "请填写这次沟通的内容" });
  });
  it("合并附件：服务端 + 新传 - 删了；同 id 不重复", () => {
    const a = (id: string) => ({ id });
    expect(合并附件([a("1"), a("2")], [a("2"), a("3")], ["1"])).toEqual([a("2"), a("3")]);
    expect(合并附件([], [], [])).toEqual([]);
  });
});

describe("联系人 / 项目来源 / 业务线：就地改也只交一格", () => {
  const 别的格 = async () => { const p = await 读(); return [p.name, p.remark, p.amount, p.ownerId]; };
  const 原样 = ["示例项目", "原备注", 100, () => 销售] as const;
  const 核别的格没动 = async () => expect(await 别的格()).toEqual([原样[0], 原样[1], 原样[2], 原样[3]()]);

  it("联系人：换成本客户下的联系人落库、留痕；别的客户的联系人拦下；交 null 清掉", async () => {
    const 甲 = (await prisma.contact.create({ data: { name: "联系人甲", customerId: 客户 } })).id;
    const 外客户 = (await prisma.customer.create({ data: { name: "另一个客户", phone: "13800000002", salesOwnerId: 销售 } })).id;
    const 外人 = (await prisma.contact.create({ data: { name: "外人", customerId: 外客户 } })).id;

    expect(await 编辑项目(项目, { contactId: 甲 })).toMatchObject({ ok: true });
    expect((await 读()).contactId).toBe(甲);
    await 核别的格没动();
    const 痕 = await prisma.auditLog.findFirstOrThrow({ where: { entityId: 项目, action: "update" }, orderBy: { at: "desc" } });
    expect(痕.summary).toContain("主联系人");

    const r = await 编辑项目(项目, { contactId: 外人 });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("不在这个客户下");
    expect((await 读()).contactId).toBe(甲);

    expect(await 编辑项目(项目, { contactId: null })).toMatchObject({ ok: true });
    expect((await 读()).contactId).toBeNull();
  });

  it("项目来源：在用的渠道落库；停用的拦下；交 null 清掉；别的格不动", async () => {
    const 展会 = (await prisma.channel.create({ data: { name: "展会", channelOwnerId: 销售 } })).id;
    const 停了 = (await prisma.channel.create({ data: { name: "停用渠道", channelOwnerId: 销售, active: false } })).id;

    expect(await 编辑项目(项目, { channelId: 展会 })).toMatchObject({ ok: true });
    expect((await 读()).channelId).toBe(展会);
    await 核别的格没动();

    expect((await 编辑项目(项目, { channelId: 停了 })).ok).toBe(false);
    expect((await 读()).channelId).toBe(展会);

    expect(await 编辑项目(项目, { channelId: null })).toMatchObject({ ok: true });
    expect((await 读()).channelId).toBeNull();
  });

  it("业务线：改成外贸落库、负责人不跟着重分；清空和不认得的值拦下", async () => {
    expect(await 编辑项目(项目, { 业务线: "外贸" })).toMatchObject({ ok: true });
    expect((await 读()).bizLine).toBe("外贸");
    await 核别的格没动();

    expect((await 编辑项目(项目, { 业务线: "" })).ok).toBe(false);
    expect((await 编辑项目(项目, { 业务线: "火星线" })).ok).toBe(false);
    expect((await 读()).bizLine).toBe("外贸");
  });

  it("不是负责人：三格都改不了，库不变", async () => {
    const 展会 = (await prisma.channel.create({ data: { name: "展会", channelOwnerId: 销售 } })).id;
    const 甲 = (await prisma.contact.create({ data: { name: "联系人甲", customerId: 客户 } })).id;
    const 前 = await 读();
    当(同事);
    for (const patch of [{ contactId: 甲 }, { channelId: 展会 }, { 业务线: "外贸" }]) {
      expect((await 编辑项目(项目, patch)).ok).toBe(false);
    }
    const 后 = await 读();
    expect([后.contactId, 后.channelId, 后.bizLine]).toEqual([前.contactId, 前.channelId, 前.bizLine]);
  });
});
