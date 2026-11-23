/**
 * 11-18 审核「权限与可见」P0-1、P0-2、P0-3、P1-3：绕过界面直接调服务端动作，「看得到」不等于「能改」。
 * 复现单测原在 tests/audit-1118/perm-actions.test.ts（B1–B3），搬进来改成正式用例，另补对照（负责人本人、系统管理员照样能做）。
 *
 * 背景：Prisma 限定层对改、删放行的范围 = 自己 + 实线下属 + 公海，所以「只有负责人本人能改」只能靠每个动作自己判。
 * 这里没有请求上下文，限定层不限定——正好只看动作自己那道判定。
 *   - saveContact：过 客户事项挡（同 detachContact；核心是 能改客户）
 *   - 联系人挂靠：挂到客户、换主客户两头都要能改；解除 / 改说明看挂的那一位
 *   - 关联客户：发起的这一头要能改（改客户挡），另一头照原设计只要看得到
 *   - 撤销记一笔：客户要能改（同 deletePlan），跟进必须是这位客户名下、本人 10 分钟内记的
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const 当前 = vi.hoisted(() => ({ me: { id: "", name: "", email: "x", role: "SALES", title: "" } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => 当前.me, getCurrentUser: async () => 当前.me }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveContact, 撤销记一笔 } from "@/app/(app)/customers/[id]/actions";
import { 挂到客户, 改挂靠说明, 解除挂靠, 换主客户 } from "@/app/(app)/customers/[id]/contact-link-actions";
import { 关联客户, 改关联说明, 取消关联 } from "@/app/(app)/customers/[id]/link-actions";

let 经理 = "", 下属 = "", 销售 = "", 系管 = "";
let 序 = 0;
const 人 = async (name: string, bizRole: string, managerId: string | null = null) => {
  const u = await prisma.user.create({ data: { email: `${name}${++序}@x`, name, title: "", role: "SALES", password: "x" } });
  await prisma.entMember.create({ data: { userId: u.id, bizRole, managerId } });
  return u.id;
};
const 当 = (id: string) => { 当前.me = { ...当前.me, id, name: id }; };
const 客户 = async (salesOwnerId: string, 公海 = false) => {
  const c = await prisma.customer.create({ data: { name: `示例客户${++序}`, phone: "", salesOwnerId } });
  if (公海) await prisma.customerPool.create({ data: { customerId: c.id, userId: 系管, reason: "测试" } });
  return c.id;
};
const 联系人 = async (customerId: string, name = "联系人") => {
  const k = await prisma.contact.create({ data: { customerId, name, isPrimary: true } });
  await prisma.contactCustomer.create({ data: { contactId: k.id, customerId } });
  return k.id;
};
const 联系人表单 = { phone: "", email: "", wechat: "", position: "" };
const 刚记一笔 = (customerId: string, ownerId: string) =>
  prisma.followUp.create({ data: { type: "PHONE", title: "", content: "打过了", occurredAt: new Date(), customerId, ownerId } });
const 计划 = (customerId: string, ownerId: string, done: boolean, subject = "计划") =>
  prisma.followPlan.create({ data: { subject, plannedAt: new Date(Date.now() + (done ? 0 : 864e5)), customerId, ownerId, done, ...(done ? { doneAt: new Date() } : {}) } });

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  系管 = await 人("系管", "director");
  经理 = await 人("经理", "sales_mgr");
  下属 = await 人("下属", "sales", 经理);
  销售 = await 人("销售", "sales");
});
afterEach(() => void vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("saveContact 要能改这位客户（P0-1，P-判定-02：能编辑 = 负责人本人；公海里的先领）", () => {
  it("销管给下属负责的客户新建联系人：拒，库里没有", async () => {
    const c = await 客户(下属);
    当(经理);
    const r = await saveContact({ customerId: c, name: "示例联系人", isPrimary: true, ...联系人表单 } as never);
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.contact.count({ where: { customerId: c } })).toBe(0);
  });

  it("销管改下属客户上已有的联系人：拒，原样", async () => {
    const c = await 客户(下属);
    const k = await 联系人(c, "原名");
    当(经理);
    const r = await saveContact({ id: k, customerId: c, name: "被改了", isPrimary: true, ...联系人表单 } as never);
    expect(r).toMatchObject({ ok: false });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: k } })).name).toBe("原名");
  });

  it("销售改公海客户上已有的联系人：拒（先领才能改）", async () => {
    const c = await 客户(销售, true);
    const k = await 联系人(c, "原名");
    当(下属);
    const r = await saveContact({ id: k, customerId: c, name: "被改了", isPrimary: true, ...联系人表单 } as never);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: k } })).name).toBe("原名");
  });

  // 11-23 小修批：客户详情公海客户联系人行不摆编辑笔（RecordView 联系人只读）——服务端对谁都不放行，原负责人、系统管理员也一样先领
  it.each([["原负责人", () => 销售], ["系统管理员", () => 系管]] as const)("%s改、新建公海客户的联系人：也拒（先领才能改）", async (_, 谁) => {
    const c = await 客户(销售, true);
    const k = await 联系人(c, "原名");
    当(谁());
    expect(await saveContact({ id: k, customerId: c, name: "被改了", isPrimary: true, ...联系人表单 } as never)).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
    expect(await saveContact({ customerId: c, name: "新来的", isPrimary: false, ...联系人表单 } as never)).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: k } })).name).toBe("原名");
    expect(await prisma.contact.count({ where: { customerId: c, name: "新来的" } })).toBe(0);
  });

  it("对照：负责人本人新建、改自己客户的联系人照常", async () => {
    const c = await 客户(下属);
    当(下属);
    const 建 = await saveContact({ customerId: c, name: "张三", isPrimary: true, ...联系人表单 } as never);
    expect(建).toMatchObject({ ok: true });
    const id = (建 as { id: string }).id;
    expect(await saveContact({ id, customerId: c, name: "张三丰", isPrimary: true, ...联系人表单 } as never)).toMatchObject({ ok: true });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id } })).name).toBe("张三丰");
  });

  it("对照：系统管理员能改下属客户的联系人", async () => {
    const c = await 客户(下属);
    当(系管);
    expect(await saveContact({ customerId: c, name: "系管建的", isPrimary: false, ...联系人表单 } as never)).toMatchObject({ ok: true });
    expect(await prisma.contact.count({ where: { customerId: c } })).toBe(1);
  });

  it("对照：这位客户下有自己负责的在推项目，能加联系人（同待办、计划，客户事项挡）", async () => {
    const c = await 客户(下属);
    await prisma.project.create({ data: { name: "经理的项目", customerId: c, ownerId: 经理, creatorId: 经理, phase: "线索", node: "潜客培育" } });
    当(经理);
    expect(await saveContact({ customerId: c, name: "项目上的人", isPrimary: false, ...联系人表单 } as never)).toMatchObject({ ok: true });
  });
});

describe("撤销记一笔：跟进要是本人刚记的、客户要能改（P0-3）", () => {
  it("销管拿下属客户的计划 id、跟进 id 随便填：拒，计划还在、原计划还是完成", async () => {
    const c = await 客户(下属);
    const 原计划 = await 计划(c, 下属, true, "原计划");
    const 下次 = await 计划(c, 下属, false, "下属排的计划");
    当(经理);
    const r = await 撤销记一笔({ customerId: c, 跟进id: "不存在", 计划id: 原计划.id, 下次计划id: 下次.id });
    expect(r).toMatchObject({ ok: false });
    expect(await prisma.followPlan.count({ where: { id: 下次.id } })).toBe(1);
    expect((await prisma.followPlan.findUniqueOrThrow({ where: { id: 原计划.id } })).done).toBe(true);
  });

  it("销管在下属客户上，跟进还是自己刚记的：也拒（客户不能改，同 deletePlan）", async () => {
    const c = await 客户(下属);
    const f = await 刚记一笔(c, 经理);
    const 原计划 = await 计划(c, 下属, true);
    const 下次 = await 计划(c, 下属, false);
    当(经理);
    expect(await 撤销记一笔({ customerId: c, 跟进id: f.id, 计划id: 原计划.id, 下次计划id: 下次.id })).toMatchObject({ ok: false });
    expect(await prisma.followPlan.count({ where: { id: 下次.id } })).toBe(1);
    expect(await prisma.followUp.count({ where: { id: f.id } })).toBe(1);
  });

  it("负责人本人在自己客户上，跟进 id 不存在：也拒，计划不删", async () => {
    const c = await 客户(下属);
    const 原计划 = await 计划(c, 下属, true);
    const 下次 = await 计划(c, 下属, false);
    当(下属);
    expect(await 撤销记一笔({ customerId: c, 跟进id: "不存在", 计划id: 原计划.id, 下次计划id: 下次.id })).toMatchObject({ ok: false });
    expect(await prisma.followPlan.count({ where: { id: 下次.id } })).toBe(1);
  });

  it("公海客户上：谁都撤不了", async () => {
    const c = await 客户(销售, true);
    const f = await 刚记一笔(c, 下属);
    const 原计划 = await 计划(c, 下属, true);
    当(下属);
    expect(await 撤销记一笔({ customerId: c, 跟进id: f.id, 计划id: 原计划.id })).toMatchObject({ ok: false });
    expect(await prisma.followUp.count({ where: { id: f.id } })).toBe(1);
  });

  it("对照：负责人本人撤自己刚记的一笔，跟进删掉、下一条删掉、原计划改回未完成", async () => {
    const c = await 客户(下属);
    const f = await 刚记一笔(c, 下属);
    const 原计划 = await 计划(c, 下属, true);
    const 下次 = await 计划(c, 下属, false);
    当(下属);
    expect(await 撤销记一笔({ customerId: c, 跟进id: f.id, 计划id: 原计划.id, 下次计划id: 下次.id })).toEqual({ ok: true });
    expect(await prisma.followUp.count({ where: { id: f.id } })).toBe(0);
    expect(await prisma.followPlan.count({ where: { id: 下次.id } })).toBe(0);
    expect(await prisma.followPlan.findUniqueOrThrow({ where: { id: 原计划.id } })).toMatchObject({ done: false, doneAt: null });
  });

  it("对照：系统管理员撤自己刚记的一笔照常", async () => {
    const c = await 客户(下属);
    const f = await 刚记一笔(c, 系管);
    const 原计划 = await 计划(c, 系管, true);
    当(系管);
    expect(await 撤销记一笔({ customerId: c, 跟进id: f.id, 计划id: 原计划.id })).toEqual({ ok: true });
    expect(await prisma.followUp.count({ where: { id: f.id } })).toBe(0);
  });
});

describe("联系人挂靠要能改，不只是看得到（P0-2）", () => {
  it("销售把公海客户的联系人换主客户到自己名下：拒，主客户不变", async () => {
    const 公海客 = await 客户(销售, true);
    const 我的 = await 客户(下属);
    const k = await 联系人(公海客, "公海联系人");
    当(下属);
    expect(await 换主客户(k, 我的)).toMatchObject({ ok: false });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: k } })).customerId).toBe(公海客);
  });

  it("销售把公海客户的联系人挂到自己客户上：拒（主客户那头不能改）", async () => {
    const 公海客 = await 客户(销售, true);
    const 我的 = await 客户(下属);
    const k = await 联系人(公海客, "公海联系人");
    当(下属);
    expect(await 挂到客户(k, 我的, "借过来")).toMatchObject({ ok: false });
    expect(await prisma.contactCustomer.count({ where: { contactId: k, customerId: 我的 } })).toBe(0);
  });

  it("销管把下属客户的联系人挂到自己客户上、换主客户：拒", async () => {
    const 下属的 = await 客户(下属);
    const 经理的 = await 客户(经理);
    const k = await 联系人(下属的);
    当(经理);
    expect(await 挂到客户(k, 经理的)).toMatchObject({ ok: false });
    expect(await 换主客户(k, 经理的)).toMatchObject({ ok: false });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: k } })).customerId).toBe(下属的);
    expect(await prisma.contactCustomer.count({ where: { contactId: k } })).toBe(1);
  });

  it("销管改、解下属客户上的挂靠：拒", async () => {
    const 下属的 = await 客户(下属);
    const 下属另一位 = await 客户(下属);
    const k = await 联系人(下属的);
    const 行 = await prisma.contactCustomer.create({ data: { contactId: k, customerId: 下属另一位, note: "原说明" } });
    当(经理);
    expect(await 改挂靠说明(行.id, "上级改")).toMatchObject({ ok: false });
    expect(await 解除挂靠(行.id)).toMatchObject({ ok: false });
    expect(await prisma.contactCustomer.findUniqueOrThrow({ where: { id: 行.id } })).toMatchObject({ note: "原说明" });
  });

  it("对照：负责人本人在自己两位客户之间挂、改说明、换主客户、解除都行", async () => {
    const 甲 = await 客户(下属);
    const 乙 = await 客户(下属);
    const k = await 联系人(甲);
    当(下属);
    expect(await 挂到客户(k, 乙, "顾问")).toEqual({ ok: true });
    const 行 = await prisma.contactCustomer.findUniqueOrThrow({ where: { contactId_customerId: { contactId: k, customerId: 乙 } } });
    expect(await 改挂靠说明(行.id, "总顾问")).toEqual({ ok: true });
    expect(await 换主客户(k, 乙)).toEqual({ ok: true });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: k } })).customerId).toBe(乙);
    const 甲行 = await prisma.contactCustomer.findUniqueOrThrow({ where: { contactId_customerId: { contactId: k, customerId: 甲 } } });
    expect(await 解除挂靠(甲行.id)).toEqual({ ok: true });
  });

  it("对照：系统管理员能把下属客户的联系人换到别人客户上", async () => {
    const 下属的 = await 客户(下属);
    const 销售的 = await 客户(销售);
    const k = await 联系人(下属的);
    当(系管);
    expect(await 换主客户(k, 销售的)).toEqual({ ok: true });
  });
});

describe("关联客户发起的这一头要能改，另一头看得到就行（P1-3）", () => {
  it("销管在下属客户上建客户关联：拒", async () => {
    const a = await 客户(下属);
    const b = await 客户(经理);
    当(经理);
    expect(await 关联客户(a, b, "测试")).toMatchObject({ ok: false });
    expect(await prisma.entCustomerLink.count()).toBe(0);
  });

  it("从公海客户这一头发起关联：拒（公海里的先领）", async () => {
    const a = await 客户(销售, true);
    const b = await 客户(下属);
    当(下属);
    expect(await 关联客户(a, b)).toMatchObject({ ok: false, error: expect.stringContaining("公海") });
    expect(await prisma.entCustomerLink.count()).toBe(0);
  });

  it("销管从下属客户那一头改、取消关联：拒", async () => {
    const a = await 客户(下属);
    const b = await 客户(经理);
    当(系管);
    expect(await 关联客户(a, b, "原说明")).toEqual({ ok: true });
    const 行 = await prisma.entCustomerLink.findFirstOrThrow();
    当(经理);
    expect(await 改关联说明(行.id, a, "经理改")).toMatchObject({ ok: false });
    expect(await 取消关联(行.id, a)).toMatchObject({ ok: false });
    expect(await prisma.entCustomerLink.findUniqueOrThrow({ where: { id: 行.id } })).toMatchObject({ note: "原说明" });
  });

  it("对照：把自己的客户关联到同事的客户照常（另一头只要看得到）", async () => {
    const a = await 客户(下属);
    const b = await 客户(销售);
    当(下属);
    expect(await 关联客户(a, b, "同一集团")).toEqual({ ok: true });
    const 行 = await prisma.entCustomerLink.findFirstOrThrow();
    expect(await 改关联说明(行.id, a, "子公司")).toEqual({ ok: true });
    expect(await 取消关联(行.id, a)).toEqual({ ok: true });
  });

  it("对照：负责人本人在自己两位客户之间建、改、取消关联照常", async () => {
    const a = await 客户(下属);
    const b = await 客户(下属);
    当(下属);
    expect(await 关联客户(a, b, "同一集团")).toEqual({ ok: true });
    const 行 = await prisma.entCustomerLink.findFirstOrThrow();
    expect(await 改关联说明(行.id, a, "子公司")).toEqual({ ok: true });
    expect(await 取消关联(行.id, b)).toEqual({ ok: true });
    expect(await prisma.entCustomerLink.count()).toBe(0);
  });

  it("对照：系统管理员能关联两位别人负责的客户", async () => {
    当(系管);
    expect(await 关联客户(await 客户(下属), await 客户(销售))).toEqual({ ok: true });
  });
});
