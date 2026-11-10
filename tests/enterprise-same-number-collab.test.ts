/**
 * 企业版同号再次录入 → 组员协同（lib/enterprise/same-number-collab.ts，2026-11-03）。
 * 撞到有负责人在跟的客户：记录写进现有项目、发邀请、通知负责人、负责人不变；公海、停用、占位不走。
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
import { 等通知推完 } from "@/lib/enterprise/notify";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 同号再次录入, 同号可协同, 同号只记备注, 同号提醒们, 同号节点 } from "@/lib/enterprise/same-number-collab";
import { 查号码 } from "@/app/(app)/customers/number-actions";
import { saveLead } from "@/app/(app)/leads/actions";
import { 待我回的邀请, 读必填数据 } from "@/lib/project/db";
import { saveCustomer } from "@/app/(app)/customers/actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 执行导入 } from "@/app/(app)/customers/import-actions";
import { 字段表, 猜列 } from "@/lib/import/fields";
import { getBusiness } from "@/lib/business";
import { 建档向导, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { AI建档查重 } from "@/lib/enterprise/ai-lead-dedupe";
import { 查重提示 } from "@/lib/enterprise/contact-format";
import { 试跑 } from "@/lib/enterprise-import/report";
import { 写一批, 定这批业务线 } from "@/lib/enterprise-import/apply";
import { 撤回一批 } from "@/lib/enterprise-import/revert";

const 号码 = "13800138000";
const 好号 = () => {
  const r = 验号码("手机号", 号码);
  if (!r.ok) throw new Error("号码样例没过格式");
  return r;
};

async function 人(id: string, name: string, bizRole: string, 额外: { active?: boolean; email?: string } = {}) {
  const u = await prisma.user.create({ data: { id, email: 额外.email ?? `${id}@x.test`, name, title: "", role: "SALES", password: "x", active: 额外.active ?? true } });
  await prisma.entMember.createMany({ data: [{ userId: u.id, bizRole }] });
  return { id: u.id, name: u.name, email: u.email, role: "SALES" };
}

async function 现场(opt: { 客户渠道?: string; 项目?: boolean } = {}) {
  const 负责人 = await 人("owner1", "小甲", "sales");
  const 市场 = await 人("mkt1", "小丙", "channel_ops");
  const 销售 = await 人("sales2", "小丁", "sales");
  const 渠道老 = await prisma.channel.create({ data: { name: opt.客户渠道 ?? "展会", channelOwnerId: 市场.id } });
  const 渠道新 = await prisma.channel.create({ data: { name: "转介绍", channelOwnerId: 市场.id } });
  const 客户 = await prisma.customer.create({ data: { name: "编的客户甲", phone: 号码, salesOwnerId: 负责人.id, channelId: 渠道老.id } });
  const 项目 = opt.项目 === false ? null : await prisma.project.create({
    data: { name: "编的项目甲", customerId: 客户.id, ownerId: 负责人.id, creatorId: 负责人.id, channelId: 渠道老.id, phase: "线索", node: "潜客培育" },
  });
  return { 负责人, 市场, 销售, 渠道老, 渠道新, 客户, 项目 };
}

/** 按这个人的身份跑（可见范围照真请求限定） */
function 作为<R>(u: { id: string; name: string; role: string; email: string }, f: () => Promise<R>): Promise<R> {
  mocks.user = u;
  忘掉企业版范围();
  return 以谁的身份(u.id, f);
}
const 通知们 = (userId: string) => prisma.entNotice.findMany({ where: { userId } });

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await setSetting("business", { projectMode: true } as never);
  await setSetting(规则.按组织看客户.key, true); // 全程按真实可见范围跑：看不到客户的人也要写得进去
  mocks.user = null;
});

