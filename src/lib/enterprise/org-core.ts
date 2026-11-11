/**
 * 企业版组织架构的纯函数（2026-10-24）：组织里谁是谁、谁管谁。
 *
 * 不碰数据库，所以 Prisma 那一层的限定（lib/enterprise/visibility.ts）也能直接用，不会绕回 lib/prisma.ts；
 * 从库里读组织在 org.ts。
 */
import { 业务角色 as 角色顺序, 部门最多层数, type 业务角色, type 业务线 } from "@/lib/sync/dept-policy";
import type { 组织部门 } from "./org-tree";

export type 组织成员 = {
  userId: string;
  deptId: string | null;
  /** 主角色 = 角色们里排最前的那个（按 dept-policy 的顺序）；没设业务角色 = null */
  bizRole: 业务角色 | null;
  /** 一个人可以兼几个角色（10-27 会议）。11-01 起空着 = 没设业务角色 = 什么权限都没有（不再按账号角色推） */
  角色们: 业务角色[];
  line: 业务线 | null;
  managerId: string | null;
  dottedManagerId: string | null;
  /** 「不管设置」（迁移 108）：总管理勾上以后进不了设置页 */
  不管设置: boolean;
};
/** 只含在职（User.active）的人：停用的人不当任何人的上级，也不算谁的下属 */
export type 组织 = {
  成员: Map<string, 组织成员>;
  部门: Map<string, 组织部门>;
  /** 回收站副手（V3.5.1）：系统管理员之外能看、能恢复回收站的人。Setting enterprise.trash_helpers（逗号串 userId），org.ts 读组织 填 */
  回收站副手?: ReadonlySet<string>;
  /** 只看某人（V3.5.1 市管特例）：本人 → 那个人；业务数据只看那个人是创建人或负责人的。Setting enterprise.watch_only（JSON），org.ts 读组织 填 */
  只看某人?: ReadonlyMap<string, string>;
  /**
   * 系统管理员标记（P-判定-06）：设了业务线的总管理里，哪几位同时还是系统管理员。Setting enterprise.sysadmin_flag（JSON 数组 userId），org.ts 读组织 填。
   * 没设业务线的总管理不用进这份，读的时候就算系统管理员（老数据不丢权限，不用跑迁移）；见 是系统管理员of
   */
  系统管理员标记?: ReadonlySet<string>;
  /** 停用（离职）的人手填的直属上级：成员里不收停用的人，市场复核要找「离职创建人的直属市场管理」（客户 11-05）时查这里。建组织 填 */
  离职上级?: ReadonlyMap<string, string>;
};

/** 回收站副手名单存的 Setting 键（设置页存 JSON 数组；手写的逗号串也认） */
export const 回收站副手键 = "enterprise.trash_helpers";
/** 只看某人存的 Setting 键（JSON {本人 userId: 那个人 userId}），设置页「组织架构」里配 */

export const 只看某人键 = "enterprise.watch_only";
/** 系统管理员标记存的 Setting 键（JSON 数组 userId）：成员管理里总管理那一格的「系统管理员」开关写它 */
export const 系统管理员标记键 = "enterprise.sysadmin_flag";

