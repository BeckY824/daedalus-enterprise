/**
 * 刚记的沟通「撤销」（A7-1，11-03）：纯函数，前后端共用（这里不碰数据库，客户端也能引）。
 * - 只认本人记的、记下 撤销窗口分钟 以内的；时间以服务器为准（前端只拿来决定摆不摆按钮，点了服务器再判一次）。
 * - 撤销 = 走 deleteFollowUp：企业版软删进回收站、照旧记审计。过了窗口就和别的沟通一样，去「…」里删（负责人本人或系统管理员）。
 */
export const 撤销窗口分钟 = 10;
const 窗口毫秒 = 撤销窗口分钟 * 60_000;

export const 不是本人记的话 = "只能撤销自己记的沟通";
export const 撤销过时话 = `已经超过 ${撤销窗口分钟} 分钟，撤销不了了；要删请用这条沟通的「…」菜单`;

function 毫秒(t: Date | string): number {
  return typeof t === "string" ? new Date(t).getTime() : t.getTime();
}

/** 能撤就给 null，不能撤给一句说清为什么（服务器用） */
export function 撤销拦(me: { id: string }, f: { ownerId: string | null; createdAt: Date | string }, now: Date = new Date()): string | null {
  if (f.ownerId !== me.id) return 不是本人记的话;
  const 过了 = now.getTime() - 毫秒(f.createdAt);
  if (!(过了 <= 窗口毫秒)) return 撤销过时话;
  return null;
}

/** 前端摆不摆「撤销」：本人记的、记下不到 10 分钟。createdAt 没带（老数据、别处来的行）就不摆 */
export function 时间线可撤(我记的: boolean | undefined, createdAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!我记的 || !createdAt) return false;
  const 过了 = now - 毫秒(createdAt);
  return 过了 <= 窗口毫秒;
}

/** 还剩多少毫秒到窗口关（前端到点把按钮收起来用）；已过给 0 */
export function 撤销剩余毫秒(createdAt: string, now: number = Date.now()): number {
  return Math.max(0, 窗口毫秒 - (now - 毫秒(createdAt)));
}
