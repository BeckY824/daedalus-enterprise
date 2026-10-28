"use server";

import { prisma } from "@/lib/prisma";
import { createSession } from "@/lib/auth";
import { 演示切换 } from "@/lib/enterprise/demo-switch";
import type { LoginResult } from "./actions";

/**
 * 演示部署里不要密码、点谁就以谁的身份进（登录页的选人 + 左下角换人共用这一个）。
 * 开关（CRM_DEMO_SWITCH）关着时一律拒绝：正式部署里这个 action 照样能被 POST 到，挡在这里而不是只挡页面。
 */
export async function 演示登录(userId: string): Promise<LoginResult> {
  if (!演示切换()) return { ok: false, error: "这个部署没有开演示切换" };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, active: true } });
  if (!user || !user.active) return { ok: false, error: "这个人不在了或已停用，刷新一下再选" };
  await createSession(user.id);
  return { ok: true };
}
