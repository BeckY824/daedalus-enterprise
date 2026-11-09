/**
 * 企业版「按线只读」（11-02）：业务角色 管理员（admin，不兼总管理）又设了业务线 = 只看这条线、一律不能改。
 * 没设业务线的管理员照旧看全部、不能改（权限在 permissions.ts 只读角色）。
 *
 * 看得到（负责人、创建人任一条对上就算）：
 *   - 负责人或创建人是这条线的成员（EntMember.line），不管项目标签是内贸还是外贸；
 *   - 负责人或创建人是下属（实线整条链 + 虚线下属和他们的实线下属），不按线滤；
 *   - 标签是这条线的（bizLine；没填按负责人的线算，同 项目业务线）；
 *   - 公海（公海不按线分）。
 *
 * 纯函数：不碰 prisma、team-scope。team-scope 是底层，这里只算名单和 where，算好了放进范围里传下去。
 */
import type { 业务线 } from "@/lib/sync/dept-policy";
import { 三种业务线 } from "./assign-line";
import { 实线下属, 虚线下属, type 组织 } from "./org-core";

export type 按线范围 = {
  本人: string;
  线: 业务线;
  /** 本人 + 下属 + 这条线的成员：负责人或创建人是他们就看得到 */
  人们: string[];
  /** 标记外贸的成员：没填标签的按负责人算线时要用（没设线、内贸都算内贸，同 项目业务线） */
  外贸们: string[];
};

/** 这个人按哪条线只读；null = 不是（不是管理员、兼了总管理、没设业务线） */
export function 按线的线(org: 组织, id: string): 业务线 | null {
  const m = org.成员.get(id);
  if (!m?.line || !m.角色们.includes("admin") || m.角色们.includes("director")) return null;
  return m.line;
}

export function 按线范围of(org: 组织, id: string): 按线范围 | null {
  const 线 = 按线的线(org, id);
  return 线 ? 范围(org, id, 线) : null;
}

/**
 * 条线总管理（V3.5.1，11-03）：总管理（director）又设了业务线 = 管这条线。没设业务线的总管理是系统管理员（permissions.ts 是系统管理员）。
 * 看本线人员名下全部、条线内能转让；不能编辑、不能删、进不了设置
 */
export function 条线的线(org: 组织, id: string): 业务线 | null {
  const m = org.成员.get(id);
  return m?.line && m.角色们.includes("director") ? m.line : null;
}

/** 条线总管理管得到的人：同 按线范围of（本人 + 下属 + 这条线的成员） */
export function 条线范围of(org: 组织, id: string): 按线范围 | null {
  const 线 = 条线的线(org, id);
  return 线 ? 范围(org, id, 线) : null;
}

function 范围(org: 组织, id: string, 线: 业务线): 按线范围 {
  const 人们 = new Set<string>([id, ...实线下属(org, id)]);
  for (const d of 虚线下属(org, id)) for (const x of [d, ...实线下属(org, d)]) 人们.add(x);
  const 外贸们: string[] = [];
  for (const [uid, m] of org.成员) {
    if (m.line === 线) 人们.add(uid);
    if (m.line === "外贸") 外贸们.push(uid);
  }
  return { 本人: id, 线, 人们: [...人们], 外贸们 };
}

/** 标签是这条线；标签没填（或存坏了）按负责人的线算 */
function 标签条件(x: 按线范围, 负责人列: "ownerId"): Record<string, unknown> {
  const 未填 = { OR: [{ bizLine: null }, { bizLine: { notIn: [...三种业务线] } }] };
  const 负责人 = { [负责人列]: x.线 === "外贸" ? { in: x.外贸们 } : { notIn: x.外贸们 } };
  return { OR: [{ bizLine: x.线 }, { AND: [未填, 负责人] }] };
}

/** 项目：负责人或创建人在 人们 里，或标签是这条线 */
export function 按线项目(x: 按线范围): Record<string, unknown> {
  return { OR: [{ ownerId: { in: x.人们 } }, { creatorId: { in: x.人们 } }, 标签条件(x, "ownerId")] };
}

/**
 * 客户的标签条件：同 标签条件，只多一件——公海里的客户负责人清空了（M-公海-03，挂占位账号，占位账号不在 外贸们 里），
 * 标签没填时按历史负责人判线：曾由外贸的人放进公海的算外贸。写不出「最近一次」，曾有 pool-release 就算（待解决：只认最近一次要不要收窄）
 */
function 客户标签条件(x: 按线范围): Record<string, unknown> {
  const 未填 = { OR: [{ bizLine: null }, { bizLine: { notIn: [...三种业务线] } }] };
  const 曾属外贸 = { pool: { isNot: null }, ownerLogs: { some: { kind: "pool-release", fromOwnerId: { in: x.外贸们 } } } };
  return x.线 === "外贸"
    ? { OR: [{ bizLine: x.线 }, { AND: [未填, { salesOwnerId: { in: x.外贸们 } }] }, { AND: [未填, 曾属外贸] }] }
    : { OR: [{ bizLine: x.线 }, { AND: [未填, { salesOwnerId: { notIn: x.外贸们 } }, { NOT: 曾属外贸 }] }] };
}

/** 客户：标签是这条线，或名下有这条线的项目。「按人」那一半（负责人、创建人、建过 / 负责项目）走 市场相关客户(人们) */
export function 按线客户(x: 按线范围): Record<string, unknown> {
  return { OR: [客户标签条件(x), { projects: { some: { deletedAt: null, ...标签条件(x, "ownerId") } } }] };
}
