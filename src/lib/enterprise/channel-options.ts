/**
 * 企业版选渠道用的清单（components/ChannelPicker.tsx 吃这个形状）：建档向导、项目编辑里选项目来源都从这拿。
 * 启用的在前、新建的在前（ChannelPicker 按出现顺序排三级）；停用的只带上「现在选着的那个」，编辑老项目时不把它的来源弄丢。
 */
import { prisma } from "@/lib/prisma";
import type { 可选渠道 } from "@/components/ChannelPicker";

export async function 可选渠道们(选着?: string | null): Promise<可选渠道[]> {
  return prisma.channel.findMany({
    where: { OR: [{ active: true }, ...(选着 ? [{ id: 选着 }] : [])] },
    select: { id: true, name: true, attr: true, platform: true, active: true },
    orderBy: [{ active: "desc" }, { createdAt: "desc" }],
  });
}

/** 列表「客户来源 / 渠道」筛选的选项：老客户、老项目还挂着停用的渠道，所以停用的也给（排在后面、标出来） */
export async function 渠道筛选选项(): Promise<{ value: string; label: string }[]> {
  const 们 = await prisma.channel.findMany({
    select: { id: true, name: true, active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return 们.map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name}（已停用）` }));
}
