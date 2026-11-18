/**
 * 企业版首页右侧的四张指标卡（10-29 首页改版 #10 / 待 2）：口径全在这一个文件里，会上要改哪张就改这里。
 * 这里只拼条件、算日子，不碰 prisma（界面、单测都能直接引）；取数在 home-cards-db.ts，项目页筛选在 list.ts，
 * 两边都用这里的条件，所以卡上的数和点进 /projects?f=… 看到的行是同一批。
 *
 * **首页摆哪四张只看 首页摆的卡 这一个常量**（10-29 定稿：本月新增、重点项目、暂未跟进、即将逾期）。
 * 换别的只改那一行：取数（数首页卡）只数摆着的卡，没摆的卡项目页 ?f=… 照样能筛。
 * 数谁的（10-29 定稿）：当前账号能看的那一圈——业务员只数自己的；老板 / 总管理员数全员；别的上级数自己 + 直属和间接下属。
 * 这一圈和复盘页「全部」是同一个（board-member.ts 的 看板的人 的 谁），卡上的数和项目页 ?f=… 都按它筛负责人。
 *
 * 卡（URL 参数 f 的值 → 卡名 → 口径）：
 *   month-new  本月新增   这个月（北京时间自然月，1 号 0 点起）新建的项目，不管现在是否还在推、有没有结局；
 *                          补零项目客户的脚本补建的（creatorId = 补建创建人或 importBatch = 补建批次，createdAt = 客户建档时间）不算新建（system-created.ts）
 *   key        重点项目   在推的项目里，项目自己的级别（Project.level，迁移 093，界面显示成星级）是 重点级别（S / A）的。
 *                          项目标签字典里的「A 重点推进」就是项目级别 A；S 比 A 高一档，也算重点。不看客户级别
 *   no-follow  暂未跟进   在推的项目里，现负责人还没在这个项目上记过一条沟通的（挂在项目上、记录人是现负责人、没删的沟通一条都没有）。
 *                          11-18 审核 P1-1：建档的人（市场）向导里记的首条、换人之前原负责人记的，都不算现负责人跟进过——
 *                          卡按负责人数，员工读它是「我手上还没联系过的」。Prisma 比不了两张表的列，所以按负责人一路一路写（现负责人没记过沟通），
 *                          调用方要把这一圈负责人传进来（home-cards-db.ts 暂未跟进负责人们）。
 *                          例外（11-17）：补建的项目（老客户补的潜客培育）客户身上有过沟通就不算——导入的老客户沟通记在客户上、没挂项目，
 *                          补了项目不等于没人跟过。历史分析回填的（被人领走后还在推的）同样例外。别的项目照旧只看挂在项目上的沟通（客户名下另一个项目的沟通不算这个项目跟进过）
 *   due-soon   3 天内回公海（原叫即将逾期）  在推的线索 / 商机项目里，超时回收日在 即将逾期天数（3 天）以内的；
 *                          回收日和项目页「即将回收」标签同一套算法（timeout.ts 的 超时回收日），只是提前量从 1 天放到 3 天。
 *                          组织规则里「超时回收」没开 = 没有回收日 = 恒为 0
 *   month-won  本月赢单   这个月有一条「商机 → 订单」节点留痕的项目（ProjectNodeLog，和数据看板「转订单」同一口径）；不摆在首页，项目页能筛
 *
 * 「今日待办」不再是首页的卡（10-29 定稿）：今天 + 逾期的数只有一个，reminders-db.ts 的 数提醒——首页问候、左栏角标、Dock 都读它。
 *
 * 「在推」= 没结局、不在项目公海（active.ts 的 在推项目条件）。
 * 取数还是走带限定的 prisma（lib/team-scope.ts），上面那一圈是在它之上再按负责人筛（服务端兜底）。
 */
import type { Prisma } from "@/generated/prisma";
import { dayjs } from "@/lib/utils";
import type { 组织规则 } from "./org-rules";
import { 节点超时天数 } from "./timeout";
import { 同名们, type 阶段字典 } from "./stage-dict";
import { 不算补建, 补建的, 历史分析的 } from "./system-created";

const 有过沟通 = { followUps: { some: { deletedAt: null } } } satisfies Prisma.CustomerWhereInput;