describe("同号再次录入", () => {
  it("市场录：写进现有项目、发邀请、通知负责人，负责人不变、不新建", async () => {
    const x = await 现场();
    const r = await 作为(x.市场, () => 同号再次录入(x.市场, 好号(), { 入口: "手工建档", 渠道id: x.渠道老.id, 内容: "展会上又聊了一次" }));
    await 等通知推完();
    expect(r.走).toBe(true);
    if (!r.走) return;
    expect(r.邀请).toBe("发了");
    expect(r.反馈).toContain("小甲");
    expect(r.反馈).toContain("组员邀请");
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.project.count()).toBe(1);
    expect((await prisma.customer.findUnique({ where: { id: x.客户.id } }))?.salesOwnerId).toBe(x.负责人.id);
    expect((await prisma.project.findUnique({ where: { id: x.项目!.id } }))?.ownerId).toBe(x.负责人.id);
    const f = await prisma.followUp.findFirst({ where: { customerId: x.客户.id } });
    expect(f?.ownerId).toBe(x.市场.id);
    expect(f?.content).toContain("小丙");
    expect(f?.content).toContain("来源：展会");
    expect(f?.content).toContain("展会上又聊了一次");
    expect(await prisma.followUpProject.findFirst({ where: { followUpId: f!.id } })).toMatchObject({ projectId: x.项目!.id, node: 同号节点 });
    const 成员 = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId: x.项目!.id, userId: x.市场.id } } });
    expect(成员).toMatchObject({ inviteStatus: "INVITED", invitedById: null });
    expect((await 通知们(x.负责人.id)).filter((n) => n.kind === "撞号")).toHaveLength(1);
    expect((await 通知们(x.市场.id)).filter((n) => n.kind === "项目邀请")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { summary: { contains: "系统因撞号发出组员邀请" } } })).toBe(1);
    // 不替负责人续回收时钟
    expect((await prisma.customer.findUnique({ where: { id: x.客户.id } }))?.lastFollowAt).toBeNull();
    // 同意前邀请卡上写清是系统发的
    expect((await 待我回的邀请(x.市场 as never))[0]?.邀请人).toBe("系统（同号再次录入）");
  });

  it("销售录：同样走，邀请落到这位销售", async () => {
    const x = await 现场();
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档", 内容: "客户又打来了" }));
    expect(r.走 && r.邀请).toBe("发了");
    expect(await prisma.projectMember.count({ where: { userId: x.销售.id, inviteStatus: "INVITED" } })).toBe(1);
  });

  it("同来源：不标重点；不同来源：标重点并写明现有来源，详情条看得到", async () => {
    const x = await 现场();
    await 作为(x.市场, () => 同号再次录入(x.市场, 好号(), { 入口: "手工建档", 渠道id: x.渠道老.id }));
    const 同 = await prisma.followUp.findFirst({ where: { customerId: x.客户.id } });
    expect(同?.title).toBe("同号再次录入");
    expect(同?.content).not.toContain("重点关注");
    await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档", 渠道id: x.渠道新.id }));
    const 异 = await prisma.followUp.findFirst({ where: { customerId: x.客户.id, ownerId: x.销售.id } });
    expect(异?.title).toBe("同号再次录入（来源不同）");
    expect(异?.content).toContain("现有来源：展会");
    expect(异?.content).toContain("来源：转介绍");
    const 提醒 = await 同号提醒们(x.项目!.id);
    expect(提醒).toHaveLength(2);
    expect(提醒.find((t) => t.谁 === "小丁")?.重点).toBe(true);
    expect(提醒.find((t) => t.谁 === "小丁")?.摘要).toContain("重点关注");
    expect(提醒.find((t) => t.谁 === "小丙")?.重点).toBe(false);
    // 客户详情顶上同一条（11-03 B6-9）：传这位客户名下的几个项目，合起来取；空列表不查库
    expect((await 同号提醒们([x.项目!.id, "没这个项目"])).map((t) => t.id)).toEqual(提醒.map((t) => t.id));
    expect(await 同号提醒们([])).toEqual([]);
  });

  it("已是组员：写记录，不再邀请，不改成员状态", async () => {
    const x = await 现场();
    await prisma.projectMember.create({ data: { projectId: x.项目!.id, userId: x.销售.id, inviteStatus: "JOINED", invitedById: x.负责人.id } });
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }));
    await 等通知推完();
    expect(r.走 && r.邀请).toBe("已在组里");
    expect(r.走 && r.反馈).toContain("你已在项目组");
    expect(r.走 && r.反馈).not.toContain("组员邀请");
    expect(await prisma.projectMember.findFirst({ where: { userId: x.销售.id } })).toMatchObject({ inviteStatus: "JOINED", invitedById: x.负责人.id });
    expect((await 通知们(x.销售.id)).filter((n) => n.kind === "项目邀请")).toHaveLength(0);
    expect(await prisma.followUp.count({ where: { customerId: x.客户.id } })).toBe(1);
  });

  it("添加人就是负责人：写记录，不邀请、不通知自己", async () => {
    const x = await 现场();
    const r = await 作为(x.负责人, () => 同号再次录入(x.负责人, 好号(), { 入口: "手工建档", 内容: "我自己再记一笔" }));
    await 等通知推完();
    expect(r.走 && r.邀请).toBe("不用");
    expect(r.走 && r.反馈).toContain("你自己");
    expect(await prisma.projectMember.count()).toBe(0);
    expect(await 通知们(x.负责人.id)).toHaveLength(0);
    expect(await prisma.followUp.count({ where: { customerId: x.客户.id } })).toBe(1);
  });

  it("公海客户不走：什么都不写", async () => {
    const x = await 现场();
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    expect(await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }))).toMatchObject({ 走: false, 原因: "在公海" });
    expect(await 作为(x.销售, () => 同号可协同(好号()))).toBe(false);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
  });

  it("负责人停用不走；占位账号不走", async () => {
    const x = await 现场();
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: false } });
    expect(await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }))).toMatchObject({ 走: false, 原因: "负责人已停用" });
    await prisma.user.update({ where: { id: x.负责人.id }, data: { active: true, email: 无负责人占位邮箱 } });
    expect(await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }))).toMatchObject({ 走: false, 原因: "负责人是占位账号" });
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("重复点幂等：只一条记录、一个邀请、一条通知", async () => {
    const x = await 现场();
    const 一 = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档", 内容: "第一次" }));
    const 二 = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档", 内容: "第一次" }));
    await 等通知推完();
    expect(一.走 && 一.已记过).toBe(false);
    expect(二.走 && 二.已记过).toBe(true);
    expect(二.走 && 二.反馈).toContain("小甲");
    expect(await prisma.followUp.count({ where: { customerId: x.客户.id } })).toBe(1);
    expect(await prisma.projectMember.count({ where: { userId: x.销售.id } })).toBe(1);
    expect((await 通知们(x.负责人.id)).filter((n) => n.kind === "撞号")).toHaveLength(1);
    expect((await 通知们(x.销售.id)).filter((n) => n.kind === "项目邀请")).toHaveLength(1);
  });

  it("看不到客户时反馈不泄露客户名；看得到时带上", async () => {
    const x = await 现场();
    const 看不到 = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }));
    expect(看不到.走 && 看不到.反馈).toContain("小甲");
    expect(看不到.走 && 看不到.反馈).not.toContain("编的客户甲");
    expect(看不到.走 && 看不到.反馈).not.toContain("编的项目甲");
    expect((await 通知们(x.销售.id))[0]?.title ?? "").not.toContain("编的");

    // 11-04 起市场只看「自己负责」或「自己创建且不在公海」的客户（挂渠道负责人不再算）
    await prisma.customerCreator.create({ data: { customerId: x.客户.id, userId: x.市场.id } });
    const 看得到 = await 作为(x.市场, () => 同号再次录入(x.市场, 好号(), { 入口: "手工建档" }));
    expect(看得到.走 && 看得到.反馈).toContain("编的客户甲");
  });

  it("没有项目：只写客户沟通记录并通知负责人，不邀请", async () => {
    const x = await 现场({ 项目: false });
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }));
    await 等通知推完();
    expect(r.走 && r.项目id).toBeNull();
    expect(r.走 && r.反馈).toContain("客户沟通记录");
    expect(await prisma.followUpProject.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
    expect((await 通知们(x.负责人.id)).filter((n) => n.kind === "撞号")).toHaveLength(1);
  });

  it("多个项目选最近活跃的未结束项目", async () => {
    const x = await 现场();
    await prisma.project.update({ where: { id: x.项目!.id }, data: { updatedAt: new Date(Date.now() - 86_400_000) } });
    const 新 = await prisma.project.create({ data: { name: "编的项目乙", customerId: x.客户.id, ownerId: x.负责人.id, creatorId: x.负责人.id, phase: "线索", node: "潜客培育" } });
    await prisma.project.create({ data: { name: "编的项目丙", customerId: x.客户.id, ownerId: x.负责人.id, creatorId: x.负责人.id, phase: "线索", node: "潜客培育", result: "线索流失" } });
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }));
    expect(r.走 && r.项目id).toBe(新.id);
  });

  it("只读管理员不走", async () => {
    const x = await 现场();
    const 管 = await 人("adm1", "小戊", "admin");
    expect((await 作为(管, () => 同号再次录入(管, 好号(), { 入口: "手工建档" }))).走).toBe(false);
    expect(await prisma.followUp.count({ where: { customerId: x.客户.id } })).toBe(0);
  });

  it("组员级联看得到客户（V3.5.1），项目必填不误报「所属客户」（11-03 B6-1）", async () => {
    const x = await 现场();
    await prisma.projectMember.create({ data: { projectId: x.项目!.id, userId: x.市场.id, inviteStatus: "JOINED", invitedById: x.负责人.id } });
    const 行 = await prisma.project.findUniqueOrThrow({ where: { id: x.项目!.id } });
    const r = await 作为(x.市场, async () => ({
      见客户: await prisma.customer.findUnique({ where: { id: x.客户.id }, select: { id: true } }),
      数据: await 读必填数据(prisma, 行),
    }));
    expect(r.见客户?.id).toBe(x.客户.id); // V3.5.1：加入的项目挂的客户级联看得到（只读）
    expect(r.数据.有客户).toBe(true);
    expect(r.数据.客户.phone).toBe(号码);
  });

  it("组员直接在级联看到的客户下记沟通：拦下、说只能看，不说客户不在了（11-03 B5-6，V3.5.1）", async () => {
    const x = await 现场();
    await prisma.projectMember.create({ data: { projectId: x.项目!.id, userId: x.市场.id, inviteStatus: "JOINED", invitedById: x.负责人.id } });
    const r = await 作为(x.市场, () => saveFollowUp({ customerId: x.客户.id, type: "PHONE", content: "组员想记一条", status: "已完成", occurredAt: new Date().toISOString() }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).not.toContain("不在了");
    expect(r.error).toContain("只能看");
    expect(await prisma.followUp.count({ where: { customerId: x.客户.id } })).toBe(0);
    const 没了 = await 作为(x.市场, () => saveFollowUp({ customerId: "没有这个客户", type: "PHONE", content: "x", status: "已完成", occurredAt: new Date().toISOString() }));
    expect(!没了.ok && 没了.error).toContain("不在了");
  });
});

