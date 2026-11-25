/**
 * 企业版客户页记跟进挂项目（10-27 会议：「默认自动关联当前项目」，customers/[id]/actions.ts saveFollowUp 的 projectId）。
 * 钉的是：新建时给了 projectId 就挂上，和项目页记的沟通一样有沟通编号、阶段标记（明确回复记「否」）；
 * 11-17 沟通必须挂项目：已结束的、在公海的、别的客户的项目不存（不再存成客户沟通）；没给时只有一个在推项目就挂它；
 * 编辑不挂（老的客户沟通照旧能改）；不是企业版一律不挂。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null },
  企业版: true,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => mocks.企业版 }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { saveFollowUp, type FollowUpInput } from "@/app/(app)/customers/[id]/actions";

let 销售: string, 客户: string, 别的客户: string;
const 项目 = (customerId: string, 补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: "项目", customerId, ownerId: 销售, creatorId: 销售, phase: "商机", node: "明确需求", ...补 } });
const 记 = (补: Partial<FollowUpInput> = {}) => saveFollowUp({
  customerId: 客户, type: "PHONE", content: "聊了报价", status: "已完成", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), ...补,
});
const 挂了 = async (followUpId: string) => ({
  挂: await prisma.followUpProject.findUnique({ where: { followUpId } }),
  编号: await prisma.entFollowUpMeta.findUnique({ where: { followUpId } }),
  标记: await prisma.entFollowUpMark.findUnique({ where: { followUpId } }),
});
const 最新跟进 = async () => (await prisma.followUp.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).id;

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.企业版 = true;
  销售 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  mocks.user = { ...mocks.user, id: 销售, role: "SALES" };
  // 11-01 起权限只认业务角色：挂项目和项目详情记沟通同一条「能管项目」（X-143），负责人得是销售
  await prisma.entMember.create({ data: { userId: 销售, bizRole: "sales" } });
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 销售 } })).id;
  别的客户 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 销售 } })).id;
});

it("给了在推的项目：挂上，记下当时节点，有沟通编号和阶段标记（明确回复记否）", async () => {
  const p = await 项目(客户);
  expect(await 记({ projectId: p.id })).toMatchObject({ ok: true });
  const r = await 挂了(await 最新跟进());
  // 项目库里存的旧名 明确需求，挂的时候写新名
  expect(r.挂).toMatchObject({ projectId: p.id, node: "痛点挖掘" });
  expect(r.编号?.projectId).toBe(p.id);
  expect(r.编号?.code).toBeTruthy();
  expect(r.标记).toMatchObject({ projectId: p.id, phase: "商机", replied: false });
});

it("已结束的、在公海的、别的客户的、不存在的项目：整条不存（11-17 不再存成客户沟通）", async () => {
  const 结束 = await 项目(客户, { result: "丢单" });
  const 公海 = await 项目(客户, { pooledAt: new Date() });
  const 别人 = await 项目(别的客户);
  for (const projectId of [结束.id, 公海.id, 别人.id, "不存在"]) {
    expect(await 记({ projectId })).toMatchObject({ ok: false });
  }
  expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(0);
});

it("没给、给 null：只有一个在推项目就挂它", async () => {
  const p = await 项目(客户);
  for (const 补 of [{}, { projectId: null }]) {
    expect(await 记(补)).toMatchObject({ ok: true });
    expect((await 挂了(await 最新跟进())).挂?.projectId).toBe(p.id);
  }
});

it("编辑时带 projectId 也不挂（老的客户沟通照旧能改）", async () => {
  const p = await 项目(客户);
  // 11-17 之前记下的、没挂项目的客户沟通
  const id = (await prisma.followUp.create({ data: { title: "", customerId: 客户, type: "PHONE", content: "老沟通", status: "已完成", occurredAt: new Date(), ownerId: 销售 } })).id;
  const 原 = await prisma.followUp.findUniqueOrThrow({ where: { id } });
  // M-权限-09 原口径（11-09）：改沟通只给身为负责人的管理；11-01 权限只认业务角色
  await prisma.entMember.upsert({ where: { userId: 销售 }, create: { userId: 销售, bizRole: "sales_mgr" }, update: { bizRole: "sales_mgr" } });
  expect(await 记({ id, projectId: p.id, content: "改一下内容", 版本: 原.updatedAt.toISOString() })).toMatchObject({ ok: true });
  expect((await prisma.followUp.findUniqueOrThrow({ where: { id } })).content).toBe("改一下内容");
  expect(await 挂了(id)).toEqual({ 挂: null, 编号: null, 标记: null });
});

describe("开关关闭", () => {
  beforeEach(() => { mocks.企业版 = false; });
  it("给了 projectId 也不挂", async () => {
    const p = await 项目(客户);
    expect(await 记({ projectId: p.id })).toMatchObject({ ok: true });
    expect(await 挂了(await 最新跟进())).toEqual({ 挂: null, 编号: null, 标记: null });
  });
});