/** 能当项目页筛选（/projects?f=…）的卡 */
export const 项目卡键们 = ["month-new", "key", "no-follow", "due-soon", "month-won"] as const;
export type 项目卡键 = (typeof 项目卡键们)[number];
/** 全部认得的卡（都是项目筛选） */
export const 首页卡键们 = 项目卡键们;
export type 首页卡键 = 项目卡键;

/** 首页右侧那一列摆哪几张、什么顺序。改主意只改这里（10-29 定稿） */
export const 首页摆的卡: readonly 首页卡键[] = ["month-new", "key", "no-follow", "due-soon"];

/**
 * 卡上的数字着什么色：soon 有数就标橙（还没过期、快要处理的），good 有数就标绿（正向 / 能直接动手的）；没写的只是个量。
 * 红色只留给已经过期的（10-30 交互审核），首页这几张都还没过期，所以没有红
 */
export const 首页卡色: Partial<Record<首页卡键, "good" | "soon">> = {
  "no-follow": "soon",
  "due-soon": "soon",
  "month-won": "good",
};

/** 摆着的卡各几个（home-cards-db.ts 的 数首页卡 给，首页右侧那一列画）；没摆的卡不数 */
export type 首页卡数 = Partial<Record<首页卡键, number>>;

/** 「重点项目」认的项目级别（Project.level，大写）：A =「A 重点推进」，S 比 A 高一档也算 */
export const 重点级别 = ["S", "A"] as const;

/** 「即将逾期」：回收日离今天还剩几天以内（含当天）。项目页「即将回收」标签是 1 天，这里放宽到 3 天 */
export const 即将逾期天数 = 3;

/** 卡名、项目页页头的「当前筛选」、卡下面那行口径小字 */
export const 首页卡口径: Record<首页卡键, { 名: string; 说明: string }> = {
  "month-new": { 名: "本月新增", 说明: "这个月新建的项目，含已结束" },
  key: { 名: "重点项目", 说明: `在推的项目里，项目级别是 ${重点级别.join(" / ")} 的` },
  "no-follow": { 名: "暂未跟进", 说明: "在推的项目里，负责人自己还没在项目上记过一条沟通的" },
  "due-soon": { 名: `${即将逾期天数} 天内回公海`, 说明: `在推的线索、商机项目里，${即将逾期天数} 天内会因为没沟通回公海的` },
  "month-won": { 名: "本月赢单", 说明: "这个月从商机转成订单的项目" },
};

/** 点卡去哪：项目页带上这张卡的筛选（列表按同一圈人筛，行数 = 卡上的数） */
export function 首页卡链接(键: 首页卡键): string {
  return `/projects?f=${键}`;
}

/** 地址栏里的 f：认得的卡原样给回，乱传、传数组、传老的 today-todo 都当没筛 */
export function 认首页卡(v: unknown): 项目卡键 | "" {
  return typeof v === "string" && (项目卡键们 as readonly string[]).includes(v) ? (v as 项目卡键) : "";
}

/** 本月起止（北京时间）：[起, 止) */
export function 本月起止(今: Date | string = new Date()): { 起: Date; 止: Date } {
  const 月初 = dayjs(今).startOf("month");
  return { 起: 月初.toDate(), 止: 月初.add(1, "month").toDate() };
}

export const 在推 = { result: null, pooledAt: null } satisfies Prisma.ProjectWhereInput;

/**
 * 「即将逾期」库里先粗筛：回收日 = 起点 + 节点天数（下一步时间只提醒、不收回，11-18），起点不早于建项目那天，
 * 所以回收日落在 今 + N 天以内，必然是「建项目不晚于 今 + N − 最短节点天数」。
 * 这是必要条件，不是充分条件——剩下的在 JS 里用 项目回收日 逐个算。超时回收没开 = null（一个都不会有）
 */
export function 即将逾期粗筛(规则: 组织规则, 字典: 阶段字典, 今: Date | string = new Date()): Prisma.ProjectWhereInput | null {
  const 线 = 逾期线(规则, 字典, 今);
  return 线 && { ...会逾期的, createdAt: { lt: 线.起点 } };
}

