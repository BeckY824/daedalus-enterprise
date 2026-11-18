/**
 * 问数据的取数：把受限的 QuerySpec 变成 Prisma 查询并聚合。
 * 报表页的「问数据」和首页的 agent 工具共用。模型永远碰不到数据库，
 * 能查什么在 report-query.ts 里白纸黑字。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "./prisma";
import { 签约归属人 } from "./contract-owner";
import { 带币种, 签约币种, 签约金额 } from "./money-db";
import { dayjs } from "./utils";
import { FOLLOW_TYPE_MAP } from "./constants";
import { sumRows, rateRows, bucketMonth, type QuerySpec, type ResultRow, type GroupBy } from "./report-query";
import type { BusinessConfig } from "./business-config";
import { statusLabel } from "./business-config";
import { 企业版只用项目 } from "./enterprise/project-only";
import { 项目算哪个渠道 } from "./enterprise/channel-stats";
import { 不算补建, 留痕不算历史分析, 并条件 } from "./project/system-created";

function dateWhere(field: string, spec: QuerySpec) {
  const cond: Record<string, Date> = {};
  if (spec.from) cond.gte = dayjs(spec.from).startOf("day").toDate();
  const now = new Date();
  cond.lte = spec.to ? new Date(Math.min(dayjs(spec.to).endOf("day").valueOf(), now.getTime())) : now;
  return Object.keys(cond).length ? { [field]: cond } : {};
}

/** 归组 key/label。key 用 id（姓名可重复，按名归组会把两个人加进同一行） */
function keyOf(groupBy: GroupBy | null, when: Date, dims: Record<string, { id: string; label: string } | string | null>) {
  if (groupBy === "month") {
    const m = bucketMonth(when);
    return { key: m, label: m };
  }
  const d = groupBy ? dims[groupBy] : null;
  if (groupBy && (d == null || d === "")) return { key: "__none__", label: "未填/未分配" };
  if (typeof d === "string") return { key: d, label: d };
  if (d) return { key: d.id, label: d.label };
  return { key: "__all__", label: "全部" };
}

