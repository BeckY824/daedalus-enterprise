/**
 * 企业版首页右侧的四张指标卡（10-29 首页改版 #10 / 待 2）：口径全在这一个文件里，会上要改哪张就改这里。
 * 这里只拼条件、算日子，不碰 prisma（界面、单测都能直接引）；取数在 home-cards-db.ts，项目页筛选在 list.ts，
 * 两边都用这里的条件，所以卡上的数和点进 /projects?f=… 看到的行是同一批。
 *
 * **首页摆哪四张只看 首页摆的卡 这一个常量**（10-29 会议二2：两张绿卡换掉两张红卡，待拍板）。
 * 换回来 / 换别的只改那一行：取数（数首页卡）只数摆着的卡，没摆的卡项目页 ?f=… 照样能筛。
 *
 * 卡（URL 参数 f 的值 → 卡名 → 口径）：
 *   month-new  本月新增   这个月（北京时间自然月，1 号 0 点起）新建的项目，不管现在是否还在推、有没有结局
 *   key        重点项目   在推的项目里，客户级别是 重点级别（S、A）的
 *   no-follow  暂未跟进   在推的项目里，一条沟通都还没挂上的（FollowUpProject 没有行）
 *   due-soon   即将逾期   在推的线索 / 商机项目里，超时回收日在 即将逾期天数（3 天）以内的；
 *                          回收日和项目页「即将回收」标签同一套算法（timeout.ts 的 超时回收日），只是提前量从 1 天放到 3 天。
 *                          组织规则里「超时回收」没开 = 没有回收日 = 恒为 0
 *   month-won  本月赢单   这个月有一条「商机 → 订单」节点留痕的项目（ProjectNodeLog，和数据看板「转订单」同一口径）
 *   today-todo 今日待办   不是项目筛选：我名下今天到期 + 已经逾期的跟进计划和待办（reminders-db.ts 的 数提醒，
 *                          和欢迎句「今天要跟 N 条」、左栏角标、Dock 同一个数），点了去复盘页「待办」页签、选中「今天到期」、看本人
 *
 * 「在推」= 没结局、不在项目公海（active.ts 的 在推项目条件）。
 * 看得到哪些不在这里管：取数走带限定的 prisma（lib/team-scope.ts），业务员只数自己看得到的，老板数全员。
 */
import type { Prisma } from "@/generated/prisma";
import { dayjs } from "@/lib/utils";
import type { 组织规则 } from "./org-rules";
import { 节点超时天数 } from "./timeout";
import type { 阶段字典 } from "./stage-dict";
import { 复盘地址 } from "./board-todos";

/** 能当项目页筛选（/projects?f=…）的卡 */
export const 项目卡键们 = ["month-new", "key", "no-follow", "due-soon", "month-won"] as const;
export type 项目卡键 = (typeof 项目卡键们)[number];
/** 全部认得的卡：项目卡 + 今日待办（数的是计划和待办，不是项目） */
export const 首页卡键们 = [...项目卡键们, "today-todo"] as const;
export type 首页卡键 = (typeof 首页卡键们)[number];

/** 首页右侧那一列摆哪几张、什么顺序。改主意只改这里（10-29 会议二2 推荐：保留本月新增、重点项目，换上今日待办、本月赢单） */
export const 首页摆的卡: readonly 首页卡键[] = ["month-new", "key", "today-todo", "month-won"];

/** 卡上的数字着什么色：warn 有数就标提醒红（告警类），good 有数就标绿（正向 / 能直接动手的）；没写的只是个量 */
export const 首页卡色: Partial<Record<首页卡键, "good" | "warn">> = {
  "no-follow": "warn",
  "due-soon": "warn",
  "today-todo": "good",
  "month-won": "good",
};

/** 摆着的卡各几个（home-cards-db.ts 的 数首页卡 给，首页右侧那一列画）；没摆的卡不数 */
export type 首页卡数 = Partial<Record<首页卡键, number>>;

/** 「重点项目」认的客户级别。级别存在 CustomerExtra.level（大写），以后加了 S 级就自动算进来 */
export const 重点级别 = ["S", "A"] as const;

/** 「即将逾期」：回收日离今天还剩几天以内（含当天）。项目页「即将回收」标签是 1 天，这里放宽到 3 天 */
export const 即将逾期天数 = 3;

