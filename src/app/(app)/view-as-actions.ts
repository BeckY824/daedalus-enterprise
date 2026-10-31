"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getSessionUser, COOKIE_SECURE } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 企业版 } from "@/lib/enterprise/switch";
import { multiTenant } from "@/lib/tenant/context";
import { 读组织 } from "@/lib/enterprise/org";
import { 视图票, 视图小时, 签视图票, 能切换视图, 当前视图, 视图放行 } from "@/lib/enterprise/view-as";

export type 视图结果 = { ok: true } | { ok: false; error: string };

/**
 * 总管理员切换视图（M-权限-08，lib/enterprise/view-as.ts）：开始以某人的视图查看。
 * 认的是会话票上的真身（getSessionUser），不是 getCurrentUser——切换中再换一个人也按真身判。
 * 这个 action 谁都 POST 得到：不是总管理员一律拒，不靠界面藏入口
 */
export async function 开始视图(userId: string): Promise<视图结果> {
  if (!企业版() || multiTenant()) return { ok: false, error: "这个部署没有切换视图" };
  const 真 = await getSessionUser();
  if (!真) return { ok: false, error: "登录已过期，请重新登录" };
  if (!能切换视图(await 读组织(), 真.role, 真.id)) return { ok: false, error: "只有总管理员能切换视图" };
  if (userId === 真.id) return 退出视图();
  const t = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, active: true } });
  if (!t || !t.active) return { ok: false, error: "这个人不在了或已停用，刷新一下再选" };
  (await cookies()).set(视图票, await 签视图票(真.id, t.id), {
    httpOnly: true,
    sameSite: "lax",
    secure: COOKIE_SECURE,
    path: "/",
    maxAge: 视图小时 * 60 * 60,
  });
  await 视图放行(() =>
    recordAudit({ user: 真, action: "view-as", entity: "User", entityId: t.id, summary: `开始以「${t.name}」的视图查看（只读）` }),
  );
  return { ok: true };
}

/** 退出切换视图：删票、回到自己的身份，记一条留痕。没在切换也照样清一下票 */
export async function 退出视图(): Promise<视图结果> {
  const 在看 = await 当前视图();
  (await cookies()).delete(视图票);
  if (在看) {
    const [真, t] = await Promise.all([
      prisma.user.findUnique({ where: { id: 在看.由 }, select: { id: true, name: true } }),
      prisma.user.findUnique({ where: { id: 在看.谁 }, select: { name: true } }),
    ]);
    if (真) {
      await 视图放行(() =>
        recordAudit({ user: 真, action: "view-as-exit", entity: "User", entityId: 在看.谁, summary: `结束以「${t?.name ?? "（已删除）"}」的视图查看` }),
      );
    }
  }
  return { ok: true };
}
