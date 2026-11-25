/**
 * [E-283] 项目详情交给界面的 能排下次回访（load.ts，审查补的服务端用例）：
 * 交付结清的项目上，能记售后回访的人里只有过得了 客户事项挡 的（客户负责人、这位客户下项目的负责人）才带；
 * 已进组的组员能记回访、不带（P-沟通-04 组员不能建计划），同 记项目沟通 事务里那道
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "QA", email: "qa-nv", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: (u: string) => { throw new Error(`REDIRECT:${u}`); } }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});
vi.mock("@/app/(app)/projects/[id]/ProjectDetail", () => ({ default: () => null }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 以谁的身份, 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 读项目详情 } from "@/app/(app)/projects/[id]/load";

afterAll(async () => { await prisma.$disconnect(); });

let 客户负责人: string, 项目负责人: string, 组员: string, 客户: string, 项目: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };
const 读 = async (id: string) => {
  当(id);
  忘掉企业版范围();
  const 载 = await 以谁的身份(id, () => 读项目详情(mocks.user as never, 项目));
  if (载.种 !== "有") throw new Error(`没给详情：${载.种}`);
  return 载.props.p;
};

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  const 人 = (email: string) => prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } }).then((u) => u.id);
  客户负责人 = await 人("nv-cust");
  项目负责人 = await 人("nv-proj");
  组员 = await 人("nv-member");
  await prisma.entMember.createMany({ data: [客户负责人, 项目负责人, 组员].map((userId) => ({ userId, bizRole: "sales" })) });
  客户 = (await prisma.customer.create({ data: { name: "客户乙", phone: "13800000002", salesOwnerId: 客户负责人 } })).id;
  项目 = (await prisma.project.create({ data: { name: "交付项目", customerId: 客户, ownerId: 项目负责人, creatorId: 项目负责人, phase: "订单", node: "交付", result: "交付结清" } })).id;
  // 客户负责人也进了组：看得到这个项目（企业版项目不跟客户走），能不能排只看 客户事项挡
  await prisma.projectMember.createMany({ data: [{ projectId: 项目, userId: 组员, inviteStatus: "JOINED" }, { projectId: 项目, userId: 客户负责人, inviteStatus: "JOINED" }] });
});

describe("[E-283] 项目详情 能排下次回访", () => {
  it("组员：能记售后回访、不带 能排下次回访", async () => {
    const p = await 读(组员);
    expect(p.能记售后回访).toBe(true);
    expect(p).not.toHaveProperty("能排下次回访");
  });

  it("客户负责人、项目负责人：都带", async () => {
    expect(await 读(客户负责人)).toMatchObject({ 能记售后回访: true, 能排下次回访: true });
    expect(await 读(项目负责人)).toMatchObject({ 能记售后回访: true, 能排下次回访: true });
  });

  it("客户转给组员后：原客户负责人（只剩组员身份）不带，接手的带", async () => {
    await prisma.customer.update({ where: { id: 客户 }, data: { salesOwnerId: 组员 } });
    expect(await 读(客户负责人)).not.toHaveProperty("能排下次回访");
    expect(await 读(组员)).toMatchObject({ 能排下次回访: true });
  });
});
