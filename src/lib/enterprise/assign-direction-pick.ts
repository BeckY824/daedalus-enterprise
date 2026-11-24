/**
 * 市场成员「指定分配」也先定方向（P-转-26 指定那一半，11-18 3703 实点发现）：客户转让框（详情 TransferBox、列表批量 TransferDialog）
 * 在市场分配模式下（市场成员转「暂不分配」的客户，同自动分配那份判定）选「指定分配」时，下拉只列这个方向能接的人：
 *   - 内贸：内贸事业部的销售 + 销售管理
 *   - 外贸：外贸事业部的销售 + 销售管理（11-23 客户改口外贸销售管理也参与指定；含义乌档口：档口只排自动分配，指定不受限，P-转-27）
 *   两条线的销售管理都只进本人事业部那一条（自动可接，不跨线）
 * 再叠「可指定」（参与状态正常：不在暂停 / 禁止名单里）。方向判不出（区域、电话、本人事业部都没有）= 两条线都算。
 * 只管市场成员发起的；操作人兼条线总管理 / 销售管理（含系统管理员）的不按方向限人（P-转-26 末句，Even 11-18 问 1 选 A；
 * P-判定-01 任一角色放行，管理指定不限of）。服务端 assignSalesOwner 同口径拒，不信前端
 */
import { 读线部门, 不参与名单 } from "./assign-eta";
import { 按部门候选, 自动可接 } from "./assign-line";
import { 按方向挑, 指定方向话, 新建方向不符话, type 指定候选表 } from "./assign-direction-pick-core";
export { 按方向挑, 指定方向话, 新建方向不符话, type 指定候选表 } from "./assign-direction-pick-core";
import { 自动候选人们, type 线 } from "./lead-assign";
import { 按区域分配of, type 分配方向 } from "./customer-region";
import { 客户在市场手里 } from "./market-transfer";
import { 暂不分配项目of } from "./cust-auto-assign";
import { 客户默认分配方向 } from "./assign-direction-db";
import { 企业版 } from "./switch";
import { 规则开着 } from "./rules";
import { 挡分配方式 } from "./dict";
import { 管理指定不限of, type 组织 } from "./org-core";
import { 客户显名 } from "./customer-title";


export async function 指定方向候选表(org: 组织): Promise<指定候选表> {
  const [设, 不参与] = await Promise.all([读线部门(), 不参与名单()]);
  const 不 = new Set(不参与);
  // 两条线同一道能接（自动可接：销售 + 本人事业部是这条线的销售管理，不跨线）；义乌档口不排（P-转-27「指定分配不受这条限制」，自动分配池才排）
  const 内贸 = 自动可接(org, 按部门候选(org, null, "内贸", 设, 自动候选人们), "内贸", 设);
  const 外贸 = 自动可接(org, 按部门候选(org, null, "外贸", 设, 自动候选人们), "外贸", 设);
  return { 内贸: 内贸.filter((id) => !不.has(id)), 外贸: 外贸.filter((id) => !不.has(id)) };
}


/**
 * 新线索向导「指定分配」（市场成员新建时直接选负责人，projects/actions.ts 建档向导）也先定方向（P-转-26，11-20 3703 实操发现：
 * 内贸销售当负责人、方向选外贸照样建成、线记外贸）：选了方向（项目业务线内贸 / 外贸）就核负责人在不在这个方向能挑的人里
 * （同客户转让框那张 指定方向候选表：内贸 = 内贸事业部的销售 + 销售管理；外贸 = 外贸事业部的销售 + 销售管理）。
 * 只管市场成员发起的；兼条线总管理 / 销售管理的不按方向限人（同 要按方向指定）；指定给自己、方向选「暂不分配」/ 没选的不核。
 * 对不上 = 回原因（新建方向不符话）；对得上 / 不用核 = null
 */
export async function 新建指定方向挡(me: { id: string }, org: 组织, 负责人: string, 方向: string | null | undefined): Promise<string | null> {
  if (!企业版() || 负责人 === me.id || !按区域分配of(org, me.id) || 管理指定不限of(org, me.id)) return null;
  if (方向 !== "内贸" && 方向 !== "外贸") return null;
  return 按方向挑(await 指定方向候选表(org), 方向).includes(负责人) ? null : 新建方向不符话(方向);
}

/** 新线索向导「指定分配」负责人下拉按方向筛要的那张表：市场成员（不兼管理）才给，别人 = null（不按方向筛） */
export async function 新建指定候选表(me: { id: string }, org: 组织): Promise<指定候选表 | null> {
  return 企业版() && 按区域分配of(org, me.id) && !管理指定不限of(org, me.id) ? 指定方向候选表(org) : null;
}

/**
 * 这位客户这次转让要不要按方向定人：市场成员（按岗位）、不兼条线总管理 / 销售管理（管理指定不限of）、客户在市场手里、名下有暂不分配的线索项目，
 * 且是「市场分配」（规则「线索分配」开着、自动分配方式可用，同 cust-auto-assign.ts 市场分配指定挡）。要 = 回那个项目 id
 */
export async function 要按方向指定(me: { id: string; role: string }, org: 组织, c: { id: string; salesOwnerId: string; bizLine: string | null; pool: { customerId: string } | null }): Promise<string | null> {
  if (!企业版() || !按区域分配of(org, me.id) || 管理指定不限of(org, me.id) || !客户在市场手里(org, c)) return null;
  if (!(await 规则开着("线索分配")) || (await 挡分配方式(me, 1))) return null;
  return 暂不分配项目of(c);
}

/**
 * 服务端那道（assignSalesOwner）：勾的客户里要按方向指定的，每位按「交来的方向 ?? 这位客户的默认方向」核接手人在不在能挑的人里。
 * 不在 = 回原因（整批不转）；都对得上 / 都不用按方向 = null
 */
export async function 市场指定方向挡(
  me: { id: string; role: string }, org: 组织,
  客户们: readonly { id: string; name: string; shortName?: string | null; customerNo?: number | null; salesOwnerId: string; bizLine: string | null; pool: { customerId: string } | null }[],
  接手人: string, 交来?: 线,
): Promise<string | null> {
  // 指定给自己 = 记在自己名下，不是分出去（同 市场分配指定挡）
  if (接手人 === me.id) return null;
  let 表: 指定候选表 | null = null;
  for (const c of 客户们) {
    const projectId = await 要按方向指定(me, org, c);
    if (!projectId) continue;
    const 向: 分配方向 = 交来 ? { 线: 交来, 来源: "手动" } : await 客户默认分配方向(org, c.id, me.id, projectId);
    表 ??= await 指定方向候选表(org);
    if (!按方向挑(表, 向.线).includes(接手人)) return `「${客户显名(c)}」${指定方向话(向.线)}：换一位，或改分配方向`;
  }
  return null;
}
