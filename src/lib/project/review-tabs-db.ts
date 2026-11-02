import { prisma } from "@/lib/prisma";
import { 跟进方式名 } from "@/lib/follow-method";
import { dayjs } from "@/lib/utils";
import {
  沟通条件, 夹页, 复盘列表每页,
  type 沟通段, type 沟通方式, type 复盘沟通,
} from "./review-tabs";
import { 公海无负责人 } from "./pool-owner";

/**
 * 复盘页「沟通」页签取数（P7 U-复盘-01；「卡点」11-01 起是三栏看板，取数在 lib/project/blocker.ts 卡点看板）。条件在 review-tabs.ts，这里只查库、排好、切一页。
 * 谁 = 看板的人 给的那一圈（只看了某个人 = [他]；总管理、管理员 = undefined）。
 */

const 名 = (u: { name: string | null; email: string } | null | undefined) => (u ? u.name || u.email : "—");

/** 沟通：项目负责人本人记在项目上的沟通，时间倒序；走带限定的 prisma（看得到哪些客户的沟通由那一层管） */
export async function 复盘沟通of(
  谁: readonly string[] | undefined,
  q: { 段: 沟通段; 方式?: 沟通方式 | ""; 页?: number; 每页?: number; now?: ReturnType<typeof dayjs> },
): Promise<复盘沟通> {
  const 每页 = q.每页 ?? 复盘列表每页;
  // 看全部时没有名单，取现有项目的全部负责人来配对（人数远不到参数上限）。公海项目 ownerId 是空串（没有负责人），不算一个负责人：
  // 没有哪条沟通的归属人是空串，放进名单也配不上，白占一个参数
  const 全部负责人 = 谁 ? [] : (await prisma.project.findMany({ where: { deletedAt: null, ownerId: { not: 公海无负责人 } }, distinct: ["ownerId"], select: { ownerId: true } })).map((p) => p.ownerId);
  const where = 沟通条件(谁, q.段, q.now ?? dayjs(), q.方式 ?? "", 全部负责人);
  const 总数 = await prisma.followUp.count({ where });
  const 页 = 夹页(q.页 ?? 1, 总数, 每页);
  if (!总数) return { 总数, 页, 行: [] };
  const 们 = await prisma.followUp.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    skip: (页 - 1) * 每页,
    take: 每页,
    select: {
      id: true, occurredAt: true, type: true, method: true, initiator: true, title: true, content: true,
      customer: { select: { name: true } },
      entMeta: { select: { code: true } },
      owner: { select: { name: true, email: true } },
      projectNode: { select: { node: true, project: { select: { id: true, name: true } } } },
    },
  });
  // 附件按沟通挂（Attachment.followUpId 没外键，只有索引），这一页的一次数
  const 附件数 = new Map(
    (await prisma.attachment.groupBy({ by: ["followUpId"], where: { followUpId: { in: 们.map((f) => f.id) } }, _count: { _all: true } }))
      .map((g) => [g.followUpId, g._count._all] as const),
  );
  return {
    总数,
    页,
    行: 们.flatMap((f) =>
      f.projectNode
        ? [{
            id: f.id, 时间: f.occurredAt.toISOString(), projectId: f.projectNode.project.id, 项目: f.projectNode.project.name,
            节点: f.projectNode.node, 客户: f.customer?.name ?? "—", 方式: 跟进方式名(f), 标题: f.title, 内容: f.content, 负责人: 名(f.owner),
            发起: f.initiator || null, 编号: f.entMeta?.code ?? null, 附件: 附件数.get(f.id) ?? 0,
          }]
        : [],
    ),
  };
}