/** 两种筛共用的底：在推的线索 / 商机、客户不在客户公海、不在验证中 */
const 会逾期的 = {
  ...在推,
  phase: { in: ["线索", "商机"] },
  customer: { pool: { is: null } },
  // 验证中（等复核 / 等销售……）的线索不收回，也就不算 3 天内回公海（X-78，和 lib/project/db.ts 验证中不收 同一条；只有企业版有验证行）
  NOT: { entLeadVerify: { is: { pending: { not: null } } } },
} satisfies Prisma.ProjectWhereInput;

/**
 * 粗筛的线：建项目早于哪一刻才可能按天数到期（按全部节点里最短的天数）。
 * 超时回收没开、一个天数都没有 = null
 */
function 逾期线(规则: 组织规则, 字典: 阶段字典, 今: Date | string): { 起点: Date } | null {
  if (!规则.超时回收.开) return null;
  // 外贸那套单设的天数（C7）也算进最短，不然外贸项目时长更短时会被粗筛漏掉
  const 天数们 = [
    ...Object.keys(规则.超时回收.节点天数).map((n) => 节点超时天数(规则, n, 字典)),
    ...Object.keys(规则.超时回收.外贸节点天数 ?? {}).map((n) => 节点超时天数(规则, n, 字典, "外贸")),
    字典.默认超时天数,
  ].filter((d): d is number => !!d && d > 0);
  if (!天数们.length) return null;
  const 最短 = Math.min(...天数们);
  const 今天 = dayjs(今).startOf("day");
  return { 起点: 今天.add(即将逾期天数 - 最短 + 1, "day").toDate() };
}

/**
 * 比 即将逾期粗筛 再紧一层的必要条件（11-10，代码体检 P3）：首页卡「即将逾期」、复盘「将回公海」只数不列的用。
 * 粗筛只卡建项目那天、且按所有节点里最短的天数卡，开了超时回收后几乎每个在推项目都过得去，首页每次加载都把它们连客户、最近留痕取回来算一遍。
 * 回收日 = 起 + 节点天数（下一步时间只提醒、不收回，11-18），起 = max(建项目, 最近一条留痕, 客户最近跟进, 起算日)（timeout.ts 超时回收日 / 计时起点），所以回收日落在 今 + N 天以内，必然是：
 *   - 建项目、最近留痕、客户最近跟进三样都不晚于 今 + N − 这个节点的天数（粗筛只卡了第一样、天数用的是全部节点里最短的）；
 *     从起算日算、按这个节点的天数都到不了 N 天以内的，这一路一个都不会有
 * 仍是必要条件，取回来照旧用 项目回收日 逐个算，数出来的和粗筛一样（tests/ent-due-soon-prefilter.test.ts 两种筛对拍）。
 * 项目列表 f=due-soon 仍用粗筛（首页卡条件）：那边取到 500 条为止，换筛会改它满 500 时列出来的东西
 */
export function 即将逾期紧筛(规则: 组织规则, 字典: 阶段字典, 今: Date | string = new Date()): Prisma.ProjectWhereInput | null {
  const 线 = 逾期线(规则, 字典, 今);
  if (!线) return null;
  const 今天 = dayjs(今).startOf("day");
  const 算 = 规则.超时回收.起算日 ? dayjs(规则.超时回收.起算日).startOf("day") : null;
  const 起算 = 算 && 算.isValid() ? 算 : null;
  const 按天数: Prisma.ProjectWhereInput[] = [];
  for (const { 节点, 天数 } of 按天数的几路(规则, 字典)) {
    // 天数不是正数（存坏了，规整时本来就拦）：这一路不另卡，和粗筛一样只卡建项目那天
    if (天数 <= 0) { 按天数.push({ node: 节点, createdAt: { lt: 线.起点 } }); continue; }
    // 起点最早也是起算日：从起算日算、按这个天数都到不了 N 天以内，这一路就一个都没有
    if (起算 && !即将逾期(起算.add(天数, "day").format("YYYY-MM-DD"), 今)) continue;
    const 起点早于 = 今天.add(即将逾期天数 - 天数 + 1, "day").toDate();
    按天数.push({
      node: 节点,
      createdAt: { lt: 起点早于 },
      customer: { OR: [{ lastFollowAt: null }, { lastFollowAt: { lt: 起点早于 } }] },
      logs: { none: { at: { gte: 起点早于 } } },
    });
  }
  return { ...会逾期的, OR: 按天数 };
}

