import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 跟进方式名 } from "@/lib/follow-method";
import { dayjs } from "@/lib/utils";
import {
  卡点条件, 沟通条件, 夹页, 复盘列表每页,
  type 卡点筛, type 沟通段, type 复盘卡点, type 复盘沟通,
} from "./review-tabs";

/**
 * 复盘页「卡点」「沟通」页签取数（P7 U-复盘-01）。条件在 review-tabs.ts，这里只查库、排好、切一页。
 * 谁 = 看板的人 给的那一圈（只看了某个人 = [他]；老板、总管理员 = undefined）。
 */

const 名 = (u: { name: string | null; email: string } | null | undefined) => (u ? u.name || u.email : "—");

/**
 * 卡点：同 lib/project/blocker.ts，读包在 看全部 里、范围在 卡点条件 里明着查（卡点不跟互看放开，
 * 组员不一定看得到负责人的客户）。按发布时间倒序
 */
export async function 复盘卡点of(
  谁: readonly string[] | undefined,
  我: string,
  q: { 筛: 卡点筛; 页?: number; 每页?: number },
): Promise<复盘卡点> {
  if (!企业版()) return { 总数: 0, 页: 1, 行: [] };
  const 每页 = q.每页 ?? 复盘列表每页;
  const where = 卡点条件(谁, 我, q.筛);
  return 看全部(async () => {
    const 总数 = await prisma.entBlocker.count({ where });
    const 页 = 夹页(q.页 ?? 1, 总数, 每页);
    if (!总数) return { 总数, 页, 行: [] };
    const 们 = await prisma.entBlocker.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (页 - 1) * 每页,
      take: 每页,
      select: {
        id: true, code: true, projectId: true, type: true, impact: true, description: true, status: true, assigneeId: true, createdAt: true,
        project: { select: { name: true, ownerId: true, customer: { select: { name: true } } } },
      },
    });
    // 项目负责人、经手人的名字一次取（Project 上没有 owner 关联）
    const 人们 = [...new Set(们.flatMap((b) => [b.project.ownerId, b.assigneeId]).filter((x): x is string => !!x))];
    const us = await prisma.user.findMany({ where: { id: { in: 人们 } }, select: { id: true, name: true, email: true } });
    const 叫 = new Map(us.map((u) => [u.id, 名(u)]));
    return {
      总数,
      页,
      行: 们.map((b) => ({
        id: b.id, code: b.code, projectId: b.projectId, 项目: b.project.name, 客户: b.project.customer?.name ?? "—",
        type: b.type, impact: b.impact, description: b.description, status: b.status,
        负责人: 叫.get(b.project.ownerId) ?? "—", 经手人: b.assigneeId ? 叫.get(b.assigneeId) ?? "—" : null,
        createdAt: b.createdAt.toISOString(),
      })),
    };
  });
}

/** 沟通：项目上的沟通记录，时间倒序；走带限定的 prisma（看得到哪些客户的沟通由那一层管） */
export async function 复盘沟通of(
  谁: readonly string[] | undefined,
  q: { 段: 沟通段; 页?: number; 每页?: number; now?: ReturnType<typeof dayjs> },
): Promise<复盘沟通> {
  const 每页 = q.每页 ?? 复盘列表每页;
  const where = 沟通条件(谁, q.段, q.now ?? dayjs());
  const 总数 = await prisma.followUp.count({ where });
  const 页 = 夹页(q.页 ?? 1, 总数, 每页);
  if (!总数) return { 总数, 页, 行: [] };
  const 们 = await prisma.followUp.findMany({
    where,
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    skip: (页 - 1) * 每页,
    take: 每页,
    select: {
      id: true, occurredAt: true, type: true, method: true, title: true, content: true,
      customer: { select: { name: true } },
      owner: { select: { name: true, email: true } },
      projectNode: { select: { node: true, project: { select: { id: true, name: true } } } },
    },
  });
  return {
    总数,
    页,
    行: 们.flatMap((f) =>
      f.projectNode
        ? [{
            id: f.id, 时间: f.occurredAt.toISOString(), projectId: f.projectNode.project.id, 项目: f.projectNode.project.name,
            节点: f.projectNode.node, 客户: f.customer?.name ?? "—", 方式: 跟进方式名(f), 标题: f.title, 内容: f.content, 负责人: 名(f.owner),
          }]
        : [],
    ),
  };
}
