/**
 * 市场成员「指定分配」也先定方向（P-转-26 指定那一半，11-18 3703 实点发现）：客户转让框（详情 TransferBox、列表批量 TransferDialog）
 * 在市场分配模式下（市场成员转「暂不分配」的客户，同自动分配那份判定）选「指定分配」时，下拉只列这个方向能接的人：
 *   - 内贸：内贸事业部的销售 + 销售管理
 *   - 外贸：外贸事业部的销售（不含外贸销售管理）
 * 再叠「可指定」（参与状态正常：不在暂停 / 禁止名单里）。方向判不出（区域、电话、本人事业部都没有）= 两条线都算。
 * 只管市场成员发起的；销管、总管理指定分配受不受方向限制还在等客户（X-141 ④），不动。服务端 assignSalesOwner 同口径拒，不信前端
 */
import { 读线部门, 不参与名单, 自动分配池 } from "./assign-eta";
import { 按部门候选 } from "./assign-line";
import { 按方向挑, 指定方向话, type 指定候选表 } from "./assign-direction-pick-core";
export { 按方向挑, 指定方向话, type 指定候选表 } from "./assign-direction-pick-core";
import { 自动候选人们, type 线 } from "./lead-assign";
import { 按区域分配of, type 分配方向 } from "./customer-region";
import { 客户在市场手里 } from "./market-transfer";
import { 暂不分配项目of } from "./cust-auto-assign";
import { 客户默认分配方向 } from "./assign-direction-db";
import { 企业版 } from "./switch";
import { 规则开着 } from "./rules";
import { 挡分配方式 } from "./dict";
import type { 组织 } from "./org-core";


export async function 指定方向候选表(org: 组织): Promise<指定候选表> {
  const [设, 不参与] = await Promise.all([读线部门(), 不参与名单()]);
  const 不 = new Set(不参与);
  const 内贸 = 按部门候选(org, null, "内贸", 设, 自动候选人们)
    .filter((id) => org.成员.get(id)?.角色们.some((r) => r === "sales" || r === "sales_mgr"));
  // 外贸只要销售，不含外贸销售管理（同自动分配池）
  const 外贸 = 自动分配池(org, null, "外贸", 设);
  return { 内贸: 内贸.filter((id) => !不.has(id)), 外贸: 外贸.filter((id) => !不.has(id)) };
}


/**
 * 这位客户这次转让要不要按方向定人：市场成员（按岗位）、客户在市场手里、名下有暂不分配的线索项目，
 * 且是「市场分配」（规则「线索分配」开着、自动分配方式可用，同 cust-auto-assign.ts 市场分配指定挡）。要 = 回那个项目 id
 */
export async function 要按方向指定(me: { id: string; role: string }, org: 组织, c: { id: string; salesOwnerId: string; bizLine: string | null; pool: { customerId: string } | null }): Promise<string | null> {
  if (!企业版() || !按区域分配of(org, me.id) || !客户在市场手里(org, c)) return null;
  if (!(await 规则开着("线索分配")) || (await 挡分配方式(me, 1))) return null;
  return 暂不分配项目of(c);
}

/**
 * 服务端那道（assignSalesOwner）：勾的客户里要按方向指定的，每位按「交来的方向 ?? 这位客户的默认方向」核接手人在不在能挑的人里。
 * 不在 = 回原因（整批不转）；都对得上 / 都不用按方向 = null
 */
export async function 市场指定方向挡(
  me: { id: string; role: string }, org: 组织,
  客户们: readonly { id: string; name: string; salesOwnerId: string; bizLine: string | null; pool: { customerId: string } | null }[],
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
    if (!按方向挑(表, 向.线).includes(接手人)) return `「${c.name}」${指定方向话(向.线)}：换一位，或改分配方向`;
  }
  return null;
}
