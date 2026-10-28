/**
 * 企业版演示：免密选人登录 + 左下角按业务角色换人（10-28 用户：「左下角是身份，点击可以切换管理员，业务员包含已有的角色。
 * 登录不设密码。」「可以做放几个角色进去，因为不同角色会有不一样的权限以及界面」）。
 *
 * 给客户试用的演示服务器才开：CRM_DEMO_SWITCH=1，而且必须同时是企业版、自部署（不是托管版、不是桌面端）。
 * 开着等于**谁拿到地址谁就能以任何人（包括老板）身份进来**——正式部署永远不设。
 */
import { 企业版 } from "./switch";
import type { 组织 } from "./org";
import { multiTenant } from "@/lib/tenant/context";
import { 本地模式 } from "@/lib/desktop/cloud";
import { 业务角色 as 角色顺序, 角色名, type 业务角色 } from "@/lib/sync/dept-policy";
import { 同名带邮箱 } from "@/lib/utils";

export function 演示切换(): boolean {
  return process.env.CRM_DEMO_SWITCH === "1" && 企业版() && !multiTenant() && !本地模式();
}

export type 演示人 = {
  id: string;
  /** 同名的带登录名（两个王芳） */
  name: string;
  /** 部门 · 业务线 · 兼的角色 · 职位，有什么摆什么 */
  说明: string;
};
export type 演示组 = { 角色: 业务角色; 名: string; 人: 演示人[] };

/** 按主角色分组，组按业务角色的固定顺序（总管理在最前），空组不出；组里按传进来的顺序 */
export function 分组演示名单(
  人们: readonly { id: string; name: string; email: string; title: string | null }[],
  org: 组织,
): 演示组[] {
  const 在 = 人们.filter((u) => org.成员.has(u.id));
  const 叫 = 同名带邮箱(在);
  const 组 = new Map<业务角色, 演示人[]>();
  for (const u of 在) {
    const m = org.成员.get(u.id)!;
    const 兼 = m.角色们.filter((r) => r !== m.bizRole).map((r) => `兼${角色名[r]}`);
    const 说明 = [m.deptId ? org.部门.get(m.deptId)?.name : null, m.line, ...兼, u.title].filter(Boolean).join(" · ");
    组.set(m.bizRole, [...(组.get(m.bizRole) ?? []), { id: u.id, name: 叫.get(u.id)!, 说明 }]);
  }
  return 角色顺序.filter((r) => 组.has(r)).map((r) => ({ 角色: r, 名: 角色名[r], 人: 组.get(r)! }));
}

/** 开关关着返回 null：调用方据此什么都不画 */
export async function 读演示名单(): Promise<演示组[] | null> {
  if (!演示切换()) return null;
  /* 登录页也调它：库模块一 import 就开连接（lib/prisma.ts 的 PRAGMA），开关关着的登录页不能连库——
     网页版 E2E 先起服务、探活 /login，再删库重建，提前连上就整片登录失败（e2e/global-setup.ts 文件头） */
  const [{ prisma }, { 读组织 }] = await Promise.all([import("@/lib/prisma"), import("./org")]);
  const [人们, org] = await Promise.all([
    prisma.user.findMany({ where: { active: true }, select: { id: true, name: true, email: true, title: true }, orderBy: { createdAt: "asc" } }),
    读组织(),
  ]);
  return 分组演示名单(人们, org);
}
