/**
 * 判无效原因（dt.invalid，P-界面-42）：项目页终止进程 / 改到线索流失时交「无效原因」，服务端用公海标无效同一个 选的原因("invalid") 核——
 * 不在字典里的、停用的、「其他」没写的拒；选中的合成「无效原因：X」+ 补充说明记进节点变更。不给照旧只用 备注
 */
import { it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "小王", email: "s1", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 终止项目进程, 改项目节点 } from "@/app/(app)/projects/actions";

let 项目: string;
beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  await setSetting("business", { projectMode: true });
  invalidateSettingsCache();
  const 我 = (await prisma.user.create({ data: { email: "s1", name: "小王", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: 我, bizRole: "sales" } });
  mocks.user = { ...mocks.user, id: 我 };
  const 客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "13800000001", salesOwnerId: 我 } })).id;
  项目 = (await prisma.project.create({ data: { name: "一号", customerId: 客户, ownerId: 我, creatorId: 我, phase: "线索", node: "潜客培育" } })).id;
});
const 最后一条 = () => prisma.projectNodeLog.findFirst({ where: { projectId: 项目 }, orderBy: { at: "desc" } });

it("不在无效原因字典里的：拒，项目不动", async () => {
  const r = await 终止项目进程(项目, { 无效原因: "随便写的" });
  expect(r).toMatchObject({ ok: false });
  expect((r as { error: string }).error).toContain("无效原因");
  expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目 } })).result).toBeNull();
});

it("选「其他」没写：拒；写了存成「其他：xxx」", async () => {
  expect(await 终止项目进程(项目, { 无效原因: "其他" })).toMatchObject({ ok: false });
  expect(await 终止项目进程(项目, { 无效原因: "其他：客户换了方向" })).toMatchObject({ ok: true });
  expect((await 最后一条())?.reason).toContain("无效原因：其他：客户换了方向");
});

it("字典里启用的：通过，节点变更记「无效原因：X」；改项目节点那条路同一个核法", async () => {
  expect(await 终止项目进程(项目, { 无效原因: "需求不存在" })).toMatchObject({ ok: true });
  expect((await prisma.project.findUniqueOrThrow({ where: { id: 项目 } })).result).toBe("线索流失");
  expect((await 最后一条())?.reason).toContain("无效原因：需求不存在");
  expect(await 改项目节点(项目, { phase: "线索", node: "潜客培育", result: "线索流失" }, { 无效原因: "预算不足" })).toMatchObject({ ok: false });
});