/**
 * 按天数到期分几路：天数一样的节点一路，没单设天数的节点（按字典默认）一路。
 * 一个节点内贸、外贸两套天数不一样时取短的（项目按哪条线算要看项目和负责人，库里不分，取短的不会漏）；
 * 节点名连旧名一起认（同 节点超时天数）；两套都没有天数、字典也没有默认的节点不会被收，不在任何一路里
 */
function 按天数的几路(规则: 组织规则, 字典: 阶段字典): { 节点: Prisma.StringFilter; 天数: number }[] {
  const 设了的 = [...new Set([...Object.keys(规则.超时回收.节点天数), ...Object.keys(规则.超时回收.外贸节点天数 ?? {})].flatMap(同名们))];
  const 路 = new Map<number, string[]>();
  for (const n of 设了的) {
    const 两套 = [节点超时天数(规则, n, 字典), 节点超时天数(规则, n, 字典, "外贸")].filter((d): d is number => d !== null);
    if (!两套.length) continue;
    const 天数 = Math.min(...两套);
    路.set(天数, [...(路.get(天数) ?? []), n]);
  }
  const 出: { 节点: Prisma.StringFilter; 天数: number }[] = [...路].map(([天数, 节点]) => ({ 节点: { in: 节点 }, 天数 }));
  if (字典.默认超时天数) 出.push({ 节点: { notIn: 设了的 }, 天数: 字典.默认超时天数 });
  return 出;
}

/** 回收日在 即将逾期天数 以内（含今天、含已过的——已过的夜扫 / 打开页面时会先收走） */
export function 即将逾期(回收日: string | null, 今: Date | string = new Date()): boolean {
  if (!回收日) return false;
  return dayjs(回收日).diff(dayjs(今).startOf("day"), "day") <= 即将逾期天数;
}

/**
 * 每张卡在库里的条件。即将逾期给的是粗筛（还要再用 即将逾期 过一遍）；
 * 超时回收没开时给一个查不出东西的条件，卡上是 0、项目页是空列表
 */
/**
 * 现负责人没在项目上记过沟通（暂未跟进的主体）：负责人们 = 要数的那一圈负责人，每人一路 ownerId = 他 且项目上没有他记的、没删的沟通。
 * 一个人都没有 = 查不出东西
 */
export function 现负责人没记过沟通(负责人们: readonly string[]): Prisma.ProjectWhereInput {
  const 们 = [...new Set(负责人们)];
  if (!们.length) return { id: { in: [] } };
  return { OR: 们.map((o) => ({ ownerId: o, followUps: { none: { followUp: { ownerId: o, deletedAt: null } } } })) };
}

/**
 * 负责人们：只有 no-follow 用（现负责人没记过沟通），不传就抛——这张卡不知道数谁就数不对。
 * 别的卡不看它
 */
export function 首页卡条件(键: 项目卡键, 规则: 组织规则, 字典: 阶段字典, 今: Date | string = new Date(), 负责人们?: readonly string[]): Prisma.ProjectWhereInput {
  switch (键) {
    case "month-new": {
      const { 起, 止 } = 本月起止(今);
      return { createdAt: { gte: 起, lt: 止 }, ...不算补建 };
    }
    case "key":
      return { ...在推, level: { in: [...重点级别] } };
    case "no-follow":
      // 补建的、历史分析回填的（客户身上就是那批旧沟通）：客户有过沟通就不算没跟进。分两条 NOT 写，历史分析的 用 null 安全的写法
      if (!负责人们) throw new Error("暂未跟进要传这一圈负责人（首页卡条件 第 5 个参数）");
      return { ...在推, AND: [现负责人没记过沟通(负责人们)], NOT: [{ ...补建的, customer: 有过沟通 }, { ...历史分析的, customer: 有过沟通 }] };
    case "due-soon":
      return 即将逾期粗筛(规则, 字典, 今) ?? { id: { in: [] } };
    case "month-won": {
      const { 起, 止 } = 本月起止(今);
      return { logs: { some: { kind: "node", fromPhase: "商机", toPhase: "订单", at: { gte: 起, lt: 止 } } } };
    }
  }
}
