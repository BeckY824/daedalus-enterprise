/**
 * 企业版客户页「列表 / 看板」记哪个（11-12 客户详情合并第 3 批）：看板是按节点分列的项目看板，取数和列表完全不同，
 * 服务端要在画之前就知道画哪个（看板视图才取看板数据、列表视图不取），所以记在 cookie 里，不用只在浏览器里的 localStorage。
 * 只在这台电脑这个浏览器生效，和原来一样
 */
export const 客户页看法键 = "customers-view";
export type 客户页看法 = "board" | "list";

/**
 * 浏览器里记下，再按同一组筛选重新取一屏（C18：两边是同一行筛选，切视图筛选留着）。
 * 页码、每页条数、排序两边各算各的（列表翻客户、看板翻项目），换视图时去掉
 */
export function 换客户页看法(v: 客户页看法, 去: { push: (u: string) => void; refresh: () => void }) {
  document.cookie = `${客户页看法键}=${v}; path=/; max-age=31536000; samesite=lax`;
  const q = new URLSearchParams(location.search);
  for (const k of ["page", "pageSize", "sort", "sortCurrency"]) q.delete(k);
  const 址 = q.size ? `/customers?${q}` : "/customers";
  if (location.pathname + location.search === 址) 去.refresh();
  else 去.push(址);
}
