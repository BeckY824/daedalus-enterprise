/**
 * 企业版「市场成员」（2026-10-31 定）：市场部门的人建的、负责过的客户，转给销售以后他还看得到（只读）。
 *
 * - 市场部门：组织规则里设一组部门（连下级部门）；没设 = 名字带「市场」的部门和它们的下级。
 * - 市场成员：在职、部门在市场部门里的人（组织里只有在职的人），再加上逐人设的（11-01：岗位调整试行期的人，部门不动也算市场成员）。
 * - 市场成员看得到（11-04 用户定，替代 10-31 那版）：自己负责的客户，加上自己创建（CustomerCreator）、已经有负责人（不在公海）的客户；
 *   公海里没负责人的不算（公海只在「公海」页签看）。渠道负责人、建过 / 负责过它的项目这两条路 11-04 起不再算。
 *   项目同理（permissions.ts 能看项目、team-scope.ts 看得到的项目）：自己负责的，加上自己建的、负责人不为空（不在公海）的；
 *   市场管理（bizRole marketing_mgr）看得到自己直属下级按上面算得到的，加上直属下级建的项目（线索），不管什么状态（11-05 客户定）。
 * - 「看得到」= 只读：不能改、不能记沟通、不能转、不能领；原来就能改的不降。只在企业版、「按组织看客户」开着时生效，线索照旧。
 *
 * 设置页的客户端组件也 import（部门多选），这里只放纯数据和纯函数，别 import prisma；读库、算范围在 visibility.ts。
 */
import type { 组织 } from "./org-core";
import type { 组织部门 } from "./org-tree";

/** Setting：市场部门的编号数组；没存 / 存的不对 = 按名字带「市场」认 */
export const 市场部门key = "enterprise.market_depts";
/** Setting：逐人设的市场成员（用户编号数组，11-01）；没存 = 没有 */
export const 市场成员key = "enterprise.market_users";
export const 市场只读话 = "这是市场成员相关的客户：只能看，不能改、不能转";

/** 存的、交来的都过一遍：去重、去空，不是数组 = null（按默认） */
export function 规整市场部门(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  return [...new Set(x.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()))];
}

/** 市场部门（连下级）：设了且还有在的部门按设的，不然按名字带「市场」的 */
export function 市场部门们(部门: ReadonlyMap<string, Pick<组织部门, "id" | "name" | "parentId">>, 设的: readonly string[] | null): Set<string> {
  const 设 = (设的 ?? []).filter((id) => 部门.has(id));
  const 种子 = 设.length ? 设 : [...部门.values()].filter((d) => d.name.includes("市场")).map((d) => d.id);
  const 子 = new Map<string, string[]>();
  for (const d of 部门.values()) if (d.parentId) 子.set(d.parentId, [...(子.get(d.parentId) ?? []), d.id]);
  const 出 = new Set<string>();
  const 走 = [...种子];
  while (走.length) {
    const id = 走.pop()!;
    if (出.has(id)) continue; // 成环的部门也只走一遍
    出.add(id);
    走.push(...(子.get(id) ?? []));
  }
  return 出;
}

/** 市场成员：组织里（在职）、部门在市场部门里的人，加上逐人设的（不在组织里了的不算） */
export function 市场成员们(org: 组织, 设的: readonly string[] | null, 设的人: readonly string[] | null = null): Set<string> {
  const 部门 = 市场部门们(org.部门, 设的);
  const 出 = new Set([...org.成员.values()].filter((m) => m.deptId && 部门.has(m.deptId)).map((m) => m.userId));
  for (const id of 设的人 ?? []) if (org.成员.has(id)) 出.add(id);
  return 出;
}

/** 这几位市场成员「相关」的客户（Prisma where）：负责人是他们，或创建人是他们、已经有负责人（不在公海）（11-04） */
export function 市场相关客户(们: readonly string[]) {
  const 里 = { in: [...们] };
  return {
    OR: [
      { salesOwnerId: 里 },
      { AND: [{ creator: { userId: 里 } }, { pool: { is: null } }] },
    ],
  };
}
