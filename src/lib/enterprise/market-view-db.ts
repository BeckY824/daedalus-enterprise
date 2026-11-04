/** 市场视角的读库部分：认人、圈、等我拍板的市场复核。规矩在 market-view.ts */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import { 读市场成员们 } from "./market-db";
import { 管理员类别们of, type 组织 } from "./org-core";
import { 市场视角of, 市场圈, 市场挡详情, type 市场视角 } from "./market-view";
import { 无效交给 } from "@/lib/project/lead-verify";

export type 市场身份 = { 视角: 市场视角; 圈: string[]; org: 组织; 成员集: Set<string> };

/** 这个人在项目页 / 渠道看板算哪种市场视角；不是企业版、不是市场角色 = null */
export const 读市场身份 = cache(async (我: string): Promise<市场身份 | null> => {
  if (!企业版()) return null;
  const org = await 读组织();
  const 成员集 = await 读市场成员们(org);
  const 视角 = 市场视角of(org, 我, 成员集);
  return 视角 ? { 视角, 圈: 市场圈(org, 我, 视角), org, 成员集 } : null;
});

/** 等「市场复核」、我是市场管理能拍板的那几条（只看进度的例外：复核要进详情） */
export async function 等我复核的(我: string, org: 组织, projectIds?: string[]): Promise<Set<string>> {
  // 规则关了「市场复核」或没有市场管理时，存着的「市场复核」实际按总管理终判走（lead-verify.ts 实际待），不给例外
  if (!管理员类别们of(org, 我).has("市场管理") || (await 无效交给(org)) !== "市场复核") return new Set();
  const 行 = await 看全部(() => prisma.entLeadVerify.findMany({
    where: { pending: "市场复核", ...(projectIds ? { projectId: { in: projectIds } } : {}), project: { pooledAt: null, result: null } },
    select: { projectId: true },
  }));
  return new Set(行.map((v) => v.projectId));
}

/**
 * 详情页、收藏、搜索、提醒链接问：这条我（市场视角）是不是只能在列表看进度、不能进详情。不是市场视角 = false。
 * p 不传就自己查（负责人、公海、我是不是已加入）
 */
export async function 市场进不了详情(我: string, projectId: string, p?: { ownerId: string; pooledAt: Date | null; 已加入?: readonly string[] }): Promise<boolean> {
  const 身份 = await 读市场身份(我);
  if (!身份) return false;
  const 项 = p ?? await 看全部(async () => {
    const r = await prisma.project.findUnique({
      where: { id: projectId },
      select: { ownerId: true, pooledAt: true, members: { where: { userId: 我, inviteStatus: "JOINED" }, select: { userId: true } } },
    });
    return r ? { ownerId: r.ownerId, pooledAt: r.pooledAt, 已加入: r.members.map((m) => m.userId) } : null;
  });
  if (!项) return false;
  const 复核 = (await 等我复核的(我, 身份.org, [projectId])).has(projectId);
  return 市场挡详情(身份.org, 我, 身份.成员集, 项, 复核);
}

/** 一批项目里哪些我（市场视角）进不了详情：搜索结果、提醒、收藏一次筛完 */
export async function 市场进不了详情的(我: string, projectIds: string[]): Promise<Set<string>> {
  const 身份 = await 读市场身份(我);
  if (!身份 || !projectIds.length) return new Set();
  const ids = [...new Set(projectIds)];
  const [行, 复核] = await Promise.all([
    看全部(() => prisma.project.findMany({
      where: { id: { in: ids } },
      select: { id: true, ownerId: true, pooledAt: true, members: { where: { userId: 我, inviteStatus: "JOINED" }, select: { userId: true } } },
    })),
    等我复核的(我, 身份.org, ids),
  ]);
  const out = new Set<string>();
  for (const r of 行) {
    if (市场挡详情(身份.org, 我, 身份.成员集, { ownerId: r.ownerId, pooledAt: r.pooledAt, 已加入: r.members.map((m) => m.userId) }, 复核.has(r.id))) out.add(r.id);
  }
  return out;
}