/** Setting 原文：JSON 解得开就解（setSetting 存的），解不开当原样字符串（库里手写的逗号串） */
function 解码(v: string | null | undefined): unknown {
  if (!v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

/** userId 名单（JSON 数组，或手写的逗号串）：只留在职的 */
function 解名单(v: string | null | undefined, org: 组织): Set<string> {
  const 解 = 解码(v);
  const 们 = Array.isArray(解) ? 解 : typeof 解 === "string" ? 解.split(",") : [];
  return new Set(们.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter((x) => org.成员.has(x)));
}

/**
 * 读完 Setting 后补上组织里的几份名单（org.ts 读组织、visibility.ts 算 共用）：回收站副手（逗号串）、只看某人（JSON）、系统管理员标记（JSON 数组）。
 * 标记没传（undefined）= 不动 org 上原有的，传 null = 没设
 */
export function 填组织设置(org: 组织, 副手: string | null | undefined, 只看: string | null | undefined, 标记?: string | null): 组织 {
  org.回收站副手 = 解名单(副手, org);
  org.只看某人 = 规整只看某人(只看, org);
  if (标记 !== undefined) org.系统管理员标记 = 解名单(标记, org);
  return org;
}

/**
 * 系统管理员（V3.5.1 P-判定-03、P-判定-06）：业务角色有总管理（director），并且 没设业务线，或 带着系统管理员标记。
 * 两个身份并存：设了业务线又带标记的，同时是那条线的条线总管理（line-viewer.ts 条线的线）。
 * 纯函数，permissions.ts 是系统管理员、view-as.ts 能切换视图 都走这里；老规矩（不是企业版）在 permissions.ts 里另判
 */
export function 是系统管理员of(org: 组织, userId: string): boolean {
  const m = org.成员.get(userId);
  return !!m && m.角色们.includes("director") && (!m.line || !!org.系统管理员标记?.has(userId));
}

/** 能管设置的系统管理员：是系统管理员、没勾「不管设置」（同 permissions.ts 能进设置）。组织架构、成员管理、停用的「留一位」守卫都按这个数 */
export const 能管设置of = (org: 组织, userId: string): boolean => 是系统管理员of(org, userId) && !org.成员.get(userId)?.不管设置;
/** 「留一位」守卫那一句；事务里写完重查不过就抛 留一位系统管理员错，事务回滚，调用方换成这句话回给界面 */
export const 留一位系统管理员话 = "至少要留一位能管设置的系统管理员（业务角色总管理、是系统管理员、没勾「不管设置」）";
export class 留一位系统管理员错 extends Error {}
/** 还有没有一位能管设置的系统管理员；一位都没有就没人能再改角色、进设置了 */
export const 有人能管设置 = (org: 组织, 除了?: string): boolean => [...org.成员.keys()].some((id) => id !== 除了 && 能管设置of(org, id));

/** 解析 enterprise.watch_only（{本人: 那个人}）：两个都在职、不是同一个人才留；存坏了当没设 */
export function 规整只看某人(value: unknown, org: 组织): Map<string, string> {
  const m = new Map<string, string>();
  let o: unknown = typeof value === "string" ? 解码(value) : value;
  // setSetting 再包一层 JSON：解出来还是字符串就再解一次
  if (typeof o === "string") o = 解码(o);
  if (!o || typeof o !== "object" || Array.isArray(o)) return m;
  for (const [k, v] of Object.entries(o)) if (typeof v === "string" && k !== v && org.成员.has(k) && org.成员.has(v)) m.set(k, v);
  return m;
}

/**
 * 账号角色 → 业务角色的老对照：管理员 → 总管理员，主管 → 销售管理，其余 → 销售。
 * 11-01 起**不再拿来兜底权限**（没设业务角色 = 没权限，见 建组织）；只剩设置页「从账号角色带一个初始勾选」这类提示用
 */
export function 推业务角色(账号角色: string | null | undefined): 业务角色 {
  return 账号角色 === "ADMIN" ? "director" : 账号角色 === "MANAGER" ? "sales_mgr" : "sales";
}

/**
 * EntMember.bizRole 存逗号串（10-27：业务角色可多选，不加字段）：拆开、丢掉不认识的、去重、按固定顺序排。
 * 老数据就是一个角色，拆出来还是它自己。
 */
export function 拆角色(s: string | null | undefined): 业务角色[] {
  const 有 = new Set(String(s ?? "").split(",").map((x) => x.trim()));
  return 角色顺序.filter((r) => 有.has(r));
}
/** 存回库里的样子；空数组 = 空串（调用方自己挡） */
export const 合角色 = (们: readonly string[]): string => 拆角色(们.join(",")).join(",");

const 是业务线 = (x: unknown): x is 业务线 => x === "内贸" || x === "外贸";

export function 建组织(
  users: readonly { id: string; role: string; active: boolean }[],
  members: readonly { userId: string; deptId: string | null; bizRole: string; line: string | null; managerId: string | null; dottedManagerId: string | null; noSettings?: boolean | null }[],
  depts: readonly 组织部门[],
): 组织 {
  const 行 = new Map(members.map((m) => [m.userId, m]));
  const 部门 = new Map(depts.map((d) => [d.id, d]));
  const 成员 = new Map<string, 组织成员>();
  const 离职上级 = new Map<string, string>();
  for (const u of users) {
    if (!u.active) {
      const 上 = 行.get(u.id)?.managerId;
      if (上 && 上 !== u.id) 离职上级.set(u.id, 上);
      continue;
    }
    const m = 行.get(u.id);
    // 11-01 用户定「兜底不留，没设业务角色就没权限」：没有 EntMember 行、或角色串是空的 = 角色们空着，不再按账号角色推
    const 角色们 = 拆角色(m?.bizRole);
    成员.set(u.id, {
      userId: u.id,
      // 部门被删了的当没分部门
      deptId: m?.deptId && 部门.has(m.deptId) ? m.deptId : null,
      bizRole: 角色们[0] ?? null,
      角色们,
      line: m && 是业务线(m.line) ? m.line : null,
      managerId: m?.managerId ?? null,
      dottedManagerId: m?.dottedManagerId ?? null,
      不管设置: !!m?.noSettings,
    });
  }
  return { 成员, 部门, 离职上级 };
}

/**
 * 直属上级（11-03 C10-1 定）：只认手填的「直属上级」（managerId）。没填、填的人停用了、填的是自己 = 没有上级，
 * 不再按部门往上找销售管理。权限（上级看下属、转让、办离职）、通知、卡点、提成都只认这一处
 */
export function 直属上级of(org: 组织, userId: string): string | null {
  const m = org.成员.get(userId);
  if (!m?.managerId || m.managerId === userId || !org.成员.has(m.managerId)) return null;
  return m.managerId;
}

/**
 * 这件事要告诉谁（通知用）：负责人 + 他的直属上级。只留在职的（org.成员 只有在职的）、去重、去掉操作者。
 * 负责人停用了 = 直属上级of 也找不到人，这条谁都不发
 */
export function 负责人和上级(org: 组织, ownerId: string, 排除?: string): string[] {
  const 们 = [ownerId, 直属上级of(org, ownerId)].filter((id): id is string => !!id && org.成员.has(id) && id !== 排除);
  return [...new Set(们)];
}

/** 虚线上级：只认显式指定的，停用了 = 没有 */
export function 虚线上级of(org: 组织, userId: string): string | null {
  const d = org.成员.get(userId)?.dottedManagerId;
  return d && d !== userId && org.成员.has(d) ? d : null;
}

/** 顺着「上级」往下走出所有下属（不含自己），成环不会转圈。层数 1 = 只要直接下属 */
function 下属(org: 组织, 上级of: (org: 组织, id: string) => string | null, 我: string, 层数: number): Set<string> {
  const 下面 = new Map<string, string[]>();
  for (const id of org.成员.keys()) {
    const up = 上级of(org, id);
    if (up) 下面.set(up, [...(下面.get(up) ?? []), id]);
  }
  const 结果 = new Set<string>();
  const 见过 = new Set([我]);
  let 这层 = [我];
  for (let 层 = 0; 层 < 层数 && 这层.length; 层++) {
    const 下层: string[] = [];
    for (const a of 这层) for (const b of 下面.get(a) ?? []) if (!见过.has(b)) { 见过.add(b); 结果.add(b); 下层.push(b); }
    这层 = 下层;
  }
  return 结果;
}

/** 实线下属：直属上级链往下，默认整条链 */
export const 实线下属 = (org: 组织, 我: string, 层数 = Infinity) => 下属(org, 直属上级of, 我, 层数);
/** 虚线下属：只顺虚线往下（A 虚线管 B、B 虚线管 C，A 也看 C），同团队版 虚线上级规则 */
export const 虚线下属 = (org: 组织, 我: string, 层数 = Infinity) => 下属(org, 虚线上级of, 我, 层数);

/**
 * 企业版管理员类别（10-24）：销售管理 / 市场管理 / 总管理员；别的角色 = 不是管理员。
 * 11-01 晚拆开：总管理员只有 director；admin（管理员）单列一类「管理员」= 看全部、只读（lib/enterprise/permissions.ts 只读角色），
 * 所以问「能不能改」时 .has("总管理员") 不再放 admin 进来
 */
export type 管理员类别 = "销售管理" | "市场管理" | "总管理员" | "管理员";
/** 兼几个角色的人，几类都算（10-27）：销售管理兼市场管理的，两边的权都有 */
export function 管理员类别们of(org: 组织, userId: string): Set<管理员类别> {
  const 们 = new Set<管理员类别>();
  // 设了「只看某人」的人角色挂着也不算任何一类管理员（V3.5.1 市管特例，11-03）：不收复核、满额 / 待分配提醒，不管渠道、不做市场复核
  if (org.只看某人?.has(userId)) return 们;
  for (const r of org.成员.get(userId)?.角色们 ?? []) {
    if (r === "director") 们.add("总管理员");
    else if (r === "admin") 们.add("管理员");
    else if (r === "sales_mgr") 们.add("销售管理");
    else if (r === "marketing_mgr") 们.add("市场管理");
  }
  return 们;
}
/**
 * 「市场复核」谁能拍（11-05 客户定，同日客户回复两条兜底）：
 * - 建的人不是负责人：建的人本人，或他的直属上级且是市场管理；
 * - 建的人自己就是负责人（初判是他自己判的，不复核自己）、或已离职停用：只有他的直属上级且是市场管理（离职的人按离职前手填的那位）；
 * - 上面那位找不到（没填、不是市场管理、也停用了）：只有系统总管理（系统管理员，是系统管理员of）。
 * 不再有「任何市场管理都能拍」的兜底。虚线上级接手等虚线上级能操作以后再加（迭代备忘）
 */
export function 能市场复核(org: 组织, me: string, p: { creatorId?: string | null; ownerId: string }): boolean {
  const 市管 = (id: string) => 管理员类别们of(org, id).has("市场管理");
  const 系统总管理 = 是系统管理员of(org, me);
  const c = p.creatorId;
  const 在 = !!c && org.成员.has(c);
  if (在 && me === c && c !== p.ownerId) return true;
  const 上 = !c ? null : 在 ? 直属上级of(org, c) : 离职直属上级(org, c);
  if (上 && 市管(上)) return me === 上;
  // 建的人不是负责人、在职、又没有直属市场管理：他本人复核（上面已放行），不再推给总管理
  if (在 && c !== p.ownerId) return false;
  return 系统总管理;
}
/** 离职（停用）的人离职前手填的直属上级，且那位还在职 */
function 离职直属上级(org: 组织, userId: string): string | null {
  const 上 = org.离职上级?.get(userId);
  return 上 && org.成员.has(上) ? 上 : null;
}
/** 最高的那一类：总管理员 > 销售管理 > 市场管理 > 管理员（只读）；只问「是不是总管理员 / 是不是管理员」时用，问别的类用 管理员类别们of */
export function 管理员类别of(org: 组织, userId: string): 管理员类别 | null {
  const 们 = 管理员类别们of(org, userId);
  return 们.has("总管理员") ? "总管理员" : 们.has("销售管理") ? "销售管理" : 们.has("市场管理") ? "市场管理" : 们.has("管理员") ? "管理员" : null;
}

/** 部门在第几层（一级部门 = 1，null = 顶上 = 0）；断链、成环 = Infinity */
export function 部门层数(部门: ReadonlyMap<string, 组织部门>, id: string | null): number {
  let n = 0;
  for (let cur = id; cur; cur = 部门.get(cur)!.parentId) {
    if (!部门.has(cur) || ++n > 部门最多层数 + 1) return Infinity;
  }
  return n;
}
/** 子树最深几层（自己 = 1）；成环的那一圈不往下走 */
function 子树深(部门: ReadonlyMap<string, 组织部门>, id: string, 见过 = new Set<string>()): number {
  见过.add(id);
  const 下面 = [...部门.values()].filter((d) => d.parentId === id && !见过.has(d.id));
  return 1 + Math.max(0, ...下面.map((d) => 子树深(部门, d.id, 见过)));
}

/**
 * 建部门（id = null）或把部门挪到 parentId 底下之前查一遍：返回出错原因，null = 可以。
 * 规则同团队版：挪完整棵子树仍不超过 部门最多层数 层、不能挪到自己或自己的下级部门底下。
 */
export function 部门挪动问题(部门: ReadonlyMap<string, 组织部门>, id: string | null, parentId: string | null): string | null {
  if (parentId && !部门.has(parentId)) return "上级部门不存在";
  if (id) {
    if (!部门.has(id)) return "部门不存在";
    for (let cur = parentId, i = 0; cur && i < 部门最多层数 + 2; cur = 部门.get(cur)?.parentId ?? null, i++) {
      if (cur === id) return "不能挪到自己或自己的下级部门底下";
    }
  }
  const 深 = id ? 子树深(部门, id) : 1;
  return 部门层数(部门, parentId) + 深 > 部门最多层数 ? `部门最多 ${部门最多层数} 层` : null;
}

/**
 * 给 userId 设直属 / 虚线上级之前查一遍：返回出错原因，null = 可以（上级 = null 是清掉，总是可以）。
 * 不能是自己、不能是停用的人、不能是自己（实线 / 虚线）链上的下属——否则上级链成环，谁也管不到谁。
 */
export function 上级设置问题(org: 组织, userId: string, 上级: string | null, 种类: "直属" | "虚线"): string | null {
  if (!上级) return null;
  if (!org.成员.has(userId)) return "这个人不在职";
  if (上级 === userId) return "上级不能是自己";
  if (!org.成员.has(上级)) return "选的上级不在职";
  if (种类 === "直属" && org.只看某人?.has(上级)) return "选的人设了「只看某人」，不能当别人的实线上级";
  const 下面 = 种类 === "直属" ? 实线下属(org, userId) : 虚线下属(org, userId);
  return 下面.has(上级) ? `选的人是他的${种类 === "直属" ? "" : "虚线"}下属，不能反过来当他的上级` : null;
}
