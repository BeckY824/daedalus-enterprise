/**
 * 指定分配的选人下拉（审核 11-18 追加：只列能被指定的人，不等服务端拒）。纯函数，客户端、服务端都能用。
 * 可指定 = 服务端 assign-eta.ts 可指定的人（在职销售 / 销售管理、参与状态正常，和 指定问题 同一口径）；没给（老数据、非企业版）= 不筛。
 * 我自己照列（指定给自己 = 记在自己名下，服务端不查参与状态）。现在选着、但不能指定的那位留在下拉里、灰掉，免得格子里露出内部编号
 */
import { 按方向挑, type 指定候选表 } from "./assign-direction-pick-core";

export type 选项 = { value: string; label: string; disabled?: boolean };

/**
 * 新线索向导「指定分配」负责人下拉能列的人（P-转-26，11-20）：可指定（参与状态正常）再叠方向——市场成员选了业务线内贸 / 外贸，
 * 只留这个方向能挑的人（同客户转让框 按方向挑；服务端 assign-direction-pick.ts 新建指定方向挡 同一张表）。
 * 没给候选表（不是市场成员、兼管理的）、业务线没选 / 暂不分配 = 只按可指定（原样）
 */
export function 方向可指定(可指定: readonly string[] | null | undefined, 表: 指定候选表 | null | undefined, 业务线: string | null | undefined): string[] | undefined {
  if (!表 || (业务线 !== "内贸" && 业务线 !== "外贸")) return 可指定 ? [...可指定] : undefined;
  const 向 = new Set(按方向挑(表, 业务线));
  return (可指定 ?? [...向]).filter((id) => 向.has(id));
}

export function 指定选项(全部: readonly 选项[], 可指定: readonly string[] | null | undefined, 我id?: string | null, 现值?: string | null): 选项[] {
  if (!可指定) return [...全部];
  const 能 = new Set(可指定);
  if (我id) 能.add(我id);
  const 出: 选项[] = 全部.filter((o) => 能.has(o.value));
  if (现值 && !能.has(现值)) {
    const 原 = 全部.find((o) => o.value === 现值);
    if (原) 出.push({ value: 原.value, label: `${原.label}（不能被指定）`, disabled: true });
  }
  return 出;
}
