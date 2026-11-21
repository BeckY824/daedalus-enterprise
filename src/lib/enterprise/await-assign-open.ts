/**
 * 待分配新线索的本线条件、对本线管理放开（P-转-42，用户 11-21 定「放开给本线管理」）。
 *
 * 从 await-assign-core.ts 挪出来：core 只放浏览器组件也要的常量和类型（新线索页、首页那一行），不带运行时依赖；
 * 这里的几条要 assign-line（项目业务线），由 permissions.ts（能看项目）、visibility.ts（数据层放开）、await-assign-scope.ts（首页数 / 列表）用。
 * 仍是纯函数、不 import prisma（permissions.ts 也被客户端组件 import）。
 */
import type { Prisma } from "@/generated/prisma";
import type { 组织 } from "./org-core";
import { 三种业务线, 是业务线, 项目业务线 } from "./assign-line";
import type { 线 } from "./lead-assign";
import { 待分配在等 } from "./await-assign-core";

/** 设了业务线的人能分哪几条：这条线的（同 项目业务线），加上「暂不分配」的 */
export function 本线待分配条件(org: 组织, 线: 线): Prisma.ProjectWhereInput {
  const 未填: Prisma.ProjectWhereInput = { OR: [{ bizLine: null }, { bizLine: { notIn: [...三种业务线] } }] };
  const 外贸们 = [...org.成员].filter(([, m]) => m.line === "外贸").map(([id]) => id);
  const 负责人 = 线 === "外贸" ? { ownerId: { in: 外贸们 } } : { ownerId: { notIn: 外贸们 } };
  return { OR: [{ bizLine: 线 }, { bizLine: "暂不分配" }, { AND: [未填, 负责人] }] };
}

/**
 * 待分配对本线管理放开：销售管理、条线总管理（总管理设了业务线）看得到、能手动分配
 * 还在待分配的新线索——负责人那一格是建的人（常是市场同事）占着，按原可见范围（只到下属）他们看不到、分不了。
 * 回这人放开到哪条线（null = 没设线，各线都算）；不是这两类 = undefined。开关、只读、只看某人由调用方判。
 * 只放开看和分配：改字段、初判 / 推进、删、转让照旧按负责人判（permissions.ts），客户本身不跟着放开；分出去后照原范围
 */
export function 本线放开的线(org: 组织, id: string): 线 | null | undefined {
  const m = org.成员.get(id);
  if (!m) return undefined;
  if (m.角色们.includes("sales_mgr")) return 是业务线(m.line) ? m.line : null;
  if (m.角色们.includes("director") && 是业务线(m.line)) return m.line;
  return undefined;
}

/** 放开的那几条在库里的条件（可见层 team-scope 并进项目的读条件） */
export function 本线放开条件(org: 组织, 线: 线 | null): Prisma.ProjectWhereInput {
  return 线 ? { AND: [待分配在等, 本线待分配条件(org, 线)] } : 待分配在等;
}

/**
 * 同一件事的纯判断（项目详情 能看项目）：「线索分配」开着（org.线索分配开着，org.ts 读组织 填，和 visibility.ts 同一个 Setting、同一个认法），
 * 这条项目现在还在待分配、业务线是这人放开的线。
 * 项目要带 待分配在等 那几格（permissions.ts 权限项目列）；没带的当不在待分配，不放开
 */
export function 本线放开看得到(org: 组织, id: string, p: {
  ownerId: string; bizLine?: string | null; phase?: string | null; result?: string | null; pooledAt?: Date | null;
  awaitAssignAt?: Date | null; scheduledAssignAt?: Date | null; deletedAt?: Date | null;
}): boolean {
  if (!org.线索分配开着) return false;
  const 线 = 本线放开的线(org, id);
  if (线 === undefined) return false;
  if (p.phase !== "线索" || !p.awaitAssignAt || p.scheduledAssignAt || p.pooledAt || p.result || p.deletedAt) return false;
  if (!线) return true;
  const 项目线 = 项目业务线(p, org.成员);
  return 项目线 === 线 || 项目线 === "暂不分配";
}
