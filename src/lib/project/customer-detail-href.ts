/**
 * 客户详情合并（11-12 第 2 批）：项目住在客户详情的项目区里，一个项目的地址 = 客户详情 + ?project=<项目 id>。
 * 看板、列表里点项目名直接生成这个地址；老的 /projects/<id> 链接由项目详情页跳过来兜底
 */
export function 客户页项目地址(customerId: string, projectId: string, hash = ""): string {
  return `/customers/${encodeURIComponent(customerId)}?project=${encodeURIComponent(projectId)}${hash}`;
}

/**
 * 默认选哪个页签（?project 没带、或带的那个看不了）：我能看的、没结束的、最近有动静的（不在公海的优先）；
 * 一个没结束的都没有就选最近结束的。列表已按 updatedAt 倒序
 */
export function 默认页签<T extends { id: string; result: string | null; pooledAt: Date | null }>(们: readonly T[]): T | null {
  return 们.find((p) => !p.result && !p.pooledAt) ?? 们.find((p) => !p.result) ?? 们[0] ?? null;
}

/** 录音「整理好了」通知链接里的 crec=<录音编号>：项目页跳客户页时跟着带过去，沟通卡草稿条认出来直接打开确认框（别的参数照丢） */
export const 录音确认参数 = "crec";
const 录音编号样 = /^[A-Za-z0-9_-]{1,64}$/;
export function 带录音确认参数(到: string, 号: string | null | undefined): string {
  if (!号 || !录音编号样.test(号)) return 到;
  const i = 到.indexOf("#");
  const [主, 井] = i < 0 ? [到, ""] : [到.slice(0, i), 到.slice(i)];
  if (主.split(/[?&]/).slice(1).some((x) => x.startsWith(`${录音确认参数}=`))) return 到;
  return `${主}${主.includes("?") ? "&" : "?"}${录音确认参数}=${号}${井}`;
}
