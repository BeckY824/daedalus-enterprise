import { prisma } from "./prisma";
import { 可选渠道条件, 主渠道入口们 } from "./enterprise/channel-main";
import { 企业版 } from "./enterprise/switch";

/**
 * 表单下拉里「选一个渠道 / 选一个客户」的候选。几张页面都要，口径放在一处：
 * 渠道只列在用的、不是「历史渠道」组的（P-渠道-06：只承载历史客户，新数据不选）、主渠道没停用的（P-渠道-13），按名字排；企业版里只有主渠道、没有子渠道的也各列一行；客户全列（排除自己，给「谁介绍来的」那种自引用用）。
 * 负责人候选规则多，单独在 owners.ts。
 */

export async function 可选渠道() {
  const 们 = await prisma.channel.findMany({ where: 可选渠道条件, select: { id: true, name: true, attr: true, platform: true, active: true }, orderBy: { name: "asc" } });
  // 企业版：只有主渠道（没有子渠道）的也能选，摆一行占位、存的时候才落成渠道（channel-main.ts 落到渠道）；一起按名字排
  if (!企业版()) return 们;
  return [...们, ...(await 主渠道入口们())].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function 可选客户(除了?: string) {
  return prisma.customer.findMany({
    where: 除了 ? { id: { not: 除了 } } : undefined,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * 地址栏 `?customer=<id>` 带过来的那一位（跟进 / 计划页「新建」时预填）。
 * 查不到就当没带：id 是地址栏里的，可能过期、可能被人改过，不能原样信
 */
export async function 带过来的客户(id: string | undefined): Promise<{ id: string; name: string } | null> {
  if (!id) return null;
  return prisma.customer.findUnique({ where: { id }, select: { id: true, name: true } });
}
