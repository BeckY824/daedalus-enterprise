/**
 * ⌘K 那几处（跳转单 CommandBar、记录页左边的名单 CustomerRoster / ProjectRoster）共用的小算法，纯函数好测（11-03）。
 */

/** 搜不到时那句「没找到『xxx』」（C10-2）：按字算（表情不劈开），太长截断加省略号，整句不撑破一行 */
export function 没找到说法(q: string, 最长 = 20): string {
  const 字 = Array.from(q.trim().replace(/\s+/g, " "));
  return `没找到『${字.length > 最长 ? `${字.slice(0, 最长).join("")}…` : 字.join("")}』`;
}

/**
 * 名单搜索框里按回车去哪（C1-2）：搜了字、名单上有 → 第一位（就是排在最上面那位）；
 * 名单上一位都没有 → 去全量表格里按这个词搜；只是页签筛掉了 → 不动（同原来）。没打字不接
 */
export function 名单回车去处(q: string, 显示的: readonly { id: string }[], 搜到几位: number, 表: "/customers" | "/projects"): string | null {
  const k = q.trim();
  if (!k) return null;
  if (显示的[0]) return `${表}/${显示的[0].id}`;
  return 搜到几位 === 0 ? `${表}?keyword=${encodeURIComponent(k)}` : null;
}
