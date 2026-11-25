/**
 * 组织规则改前 → 改后比一遍，列出「哪项从什么变成什么」（设置开关 N9 / N5，11-23）。
 *
 * 两处用：
 *   1. 改组织规则 的操作日志摘要（projects/actions.ts）：原来按「这次交了哪一块」拼一句，改阶段开关时写成
 *      「往前推权限 X，改了 N 个阶段的结束状态叫法」，看不出改的是哪项；现在照实写「前两个进程要沟通：关 → 开」
 *   2. 开关总览每张卡的「上次：谁 · 几点」（settings/switch-actions.ts 读开关改动）：操作日志 detail 只存改后整份规则，
 *      拿相邻两行比，找出每个开关最近一次真变了的那行
 * 纯函数，不碰库；客户端也能 import（同 org-rules.ts）
 */
import { 是不限, type 组织规则 } from "./org-rules";

/** 开关总览里，组织规则（orgRules 一个键）管的那几个开关 */
export type 组织规则开关 = "hold_cap" | "node_timeout" | "node_advance" | "first_two" | "fill_period" | "push_perm" | "tri_state" | "record_only" | "record_only_recall";

export type 一处改动 = {
  /** 哪项：「前两个进程要沟通」 */
  项: string;
  前: string;
  后: string;
  /** 一句：「前两个进程要沟通：关 → 开」 */
  话: string;
  /** 属于开关总览里哪个开关（卡上「上次」那行认它）；不是开关的细项（字数上限、叫法）没有 */
  开关?: 组织规则开关;
  /** 卡上「上次」那行的动词：打开 / 关掉 / 改成「仅上级推」/ 改范围 / 改必填 / 改上限 / 改天数 */
  动作: string;
};

const 开关话 = (b: boolean) => (b ? "开" : "关");
const 上限话 = (n: number) => (是不限(n) ? "不限" : `${n} 个`);
const 范围话 = (r: 组织规则["节点推进"]["范围"]) => (r === "新建" ? "开启之后新建的" : "全部项目");
const 字数话 = (n: number | null) => (n == null ? "不设" : `${n} 字`);
/** 两份 节点 → 值 的表有几个节点不一样（多了、少了、值变了都算） */
function 变了几个<T>(a: Record<string, T> = {}, b: Record<string, T> = {}): number {
  const 键 = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...键].filter((k) => JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)).length;
}

export function 组织规则改动(旧: 组织规则, 新: 组织规则): 一处改动[] {
  const 出: 一处改动[] = [];
  const 开关项 = (项: string, a: boolean, b: boolean, 开关: 组织规则开关) => {
    if (a !== b) 出.push({ 项, 前: 开关话(a), 后: 开关话(b), 话: `${项}：${开关话(a)} → ${开关话(b)}`, 开关, 动作: b ? "打开" : "关掉" });
  };
  const 值项 = (项: string, a: string, b: string, 动作: string, 开关?: 组织规则开关) => {
    if (a !== b) 出.push({ 项, 前: a, 后: b, 话: `${项}：${a} → ${b}`, 动作, ...(开关 ? { 开关 } : {}) });
  };
  const 数项 = (项: string, 几个: number, 话: string, 动作: string, 开关?: 组织规则开关) => {
    if (几个) 出.push({ 项, 前: "", 后: "", 话: `${项}：${话}`, 动作, ...(开关 ? { 开关 } : {}) });
  };

  const g0 = 旧.公海, g1 = 新.公海;
  开关项("项目持有上限", g0.持有上限开, g1.持有上限开, "hold_cap");
  值项("项目持有上限默认", 上限话(g0.默认上限), 上限话(g1.默认上限), "改上限", "hold_cap");
  const 单设0 = Object.keys(g0.每人上限).length, 单设1 = Object.keys(g1.每人上限).length;
  if (单设0 !== 单设1) 值项("项目持有上限单设", `${单设0} 人`, `${单设1} 人`, "改上限", "hold_cap");
  else 数项("项目持有上限单设", 变了几个(g0.每人上限, g1.每人上限), `改了 ${变了几个(g0.每人上限, g1.每人上限)} 人的上限`, "改上限", "hold_cap");
  值项("多项目客户公海走法", g0.多项目客户, g1.多项目客户, "改走法");

  const t0 = 旧.超时回收, t1 = 新.超时回收;
  开关项("超时回收", t0.开, t1.开, "node_timeout");
  const 时长 = 变了几个(t0.节点天数, t1.节点天数) + 变了几个(t0.外贸节点天数, t1.外贸节点天数);
  数项("超时回收处理时长", 时长, `改了 ${时长} 处进程时长`, "改天数", "node_timeout");
  值项("超时计时起算日", t0.起算日 ?? "不设", t1.起算日 ?? "不设", "改起算日", "node_timeout");
  开关项("「仅记录用」项目也超时回收", t0.仅记录用也回收 === true, t1.仅记录用也回收 === true, "record_only_recall");

  const p0 = 旧.节点推进, p1 = 新.节点推进;
  开关项("节点推进", p0.开, p1.开, "node_advance");
  值项("节点推进管哪些项目", 范围话(p0.范围), 范围话(p1.范围), "改范围", "node_advance");
  const 必填 = 变了几个(p0.必填, p1.必填);
  数项("节点推进必填", 必填, `改了 ${必填} 个进程，现在 ${Object.keys(p1.必填).length} 个进程配了必填`, "改必填", "node_advance");

  const s0 = 旧.阶段, s1 = 新.阶段;
  if (s0.推进权限 !== s1.推进权限) 值项("谁能往前推进程", s0.推进权限, s1.推进权限, `改成「${s1.推进权限}」`, "push_perm");
  开关项("前两个进程要沟通", s0.前两节点要沟通, s1.前两节点要沟通, "first_two");
  开关项("需求状态补全期", s0.需求补全期, s1.需求补全期, "fill_period");
  开关项("「仅记录用」项目", s0.仅记录用 === true, s1.仅记录用 === true, "record_only");
  值项("培育计划字数上限", 字数话(s0.培育计划上限), 字数话(s1.培育计划上限), "改字数上限");
  值项("无效原因字数上限", 字数话(s0.无效原因上限), 字数话(s1.无效原因上限), "改字数上限");
  const 叫法 = 变了几个(s0.出口叫法 as Record<string, unknown>, s1.出口叫法 as Record<string, unknown>);
  数项("结束状态叫法", 叫法, `改了 ${叫法} 个阶段`, "改叫法");

  开关项("客户回收", 旧.三态.开, 新.三态.开, "tri_state");
  const { 开: _a, ...天0 } = 旧.三态, { 开: _b, ...天1 } = 新.三态;
  if (JSON.stringify(天0) !== JSON.stringify(天1)) 出.push({ 项: "客户回收天数", 前: "", 后: "", 话: "客户回收天数：改了", 开关: "tri_state", 动作: "改天数" });
  return 出;
}

/** 操作日志摘要：「组织规则：前两个进程要沟通：关 → 开」，几项用「；」隔开；一项都没变也留一句，看得出有人存过 */
export function 组织规则改动摘要(旧: 组织规则, 新: 组织规则): string {
  const 变 = 组织规则改动(旧, 新);
  return `组织规则：${变.length ? 变.map((x) => x.话).join("；") : "没有改动"}`;
}
