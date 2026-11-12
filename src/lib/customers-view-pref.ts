/**
 * 企业版客户页「列表 / 看板」记哪个（11-12 客户详情合并第 3 批）：看板是按节点分列的项目看板，取数和列表完全不同，
 * 服务端要在画之前就知道画哪个（看板视图才取看板数据、列表视图不取），所以记在 cookie 里，不用只在浏览器里的 localStorage。
 * 只在这台电脑这个浏览器生效，和原来一样
 */
export const 客户页看法键 = "customers-view";
export type 客户页看法 = "board" | "list";

/** 浏览器里记下，再回到客户页（不带筛选，两边的筛选不通用）重新取一屏 */
export function 换客户页看法(v: 客户页看法, 去: { push: (u: string) => void; refresh: () => void }) {
  document.cookie = `${客户页看法键}=${v}; path=/; max-age=31536000; samesite=lax`;
  if (location.pathname + location.search === "/customers") 去.refresh();
  else 去.push("/customers");
}
