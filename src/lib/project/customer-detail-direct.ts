import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能看项目, 权限项目选, 带已加入, type 谁 } from "@/lib/enterprise/permissions";
import { 市场进不了详情的 } from "@/lib/enterprise/market-view-db";
import { 原负责人回避, 回避豁免, 项目放回人们 } from "./pool-owner";
import { 看得到的客户 } from "./db";
import { 客户页项目地址, 录音确认参数, 带录音确认参数 } from "./customer-detail-href";
import { 仅项目客户们 } from "@/lib/enterprise/project-only-customers";
import { 有放弃参数, 带放弃参数 } from "@/lib/enterprise/lead-giveup-core";

/** 老的项目页地址：拿不准跳不跳的入口照旧给它，让项目页自己判 */
export const 项目页地址 = (id: string): string => `/projects/${encodeURIComponent(id)}`;

/**
 * 站内入口链到项目（11-12 客户详情合并第 2 批审查 #3；跳转优化 PR-A 补）：/projects/<id> 会跳去客户页项目页签的，直接给客户页地址——
 * 少一跳，也不经过 Next 的 RedirectBoundary（它接住重定向时先把正文渲染成空，约 130ms 空白）。
 * 拿不准的照旧给 /projects/<id>，让项目页自己判（projects/[id]/load.ts 项目页去向）。
 * 口径和 项目页去向 跳客户页那条一一对上（tests/ent-project-direct-link.test.ts 逐种对拍）：
 * 市场没挡、能看项目、看得到客户（或「仅项目」里有这个项目）；在公海的再过原负责人回避（回避开着、我是上一任、又不豁免 = 不给，项目页 404）。
 * 市场挡着、列表里有那一行的（项目页 转向 客户列表高亮）不在这里算，照旧经项目页
 */
export async function 项目链接们(me: 谁, ids: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const 们 = [...new Set(ids.filter((x): x is string => !!x))];
  const 原 = new Map(们.map((id) => [id, 项目页地址(id)]));
  if (!企业版() || !们.length) return 原;
  const 行 = await prisma.project.findMany({
    where: { id: { in: 们 } },
    select: { id: true, customerId: true, ...权限项目选 },
  });
  if (!行.length) return 原;
  const 公海的 = 行.filter((r) => r.pooledAt).map((r) => r.id);
  const [org, 市场挡, 看得到, 上一任] = await Promise.all([
    权限组织(), 市场进不了详情的(me.id, 行.map((r) => r.id)), 看得到的客户(行.map((r) => r.customerId)), 公海上一任(me, 公海的),
  ]);
  // 只负责项目的人：客户看不到，但他自己的项目跳受限客户详情（同 项目页去向）。结果里有客户看不到、又是我负责的项目才算这份集合（全局搜索每敲一下都走这里）
  const 仅项目 = 行.some((r) => !看得到.has(r.customerId) && r.ownerId === me.id)
    ? new Set([...(await 仅项目客户们(me)).values()].flat())
    : new Set<string>();
  for (const r of 行) {
    if (市场挡.has(r.id) || (!看得到.has(r.customerId) && !仅项目.has(r.id))) continue;
    if (!能看项目(me, 带已加入(r), org)) continue;
    if (r.pooledAt && 上一任 && (上一任.get(r.id) ?? (r.ownerId || null)) === me.id) continue;
    原.set(r.id, 客户页项目地址(r.customerId, r.id));
  }
  return 原;
}

/** 公海里的项目，要判原负责人回避的：项目 id → 最近一次放公海时的负责人（没有这条痕 = 不在表里，退回项目上的 ownerId，同 项目页去向）。不用判（回避关、豁免、没有公海项目）= null */
async function 公海上一任(me: 谁, ids: string[]): Promise<Map<string, string | null> | null> {
  if (!ids.length || !原负责人回避() || (await 回避豁免(me))) return null;
  // 认 Project.poolPrevOwnerId（E-417 包 2）；空列不在表里，判的地方照旧退回项目上的 ownerId
  const 表 = new Map<string, string | null>();
  for (const [id, 人] of await 项目放回人们(prisma, ids)) 表.set(id, 人);
  return 表;
}

/** 给一批行补上 项目去（这一行项目的最终地址，同 项目链接们）；id 取不到的行不补 */
export async function 补项目去<T extends object>(me: 谁, 行们: readonly T[], id: (r: T) => string | null | undefined): Promise<(T & { 项目去?: string })[]> {
  if (!行们.length) return [...行们];
  const 链 = await 项目链接们(me, 行们.map(id));
  return 行们.map((r) => {
    const i = id(r);
    const 到 = i ? 链.get(i) : undefined;
    return 到 ? { ...r, 项目去: 到 } : r;
  });
}

/** 站内存着的链接（通知、看板待办的去处）里认得出的项目页：/projects/<id>，可带 ?查询，不带 # */
const 项目页链接 = /^\/projects\/([^/?#]+)(?:\?([^#]*))?$/;

/**
 * 存好的链接（通知等）里指向项目页的，换成项目页会跳去的最终地址；别的原样。
 * 同 projects/[id]/page.tsx 那条跳转：只把 ?giveup=1、录音通知的 crec=<编号> 带过去，别的参数跳的时候本来就丢
 */
export async function 改直达链接们<T extends string | null>(me: 谁, 链接们: readonly T[]): Promise<(T | string)[]> {
  const 项目of = (l: string | null): string | null => {
    const m = l ? 项目页链接.exec(l) : null;
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
  };
  const ids = 链接们.map(项目of);
  if (!ids.some(Boolean)) return [...链接们];
  const 链 = await 项目链接们(me, ids);
  return 链接们.map((l, i) => {
    const id = ids[i];
    const 到 = id ? 链.get(id) : undefined;
    if (!l || !id || !到 || 到 === 项目页地址(id)) return l;
    const 录音号 = new URLSearchParams(项目页链接.exec(l)?.[2] ?? "").get(录音确认参数);
    return 带录音确认参数(有放弃参数(l) ? 带放弃参数(到) : 到, 录音号);
  });
}
