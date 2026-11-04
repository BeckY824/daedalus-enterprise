/**
 * 渠道看板的读库部分（11-03）：取项目（带创建时间、线索判定、节点日志）和投入（带日期），交给 channel-dash.ts 的 算看板底数。
 * 项目范围和渠道列表的统计是同一个条件（channel-stats-db.ts 的 渠道项目条件），也同样走带企业版范围扩展的 prisma，
 * 所以看板和列表数的是同一批项目。
 */
import { prisma } from "@/lib/prisma";
import { 项目算哪个渠道 } from "./channel-stats";
import { 渠道项目条件 } from "./channel-stats-db";
import { 算看板底数, 算公海底数, type 看板底数, type 看板区间, type 看板入池, type 公海底数, type 入池方式 } from "./channel-dash";
import { 看全部 } from "@/lib/team-scope";
import { 离职理由们, 系统操作人, 拆退回原因 } from "./unified-pool";
import { 无主入池理由 } from "@/lib/enterprise-import/project-target";

/** 区间 = 地址栏「自定义」那一段（日期段界() 算好的两个瞬间）；不带就只算三个预设档 */
export async function 读看板底数(渠道ids: string[], 今: Date = new Date(), 区间?: 看板区间 | null): Promise<看板底数> {
  if (渠道ids.length === 0) return 算看板底数([], [], [], 今, 区间);
  const [项目们, 投入们] = await Promise.all([
    prisma.project.findMany({
      where: 渠道项目条件(渠道ids),
      select: {
        channelId: true, phase: true, result: true, amount: true, currency: true, createdAt: true,
        customer: { select: { channelId: true } },
        entLeadVerify: { select: { verdict: true } },
        // 不 orderBy（父行过千会让 Prisma 6.16 崩，见 channel-stats-db.ts）；起步要按时间排了取头一条（同列表），别的取最早一条
        logs: { where: { kind: "node" }, select: { fromPhase: true, toPhase: true, at: true } },
      },
    }),
    prisma.entChannelInvest.findMany({ where: { channelId: { in: 渠道ids } }, select: { channelId: true, amount: true, currency: true, date: true } }),
  ]);
  return 算看板底数(
    渠道ids,
    项目们.map((p) => ({
      channelId: 项目算哪个渠道(p.channelId, p.customer.channelId),
      phase: p.phase, result: p.result, amount: p.amount, currency: p.currency, createdAt: p.createdAt,
      判定: p.entLeadVerify?.verdict ?? null,
      起步: [...p.logs].sort((x, y) => x.at.getTime() - y.at.getTime()).find((l) => l.fromPhase === null)?.toPhase ?? "线索",
      节点们: p.logs.map((l) => ({ toPhase: l.toPhase, at: l.at })),
    })),
    投入们,
    今,
    区间,
  );
}

/**
 * 进公海那一段的底数（11-04 P-界面-09，只给市场成员 / 市场管理）：圈 = 数谁创建的（市场成员 = 自己，市场管理 = 本人 + 实线下属）。
 * 归因按创建人，不按「我现在看得见」：分出去、进了公海的线索创建人本来就看不到了，所以两趟都走 看全部，只取数、不出明细。
 * 口径见 channel-dash.ts 进公海那段注释
 */
export async function 读公海底数(渠道ids: string[], 圈: readonly string[], 今: Date = new Date(), 区间?: 看板区间 | null): Promise<公海底数> {
  if (渠道ids.length === 0 || 圈.length === 0) return 算公海底数([], [], [], 今, 区间);
  const 谁建的 = { creatorId: { in: [...圈] }, ...渠道项目条件(渠道ids) };
  const [线索们, 留痕们] = await 看全部(() => Promise.all([
    prisma.project.findMany({ where: 谁建的, select: { channelId: true, creatorId: true, createdAt: true, customer: { select: { channelId: true } } } }),
    prisma.projectNodeLog.findMany({
      // 导入时没负责人直接落进公海的不算「进」。别写 NOT: { reason }：SQL 里 reason 空的那几条也会被一起滤掉
      where: { kind: "pool-release", project: 谁建的, OR: [{ reason: null }, { reason: { not: 无主入池理由 } }] },
      select: {
        projectId: true, at: true, userId: true, reason: true,
        project: { select: { channelId: true, creatorId: true, pooledAt: true, customer: { select: { channelId: true, poolInvalidAt: true } }, entLeadVerify: { select: { invalidReason: true } } } },
      },
    }),
  ]));
  // 判无效只认「还在公海、客户被标了无效」的那条项目最近一回进公海（之前几回照各自的方式）
  const 最近一回 = new Map<string, number>();
  for (const l of 留痕们) 最近一回.set(l.projectId, Math.max(最近一回.get(l.projectId) ?? 0, l.at.getTime()));
  const 入池们: 看板入池[] = 留痕们.map((l) => {
    const p = l.project;
    const 判无效 = !!p.pooledAt && !!p.customer.poolInvalidAt && 最近一回.get(l.projectId) === l.at.getTime();
    const 方式: 入池方式 = 离职理由们.includes(l.reason ?? "") ? "离职交接" : 判无效 ? "判无效" : l.userId === 系统操作人 ? "超时回收" : "被退回";
    return {
      projectId: l.projectId, channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), creatorId: p.creatorId, at: l.at, 方式,
      原因: 方式 === "被退回" ? 拆退回原因(l.reason) : 方式 === "判无效" ? p.entLeadVerify?.invalidReason?.trim() || null : null,
    };
  });
  return 算公海底数(
    渠道ids,
    入池们,
    线索们.map((p) => ({ channelId: 项目算哪个渠道(p.channelId, p.customer.channelId), creatorId: p.creatorId, createdAt: p.createdAt })),
    今,
    区间,
  );
}