export async function runQuery(spec: QuerySpec, b: BusinessConfig, customerWhere?: Prisma.CustomerWhereInput): Promise<ResultRow[]> {
  const byMonth = spec.groupBy === "month";

  // 企业版只用项目：老的线索表、合同表没有数据（10-26「线索、商机、订单都是项目的阶段」），线索、签约改按项目数（审核 11-18 统计 P1-2）
  if ((spec.metric === "leads_count" || spec.metric === "lead_conversion" || spec.metric === "contract_amount" || spec.metric === "contract_count") && (await 企业版只用项目())) {
    return 企业版按项目(spec, customerWhere);
  }

  if (spec.metric === "leads_count" || spec.metric === "lead_conversion") {
    const leads = await prisma.lead.findMany({
      where: dateWhere("createdAt", spec),
      select: { createdAt: true, source: true, status: true, owner: { select: { id: true, name: true } } },
    });
    const shaped = leads.map((l) => ({
      ...keyOf(spec.groupBy, l.createdAt, { source: l.source, sales: l.owner ? { id: l.owner.id, label: l.owner.name } : null }),
      converted: l.status === "已转化" ? 1 : 0,
    }));
    if (spec.metric === "leads_count") return sumRows(shaped.map((s) => ({ key: s.key, label: s.label, value: 1 })), { byMonth });
    return rateRows(shaped.map((s) => ({ key: s.key, label: s.label, created: 1, converted: s.converted })), { byMonth });
  }

  if (spec.metric === "customers_count") {
    const customers = await prisma.customer.findMany({
      where: { AND: [dateWhere("createdAt", spec), ...(customerWhere ? [customerWhere] : [])] },
      select: { createdAt: true, grade: true, followStatus: true, decisionStatus: true, salesOwner: { select: { id: true, name: true } }, channel: { select: { id: true, name: true } } },
    });
    return sumRows(
      customers.map((c) => ({
        ...keyOf(spec.groupBy, c.createdAt, {
          sales: { id: c.salesOwner.id, label: c.salesOwner.name },
          channel: c.channel ? { id: c.channel.id, label: c.channel.name } : null,
          grade: c.grade,
          followStatus: statusLabel(b, c.followStatus),
          decisionStatus: statusLabel(b, c.decisionStatus),
        }),
        value: 1,
      })),
      { byMonth },
    );
  }

  if (spec.metric === "contract_amount" || spec.metric === "contract_count") {
    const contracts = await prisma.contract.findMany({
      where: { ...dateWhere("signedAt", spec), ...(customerWhere ? { customer: { is: customerWhere } } : {}) },
      select: {
        amount: true, signedAt: true,
        ...带币种.签约,
        owner: { select: { salesOwnerId: true, channelOwnerId: true } },
        customer: { select: { salesOwner: { select: { id: true, name: true, email: true } }, channel: { select: { id: true, name: true } } } },
      },
    });
    // 按销售拆时算在签约那一刻的负责人头上，和数据页同一份规则（排查 B2，lib/contract-owner.ts）
    const 归属 = await 签约归属人(contracts);
    // 金额按币种分行（不换汇）：同一个人签了美元也签了人民币，就是两行。只有一种币时行名不加后缀
    const 金额 = spec.metric === "contract_amount";
    const 多币 = 金额 && new Set(contracts.map(签约币种)).size > 1;
    return sumRows(
      contracts.map((c) => {
        const 销售 = 归属.销售(c);
        const k = keyOf(spec.groupBy, c.signedAt, {
          sales: 销售 ? { id: 销售.id, label: 销售.name } : null,
          channel: c.customer.channel ? { id: c.customer.channel.id, label: c.customer.channel.name } : null,
        });
        if (!金额) return { ...k, value: 1 };
        const 币 = 签约币种(c);
        return { key: `${k.key}|${币}`, label: 多币 ? `${k.label}（${币}）` : k.label, value: 签约金额(c), currency: 币 };
      }),
      { byMonth },
    );
  }

  const followUps = await prisma.followUp.findMany({
    where: { ...dateWhere("occurredAt", spec), ...(customerWhere ? { customer: { is: customerWhere } } : {}) },
    select: { occurredAt: true, type: true, owner: { select: { id: true, name: true } } },
  });
  return sumRows(
    followUps.map((f) => ({
      ...keyOf(spec.groupBy, f.occurredAt, { sales: { id: f.owner.id, label: f.owner.name }, type: FOLLOW_TYPE_MAP[f.type]?.label ?? f.type }),
      value: 1,
    })),
    { byMonth },
  );
}

/**
 * 企业版只用项目时，线索、签约四个指标按项目数（审核 11-18 统计 P1-2）。口径跟数据页（overview/project-stats.ts）、首页卡走：
 *   新增线索（leads_count）：这一段新建、从「线索」阶段起步的项目（建项目那条节点日志的 toPhase；没有日志的老项目当从线索起）。
 *     补建的、历史分析回填的不算（不算补建，同数据页「新建」）
 *   线索转化率（lead_conversion）：上面那批里现在已经进了商机 / 订单的（同数据页「线索转商机」：阶段不是线索、结局不是线索流失）
 *   签约单数 / 金额（contract_count / contract_amount）：这一段里从商机进订单的项目（ProjectNodeLog 商机 → 订单，
 *     同数据页「转订单」、首页「本月赢单」），一个项目只数一次、按第一次进订单的时间落段；金额取项目金额，按币种分行不换汇。
 *     历史分析回填的项目、回填留痕人写的留痕都不算（留痕不算历史分析，同数据页）
 * 按销售 = 项目现在的负责人（同数据页按人）；在公海的记「未填/未分配」。按渠道 / 线索来源 = 项目来源，没填的退回客户来源（渠道统计同一条）。
 * customerWhere（客户页带过来的筛选）按项目的客户筛
 */
