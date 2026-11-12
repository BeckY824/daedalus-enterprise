/**
 * 左栏收成只剩图标的窄栏（11-12 客户详情第 1 批）：只在客户详情 /customers/<id> 上收，给档案、沟通记录多让出 160px。
 * 列表 /customers、/customers/recent、/customers/new 之类不收；/customers/<id>/edit 这类子页也不收。离开就回到原来的宽度。
 * 宽度本身写在 globals.css 的 .rail-mini（覆盖 --rail-w），这里只认路由
 */
const 不是档案 = new Set(["new", "recent", "import"]);

export function 左栏收窄(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const 段 = pathname.split("?")[0].split("/").filter(Boolean);
  return 段.length === 2 && 段[0] === "customers" && !不是档案.has(段[1]);
}