describe("入口", () => {
  it("新建线索撞号：不新建线索，来源和备注写进现有项目，反馈明确", async () => {
    const x = await 现场();
    const r = await 作为(x.市场, () => saveLead({ name: "再录一次", phone: 号码, email: "", contact: "", industry: "", source: "官网表单", status: "待跟进", remark: "官网又来询价", ownerId: "" } as never));
    expect(r).toMatchObject({ ok: false, 同号协同: true });
    expect(await prisma.lead.count()).toBe(0);
    const f = await prisma.followUp.findFirst({ where: { customerId: x.客户.id } });
    expect(f?.content).toContain("来源：官网表单");
    expect(f?.content).toContain("官网又来询价");
    expect(f?.title).toBe("同号再次录入（来源不同）");
  });

  it("新建线索没撞号：照常建", async () => {
    await 现场();
    const 新人 = await 人("mkt2", "小己", "channel_ops");
    const r = await 作为(新人, () => saveLead({ name: "新来的", phone: "13900139000", email: "", contact: "", industry: "", source: "官网表单", status: "待跟进", remark: "", ownerId: "" } as never));
    expect(r.ok).toBe(true);
    expect(await prisma.lead.count()).toBe(1);
  });

  const 客户输入 = (号: string, channelId: string | null, 负责人: string) => ({
    name: "再建一次", phone: 号, school: null, grade: null, major: null,
    followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: "这次备注",
    salesOwnerId: 负责人, channelId, referrerCustomerId: null,
  });

  it("手工新建客户撞号：不新建，写进现有项目，反馈给添加人", async () => {
    const x = await 现场();
    const r = await 作为(x.销售, () => saveCustomer({ ...客户输入(号码, x.渠道新.id, x.销售.id), 企业号码: { 类型: "手机号", 值: 号码 } } as never));
    expect(r).toMatchObject({ ok: false, 同号协同: true });
    expect(!r.ok && r.error).toContain("小甲");
    expect(!r.ok && r.error).not.toContain("编的客户甲");
    expect(await prisma.customer.count()).toBe(1);
    const f = await prisma.followUp.findFirst({ where: { customerId: x.客户.id } });
    expect(f?.title).toBe("同号再次录入（来源不同）");
    expect(f?.content).toContain("这次备注");
  });

  it("老表单（不带号码类型）撞号：一样不新建，写进现有项目", async () => {
    const x = await 现场();
    const r = await 作为(x.销售, () => saveCustomer(客户输入(号码, x.渠道新.id, x.销售.id) as never));
    expect(r).toMatchObject({ ok: false, 同号协同: true });
    expect(await prisma.customer.count()).toBe(1);
    expect((await prisma.followUp.findFirst({ where: { customerId: x.客户.id } }))?.title).toBe("同号再次录入（来源不同）");
    expect(await prisma.projectMember.count({ where: { userId: x.销售.id, inviteStatus: "INVITED" } })).toBe(1);
  });

  it("手工新建客户撞公海：走现有查重，不写记录", async () => {
    const x = await 现场();
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    const r = await 作为(x.销售, () => saveCustomer({ ...客户输入(号码, x.渠道新.id, x.销售.id), 企业号码: { 类型: "手机号", 值: 号码 } } as never));
    expect(r).not.toHaveProperty("同号协同");
    expect(r.ok).toBe(false);
    expect(await prisma.followUp.count()).toBe(0);
  });

  it("建档向导撞号：不建客户和项目，这次的跟进写进现有项目，负责人不变", async () => {
    const x = await 现场();
    const 输入 = {
      客户: { ...客户输入(号码, x.渠道新.id, x.市场.id), remark: null },
      联系人: { name: "编的联系人", position: "", phone: 号码 },
      项目: { name: "再来一期", amount: 0, currency: "CNY", ownerId: x.市场.id, 业务线: "内贸" },
      跟进: { type: "PHONE", content: "电话又聊了需求", occurredAt: "2026-11-02 10:00", 节点: "潜客培育", 明确回复: false },
    } as unknown as 建档向导输入;
    const r = await 作为(x.市场, () => 建档向导(输入));
    expect(r).toMatchObject({ ok: false, 同号协同: true });
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.project.count()).toBe(1);
    expect((await prisma.project.findUnique({ where: { id: x.项目!.id } }))?.ownerId).toBe(x.负责人.id);
    expect((await prisma.followUp.findFirst({ where: { customerId: x.客户.id } }))?.content).toContain("电话又聊了需求");
    expect(await prisma.projectMember.count({ where: { userId: x.市场.id, inviteStatus: "INVITED" } })).toBe(1);
  });

  it("AI 建档撞号：回卡的话不变，内容写进现有项目；铃铛只响一次，待办照建", async () => {
    const x = await 现场();
    const r = await 作为(x.销售, () => AI建档查重([{ 类型: "手机号", 值: 好号().值, 键: 好号().键 }], x.销售, { 入口: "AI建档", 来源: "朋友介绍", 内容: "卡上写的情况" }));
    await 等通知推完();
    expect(r).toBe(查重提示.AI建档重复("小甲"));
    expect((await prisma.followUp.findFirst({ where: { customerId: x.客户.id } }))?.content).toContain("卡上写的情况");
    expect((await 通知们(x.负责人.id)).filter((n) => n.kind === "撞号")).toHaveLength(1);
    expect(await prisma.task.count({ where: { customerId: x.客户.id, ownerId: x.负责人.id } })).toBe(1);
  });

  it("查号码：有人在跟才带可协同；公海不带", async () => {
    const x = await 现场();
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).toMatchObject({ ok: true, 状态: "重复", 可协同: true });
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).not.toHaveProperty("可协同");
  });

  it("查号码带上协同情况，向导按它说那段话：别人的项目 / 自己负责 / 已在组 / 没项目（11-03 B6-8 / B7-4）", async () => {
    const x = await 现场();
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).toMatchObject({ 协同: { 有项目: true, 自己负责: false, 已在组: false } });
    expect(await 作为(x.负责人, () => 查号码("手机号", 号码))).toMatchObject({ 协同: { 有项目: true, 自己负责: true } });
    await prisma.projectMember.create({ data: { projectId: x.项目!.id, userId: x.销售.id, inviteStatus: "JOINED" } });
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).toMatchObject({ 协同: { 有项目: true, 自己负责: false, 已在组: true } });
  });

  it("查重撞到自己退回公海的：带原负责人是我（向导不给打开它、去领取）；别人查不带（11-03 B7-3）", async () => {
    const x = await 现场();
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    expect(await 作为(x.负责人, () => 查号码("手机号", 号码))).toMatchObject({ 状态: "公海待捞", 原负责人是我: true });
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).not.toHaveProperty("原负责人是我");
    // 负责人不是我、但项目是我退的：同样领不回
    await prisma.project.update({ where: { id: x.项目!.id }, data: { pooledAt: new Date(), ownerId: "" } });
    await prisma.projectNodeLog.create({ data: { projectId: x.项目!.id, userId: x.销售.id, kind: "pool-release", fromOwnerId: x.销售.id, toPhase: "线索", toNode: "线索" } });
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).toMatchObject({ 状态: "公海待捞", 原负责人是我: true });
    expect(await 作为(x.市场, () => 查号码("手机号", 号码))).not.toHaveProperty("原负责人是我");
  });

  it("没项目的客户：协同情况说没项目（11-03 B6-8）", async () => {
    const x = await 现场({ 项目: false });
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).toMatchObject({ 可协同: true, 协同: { 有项目: false, 自己负责: false, 已在组: false } });
  });
});