async function 企业版按项目(spec: QuerySpec, customerWhere?: Prisma.CustomerWhereInput): Promise<ResultRow[]> {
  const byMonth = spec.groupBy === "month";
  const 客户筛 = customerWhere ? { customer: { is: customerWhere } } : undefined;
  const 项目选 = {
    id: true, ownerId: true, pooledAt: true, phase: true, result: true, amount: true, currency: true,
    channel: { select: { id: true, name: true } },
    customer: { select: { channel: { select: { id: true, name: true } } } },
  } as const;
  type 项目行 = { ownerId: string; pooledAt: Date | null; channel: { id: string; name: string } | null; customer: { channel: { id: string; name: string } | null } };
  const 名们 = async (ids: string[]) =>
    new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 维度 = (p: 项目行, 名: Map<string, string>) => {
    const chId = 项目算哪个渠道(p.channel?.id, p.customer.channel?.id);
    const ch = chId ? (p.channel?.id === chId ? p.channel : p.customer.channel) : null;
    const 渠道 = ch ? { id: ch.id, label: ch.name } : null;
    return { sales: p.pooledAt ? null : { id: p.ownerId, label: 名.get(p.ownerId) ?? "已不在的成员" }, channel: 渠道, source: 渠道 };
  };

  if (spec.metric === "leads_count" || spec.metric === "lead_conversion") {
    const 们 = await prisma.project.findMany({
      where: 并条件(dateWhere("createdAt", spec), 不算补建, 客户筛),
      select: { ...项目选, createdAt: true, logs: { where: { kind: "node", fromPhase: null }, select: { toPhase: true, at: true } } },
    });
    // 建项目那条日志的 toPhase = 起步阶段（channel-stats-db.ts 同一条）；没有的当从线索起
    const 起步 = (p: (typeof 们)[number]) => [...p.logs].sort((a, b) => a.at.getTime() - b.at.getTime())[0]?.toPhase ?? "线索";
    const 线索们 = 们.filter((p) => 起步(p) === "线索");
    const 名 = await 名们(线索们.map((p) => p.ownerId));
    const shaped = 线索们.map((p) => ({
      ...keyOf(spec.groupBy, p.createdAt, 维度(p, 名)),
      converted: p.phase !== "线索" && p.result !== "线索流失" ? 1 : 0,
    }));
    if (spec.metric === "leads_count") return sumRows(shaped.map((s) => ({ key: s.key, label: s.label, value: 1 })), { byMonth });
    return rateRows(shaped.map((s) => ({ key: s.key, label: s.label, created: 1, converted: s.converted })), { byMonth });
  }

  const 变 = await prisma.projectNodeLog.findMany({
    where: {
      kind: "node", fromPhase: "商机", toPhase: "订单", ...dateWhere("at", spec),
      userId: 留痕不算历史分析.userId,
      project: 并条件(留痕不算历史分析.project, 客户筛),
    },
    select: { at: true, project: { select: 项目选 } },
    orderBy: { at: "asc" },
  });
  // 一个项目只数一次，按这一段里第一次进订单落（同数据页 转订单）
  const 数过 = new Set<string>();
  const 单们 = 变.filter((l) => !数过.has(l.project.id) && !!数过.add(l.project.id));
  const 名 = await 名们(单们.map((l) => l.project.ownerId));
  const 金额 = spec.metric === "contract_amount";
  const 多币 = 金额 && new Set(单们.map((l) => l.project.currency)).size > 1;
  return sumRows(
    单们.map((l) => {
      const k = keyOf(spec.groupBy, l.at, 维度(l.project, 名));
      if (!金额) return { ...k, value: 1 };
      const 币 = l.project.currency;
      return { key: `${k.key}|${币}`, label: 多币 ? `${k.label}（${币}）` : k.label, value: l.project.amount, currency: 币 };
    }),
    { byMonth },
  );
}
