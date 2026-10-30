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
 *   month-new  本月新增   这个月（北京时间自然月，1 号 0 点起）新建的项目，不管现在是否还在推、有没有结局
 *   key        重点项目   在推的项目里，项目自己的级别（Project.level，迁移 093，界面显示成星级）是 重点级别（S / A）的。
 *                          项目标签字典里的「A 重点推进」就是项目级别 A；S 比 A 高一档，也算重点。不看客户级别
 *   no-follow  暂未跟进   在推的项目里，一条沟通都还没挂上的（FollowUpProject 没有行）
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
import type { 阶段字典 } from "./stage-dict";

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
  "no-follow": { 名: "暂未跟进", 说明: "在推的项目里，还没有记过一条沟通的" },
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
      return { ...在推, level: { in: [...重点级别] } };
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
