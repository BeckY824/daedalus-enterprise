/**
 * 企业版选渠道用的清单（components/ChannelPicker.tsx 吃这个形状）：建档向导、项目编辑里选项目来源都从这拿。
 * 启用的在前、新建的在前（ChannelPicker 按出现顺序排三级）；停用的只带上「现在选着的那个」，编辑老项目时不把它的来源弄丢。
 * 「历史渠道」组（P-渠道-06）的渠道照样只带「现在选着的那个」：已启用但只承载历史客户，新数据不列。
 */
import { prisma } from "@/lib/prisma";
import type { 可选渠道 } from "@/components/ChannelPicker";
import { 在售渠道条件 } from "@/lib/enterprise/channel-main";
import { 是历史渠道 } from "@/lib/enterprise/channel-main-core";

export async function 可选渠道们(选着?: string | null): Promise<可选渠道[]> {
  return prisma.channel.findMany({
    where: { OR: [{ active: true, ...在售渠道条件 }, ...(选着 ? [{ id: 选着 }] : [])] },
    select: { id: true, name: true, attr: true, platform: true, active: true },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
}

/** 列表「客户来源 / 渠道」筛选的选项：老客户、老项目还挂着停用的渠道，所以停用的也给（排在后面、标出来）；历史渠道照样能筛，标「（历史渠道）」 */
export async function 渠道筛选选项(): Promise<{ value: string; label: string }[]> {
  const 们 = await prisma.channel.findMany({
    select: { id: true, name: true, active: true, main: { select: { category: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return 们.map((c) => ({ value: c.id, label: !c.active ? `${c.name}（已停用）` : 是历史渠道(c.main?.category) ? `${c.name}（历史渠道）` : c.name }));
}