describe("导入撞号只记备注", () => {
  it("写备注和来源，不邀请不通知；同来源只一条；公海不写", async () => {
    const x = await 现场();
    const 写 = () => prisma.$transaction((tx) => 同号只记备注(tx, { customerId: x.客户.id, 操作人: x.市场.id, 号: 好号(), 入口: "飞书" }));
    const id = await 写();
    await 等通知推完();
    expect(id).toBeTruthy();
    const f = await prisma.followUp.findUnique({ where: { id: id! } });
    expect(f?.content).toContain("来源：飞书");
    expect(f?.content).toContain("入口：飞书导入");
    expect(f?.title).toBe("同号再次录入");
    expect(await prisma.followUpProject.count({ where: { projectId: x.项目!.id, node: 同号节点 } })).toBe(1);
    expect(await prisma.projectMember.count()).toBe(0);
    expect(await prisma.entNotice.count()).toBe(0);
    expect(await 写()).toBeNull();
    expect(await prisma.followUp.count()).toBe(1);

    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    expect(await prisma.$transaction((tx) => 同号只记备注(tx, { customerId: x.客户.id, 操作人: x.市场.id, 号: 好号(), 入口: "钉钉" }))).toBeNull();
  });
});

describe("导入撞号的入口文字", () => {
  it("「Excel 导出」不拼成「Excel 导出导入」（11-03 B6-8）", async () => {
    const x = await 现场();
    const id = await prisma.$transaction((tx) => 同号只记备注(tx, { customerId: x.客户.id, 操作人: x.市场.id, 号: 好号(), 入口: "Excel 导出" }));
    const f = await prisma.followUp.findUniqueOrThrow({ where: { id: id! } });
    expect(f.content).toContain("入口：Excel 导入");
    expect(f.content).not.toContain("导出导入");
  });
});

