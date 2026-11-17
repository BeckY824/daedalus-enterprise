/**
 * 客户页记沟通挂项目的权限（X-143 11-15 → 11-17 客户定「沟通必须挂项目」改口径，lib/project/follow-needs-project.ts）。
 *   - 组员可记：别人名下的项目，已进组（JOINED）的组员能把沟通挂上去，记录的 ownerId 是记的人、项目负责人不变；
 *     只是被邀请（INVITED）、不在组里的不能挂，整条不存
 *   - 选的项目已结束 / 在公海 / 关联进来的（别的客户名下）：不存（X-144「照存客户沟通」作废），说清楚
 *   - 客户页「关联项目」下拉的来源（跟进去处们）：我负责的、我已进组的都标 能记=true，只是被邀请的 false
 */
import { it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { dayjs } from "@/lib/utils";
import { saveFollowUp, type FollowUpInput } from "@/app/(app)/customers/[id]/actions";
import { 跟进去处们 } from "@/lib/enterprise/customer-follow-feed";
import { 沟通不是组员话, 沟通项目已结束话, 沟通项目在公海话, 沟通项目不在话 } from "@/lib/project/follow-needs-project";

let 我: string, 同事: string, 客户: string, 别的客户: string;
const 项目 = (customerId: string, ownerId: string, 补: Record<string, unknown> = {}) =>
  prisma.project.create({ data: { name: "项目", customerId, ownerId, creatorId: ownerId, phase: "商机", node: "明确需求", ...补 } });
const 记 = (补: Partial<FollowUpInput> = {}) => saveFollowUp({
  customerId: 客户, type: "PHONE", content: "聊了报价", status: "已完成", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), ...补,
});
const 挂的 = () => prisma.followUpProject.count();

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  我 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  同事 = (await prisma.user.create({ data: { email: "s2", name: "小李", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.createMany({ data: [{ userId: 我, bizRole: "sales" }, { userId: 同事, bizRole: "sales" }] });
  mocks.user = { ...mocks.user, id: 我, role: "SALES" };
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 我 } })).id;
  别的客户 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 我 } })).id;
});

it("组员可记：项目是同事负责、我已进组——挂上，记录是我记的，项目负责人还是同事", async () => {
  const p = await 项目(客户, 同事);
  await prisma.projectMember.create({ data: { projectId: p.id, userId: 我, inviteStatus: "JOINED" } });
  const r = await 记({ projectId: p.id });
  expect(r).toMatchObject({ ok: true });
  const f = await prisma.followUp.findFirstOrThrow({ include: { projectNode: true } });
  expect(f.ownerId).toBe(我);
  expect(f.projectNode?.projectId).toBe(p.id);
  expect((await prisma.project.findUniqueOrThrow({ where: { id: p.id } })).ownerId).toBe(同事);
});

it("只是被邀请（还没进组）、不在组里：选同事的项目整条被拒，一条都不记", async () => {
  const 邀请中 = await 项目(客户, 同事, { name: "邀请中" });
  await prisma.projectMember.create({ data: { projectId: 邀请中.id, userId: 我, inviteStatus: "INVITED" } });
  const 不在组 = await 项目(客户, 同事, { name: "不在组" });
  for (const projectId of [邀请中.id, 不在组.id]) expect(await 记({ projectId })).toEqual({ ok: false, error: 沟通不是组员话 });
  expect(await prisma.followUp.count()).toBe(0);
  expect(await 挂的()).toBe(0);
});

it("下拉来源：我负责的、已进组的标 能记=true，只是被邀请的 false", async () => {
  const 进组 = await 项目(客户, 同事, { name: "同事的项目" });
  await prisma.projectMember.create({ data: { projectId: 进组.id, userId: 我, inviteStatus: "JOINED" } });
  const 邀请 = await 项目(客户, 同事, { name: "邀请中的项目" });
  await prisma.projectMember.create({ data: { projectId: 邀请.id, userId: 我, inviteStatus: "INVITED" } });
  await 项目(客户, 我, { name: "我的项目" });
  const 去处 = await 跟进去处们({ id: 我, role: "SALES" }, 客户, async (ids) => new Set(ids));
  const 按名 = Object.fromEntries(去处.map((x) => [x.名, x.能记]));
  expect(按名["我的项目"]).toBe(true);
  expect(按名["同事的项目"]).toBe(true);
  expect(按名["邀请中的项目"]).toBe(false);
});

it("我负责的在推项目：挂上", async () => {
  const p = await 项目(客户, 我);
  expect(await 记({ projectId: p.id })).toMatchObject({ ok: true });
  expect(await 挂的()).toBe(1);
});

it("已结束、在公海、关联进来的（别的客户名下）项目：不存，各说一句", async () => {
  const 结束 = await 项目(客户, 我, { result: "丢单" });
  const 公海 = await 项目(客户, 我, { pooledAt: new Date() });
  const 关联 = await 项目(别的客户, 我);
  await prisma.projectCustomer.create({ data: { projectId: 关联.id, customerId: 客户 } });
  expect(await 记({ projectId: 结束.id })).toEqual({ ok: false, error: 沟通项目已结束话 });
  expect(await 记({ projectId: 公海.id })).toEqual({ ok: false, error: 沟通项目在公海话 });
  expect(await 记({ projectId: 关联.id })).toEqual({ ok: false, error: 沟通项目不在话 });
  expect(await prisma.followUp.count()).toBe(0);
  expect(await 挂的()).toBe(0);
});
