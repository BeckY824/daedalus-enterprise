/**
 * 客户转让可选「自动分配」（客户 11-17：「市场成员对暂不分配的客户进行分配时可选自动和指定」；之前定「市场一律用客户转让」）。
 * 客户详情「更多操作 → 客户转让」框：操作人是市场成员、客户是「暂不分配」的，框里多一个选择「指定分配 / 自动分配」；
 * 别的人、别的客户框不变。自动分配走新线索的同一套挑人（assign-actions 自动分给：本月分得最少、并列给最早建号的再按 id、配额照算；
 * 市场成员按客户区域定事业部，P-转-26），挑中后照市场转销售（P-转-03 例外、P-转-17）：客户连名下项目、联系人给这位销售，只通知接手人。
 *
 * 「暂不分配」的客户 = 不在公海、在市场成员手里（客户在市场手里：负责人是市场、不兼销售），并且名下有一条
 *   客户负责人自己的、还在线索阶段、没结局、没进公海的项目，满足其一：
 *     - 这条项目建的时候分配方式选的「暂不分配」（项目 assignMode，P-转-03 / X-90：留在建的人名下、潜客培育）
 *     - 这条项目的业务线是「暂不分配」
 *     - 客户业务线标签是「暂不分配」（M-必填-13）
 *   自动分配拿这条项目（最早建的）去挑人，客户和名下别的项目随客户一起走（市场转一位）。
 * 谁能用：按岗位认的市场成员（业务角色有市场管理或渠道运营；只认业务角色，不看账号 ADMIN / MANAGER），规则「线索分配」开着（同新建页，X-79），
 *   分配方式字典「自动分配」他能用，并且他能转让这位客户（能转让客户：本人、实线直属上级、系统管理员……）。
 * 页面（page.tsx 摆不摆）和服务端动作（客户自动分配）用同一份判定。这里读库，别在客户端 import
 * 客户列表批量转让（11-17）同一份：勾的几位一位一位按 能自动分配客户 判，不满足的那几位不自动分、回原因（批量客户自动分配）
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 规则开着 } from "./rules";
import { 读组织 } from "./org";
import { 管理指定不限of, type 组织 } from "./org-core";
import { 能转让客户 } from "./permissions";
import { 客户在市场手里 } from "./market-transfer";
import { 按区域分配of } from "./customer-region";
import { 分配方式叫法, 挡分配方式 } from "./dict";
import { 指定问题 } from "./assign-eta";

const 暂不分配 = "暂不分配";

export type 要看的客户 = { id: string; salesOwnerId: string; bizLine: string | null; pool: { customerId: string } | null };
type 我 = { id: string; role: string };

export const 不是市场话 = "只有市场成员（市场管理、渠道运营）才能给暂不分配的客户选自动分配";
export const 不是暂不分配话 = "这位客户不是「暂不分配」的（名下没有暂不分配、还在线索阶段的项目），请用指定分配";
export const 不在市场手里话 = "这位客户不在市场成员名下，不能自动分配，请用指定分配";
export const 公海里话 = "公海里的客户先领取或分配，不走客户转让";
export const 不能转话 = "只能转出自己的或直属下属的客户；别的找系统管理员转";

/**
 * 客户名下拿去自动分配的那条「暂不分配」项目（最早建的）；没有 = 这位不算暂不分配。
 * 分配方式按字典当前叫法认（改过名的也认），再认原名
 */
