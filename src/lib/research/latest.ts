import { prisma } from "../prisma";
import { 背调标题前缀 } from "./report";

/** 上一次背调：时间线上「背调｜」开头的那条记录；没有是 null */
export type 最近背调结果 = { id: string; title: string; content: string; at: string } | null;

/**
 * 这位客户最近一次背调（不是 server action：客户详情页渲染时直接带下去，11-22 页面切换提速 C3；
 * 背调跑完要刷新时客户端照旧走 actions.ts 的 最近背调）。调的人自己先认过登录
 */
export async function 读最近背调(customerId: string): Promise<最近背调结果> {
  const f = await prisma.followUp.findFirst({
    where: { customerId, type: "OTHER", title: { startsWith: 背调标题前缀 } },
    orderBy: { occurredAt: "desc" },
    select: { id: true, title: true, content: true, occurredAt: true },
  });
  return f ? { id: f.id, title: f.title, content: f.content, at: f.occurredAt.toISOString() } : null;
}
