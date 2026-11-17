/**
 * 企业版选渠道用的清单（components/ChannelPicker.tsx 吃这个形状）：建档向导、项目编辑里选项目来源都从这拿。
 * 启用的在前、新建的在前（ChannelPicker 按出现顺序排三级）；停用的只带上「现在选着的那个」，编辑老项目时不把它的来源弄丢。
 * 「历史渠道」组（P-渠道-06）的渠道照样只带「现在选着的那个」：已启用但只承载历史客户，新数据不列。
 * 主渠道停用的（P-渠道-13），下面的子渠道也一样只带「现在选着的那个」，标「（已停用）」（带主属性 里 active 换成 渠道启用）。
 * 子渠道自己没填渠道属性的，带主渠道的（P-渠道-11，带主属性；只读时带出，不回写）。
 * 只有主渠道、一个子渠道都没有的（在售、启用）也各列一行占位（id =「main:主渠道 id」），选了它存的时候自动落成子渠道名留空的那条渠道。
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { 可选渠道 } from "@/components/ChannelPicker";
import { 可选渠道条件, 主渠道入口们, 来源选项列, 带主属性 } from "@/lib/enterprise/channel-main";
import { 是历史渠道, 渠道启用 } from "@/lib/enterprise/channel-main-core";

export async function 可选渠道们(选着?: string | null): Promise<可选渠道[]> {
  const 们 = 带主属性(await prisma.channel.findMany({
    where: { OR: [可选渠道条件, ...(选着 ? [{ id: 选着 }] : [])] },
    select: 来源选项列,
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  }));
  // 只有主渠道（没有子渠道）的接在后面：占位行，存的时候才落成渠道（channel-main.ts 落到渠道）
  return [...们, ...(await 主渠道入口们())];
}

/** 列表「客户来源 / 渠道」筛选的选项：老客户、老项目还挂着停用的渠道，所以停用的也给（排在后面、标出来）；历史渠道照样能筛，标「（历史渠道）」 */
/*
  同一个请求里只取一次（React cache，11-15）：客户页看板视图里客户页筛选行、看板那块（lib/project/list.ts）各要一份，
  原来两句 SQL、RSC 里两份一样的清单；同一个数组对象 RSC 只传一次
*/
export const 渠道筛选选项 = cache(async function 渠道筛选选项(): Promise<{ value: string; label: string }[]> {
  const 们 = await prisma.channel.findMany({
    select: { id: true, name: true, active: true, main: { select: { category: true, active: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  // 停用按 渠道启用（P-渠道-13）：主渠道停了的也标「（已停用）」、排到后面，和渠道页、来源下拉对得上
  const 行们 = 们.map((c) => ({ c, 启用: 渠道启用(c) }));
  行们.sort((a, b) => Number(b.启用) - Number(a.启用));
  return 行们.map(({ c, 启用 }) => ({ value: c.id, label: !启用 ? `${c.name}（已停用）` : 是历史渠道(c.main?.category) ? `${c.name}（历史渠道）` : c.name }));
});
