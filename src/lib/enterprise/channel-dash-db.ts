/**
 * 渠道看板的读库部分（11-03）：取项目（带创建时间、线索判定、节点日志）和投入（带日期），交给 channel-dash.ts 的 算看板底数。
 * 项目范围和渠道列表的统计是同一个条件（channel-stats-db.ts 的 渠道项目条件），也同样走带企业版范围扩展的 prisma，
 * 所以看板和列表数的是同一批项目。
 */
import { prisma } from "@/lib/prisma";
import { 项目算哪个渠道 } from "./channel-stats";
import { 渠道项目条件, 名单落点 } from "./channel-stats-db";
import { 算看板底数, 算公海底数, type 看板底数, type 看板区间, type 看板入池, type 公海底数, type 入池方式 } from "./channel-dash";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 离职理由们, 系统操作人, 拆退回原因 } from "./unified-pool";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";

/**
 * 区间 = 地址栏「自定义」那一段（日期段界() 算好的两个瞬间）；不带就只算三个预设档。
 * 看的人（11-11）：带了再分每条项目点进去在项目列表 / 公海页 / 两边都不列（名单落点，同渠道列表），TOP5 拆「列表里 N 条、另 M 条在公海」
 */
export async function 读看板底数(渠道ids: string[], 今: Date = new Date(), 区间?: 看板区间 | null, 看的人?: { id: string }): Promise<看板底数> {
  if (渠道ids.length === 0) return 算看板底数([], [], [], 今, 区间);
  const [项目们, 投入们, 落点] = await Promise.all([
    prisma.project.findMany({
      where: 渠道项目条件(渠道ids),
      select: {
        id: true, channelId: true, phase: true, result: true, amount: true, currency: true, createdAt: true,
        customer: { select: { channelId: true } },
        entLeadVerify: { select: { verdict: true } },
        // 不 orderBy（父行过千会让 Prisma 6.16 崩，见 channel-stats-db.ts）；起步要按时间排了取头一条（同列表），别的取最早一条
        logs: { where: { kind: "node" }, select: { fromPhase: true, toPhase: true, at: true } },
      },
    }),
    prisma.entChannelInvest.findMany({ where: { channelId: { in: 渠道ids } }, select: { channelId: true, amount: true, currency: true, date: true } }),
    名单落点(渠道ids, 看的人),
  ]);
  return 算看板底数(
    渠道ids,
    项目们.map((p) => ({
      channelId: 项目算哪个渠道(p.channelId, p.customer.channelId),
      phase: p.phase, result: p.result, amount: p.amount, currency: p.currency, createdAt: p.createdAt,
      判定: p.entLeadVerify?.verdict ?? null,
      起步: [...p.logs].sort((x, y) => x.at.getTime() - y.at.getTime()).find((l) => l.fromPhase === null)?.toPhase ?? "线索",
      节点们: p.logs.map((l) => ({ toPhase: l.toPhase, at: l.at })),
      ...(落点 ? { 名单: 落点.列表里.has(p.id) ? ("列表" as const) : 落点.公海里.has(p.id) ? ("公海" as const) : null } : {}),
    })),
    投入们,
    今,
    区间,
  );
}

/**
 * 进公海那一段的底数（11-04 P-界面-09，只给市场成员 / 市场管理）：圈 = 数谁创建的（市场成员 = 自己，市场管理 = 本人 + 实线下属）。
 * 归因按创建人，不按「我现在看得见」：分出去、进了公海的线索创建人本来就看不到了，所以几趟都走 看全部，只取数、不出明细。
 * 客户 11-05（X-10）：只数现在还在公海的（每条项目只拿它最近那回进公海，现在不在公海了就不算）；
 * 另数回收站（现在还在回收站里的项目）和验证判无效（线索验证最终判了无效、现在还是线索流失的）。
 * 分母「同期新建的线索」连回收站里的一起数：删了的也是这段时间建的，不然占比会超过 100%。
 * 口径见 channel-dash.ts 进公海那段注释
 */
