/**
 * 刚加的那条排最前（11-03 C1-8 客户详情的联系人）：其余照原来的顺序（关键在前、早加的在前），
 * 不在列表里（还没刷新回来、或已经删了）就原样返回。不改原数组
 */
export function 刚加的排前<T extends { id: string }>(xs: readonly T[], 刚加的: string | null | undefined): readonly T[] {
  if (!刚加的) return xs;
  const i = xs.findIndex((x) => x.id === 刚加的);
  if (i <= 0) return xs;
  return [xs[i], ...xs.slice(0, i), ...xs.slice(i + 1)];
}
