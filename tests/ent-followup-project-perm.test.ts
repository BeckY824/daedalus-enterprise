/**
 * 客户页记沟通挂项目的两处修复（总表 X-143 / X-144，用户 11-15 定，PR7b dt.follownp）。
 *   X-143：挂项目和项目详情记沟通同一条「能管这个项目」——客户负责人只是同事项目的组员时，选那个项目整条被拒、一条都不记；
 *          客户页「关联项目」下拉的来源（跟进去处们）给这种项目标 能记=false
 *   X-144：选的项目已结束 / 在公海 / 关联进来的：照旧存成客户沟通，返回里多一个 没挂上项目（前端说一句）；挂上了不带
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
import { 不能挂项目话 } from "@/lib/enterprise/follow-perm";

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

it("X-143：客户是我的、项目是同事负责、我只是组员——选它记沟通被拒，一条都不记、不挂", async () => {
  const p = await 项目(客户, 同事);
  await prisma.projectMember.create({ data: { projectId: p.id, userId: 我, inviteStatus: "JOINED" } });
  const r = await 记({ projectId: p.id });
  expect(r).toEqual({ ok: false, error: 不能挂项目话 });
  expect(await prisma.followUp.count()).toBe(0);
  expect(await 挂的()).toBe(0);
});

it("X-143：下拉来源给同事负责的项目标 能记=false，我负责的标 true", async () => {
  const 同事的 = await 项目(客户, 同事, { name: "同事的项目" });
  await prisma.projectMember.create({ data: { projectId: 同事的.id, userId: 我, inviteStatus: "JOINED" } });
  await 项目(客户, 我, { name: "我的项目" });
  const 去处 = await 跟进去处们({ id: 我, role: "SALES" }, 客户, async (ids) => new Set(ids));
  const 按名 = Object.fromEntries(去处.map((x) => [x.名, x.能记]));
  expect(按名["我的项目"]).toBe(true);
  // 组员看得到、只能看不能记
  expect(按名["同事的项目"]).toBe(false);
});

it("X-144：我负责的在推项目挂上，返回里不带「没挂上项目」", async () => {
  const p = await 项目(客户, 我);
  const r = await 记({ projectId: p.id });
  expect(r).toMatchObject({ ok: true });
  expect(r).not.toHaveProperty("没挂上项目");
  expect(await 挂的()).toBe(1);
});

it("X-144：已结束、在公海、别的客户（关联进来的）项目：照存成客户沟通，返回带「没挂上项目」", async () => {
  const 结束 = await 项目(客户, 我, { result: "丢单" });
  const 公海 = await 项目(客户, 我, { pooledAt: new Date() });
  const 关联 = await 项目(别的客户, 我);
  await prisma.projectCustomer.create({ data: { projectId: 关联.id, customerId: 客户 } });
  for (const projectId of [结束.id, 公海.id, 关联.id]) {
    expect(await 记({ projectId })).toMatchObject({ ok: true, 没挂上项目: true });
  }
  expect(await prisma.followUp.count({ where: { customerId: 客户 } })).toBe(3);
  expect(await 挂的()).toBe(0);
});

it("没选项目：不带「没挂上项目」", async () => {
  const r = await 记();
  expect(r).toMatchObject({ ok: true });
  expect(r).not.toHaveProperty("没挂上项目");
});