export async function 暂不分配项目of(c: Pick<要看的客户, "id" | "salesOwnerId" | "bizLine">): Promise<string | null> {
  if (!c.salesOwnerId) return null;
  const 名们 = [...new Set([await 分配方式叫法(3), 暂不分配])];
  const 暂不分配的 = c.bizLine === 暂不分配 ? {} : { OR: [{ assignMode: { in: 名们 } }, { bizLine: 暂不分配 }] };
  const p = await 看全部(() =>
    prisma.project.findFirst({
      where: { customerId: c.id, ownerId: c.salesOwnerId, phase: "线索", result: null, pooledAt: null, deletedAt: null, ...暂不分配的 },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  );
  return p?.id ?? null;
}

/**
 * 这位操作人能不能对这位客户选自动分配：能 = 回拿去分的项目；不能 = 回原因（服务端照它拦）。
 * 角色先判（不是市场成员不查库）；规则开没开由调用方判（服务端在 进门，页面在 页面可自动分配）
 */
export async function 能自动分配客户(me: 我, org: 组织, c: 要看的客户): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  if (!企业版() || !按区域分配of(org, me.id)) return { ok: false, error: 不是市场话 };
  if (c.pool) return { ok: false, error: 公海里话 };
  if (!能转让客户(me, { salesOwnerId: c.salesOwnerId, 在公海: false }, org)) return { ok: false, error: 不能转话 };
  if (!客户在市场手里(org, c)) return { ok: false, error: 不在市场手里话 };
  const projectId = await 暂不分配项目of(c);
  if (!projectId) return { ok: false, error: 不是暂不分配话 };
  const 挡 = await 挡分配方式(me, 1);
  if (挡) return { ok: false, error: 挡 };
  return { ok: true, projectId };
}

/**
 * 客户列表：批量转让框递不递自动分配那两个动作（客户 11-17）。只看人：企业版、市场成员、规则「线索分配」开着、分配方式「自动分配」他能用；
 * 勾的客户是不是暂不分配，框打开时再按 能自动分配客户 一位一位判（批量客户自动分配预看）。不是市场成员先回 false，不多查库
 */
export async function 批量可自动分配(me: 我): Promise<boolean> {
  if (!企业版()) return false;
  const org = await 读组织();
  if (!按区域分配of(org, me.id)) return false;
  if (!(await 规则开着("线索分配"))) return false;
  return !(await 挡分配方式(me, 1));
}

/**
 * 市场分配里的「指定」（审核 11-18 追加，用户定）：客户转让框（单个、批量）摆了「指定分配 / 自动分配」那组——市场成员把暂不分配的客户交给销售——
 * 选指定时只能给参与状态正常的人（同 指定问题 / 可指定的人）。服务端按库判这次是不是市场分配（转的人、客户，同 页面可自动分配 / 批量预看 的判定），
 * 不信前端传的模式：勾的里有一位算市场分配就照这条查接手人。普通转让（框里没那组的：不是市场成员、客户不是暂不分配、销售管理之间改派……）不管。
 * 转给自己不管；操作人兼条线总管理 / 销售管理的不管（市场分配限指定，接手人按普通转让 P-转-01）。null = 放行
 */
export async function 市场分配指定挡(me: 我, ids: readonly string[], 接手人: string): Promise<string | null> {
  if (!企业版() || 接手人 === me.id || !ids.length) return null;
  const org = await 读组织();
  if (!市场分配限指定(org, me.id) || !(await 规则开着("线索分配")) || (await 挡分配方式(me, 1))) return null;
  const 们 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, salesOwnerId: true, bizLine: true, pool: { select: { customerId: true } } } }));
  for (const c of 们) {
    if ((await 能自动分配客户(me, org, c)).ok) return 指定问题(org, 接手人);
  }
  return null;
}

/**
 * 市场分配里选「指定」要不要限人（只给参与正常的：市场分配指定挡、详情页 / 批量预看的可指定下拉）：按岗位的市场成员，
 * 且不兼条线总管理 / 销售管理（11-18 用户「按之前的口径」：管理角色手动指定照 P-转-01，P-判定-01 任一角色放行）。
 * 兼着的人框里照样能选自动分配（能自动分配客户 不变）
 */
export const 市场分配限指定 = (org: Pick<组织, "成员">, id: string): boolean => 按区域分配of(org, id) && !管理指定不限of(org, id);

/** 客户详情页：客户转让框里摆不摆「指定分配 / 自动分配」的选择。不是市场成员先回 false，不多查库 */
export async function 页面可自动分配(me: 我, c: 要看的客户): Promise<boolean> {
  if (!企业版()) return false;
  const org = await 读组织();
  if (!按区域分配of(org, me.id)) return false;
  if (!(await 规则开着("线索分配"))) return false;
  return (await 能自动分配客户(me, org, c)).ok;
}