/** 卡名、项目页页头的「当前筛选」、悬停说明 */
export const 首页卡口径: Record<首页卡键, { 名: string; 说明: string }> = {
  "month-new": { 名: "本月新增", 说明: "这个月新建的项目" },
  key: { 名: "重点项目", 说明: `在推的项目里，客户级别是 ${重点级别.join(" / ")} 的` },
  "no-follow": { 名: "暂未跟进", 说明: "在推的项目里，还没有挂上任何一次沟通的" },
  "due-soon": { 名: "即将逾期", 说明: `在推的线索、商机项目里，${即将逾期天数} 天内会因为没跟进被收回公海的` },
  "month-won": { 名: "本月赢单", 说明: "这个月从商机转成订单的项目" },
  "today-todo": { 名: "今日待办", 说明: "今天到期和已经过期的跟进计划、待办，逾期的排最前" },
};

/**
 * 点卡去哪：项目卡去项目页带筛选；今日待办去复盘页「待办」页签、选中「今天到期」（10-29 用户定）。
 * 给了 我 就带上 ownerId=我：卡上数的是我名下的，管理层落地默认看全部成员，不带的话数对不上；业务员本来就只看自己
 */
export function 首页卡链接(键: 首页卡键, 我?: string): string {
  return 键 === "today-todo" ? 复盘地址({ f: "today", ownerId: 我 }) : `/projects?f=${键}`;
}

/** 地址栏里的 f：认得的项目卡原样给回，乱传、传数组、传 today-todo（不是项目筛选）都当没筛 */
export function 认首页卡(v: unknown): 项目卡键 | "" {
  return typeof v === "string" && (项目卡键们 as readonly string[]).includes(v) ? (v as 项目卡键) : "";
}

/** 本月起止（北京时间）：[起, 止) */
export function 本月起止(今: Date | string = new Date()): { 起: Date; 止: Date } {
  const 月初 = dayjs(今).startOf("month");
  return { 起: 月初.toDate(), 止: 月初.add(1, "month").toDate() };
}

const 在推 = { result: null, pooledAt: null } satisfies Prisma.ProjectWhereInput;

/**
 * 「即将逾期」库里先粗筛：回收日 = min(起点 + 节点天数, 下一步那天 + 1)，起点不早于建项目那天，
 * 所以回收日落在 今 + N 天以内，必然是「建项目不晚于 今 + N − 最短节点天数」或「下一步不晚于 今 + N − 1」。
 * 这是必要条件，不是充分条件——剩下的在 JS 里用 项目回收日 逐个算。超时回收没开 = null（一个都不会有）
 */
export function 即将逾期粗筛(规则: 组织规则, 字典: 阶段字典, 今: Date | string = new Date()): Prisma.ProjectWhereInput | null {
  if (!规则.超时回收.开) return null;
  const 天数们 = [...Object.keys(规则.超时回收.节点天数).map((n) => 节点超时天数(规则, n, 字典)), 字典.默认超时天数].filter((d): d is number => !!d && d > 0);
  if (!天数们.length) return null;
  const 最短 = Math.min(...天数们);
  const 今天 = dayjs(今).startOf("day");
  return {
    ...在推,
    phase: { in: ["线索", "商机"] },
    customer: { pool: { is: null } },
    OR: [
      { createdAt: { lt: 今天.add(即将逾期天数 - 最短 + 1, "day").toDate() } },
      { nextStepAt: { lt: 今天.add(即将逾期天数, "day").toDate() } },
    ],
  };
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
export function 首页卡条件(键: 项目卡键, 规则: 组织规则, 字典: 阶段字典, 今: Date | string = new Date()): Prisma.ProjectWhereInput {
  switch (键) {
    case "month-new": {
      const { 起, 止 } = 本月起止(今);
      return { createdAt: { gte: 起, lt: 止 } };
    }
    case "key":
      return { ...在推, customer: { extra: { is: { level: { in: [...重点级别] } } } } };
    case "no-follow":
      return { ...在推, followUps: { none: {} } };
    case "due-soon":
      return 即将逾期粗筛(规则, 字典, 今) ?? { id: { in: [] } };
    case "month-won": {
      const { 起, 止 } = 本月起止(今);
      return { logs: { some: { kind: "node", fromPhase: "商机", toPhase: "订单", at: { gte: 起, lt: 止 } } } };
    }
  }
}
