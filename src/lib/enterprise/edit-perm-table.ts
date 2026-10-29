/**
 * 企业版「后台设置谁能改」（2026-10-26，清单 ② B2 第 6 条）：七样后台设置（10-26 加阶段规则）各由哪几类人改；10-29 加第八样「录入渠道投入」。
 *
 * 默认就是清单里的默认建议，对方逐行确认前先这么跑；定了在设置 → 组织架构 →「后台设置谁能改」里勾，
 * 存 Setting `enterprise.edit_perm`：{ 设置项: 能改的人[] }，没存的项 = 默认。
 * - 老板（账号管理员）每一项都能改，不受这张表管，免得把自己锁在外面。
 * - 「直属上级」「虚线上级」只对线索配额有意义：给自己的下属设。
 * 纯数据和纯函数，客户端组件也 import；读库的在 edit-perm.ts。
 */
import { 直属上级of, 虚线上级of, 管理员类别们of, type 组织, type 管理员类别 } from "./org-core";

export type 能改的人 = 管理员类别 | "直属上级" | "虚线上级";

const 三类: readonly 能改的人[] = ["销售管理", "市场管理", "总管理员"];

export const 设置项 = {
  节点时限: { 名: "各节点时限（超时回收用）", 可选: 三类, 默认: ["销售管理", "市场管理", "总管理员"] },
  必填字段: { 名: "每个节点的必填字段（节点推进）", 可选: 三类, 默认: ["总管理员"] },
  线索配额: { 名: "线索分配配额", 可选: ["直属上级", "虚线上级", ...三类], 默认: ["直属上级", "虚线上级"] },
  持有上限: { 名: "公海持有上限", 可选: 三类, 默认: ["销售管理", "总管理员"] },
  字典: { 名: "异常类别、组员角色、企业选项字典", 可选: 三类, 默认: ["总管理员"] },
  字段权限: { 名: "字段权限表", 可选: 三类, 默认: ["总管理员"] },
  阶段规则: { 名: "阶段结束状态叫法、往前推权限（负责人可推 / 仅上级推）", 可选: 三类, 默认: ["销售管理", "总管理员"] },
  // 渠道投入（2026-10-29）：不是一样「设置」，是谁能在渠道详情里录投入。渠道负责人自己那几条渠道总能录，不受这张表管
  渠道投入: { 名: "录入渠道投入（渠道负责人自己的渠道总能录）", 可选: 三类, 默认: ["市场管理", "总管理员"] },
} as const satisfies Record<string, { 名: string; 可选: readonly 能改的人[]; 默认: readonly 能改的人[] }>;
export type 设置项名 = keyof typeof 设置项;
export const 设置项们 = Object.keys(设置项) as 设置项名[];

export type 改权限配置 = Partial<Record<设置项名, 能改的人[]>>;
export const 改权限key = "enterprise.edit_perm";

/** 存的、交来的配置都过一遍：不认识的项丢掉，每项只留这一项可选的人，按可选的顺序排；空数组 = 只有老板 */
export function 规整改权限(x: unknown): 改权限配置 {
  const out: 改权限配置 = {};
  if (!x || typeof x !== "object") return out;
  for (const [k, v] of Object.entries(x as Record<string, unknown>)) {
    if (!Object.hasOwn(设置项, k) || !Array.isArray(v)) continue;
    const 项 = k as 设置项名;
    const 可选: readonly 能改的人[] = 设置项[项].可选;
    out[项] = 可选.filter((p) => v.includes(p));
  }
  return out;
}

/** 这一项现在由谁改（不含老板） */
export function 谁能改(配置: 改权限配置, 项: 设置项名): readonly 能改的人[] {
  return 配置[项] ?? 设置项[项].默认;
}

/**
 * 我能不能改这一项。目标 = 线索配额给谁设（看他是不是我的直属 / 虚线下属）；别的项不用给。
 * 只管企业版：不是企业版的地方别调它，照原来的「只有老板」走。
 */
export function 能改设置(org: 组织, 我: { id: string; role: string }, 项: 设置项名, 配置: 改权限配置, 目标?: string): boolean {
  if (我.role === "ADMIN") return true;
  const 谁 = 谁能改(配置, 项);
  // 兼几类管理员的（10-27 角色多选），哪一类在表里都算
  if ([...管理员类别们of(org, 我.id)].some((类) => 谁.includes(类))) return true;
  if (!目标) return false;
  return (谁.includes("直属上级") && 直属上级of(org, 目标) === 我.id) || (谁.includes("虚线上级") && 虚线上级of(org, 目标) === 我.id);
}

/** 「只有老板、销售管理、总管理员能改」这样的一句，界面和报错共用 */
export function 谁能改的话(配置: 改权限配置, 项: 设置项名): string {
  return `只有${["老板", ...谁能改(配置, 项)].join("、")}能改`;
}

/**
 * 节点时限再按节点拆（10-27 批注）：「谁能改」表里有这一类人以后，销售管理只改潜客培育，市场管理改潜客培育 + 线索验证；
 * 总管理员和老板每个节点都能改，超时回收的开关也只有他们能动（开关管所有节点）
 */
export const 时限可改节点: Readonly<Record<"销售管理" | "市场管理", readonly string[]>> = {
  销售管理: ["潜客培育"],
  市场管理: ["潜客培育", "线索验证"],
};
export type 时限范围 = "全部" | readonly string[];

/** 我能改哪几个节点的时限："全部" = 每个节点都能改、能开关；[] = 一个都不能改 */
export function 能改时限的节点(org: 组织, 我: { id: string; role: string }, 配置: 改权限配置): 时限范围 {
  if (我.role === "ADMIN") return "全部";
  if (!能改设置(org, 我, "节点时限", 配置)) return [];
  const 类们 = 管理员类别们of(org, 我.id);
  if (类们.has("总管理员")) return "全部";
  // 销售管理兼市场管理：两边的节点合起来，但只算「谁能改」表里有的那一类
  const 谁 = 谁能改(配置, "节点时限");
  const 节点 = new Set<string>();
  for (const 类 of ["销售管理", "市场管理"] as const) if (类们.has(类) && 谁.includes(类)) 时限可改节点[类].forEach((n) => 节点.add(n));
  return [...节点];
}

const 天数值 = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/**
 * 这次超时回收改动里有没有我动不了的：开关真变了、或哪个节点的天数真变了（交来的节点天数是整张表，没变的节点不算）。
 * null = 都能改，否则是挡住的那句
 */
export function 挡时限改动(
  范围: 时限范围,
  现在: { 开: boolean; 节点天数: Record<string, number> },
  改: { 开?: unknown; 节点天数?: Record<string, unknown> | null } | null | undefined,
): string | null {
  if (范围 === "全部" || !改 || typeof 改 !== "object") return null;
  if (改.开 !== undefined && 改.开 !== 现在.开) return "超时回收的开关只有老板、总管理员能动";
  if (!改.节点天数 || typeof 改.节点天数 !== "object") return null;
  const 交来 = 改.节点天数;
  for (const n of new Set([...Object.keys(现在.节点天数), ...Object.keys(交来)])) {
    if (范围.includes(n)) continue;
    if (天数值(现在.节点天数[n]) !== 天数值(交来[n])) {
      return 范围.length ? `你只能改${范围.map((x) => `「${x}」`).join("")}的时限，「${n}」由老板、总管理员改` : `「${n}」的时限你改不了`;
    }
  }
  return null;
}