export async function 读公海底数(渠道ids: string[], 圈: readonly string[], 今: Date = new Date(), 区间?: 看板区间 | null): Promise<公海底数> {
  if (渠道ids.length === 0 || 圈.length === 0) return 算公海底数([], [], [], 今, 区间);
  const 谁建的 = { creatorId: { in: [...圈] }, ...渠道项目条件(渠道ids) };
  const 渠道列 = { channelId: true, creatorId: true, customer: { select: { channelId: true } } } as const;
  const [线索们, 留痕们, 删了的, 验证们] = await 看全部(() => Promise.all([
    看已删(() => prisma.project.findMany({ where: 谁建的, select: { ...渠道列, createdAt: true } })),
    prisma.projectNodeLog.findMany({
      // 导入时没负责人直接落进公海的不算「进」。别写 NOT: { reason }：SQL 里 reason 空的那几条也会被一起滤掉
      // 只要现在还在公海的项目（pooledAt 有值）；回收站里的项目连它的留痕一起被软删扩展滤掉，另走下面那趟
      where: { kind: "pool-release", project: { ...谁建的, pooledAt: { not: null } }, OR: [{ reason: null }, { reason: { not: 无主入池理由 } }] },
      select: {
        projectId: true, at: true, userId: true, reason: true,
        project: { select: { ...渠道列, customer: { select: { channelId: true, poolInvalidAt: true } }, entLeadVerify: { select: { invalidReason: true } } } },
      },
    }),
    看已删(() => prisma.project.findMany({ where: { ...谁建的, deletedAt: { not: null } }, select: { id: true, deletedAt: true, ...渠道列 } })),
    prisma.entLeadVerify.findMany({
      // 判死时 verdict、finalResult 一起写成 无效线索、项目结局记 线索流失；后来被恢复（结局改了）就不算了
      where: { OR: [{ finalResult: "无效线索" }, { verdict: "无效线索" }], project: { ...谁建的, result: "线索流失", pooledAt: null } },
      select: { projectId: true, invalidReason: true, finalAt: true, reviewedAt: true, verifiedAt: true, updatedAt: true, project: { select: 渠道列 } },
    }),
  ]));
  // 每条项目只拿最近那回进公海：就是让它现在待在公海的那回（之前几回不算，不然出了公海又进来的会按老的那回落档）
  const 最近一回 = new Map<string, (typeof 留痕们)[number]>();
  for (const l of 留痕们) {
    const 旧 = 最近一回.get(l.projectId);
    if (!旧 || l.at.getTime() > 旧.at.getTime()) 最近一回.set(l.projectId, l);
  }
  const 入池们: 看板入池[] = [...最近一回.values()].map((l) => {
    const p = l.project;
    // 判无效 = 还在公海、客户被标了无效
    const 方式: 入池方式 = 离职理由们.includes(l.reason ?? "") ? "离职交接" : p.customer.poolInvalidAt ? "判无效" : l.userId === 系统操作人 ? "超时回收" : "被退回";
    return {
      projectId: l.projectId, channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), creatorId: p.creatorId, at: l.at, 方式,
      原因: 方式 === "被退回" ? 拆退回原因(l.reason) : 方式 === "判无效" ? p.entLeadVerify?.invalidReason?.trim() || null : null,
    };
  });
  for (const p of 删了的) {
    入池们.push({ projectId: p.id, channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), creatorId: p.creatorId, at: p.deletedAt!, 方式: "回收站", 原因: null });
  }
  for (const v of 验证们) {
    const p = v.project;
    入池们.push({
      projectId: v.projectId, channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), creatorId: p.creatorId,
      // 终判那一刻落档；市场复核 / 销售初判就判死的没有终判时间，按复核 / 初判时间
      at: v.finalAt ?? v.reviewedAt ?? v.verifiedAt ?? v.updatedAt, 方式: "验证判无效", 原因: v.invalidReason?.trim() || null,
    });
  }
  return 算公海底数(
    渠道ids,
    入池们,
    线索们.map((p) => ({ channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), creatorId: p.creatorId, createdAt: p.createdAt })),
    今,
    区间,
  );
}
