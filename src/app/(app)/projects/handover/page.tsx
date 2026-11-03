import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能改后台设置, 只读角色, 是总管理 } from "@/lib/enterprise/permissions";
import { 当前是共享区 } from "@/lib/shared-ws/current";
import { 读离职交接 } from "@/lib/enterprise/offboard-handover";
import { 公海分配候选 } from "@/lib/owners";
import HandoverView from "./HandoverView";

export const dynamic = "force-dynamic";

/**
 * 「项目 → 离职交接」（11-03 B7-2）：已离职成员名下还没交走的客户（开了项目模式再加项目），
 * 他的直属上级或系统管理员给每条选接手人，或一键全部交给一个人。只在企业版有；没开项目模式也有（只列客户）。
 * 只读管理员、共享区、不是谁的直属上级的普通成员没有这一页。上级在这里还能给直属下属办离职（设置页只给系统管理员，11-03 D3-1）
 */
export default async function HandoverPage() {
  const me = await requireUser();
  if (!企业版()) notFound();
  const org = await 权限组织();
  if (!org || 只读角色(me, org) || (await 当前是共享区())) notFound();
  const 系统管理员 = 能改后台设置(me, org);
  // 不是系统管理员、也不是谁的手填直属上级（在职离职都算）：这一页跟他没关系，直接打网址也 404
  if (!系统管理员 && !(await prisma.entMember.count({ where: { managerId: me.id, userId: { not: me.id } } }))) notFound();
  const [人们, 候选, 项目模式, 下属] = await Promise.all([
    读离职交接(me),
    公海分配候选(me),
    getBusiness().then((b) => b.projectMode === true),
    // 系统管理员在设置 → 成员里办离职；别人在这里给手填直属上级是自己的在职下属办（总管理不让上级办，同 能办离职）
    系统管理员
      ? Promise.resolve([])
      : prisma.entMember
          .findMany({ where: { managerId: me.id }, select: { userId: true } })
          .then((ms) => prisma.user.findMany({ where: { active: true, id: { in: ms.map((m) => m.userId) } }, select: { id: true, name: true }, orderBy: { name: "asc" } })),
  ]);
  return (
    <HandoverView
      人们={人们}
      候选={候选.map((u) => ({ id: u.id, name: u.name }))}
      项目模式={项目模式}
      系统管理员={系统管理员}
      下属={下属.filter((u) => u.id !== me.id && !是总管理({ id: u.id, role: "" }, org))}
    />
  );
}
