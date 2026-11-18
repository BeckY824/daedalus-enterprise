/**
 * 指定分配的选人下拉（审核 11-18 追加：只列能被指定的人，不等服务端拒）。纯函数，客户端、服务端都能用。
 * 可指定 = 服务端 assign-eta.ts 可指定的人（在职销售 / 销售管理、参与状态正常，和 指定问题 同一口径）；没给（老数据、非企业版）= 不筛。
 * 我自己照列（指定给自己 = 记在自己名下，服务端不查参与状态）。现在选着、但不能指定的那位留在下拉里、灰掉，免得格子里露出内部编号
 */
export type 选项 = { value: string; label: string; disabled?: boolean };

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
