/**
 * 某人的习惯沟通方式（读库那半，挑法在 lib/follow-habit.ts）：他自己记的最近 20 条沟通（任务、提醒、回收站里的不算），用得最多的那种。
 * 企业版只认现在字典里还启用着的方式；一条都没有回 null。
 * 表单走 follow-method-actions.ts 我常用的沟通方式（当前登录的人）；AI 记沟通卡在服务端按 ctx.userId 调这里（11-18）
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选项 } from "@/lib/enterprise/dict";
import { 挑常用方式, 看最近几条, type 一条方式 } from "@/lib/follow-habit";

export async function 常用沟通方式of(userId: string): Promise<一条方式 | null> {
  const 们 = await prisma.followUp.findMany({
    where: { ownerId: userId, deletedAt: null, type: { notIn: ["TASK", "REMIND"] } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 看最近几条,
    select: { type: true, method: true },
  });
  if (!企业版()) return 挑常用方式(们);
  const 启用 = new Set(await 可选项("followMethod"));
  return 挑常用方式(们, (x) => !!x.method && 启用.has(x.method));
}
