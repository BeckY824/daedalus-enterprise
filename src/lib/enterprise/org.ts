/**
 * 企业版组织架构（2026-10-24）：部门、业务角色、直属 / 虚线上级、下属。
 *
 * 数据在租户库的 EntDept / EntMember（迁移 044）。团队版的同一套概念在控制库（lib/sync/dept-policy.ts），
 * 角色取值、部门层数沿用那边的，规则不另起一套。
 *
 * 纯函数在 org-core.ts（测试和 Prisma 那一层直接用），这里转出去；最下面几个 async 的从库里读——
 * 别的模块要「谁是他直属上级」只调那几个，别自己查表。
 * 只管「组织里谁是谁」；规则生不生效（企业版() && 规则开关）由调用方判断。
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "./switch";
import { 回收站副手键, 只看某人键, 系统管理员标记键, 填组织设置, 建组织, 管理员类别of, type 组织, type 管理员类别 as 类别 } from "./org-core";

export * from "./org-core";
// 部门树在 org-tree.ts（客户端组件也用，不能带 prisma）；这里转出去，服务端照旧从 org 拿
export { 部门树, type 组织部门 } from "./org-tree";

export { 回收站副手键, 只看某人键 } from "./org-core";

/** 从库里读整张组织表。二三十人的公司，一次全读比逐条查省事也更快。一次渲染里只读一遍（客户列表一页要问四五次），渲染外（动作、测试）照旧每次现读 */
export const 读组织 = cache(async (): Promise<组织> => {
  const [users, members, depts, 副手, 只看, 标记] = await Promise.all([
    prisma.user.findMany({ select: { id: true, role: true, active: true } }),
    prisma.entMember.findMany(),
    prisma.entDept.findMany({ select: { id: true, name: true, parentId: true, sort: true } }),
    prisma.setting.findUnique({ where: { key: 回收站副手键 }, select: { value: true } }),
    prisma.setting.findUnique({ where: { key: 只看某人键 }, select: { value: true } }),
    prisma.setting.findUnique({ where: { key: 系统管理员标记键 }, select: { value: true } }),
  ]);
  return 填组织设置(建组织(users, members, depts), 副手?.value, 只看?.value, 标记?.value ?? null);
});

// 类型和读库的函数同名（老写法），类型在这里再转一次
export type 管理员类别 = 类别;
export const 管理员类别 = async (userId: string): Promise<类别 | null> => 管理员类别of(await 读组织(), userId);

/** 判权限用的组织（permissions.ts 的 org 参数）：企业版读整张组织表；不是企业版 = null（走老规矩） */
export async function 权限组织(): Promise<组织 | null> {
  return 企业版() ? 读组织() : null;
}