describe("老 Excel 导入撞号", () => {
  const 表头 = ["姓名", "手机号", "来源"];
  const 方案 = async (数据: string[][]) => ({ 表头, 数据, 映射: 猜列(表头, 字段表(await getBusiness())), 重复行: "跳过" as const });

  it("有人在跟：整行跳过，不记备注、不写导入记录、不邀请不通知、不新建，已有客户不动（M-导入-29）", async () => {
    const x = await 现场();
    const 总 = await 人("boss1", "总管", "director");
    const 前 = await prisma.customer.findUniqueOrThrow({ where: { id: x.客户.id } });
    const r = await 作为(总, async () => 执行导入(await 方案([["再导一次", 号码, x.渠道新.name]]), "a.xlsx"));
    if (!r.ok) throw new Error(r.error);
    await 等通知推完();
    expect(r.新建).toBe(0);
    expect(r.跳过).toBe(1);
    expect(await prisma.customer.count()).toBe(1);
    expect(await prisma.followUp.count()).toBe(0);
    expect(await prisma.followUpProject.count()).toBe(0);
    expect(await prisma.importRow.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
    expect(await prisma.entNotice.count()).toBe(0);
    const 后 = await prisma.customer.findUniqueOrThrow({ where: { id: x.客户.id } });
    expect(后.remark).toBe(前.remark);
    expect(后.updatedAt).toEqual(前.updatedAt);
  });

  it("撞公海客户不记备注，照旧跳过", async () => {
    const x = await 现场();
    const 总 = await 人("boss1", "总管", "director");
    await prisma.customerPool.create({ data: { customerId: x.客户.id, reason: "手动", userId: x.负责人.id } });
    const r = await 作为(总, async () => 执行导入(await 方案([["再导一次", 号码, x.渠道新.name]]), "a.xlsx"));
    if (!r.ok) throw new Error(r.error);
    expect(await prisma.followUp.count()).toBe(0);
  });
});

describe("导入走完整流程", () => {
  const 线索表 = (行: string[][]) => ({ 名: "线索.xlsx", 实体: "lead", 表头: ["线索ID", "线索名称", "联系人", "电话", "负责人", "线索状态"], 行, 行号: 行.map((_, i) => i + 2), 提醒: [] });

  it("线索撞有人在跟的客户：已有项目多一条备注，不发邀请不通知、不续最近跟进；整批撤回一起退", async () => {
    const x = await 现场();
    const 操作人 = { id: "imp1", name: "导入员" };
    await prisma.user.create({ data: { id: 操作人.id, email: "imp@x.test", name: 操作人.name, title: "", role: "ADMIN", password: "x" } });
    const { 批次Id } = await 试跑({ 来源: "excel", 用户Id: 操作人.id, 表: [线索表([["L1", "同号的线索", "编的联系人", 号码, "小甲", "待跟进"]])] as never, 建议器: null });
    await 定这批业务线(批次Id, "外贸");
    expect((await 写一批(批次Id, 操作人)).完了).toBe(true);
    await 等通知推完();

    const 备注 = await prisma.followUpProject.findFirst({ where: { projectId: x.项目!.id, node: 同号节点 }, include: { followUp: true } });
    expect(备注?.followUp.content).toContain("来源：Excel");
    expect(await prisma.projectMember.count()).toBe(0);
    expect(await prisma.entNotice.count({ where: { kind: "撞号" } })).toBe(0);
    expect((await prisma.customer.findUnique({ where: { id: x.客户.id } }))?.lastFollowAt).toBeNull();

    await 撤回一批(批次Id, 操作人);
    expect(await prisma.followUpProject.count({ where: { node: 同号节点 } })).toBe(0);
    expect(await prisma.customer.count({ where: { id: x.客户.id } })).toBe(1);
  });
});

describe("撞到待分配项目（X-87，P-挂靠-01）：按没有负责人处理", () => {
  /** 市场建的线索没分出去：客户和项目都还挂在建的人名下（占位），项目标了待分配 */
  async function 待分配现场() {
    const 建的人 = await 人("mkt9", "小庚", "channel_ops");
    const 市管 = await 人("mmgr9", "小辛", "marketing_mgr");
    const 销管 = await 人("smgr9", "小壬", "sales_mgr");
    const 销售 = await 人("sales9", "小癸", "sales");
    const 客户 = await prisma.customer.create({ data: { name: "编的客户庚", phone: 号码, salesOwnerId: 建的人.id } });
    const 项目 = await prisma.project.create({
      data: { name: "编的线索庚", customerId: 客户.id, ownerId: 建的人.id, creatorId: 建的人.id, phase: "线索", node: "潜客培育", awaitAssignAt: new Date() },
    });
    return { 建的人, 市管, 销管, 销售, 客户, 项目 };
  }

  it("记到客户上、通知能分配的人，不通知也不邀请占位的创建人，反馈不把创建人当负责人", async () => {
    const x = await 待分配现场();
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档", 内容: "又来问了" }));
    await 等通知推完();
    expect(r.走).toBe(true);
    if (!r.走) return;
    expect(r.项目id).toBeNull();
    expect(r.邀请).toBe("不用");
    expect(r.反馈).toContain("待分配");
    expect(r.反馈).not.toContain("小庚");
    const f = await prisma.followUp.findMany({ where: { customerId: x.客户.id } });
    expect(f).toHaveLength(1);
    expect(await prisma.followUpProject.count()).toBe(0);
    expect(await prisma.projectMember.count()).toBe(0);
    expect((await 通知们(x.建的人.id)).filter((n) => n.kind === "撞号")).toHaveLength(0);
    for (const 谁 of [x.市管, x.销管]) {
      const 发 = (await 通知们(谁.id)).filter((n) => n.kind === "撞号");
      expect(发).toHaveLength(1);
      expect(发[0].link).toBe(`/projects/${x.项目.id}`);
    }
    // 负责人、待分配都不动
    expect(await prisma.customer.findUnique({ where: { id: x.客户.id } })).toMatchObject({ salesOwnerId: x.建的人.id });
    expect((await prisma.project.findUnique({ where: { id: x.项目.id } }))?.awaitAssignAt).not.toBeNull();
  });

  it("能分配的人自己录：不给自己发", async () => {
    const x = await 待分配现场();
    const r = await 作为(x.销管, () => 同号再次录入(x.销管, 好号(), { 入口: "手工建档" }));
    await 等通知推完();
    expect(r.走).toBe(true);
    expect((await 通知们(x.销管.id)).filter((n) => n.kind === "撞号")).toHaveLength(0);
    expect((await 通知们(x.市管.id)).filter((n) => n.kind === "撞号")).toHaveLength(1);
  });

  it("查号码的协同情况带待分配，不算谁自己负责", async () => {
    const x = await 待分配现场();
    expect(await 作为(x.销售, () => 查号码("手机号", 号码))).toMatchObject({ 可协同: true, 协同: { 有项目: false, 自己负责: false, 已在组: false, 待分配: true } });
    expect(await 作为(x.建的人, () => 查号码("手机号", 号码))).toMatchObject({ 协同: { 有项目: false, 自己负责: false, 待分配: true } });
  });

  it("同一客户另有真人在跟的项目：照旧写进那个项目、邀请、通知那位负责人", async () => {
    const x = await 待分配现场();
    const 甲 = await 人("owner9", "小甲", "sales");
    const 真 = await prisma.project.create({ data: { name: "编的项目庚", customerId: x.客户.id, ownerId: 甲.id, creatorId: 甲.id, phase: "线索", node: "潜客培育" } });
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }));
    await 等通知推完();
    expect(r.走 && r.项目id).toBe(真.id);
    expect(r.走 && r.邀请).toBe("发了");
    expect((await 通知们(x.市管.id)).filter((n) => n.kind === "撞号")).toHaveLength(0);
  });

  it("客户负责人是另一位真人（不是占着待分配的建的人）：照旧按没项目通知客户负责人", async () => {
    const x = await 待分配现场();
    const 甲 = await 人("owner9", "小甲", "sales");
    await prisma.customer.update({ where: { id: x.客户.id }, data: { salesOwnerId: 甲.id } });
    const r = await 作为(x.销售, () => 同号再次录入(x.销售, 好号(), { 入口: "手工建档" }));
    await 等通知推完();
    expect(r.走 && r.反馈).toContain("小甲");
    expect((await 通知们(甲.id)).filter((n) => n.kind === "撞号")).toHaveLength(1);
    expect((await 通知们(x.市管.id)).filter((n) => n.kind === "撞号")).toHaveLength(0);
  });
});
