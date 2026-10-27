/**
 * 企业版「分配方式谁能用」（2026-10-27）：分配方式字典的每一项，按业务角色勾谁能用。
 *
 * 默认照 10-27 会上定的：销售只有指定分配、自拓自持；市场除自拓自持外都有；其他角色一样都没有。
 * （早先照流程表给过其他角色指定 / 自动 / 公海捞取 / 自持，会上改了；管理员已存过的不动。）
 * 市场 = 市场管理；销售 = 销售管理 + 销售成员；其他 = 渠道运营 + 项目运营。
 * - 总管理、管理员、老板（账号管理员）每样都能用，不受这张表管。
 * - 后来加的选项默认谁都能用（没有对应的操作，管不着）。
 * 存 Setting `enterprise.assign_use`：{ 选项 id: 业务角色[] }，没存的项 = 默认。
 * 纯数据和纯函数，客户端组件也 import；读库、存库在 dict.ts。
 */
import { 角色名, type 业务角色 } from "@/lib/sync/dept-policy";
import type { 组织 } from "./org-core";

/** 能勾的业务角色；总管理、管理员总能用，不列 */
export const 分配可选角色 = ["marketing_mgr", "sales_mgr", "sales", "channel_ops", "project_ops"] as const satisfies readonly 业务角色[];
export type 分配可选角色 = (typeof 分配可选角色)[number];

const 市场: 分配可选角色[] = ["marketing_mgr"];
const 销售: 分配可选角色[] = ["sales_mgr", "sales"];
const 其他: 分配可选角色[] = ["channel_ops", "project_ops"];

/** 分配方式字典默认五项的固定 id（dict.ts 默认id("assign", i)），改名不变 */
export const 分配方式id = { 指定: "dict-assign-0", 自动: "dict-assign-1", 公海捞取: "dict-assign-2", 暂不分配: "dict-assign-3", 自拓自持: "dict-assign-4" } as const;

export const 分配默认谁能用: Readonly<Record<string, readonly 分配可选角色[]>> = {
  [分配方式id.指定]: [...市场, ...销售],
  [分配方式id.自动]: [...市场],
  [分配方式id.公海捞取]: [...市场],
  [分配方式id.暂不分配]: [...市场],
  [分配方式id.自拓自持]: [...销售],
};

export type 分配谁能用配置 = Record<string, 分配可选角色[]>;
export const 分配谁能用key = "enterprise.assign_use";


/** 存的值读回来：不认识的角色丢掉、重复的去掉；存坏了当没存（= 默认） */
export function 规整分配谁能用(v: unknown): 分配谁能用配置 {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const 出: 分配谁能用配置 = {};
  for (const [id, xs] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(xs)) 出[id] = 分配可选角色.filter((r) => xs.includes(r));
  }
  return 出;
}

/** 这一项哪几类能用（总管理、管理员不算在内）；"所有人" = 后加的、没设过的 */
export function 谁能用(id: string, 配置: 分配谁能用配置): readonly 分配可选角色[] | "所有人" {
  return 配置[id] ?? 分配默认谁能用[id] ?? "所有人";
}

export function 能用分配方式(org: 组织, 我: { id: string; role: string }, id: string, 配置: 分配谁能用配置): boolean {
  if (我.role === "ADMIN") return true;
  const 们 = org.成员.get(我.id)?.角色们;
  if (!们?.length) return false;
  if (们.includes("director") || 们.includes("admin")) return true;
  const 能 = 谁能用(id, 配置);
  // 兼几个角色的（10-27），哪个角色能用都算
  return 能 === "所有人" || 们.some((r) => 能.includes(r as 分配可选角色));
}

/** 挡住时那句：「指定分配」只有总管理、管理员和市场管理、销售管理能用 */
export function 谁能用的话(id: string, 名: string, 配置: 分配谁能用配置): string {
  const 能 = 谁能用(id, 配置);
  const 列 = 能 === "所有人" ? [] : 能.map((r) => 角色名[r]);
  return `「${名}」只有老板、总管理、管理员${列.length ? `和${列.join("、")}` : ""}能用`;
}
