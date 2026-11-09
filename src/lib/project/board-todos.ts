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
 * 顶上四张指标卡本身就是筛选；都记在地址栏，刷新、返回不丢：
 *   tab=todo|block|talk|data  f=overdue|today|week|all  lay=list（全部待办时看表格，不写 = 三列看板）  p=页码（从 1 起）
 * 分页在服务端：轻列表上筛人、分组排好，只取当页 20 条的详情。
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
 * 挑出这一页要摆的：按人筛（只看：一个人的 id，或一组人 = 看板的人 的 谁；不给 = 不筛）→ 分组 → 逾期在前、然后按时间从早到晚、没时间的排最后
 * （分组 的「以后」里没时间的本来就在末尾）→ 按卡筛 → 切出第 页 页。
 * 四张卡的条数跟着人走，不跟着卡本身。
 * 页码超出最后一页时落到最后一页（完成了几条、换了人之后地址栏里的页码可能已经没那么多页）。
 */
export function 挑一页(
  全部: readonly 轻项[],
  { 只看, 卡 = "all", 页 = 1, now = dayjs(), 每页 = 复盘待办每页 }: {
    只看?: string | readonly string[]; 卡?: 待办卡; 页?: number; now?: ReturnType<typeof dayjs>; 每页?: number;
  } = {},
): { 计数: Record<待办卡, number>; 总数: number; 页: number; 要: { key: string; 组: 组 }[] } {
  const 人 = 只看 === undefined ? null : new Set(typeof 只看 === "string" ? [只看] : 只看);
  const 这些 = 全部.filter((x) => !人 || 人.has(x.ownerId));
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

/**
 * 「全部待办」时默认的三列看板（11-01 参考复盘稿融合）：逾期｜今天到期｜之后（本周 + 以后 + 没定时间）。
 * 口径同 挑一页 的分组（逾期、今天就是指标卡上那两个数），每列只取前 每列 条的详情，列尾「看全部」去对应卡的列表。
 * 地址栏 lay=list 时不摆看板、照旧是表格；点了逾期 / 今天 / 本周那几张卡也是表格（筛过的）
 */
export const 看板列们 = ["overdue", "today", "later"] as const;
export type 看板列 = (typeof 看板列们)[number];
export const 看板列叫法: Record<看板列, string> = { overdue: "已逾期", today: "今天到期", later: "待跟进" };
/** 列尾「看全部」去哪张卡：之后那列没有单独的卡，去「全部」的列表 */
export const 看板列的卡: Record<看板列, 待办卡> = { overdue: "overdue", today: "today", later: "all" };
export const 看板每列 = 8;
const 组的列 = (g: 组): 看板列 => (g === "逾期" ? "overdue" : g === "今天" ? "today" : "later");

export type 待办布局 = "board" | "list";
export const 读布局 = (v?: string): 待办布局 => (v === "list" ? "list" : "board");

/** 同 挑一页 的筛人、分组和排序，切成三列、每列前 每列 条 */
export function 挑看板(
  全部: readonly 轻项[],
  { 只看, now = dayjs(), 每列 = 看板每列 }: { 只看?: string | readonly string[]; now?: ReturnType<typeof dayjs>; 每列?: number } = {},
): { 计数: Record<待办卡, number>; 列: Record<看板列, { 总数: number; 要: { key: string; 组: 组 }[] }> } {
  const 全 = 挑一页(全部, { 只看, now, 每页: Number.MAX_SAFE_INTEGER });
  const 列 = Object.fromEntries(看板列们.map((k) => [k, { 总数: 0, 要: [] as { key: string; 组: 组 }[] }])) as Record<看板列, { 总数: number; 要: { key: string; 组: 组 }[] }>;
  for (const x of 全.要) {
    const c = 列[组的列(x.组)];
    c.总数++;
    if (c.要.length < 每列) c.要.push(x);
  }
  return { 计数: 全.计数, 列 };
}

/** 卡片上的「逾 N 天」：到期那天到今天隔了几天（按日子算，没过期 / 没时间 = 0） */
export function 逾天数(时间: string | null, now: ReturnType<typeof dayjs> = dayjs()): number {
  if (!时间) return 0;
  return Math.max(0, now.startOf("day").diff(dayjs(时间).startOf("day"), "day"));
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
  /** 那个项目的级别（S / A / B / C，企业版）；没项目、没定级别 = null */
  projectLevel: string | null;
  ownerId: string;
  ownerName: string;
  组: 组;
  /** 点这一行去哪：客户有进行中的项目就去项目页，没有去客户页；客户详情进不去的去自己看得到的项目，都没有 = null（行不能点，只能勾） */
  去: string | null;
};

export type 复盘待办 = { 计数: Record<待办卡, number>; 总数: number; 页: number; 行: 复盘待办行[] };
export type 复盘看板 = { 计数: Record<待办卡, number>; 列: Record<看板列, { 总数: number; 行: 复盘待办行[] }> };

/**
 * 复盘页地址：页签、看谁、各页签自己的筛选、页码；默认值不写进地址栏。
 * 每个页签只带自己的筛选（待办 f，卡点 bs，沟通 t）；「数据」不带页码
 */
export function 复盘地址(q: {
  tab?: 复盘页签; view?: string; ownerId?: string; f?: 待办卡; lay?: 待办布局; bs?: string; t?: string; m?: string; p?: number;
}): string {
  const s = new URLSearchParams();
  const 签 = q.tab ?? "todo";
  if (签 !== "todo" || q.view) s.set("tab", 签);
  if (q.view) s.set("view", q.view);
  if (q.ownerId) s.set("ownerId", q.ownerId);
  if (签 === "todo") {
    if (q.f && q.f !== "all") s.set("f", q.f);
    if (q.lay === "list") s.set("lay", "list");
  }
  if (签 === "block" && q.bs && q.bs !== "open") s.set("bs", q.bs);
  if (签 === "talk" && q.t && q.t !== "all") s.set("t", q.t);
  if (签 === "talk" && q.m) s.set("m", q.m);
  if (签 !== "data" && q.p && q.p > 1) s.set("p", String(q.p));
  const t = s.toString();
  return `/overview${t ? `?${t}` : ""}`;
}
