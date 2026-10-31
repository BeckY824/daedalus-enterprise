/**
 * 切换视图（M-权限-08，lib/enterprise/view-as.ts）在账号菜单里的那张名单：按业务角色分组列出全部在职的人（同演示换人的分组），
 * 总管理员先挑角色组、再挑组里的人。只有总管理员拿得到；演示部署（CRM_DEMO_SWITCH=1）那边已经有「切换身份」，这里不再给一张。
 */
import { 企业版 } from "./switch";
import { 演示切换, 分组演示名单, type 演示组 } from "./demo-switch";
import { 能切换视图 } from "./view-as";
import { multiTenant } from "@/lib/tenant/context";
import { 本地模式 } from "@/lib/desktop/cloud";
import type { SessionUser } from "@/lib/auth";

/** 这个部署有没有切换视图：企业版、自部署（不是托管版、不是桌面端） */
export function 有切换视图(): boolean {
  return 企业版() && !multiTenant() && !本地模式();
}

/**
 * 名单：user 是 getCurrentUser() 回的人——切换中是被看的人（带 视图由 = 真身，getCurrentUser 已核过真身还是总管理员）。
 * 不能切的回 null，调用方据此什么都不画。名单里不列真身自己（回自己 = 点顶上的「退出」）
 */
export async function 读视图名单(user: SessionUser): Promise<演示组[] | null> {
  if (!有切换视图() || 演示切换() || user.accountId) return null;
  const [{ prisma }, { 读组织 }] = await Promise.all([import("@/lib/prisma"), import("./org")]);
  const org = await 读组织();
  const 真 = user.视图由?.id ?? user.id;
  if (!user.视图由 && !能切换视图(org, user.role, user.id)) return null;
  const 人们 = await prisma.user.findMany({
    where: { active: true, id: { not: 真 } },
    select: { id: true, name: true, email: true, title: true },
    orderBy: { createdAt: "asc" },
  });
  return 分组演示名单(人们, org);
}
