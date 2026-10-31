import { dayjs } from "@/lib/utils";
import { 分组, 组名, type 组 } from "@/lib/plans-groups";
import type { 轻项 } from "@/lib/plans-page";

/**
 * 企业版复盘页「待办」页签（P15，10-29 改成两个页签）：没做完的跟进计划 + 待办事项，合在一起。
 *
 * 口径全照跟进计划页：同一份轻列表（lib/plans-page 的 未完成轻列表）、同一套分组（lib/plans-groups 的 分组），
 * 所以「逾期 / 今天到期 / 本周到期」的条数和计划页组头一致——本周 = 今天以后到本周末，不含今天和逾期（同计划页）。
 * 看谁跟着复盘页的人员选择走（board-member.ts 的 看板的人）；看得到哪些客户的事项由外面那层 prisma 限定。
 *
 * 顶上四张指标卡本身就是筛选，列表上方的分段是「待办类型」；都记在地址栏，刷新、返回不丢：
 *   tab=todo|block|talk|data  f=overdue|today|week|all  kind=all|task|plan  p=页码（从 1 起）
 * 分页在服务端：轻列表上筛人、筛类型、分组排好，只取当页 20 条的详情。
 *
 * 本文件不碰库，页面和测试都直接用；取数在 board-todos-db.ts。
 */

/**
 * 复盘页四个页签（P7 U-复盘-01，10-31 改）：任务（todo，默认）｜卡点（block）｜沟通（talk）｜数据（data）。
 * 「任务」的键还叫 todo：首页「今日待办」等链接（/overview?f=today）照旧落到这里
 */
export const 复盘页签们 = ["todo", "block", "talk", "data"] as const;
export type 复盘页签 = (typeof 复盘页签们)[number];
export const 复盘页签叫法: Record<复盘页签, string> = { todo: "任务", block: "卡点", talk: "沟通", data: "数据" };
/** 地址栏没写 tab 但带了 view（首页信号「本月」、/reports 跳过来的「本年」，都是要看数）→「数据」；都没写 →「任务」 */
export const 读页签 = (tab?: string, view?: string): 复盘页签 =>
  (复盘页签们 as readonly string[]).includes(tab ?? "") ? (tab as 复盘页签) : view ? "data" : "todo";

/** 四张指标卡，也是四个筛选；值是地址栏 f= 的取值 */
export const 待办卡们 = ["overdue", "today", "week", "all"] as const;
export type 待办卡 = (typeof 待办卡们)[number];
export const 待办卡叫法: Record<待办卡, string> = { overdue: "逾期", today: "今天到期", week: "本周到期", all: "全部待办" };
const 卡的组: Record<Exclude<待办卡, "all">, 组> = { overdue: "逾期", today: "今天", week: "本周" };
export const 读卡 = (v?: string): 待办卡 => ((待办卡们 as readonly string[]).includes(v ?? "") ? (v as 待办卡) : "all");

/** 待办类型：全部 / 任务（Task）/ 跟进计划（FollowPlan）；值是地址栏 kind= 的取值 */
export const 待办类型们 = ["all", "task", "plan"] as const;
export type 待办类型 = (typeof 待办类型们)[number];
export const 待办类型叫法: Record<待办类型, string> = { all: "全部", task: "任务", plan: "跟进计划" };
export const 读类型 = (v?: string): 待办类型 => ((待办类型们 as readonly string[]).includes(v ?? "") ? (v as 待办类型) : "all");

/** 每页几条 */
export const 复盘待办每页 = 20;
export const 读页码 = (v?: string): number => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 1 ? n : 1;
};

/** 行上的状态：逾期标红；本周、以后、没定时间的都算「之后」 */
export type 待办状态 = "逾期" | "今天" | "之后";
export const 状态of = (g: 组): 待办状态 => (g === "逾期" ? "逾期" : g === "今天" ? "今天" : "之后");

/** 某一条在不在这张卡里 */
export const 在卡里 = (卡: 待办卡, g: 组): boolean => 卡 === "all" || 卡的组[卡] === g;

