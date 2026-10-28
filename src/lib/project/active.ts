import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";

/**
 * 「在推」的项目：没结局、不在公海。记跟进挂项目（customers/[id]/actions.ts 的 挂项目）、
 * 客户页记跟进的项目下拉（RecordView 的 在推项目）、AI 记跟进自动挂项目（dashboard/apply.ts）都认这一条
 */
export const 在推项目条件 = { result: null, pooledAt: null } satisfies Prisma.ProjectWhereInput;

/**
 * 这位客户名下当前这位看得到的在推项目，最近动过的排前面。
 * 走带限定的 prisma：看得到哪些由限定层（lib/team-scope.ts 的 看得到的项目）说了算，这里不另写一套规矩。
 * take 只是省事：判断「是不是只有一个」时取 2 个就够
 */
export async function 客户在推项目(customerId: string, take = 10) {
  return prisma.project.findMany({
    where: { customerId, ...在推项目条件 },
    orderBy: { updatedAt: "desc" },
    take,
    select: { id: true, name: true },
  });
}
