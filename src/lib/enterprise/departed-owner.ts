import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 无负责人占位邮箱 } from "@/lib/pool";

/**
 * 查重撞到的客户、负责人已经离职（11-03 C4-5）：离职不再进公海、名下原地不动，撞到的多半就是这种。
 * 叫人「找负责人」找不到，改成指他的直属上级（手填的 managerId，在职的才算）；没填上级或上级也走了，指系统管理员。
 * 返回该找谁的名字；负责人在职、找不到人、不是企业版 = null（照原来的说法）
 */
export async function 离职负责人找谁(ownerId: string | null | undefined): Promise<string | null> {
  if (!企业版() || !ownerId) return null;
  const u = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { active: true, email: true },
  });
  if (!u || u.active || u.email === 无负责人占位邮箱) return null;
  const m = await prisma.entMember.findUnique({ where: { userId: ownerId }, select: { managerId: true } });
  const 上级 = m?.managerId
    ? await prisma.user.findUnique({ where: { id: m.managerId }, select: { name: true, active: true } })
    : null;
  return 上级?.active ? 上级.name : "系统管理员";
}

/** 「负责人已离职，请联系 X」：查重提示、保存被拦那句共用 */
export const 离职负责人说法 = (找谁: string) => `负责人已离职，请联系 ${找谁}`;