/**
 * 挑出这一页要摆的：按人筛（只看：一个人的 id，或一组人 = 看板的人 的 谁；不给 = 不筛）→ 按类型筛 → 分组 → 逾期在前、然后按时间从早到晚、没时间的排最后
 * （分组 的「以后」里没时间的本来就在末尾）→ 按卡筛 → 切出第 页 页。
 * 四张卡的条数跟着人和类型走（换成「任务」，卡上数的也只是任务），不跟着卡本身。
 * 页码超出最后一页时落到最后一页（完成了几条、换了人之后地址栏里的页码可能已经没那么多页）。
 */
export function 挑一页(
  全部: readonly 轻项[],
  { 只看, 类型 = "all", 卡 = "all", 页 = 1, now = dayjs(), 每页 = 复盘待办每页 }: {
    只看?: string | readonly string[]; 类型?: 待办类型; 卡?: 待办卡; 页?: number; now?: ReturnType<typeof dayjs>; 每页?: number;
  } = {},
): { 计数: Record<待办卡, number>; 总数: number; 页: number; 要: { key: string; 组: 组 }[] } {
  const 前缀 = 类型 === "all" ? null : `${类型}:`;
  const 人 = 只看 === undefined ? null : new Set(typeof 只看 === "string" ? [只看] : 只看);
  const 这些 = 全部.filter((x) => (!人 || 人.has(x.ownerId)) && (!前缀 || x.key.startsWith(前缀)));
  const 分 = 分组(这些, now);
  const 排好 = 组名.flatMap((g) => 分[g].map((x) => ({ key: x.key, 组: g })));
  const 卡里 = 排好.filter((x) => 在卡里(卡, x.组));
  const 末页 = Math.max(1, Math.ceil(卡里.length / 每页));
  const 第 = Math.min(Math.max(1, 页), 末页);
  return {
    计数: { overdue: 分.逾期.length, today: 分.今天.length, week: 分.本周.length, all: 这些.length },
    总数: 卡里.length,
    页: 第,
    要: 卡里.slice((第 - 1) * 每页, 第 * 每页),
  };
}

export type 复盘待办行 = {
  key: string;
  kind: "plan" | "task";
  id: string;
  /** 到期 / 计划时间（同计划页 scheduleValue）；待办可以没有 */
  时间: string | null;
  /** false = 只定了日子没定钟点 */
  明确钟点: boolean | null;
  内容: string;
  customerId: string;
  /** 客户只有一个名字（没有简称字段），长的在页面上省略 */
  customerName: string;
  /** 客户最近动过的进行中项目（Task / FollowPlan 本身不挂项目，按客户推）；没有 = null */
  projectName: string | null;
  ownerId: string;
  ownerName: string;
  组: 组;
  /** 点这一行去哪：客户有进行中的项目就去项目页，没有去客户页 */
  去: string;
};

export type 复盘待办 = { 计数: Record<待办卡, number>; 总数: number; 页: number; 行: 复盘待办行[] };

/** 右上角「去计划页」：看全部成员、或选了别人时带 scope=all（计划页没有按人筛的参数，选了某个人只能带到「全部成员」） */
export function 计划页链接(范围: "自己" | "全员"): string {
  return `/follow-ups/plans${范围 === "全员" ? "?scope=all" : ""}`;
}

/**
 * 复盘页地址：页签、看谁、各页签自己的筛选、页码；默认值不写进地址栏。
 * 每个页签只带自己的筛选（待办 f / kind，卡点 bs，沟通 t）；「数据」不带页码
 */
export function 复盘地址(q: {
  tab?: 复盘页签; view?: string; ownerId?: string; f?: 待办卡; kind?: 待办类型; bs?: string; t?: string; p?: number;
}): string {
  const s = new URLSearchParams();
  const 签 = q.tab ?? "todo";
  if (签 !== "todo" || q.view) s.set("tab", 签);
  if (q.view) s.set("view", q.view);
  if (q.ownerId) s.set("ownerId", q.ownerId);
  if (签 === "todo") {
    if (q.f && q.f !== "all") s.set("f", q.f);
    if (q.kind && q.kind !== "all") s.set("kind", q.kind);
  }
  if (签 === "block" && q.bs && q.bs !== "open") s.set("bs", q.bs);
  if (签 === "talk" && q.t && q.t !== "all") s.set("t", q.t);
  if (签 !== "data" && q.p && q.p > 1) s.set("p", String(q.p));
  const t = s.toString();
  return `/overview${t ? `?${t}` : ""}`;
}
