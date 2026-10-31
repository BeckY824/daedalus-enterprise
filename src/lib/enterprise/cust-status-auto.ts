/**
 * 企业版客户状态按项目自动算（10-30，照客户原飞书表「当前阶段」那条公式）。纯函数，库读写在 cust-status-auto-db.ts。
 *
 * 一个客户名下的项目（Project.customerId 指着它的，软删的不算；关联客户 ProjectCustomer 不算）：
 *   1. 先数交付结清的：≥3 忠诚，2 复购，1 交付（有交付的不管别的项目怎样，按交付个数定）
 *   2. 一个都没交付：按下面的先后，命中第一条就定
 *      异常（有订单处在异常状态）> 丢单（商机阶段丢了）> 流失（线索阶段流失）
 *      > 成交（付了首款：商机最后一个节点「首款到账」，或者已经进了订单阶段、还没结局）
 *      > 意向（进了商机、还没结局）> 潜在（有项目，都还在线索阶段）
 *   3. 一个项目都没有：null（不写状态）
 *
 * 模型里怎么对：
 *   - 交付结清 = result「交付结清」（库里存着旧名「成功交付」的也算，企业版 10-31 改名）；异常 = result「异常状态」；丢单 = result「丢单」；流失 = result「线索流失」（结局只认 result，不看阶段）
 *   - 「已转商机」「商机赢单」不是结局，是进了下一阶段第一个节点：已转商机 = phase 商机，赢单 = phase 订单
 *   - 付了首款 = 没结局且（phase 订单，或 phase 商机、node 首款到账；旧名「首款支付」也算）
 *
 * 返回的是字典 custStatus 的默认序号（dict-custStatus-<序号>），存库时换成这一项现在的名字：管理员改了名照样对得上，不写死名字。
 */

import { 企业版字典, 本套名, 是交付 } from "@/lib/project/stage-dict";

/** 字典 custStatus 默认九项的序号（id = dict-custStatus-<序号>，排序换过、id 没动） */
export const 客户状态序号 = { 潜在: 0, 意向: 1, 成交: 2, 交付: 3, 复购: 4, 忠诚: 5, 丢单: 6, 流失: 7, 异常: 8 } as const;
export type 客户状态序号 = (typeof 客户状态序号)[keyof typeof 客户状态序号];

/** 算状态要的项目几列 */
export type 算状态的项目 = { phase: string; node: string; result: string | null; deletedAt?: Date | null };

/** 付了首款：没结局，进了订单，或停在商机最后一个节点首款到账（库里旧名也认） */
function 付了首款(p: 算状态的项目): boolean {
  return p.result == null && (p.phase === "订单" || (p.phase === "商机" && 本套名(p.node, 企业版字典) === "首款到账"));
}

/** 进了商机、还没结局 */
function 在商机(p: 算状态的项目): boolean {
  return p.result == null && p.phase === "商机";
}

/** 一个客户名下的项目 → 客户状态序号；没有项目（软删的不算）= null */
export function 算客户状态(项目们: readonly 算状态的项目[]): 客户状态序号 | null {
  const 在的 = 项目们.filter((p) => !p.deletedAt);
  if (!在的.length) return null;
  const 交付数 = 在的.filter((p) => 是交付(p.result)).length;
  if (交付数 >= 3) return 客户状态序号.忠诚;
  if (交付数 === 2) return 客户状态序号.复购;
  if (交付数 === 1) return 客户状态序号.交付;
  if (在的.some((p) => p.result === "异常状态")) return 客户状态序号.异常;
  if (在的.some((p) => p.result === "丢单")) return 客户状态序号.丢单;
  if (在的.some((p) => p.result === "线索流失")) return 客户状态序号.流失;
  if (在的.some(付了首款)) return 客户状态序号.成交;
  if (在的.some(在商机)) return 客户状态序号.意向;
  return 客户状态序号.潜在;
}

/** 序号 → 字典项 id */
export const 客户状态id = (i: number) => `dict-custStatus-${i}`;
