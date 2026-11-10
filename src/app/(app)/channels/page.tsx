import { 号码脱敏器 } from "@/lib/shared-ws/current";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import ChannelsView from "./ChannelsView";
import { 负责人候选 } from "@/lib/owners";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选项, 字典定义 } from "@/lib/enterprise/dict";
import { 读渠道统计 } from "@/lib/enterprise/channel-stats-db";
import { 读看板底数, 读公海底数 } from "@/lib/enterprise/channel-dash-db";
import { 读市场身份 } from "@/lib/enterprise/market-view-db";
import { 读日期段, 日期段界 } from "@/lib/custom-date-range";
import { 自定义 } from "@/lib/enterprise/channel-dash";
import { 能录投入, 能管渠道 } from "@/lib/enterprise/channel-stats";
import { 看全部, 系统写 } from "@/lib/team-scope";
import { 读组织 } from "@/lib/enterprise/org";
import { 补主渠道, 读主渠道们 } from "@/lib/enterprise/channel-main";
import { 读策略, 沿用主渠道属性 } from "@/lib/enterprise/channel-main-core";

export const dynamic = "force-dynamic";

// 老用例直接 Page() 调，不带 searchParams：当没选自定义
export default async function ChannelsPage({ searchParams }: { searchParams?: Promise<{ view?: string; from?: string; to?: string }> } = {}) {
  const me = await requireUser();
  // 看板的「自定义」（11-04 P-界面-10）：地址栏 view=自定义&from=&to=，读法同数据页（缺 / 错落到本月 1 号到今天，倒过来对调）
  const sp = (await searchParams) ?? {};
  const 段 = sp.view === 自定义 ? 读日期段(sp.from, sp.to) : null;
  const 区间 = 段 ? 日期段界(段) : null;
  const 市场 = 企业版() ? await 读市场身份(me.id) : null;
  // 渠道两层（11-08）：还没挂主渠道的渠道（老数据、导入、别处新建的）先按名字补挂上，补过的不再动。
  // 是系统补数据不是用户改：只读管理员打开也要能补，不然整页被只读拦挡掉
  if (企业版()) await 系统写(() => 补主渠道());

  const [channels, users] = await Promise.all([
    prisma.channel.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, phone: true, remark: true, active: true, createdAt: true, updatedAt: true,
        attr: true, platform: true, endDate: true, createdById: true,
        mainId: true, strategies: true,
        channelOwnerId: true,
        channelOwner: { select: { name: true } },
      },
    }),
    /*
      走 负责人候选()，不直接查「排除管理员」。
      「渠道负责人」是必填项，而刚开的工作区里只有一个人、那个人是管理员——
      直接用严格口径的话这个下拉是空的，于是**新建渠道这条路整个走不通**（2026-09-18 报上来的）。
      候选名单里留了「没有别人时列出全部在职成员」那条回退，见 lib/owners.ts。
    */
    负责人候选(),
  ]);

  /*
    统计一次读完（2026-10-29 渠道改版）：项目一趟、投入一趟，按渠道在内存里分组，
    口径全在 lib/enterprise/channel-stats.ts 的 算渠道统计。原来的转介绍链汇总、雷达整个不算了——
    企业版的渠道是预设的来源清单，没有推荐链。
    统计只数「我看得见的」项目（10-30 B2）：和客户列表同一套「按组织看客户」范围，见 channel-stats-db.ts 文件头
  */
  /*
    行上「⋯ → 删除」有没有关联数据（10-30 交互规则 A）：口径照 deleteChannel——名下客户（来源或归属落在这个渠道）、录过的投入，
    有就把删除项变灰、原因写在旁边，不等点了确认才说删不了。只读，删不删照旧由 deleteChannel 判
  */
  const 渠道ids = channels.map((c) => c.id);
  const [统计, 看板底数, 创建人们, 属性选项, 挂客户, 投入笔数, 挂项目, 能录, 能管, 公海底数, 圈里的人, 主渠道们, 策略选项] = await Promise.all([
    读渠道统计(channels),
    // 总览看板（11-03）：每个渠道 × 本月 / 本季 / 全部（带了「自定义」再加那一段）的底数，界面按列表的筛选结果再合，口径见 channel-dash.ts
    企业版() ? 读看板底数(渠道ids, new Date(), 区间) : Promise.resolve(null),
    prisma.user.findMany({
      where: { id: { in: [...new Set(channels.map((c) => c.createdById).filter((x): x is string => Boolean(x)))] } },
      select: { id: true, name: true },
    }),
    // 不是企业版（单测里）字典是空的，退回默认那五项，表单照样能选
    企业版() ? 可选项("channelAttr") : Promise.resolve([...字典定义.channelAttr.默认]),
    // 数全部客户（和 deleteChannel 一样不按「按组织看客户」限定），不然别人名下有客户的渠道删除项不变灰
    看全部(() => prisma.customer.findMany({
      where: { OR: [{ channelId: { not: null } }, { attributionChannelId: { not: null } }] },
      select: { channelId: true, attributionChannelId: true },
    })),
    prisma.entChannelInvest.groupBy({ by: ["channelId"], _count: { _all: true } }),
    // 项目来源挂在渠道上的项目（11-03 A1-1），同样数全部
    看全部(() => prisma.project.groupBy({ by: ["channelId"], where: { channelId: { not: null } }, _count: { _all: true } })),
    // 行上「录投入」给谁摆：和 挡投入 同一个口径
    (async () => (企业版() ? 能录投入(await 读组织(), me) : me.role === "ADMIN"))(),
    // 新建、编辑、停用、删除给谁摆（10-30 B1）：和 actions.ts 的 挡管 同一个口径；团队版照旧谁都摆
    (async () => !企业版() || 能管渠道(await 读组织(), me))(),
    // 进公海那一段（11-04 P-界面-09）：只给市场成员 / 市场管理，按创建人归
    市场 ? 读公海底数(渠道ids, 市场.圈, new Date(), 区间) : Promise.resolve(null),
    市场?.视角 === "市场管理" ? prisma.user.findMany({ where: { id: { in: 市场.圈 } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : Promise.resolve([]),
    企业版() ? 读主渠道们() : Promise.resolve([]),
    企业版() ? 可选项("channelStrategy") : Promise.resolve([] as string[]),
  ]);
  const 创建人 = new Map(创建人们.map((u) => [u.id, u.name]));
  const 客户数 = new Map<string, number>();
  for (const c of 挂客户) {
    // 来源和归属是同一个渠道的只算一位（deleteChannel 那条 OR 也是按人数）
    for (const id of new Set([c.channelId, c.attributionChannelId])) if (id) 客户数.set(id, (客户数.get(id) ?? 0) + 1);
  }
  const 投入数 = new Map(投入笔数.map((x) => [x.channelId, x._count._all]));
  const 项目数 = new Map(挂项目.map((x) => [x.channelId, x._count._all]));

  const 号 = await 号码脱敏器();
  return (
    <ChannelsView
      users={users}
      属性选项={属性选项}
      能录={能录}
      能管={能管}
      看板底数={看板底数}
      看板段={段}
      主渠道们={主渠道们}
      两层={企业版()}
      策略选项={策略选项}
      公海={市场 && 公海底数 ? { 底: 公海底数, 视角: 市场.视角, 创建人们: 圈里的人 } : null}
      // 子渠道自己没填属性的沿用主渠道的（迁移 118，P-渠道-11）：列表、属性筛选、看板「按属性分布」吃的都是沿用后的；只读时带出，不回写
      rows={沿用主渠道属性(channels, 主渠道们).map((c) => ({
        id: c.id,
        name: c.name,
        // 表单里不再问电话，编辑时原样交回去（打码的由 认回打码号 认回原号，不会被抹掉）
        phone: 号(c.phone),
        remark: c.remark,
        active: c.active,
        attr: c.attr,
        platform: c.platform,
        mainId: c.mainId,
        strategies: 读策略(c.strategies),
        endDate: c.endDate ? c.endDate.toISOString() : null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        createdByName: c.createdById ? 创建人.get(c.createdById) ?? null : null,
        channelOwnerId: c.channelOwnerId,
        channelOwnerName: c.channelOwner.name,
        统计: 统计[c.id],
        客户数: 客户数.get(c.id) ?? 0,
        投入数: 投入数.get(c.id) ?? 0,
        项目数: 项目数.get(c.id) ?? 0,
      }))}
    />
  );
}
