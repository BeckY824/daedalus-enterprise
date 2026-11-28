/**
 * 企业版「沟通必须挂项目」（11-17 客户定，取代 P-界面-35「没项目记为客户沟通」、X-144「没挂上照存客户沟通」）：
 *   - 沟通记录（电话、微信、WhatsApp、邮件、拜访……除了待办 / 提醒）新建时必须挂本客户一个在推项目（没结局、不在公海、没删）；
 *   - 能挂的人：项目负责人（能管项目，含系统管理员），或已进组的项目组员（别人名下的项目，记录上显示谁记的，负责人不变）；
 *   - 几个能挂的在推项目时要人选，不猜；只有一个就挂它；
 *   - 待办 / 提醒、背调结果存档（不挂项目也能存）、同号再次录入系统自动留的记录不受限。
 *   - 例外：售后回访（11-25，客户 E-282 / E-283 / E-286）——交付结清的项目还能记沟通，但只能记标了售后回访的；
 *     客户不在公海时项目负责人、已进组的组员、客户负责人能记（公海按客户判，见 能记售后回访）；自动挂只在在推项目里挑，交付结清的要人选。
 * 客户页记沟通（saveFollowUp）、项目详情记沟通（记项目沟通）、首页 AI 对话框、完成跟进计划都认这一份。
 * 组员看客户是连带只读（P-看-08，限定层拦在下面新建）：核过「能往项目记沟通」的那一笔，两条写入路各自按全部写（只写沟通和连带几样），
 * 组员在只读客户上只能新记沟通，改已有的、建待办 / 计划照旧只读（P-沟通-04）。
 */
import { prisma } from "../prisma";
import type { Prisma } from "@/generated/prisma";
import { 看全部 } from "../team-scope";
import { 全进程上下文 } from "../process-als";
import { 企业版 } from "../enterprise/switch";
import { 权限组织 } from "../enterprise/org";
import type { 组织 } from "../enterprise/org-core";
import { 占着待分配, 能编辑项目, 只读角色, 没设业务角色, 只看的人, 只看某人话, type 谁 } from "../enterprise/permissions";
import { 是交付 } from "./stage-dict";
import { 待分配不能动 } from "../enterprise/await-assign";

export { 售后回访名, 交付结清要售后回访话, 请选在推或售后话, 售后只在交付结清话, 售后不能记话, 售后客户在公海话, 下次回访日期不对话, 下次回访早于今天话, 售后回访主题 } from "./follow-needs-project-text";
import { 交付结清要售后回访话, 请选在推或售后话, 售后只在交付结清话, 售后不能记话, 售后客户在公海话 } from "./follow-needs-project-text";
export { 沟通没项目话, 沟通没在推项目话, 沟通项目已结束话, 沟通项目在公海话, 沟通项目不在话, 沟通要选项目话, 沟通不是组员话, 沟通都不能记话, 沟通客户在公海话, 请负责人建项目话, 待办改沟通话, 要挂项目的类型 } from "./follow-needs-project-text";
import { 沟通没项目话, 沟通没在推项目话, 沟通项目已结束话, 沟通项目在公海话, 沟通项目不在话, 沟通要选项目话, 沟通不是组员话, 沟通都不能记话 } from "./follow-needs-project-text";

/**
 * 背调结果存档（lib/research/actions.ts）走 saveFollowUp 记一条「其他记录」，客户定了仍可只挂客户。
 * 用进程级上下文标出「这一段是背调存档」：浏览器调不到它，不能拿来绕开
 */
const 免挂 = 全进程上下文<true>("沟通免挂项目");
export function 不挂项目也能存<T>(fn: () => Promise<T>): Promise<T> {
  return 免挂.run(true, async () => await fn());
}
export function 免挂项目中(): boolean {
  return 免挂.getStore() === true;
}

/**
 * 能不能往这个项目记沟通：能管项目（负责人本人、系统管理员）；企业版再加上已进组（JOINED）的项目组员——
 * 公海里的、只读角色（管理员只读、教练）、没设业务角色、设了「只看某人」的组员不行
 * （P-看-19 只放开看：只看某人进了组也是只读身份，同 能编辑项目 一律拒）
 */
export function 能往项目记沟通(me: 谁, p: { ownerId: string; pooledAt?: Date | null; awaitAssignAt: Date | null }, org: 组织 | null, 组员状态: string | null | undefined): boolean {
  // 待分配期间占着负责人一格的建的人只能看和改字段，不能记沟通（P-转-21、29M）
  if (占着待分配(me, p)) return false;
  if (能编辑项目(me, p, org)) return true;
  return 企业版() && !!org && !p.pooledAt && 组员状态 === "JOINED" && !只读角色(me, org) && !没设业务角色(org, me.id) && !只看的人(org, me.id);
}

/**
 * 能不能在这个交付结清的项目上记售后回访（11-25，E-283 第 11 条）：只有企业版、项目结局是交付结清（含旧名成功交付）；
 * 在不在公海按**客户**判（CustomerPool）——客户整体进公海只带在推项目（pool-link.ts 在推项目条件），交付结清的项目 pooledAt 永远是空，不能拿它判。
 * 客户在公海谁都不能记（项目负责人还挂在原处也不行）；不在公海时：能管项目的（负责人本人、系统管理员）、已进组的组员、客户负责人能记，
 * 只读角色、没设业务角色、设了「只看某人」的不行。组员、客户负责人记照组员记：只写沟通，不写项目任何一格
 */
export function 能记售后回访(
  me: 谁,
  p: { ownerId: string; result?: string | null; 客户负责人: string | null | undefined; 客户在公海: boolean },
  org: 组织 | null, 组员状态: string | null | undefined,
): boolean {
  if (!企业版() || !org || !是交付(p.result) || p.客户在公海) return false;
  if (能编辑项目(me, { ownerId: p.ownerId, pooledAt: null }, org)) return true;
  if (只读角色(me, org) || 没设业务角色(org, me.id) || 只看的人(org, me.id)) return false;
  return 组员状态 === "JOINED" || (!!p.客户负责人 && p.客户负责人 === me.id);
}

/**
 * 记售后回访要的客户两格：客户负责人、在不在公海（组员不一定看得到这位客户，按 id 取全）。
 * 事务里调要传 tx（同 客户事项挡 的 于）：外面的 prisma 在 CRM_READ_POOL=0 时排在主连接上，主连接被这笔事务占着就卡死
 */
export async function 售后客户(customerId: string, tx?: Prisma.TransactionClient): Promise<{ 客户负责人: string | null; 客户在公海: boolean }> {
  const db: Pick<Prisma.TransactionClient, "customer"> = tx ?? prisma;
  const c = await 看全部(() => db.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } }));
  return { 客户负责人: c?.salesOwnerId ?? null, 客户在公海: !!c?.pool };
}

export type 可记项目 = { id: string; name: string };

/**
 * 这位客户名下的项目：一共几个、在推几个、我能记沟通的在推项目（最近动过的在前）；
 * 售后 = 我能记售后回访的交付结清项目（客户在公海时为空），另列一组，自动挂不从这里挑
 */
export async function 可记沟通项目们(me: 谁, customerId: string): Promise<{ 总数: number; 在推数: number; 可记: 可记项目[]; 售后: 可记项目[] }> {
  const org = await 权限组织();
  // 组员不一定看得到这位客户（P-看-08 连带只读）：项目按客户 id 取全，能不能记下面逐个判
  const 们 = await 看全部(() => prisma.project.findMany({
    where: { customerId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true, ownerId: true, pooledAt: true, awaitAssignAt: true, result: true, members: { where: { userId: me.id }, select: { inviteStatus: true } } },
  }));
  const 在推 = 们.filter((p) => !p.result && !p.pooledAt);
  const 交付 = 企业版() ? 们.filter((p) => 是交付(p.result)) : [];
  const 客 = 交付.length ? await 售后客户(customerId) : null;
  return {
    总数: 们.length,
    在推数: 在推.length,
    可记: 在推.filter((p) => 能往项目记沟通(me, p, org, p.members[0]?.inviteStatus)).map((p) => ({ id: p.id, name: p.name })),
    售后: 客 ? 交付.filter((p) => 能记售后回访(me, { ...p, ...客 }, org, p.members[0]?.inviteStatus)).map((p) => ({ id: p.id, name: p.name })) : [],
  };
}

/**
 * 选定的项目核一遍：这位客户的、在推、我能记；不行回那一句。
 * 售后回访 = 这条标了售后回访：交付结清的项目只认标了的（不标回「只能记售后回访」），标了的只认交付结清的项目
 */
export async function 核沟通项目(me: 谁, customerId: string, projectId: string, 售后回访?: boolean): Promise<string | null> {
  const p = await 看全部(() => prisma.project.findUnique({
    where: { id: projectId },
    select: { customerId: true, ownerId: true, pooledAt: true, awaitAssignAt: true, result: true, members: { where: { userId: me.id }, select: { inviteStatus: true } } },
  }));
  if (!p || p.customerId !== customerId) return 沟通项目不在话;
  if (p.pooledAt) return 沟通项目在公海话;
  if (企业版() && 是交付(p.result)) return 核售后回访(me, p, 售后回访);
  if (p.result) return 沟通项目已结束话;
  if (售后回访) return 售后只在交付结清话;
  const org = await 权限组织();
  // 设了「只看某人」的进了组也只能看（P-看-19）：说只读那句，不说「只有组员能记」
  if (企业版() && 只看的人(org, me.id)) return 只看某人话;
  if (企业版() && 占着待分配(me, p)) return 待分配不能动;
  if (!能往项目记沟通(me, p, org, p.members[0]?.inviteStatus)) return 沟通不是组员话;
  return null;
}

/**
 * 交付结清的项目上记沟通（核沟通项目、记项目沟通共用）：客户在公海 → 先领取那句；只看某人 → 只读那句；记不了 → 售后不能记话；没标 → 只能记售后回访。
 * 事务里核（记项目沟通）传 于 = { tx, org }，同 客户事项挡：读客户走 tx，不在事务里另走外面的 prisma（CRM_READ_POOL=0 时卡死主连接）
 */
export async function 核售后回访(
  me: 谁, p: { customerId: string; ownerId: string; result: string | null; members?: { inviteStatus: string }[] }, 售后回访: boolean | undefined,
  组员状态: string | null | undefined = p.members?.[0]?.inviteStatus,
  于?: { tx: Prisma.TransactionClient; org: 组织 | null },
): Promise<string | null> {
  const 客 = await 售后客户(p.customerId, 于?.tx);
  if (客.客户在公海) return 售后客户在公海话;
  const org = 于 ? 于.org : await 权限组织();
  if (只看的人(org, me.id)) return 只看某人话;
  if (!能记售后回访(me, { ...p, ...客 }, org, 组员状态)) return 售后不能记话;
  if (!售后回访) return 交付结清要售后回访话;
  return null;
}

/**
 * 新记一条沟通挂哪个项目：给了就核那一个；没给 —— 能记的在推项目只有一个就挂它，几个就要人选，没有就说先建项目。
 * 没项目 = true：前端该摆「新建项目」。
 * 售后回访（11-25）：交付结清的项目从不自动挂（第十节第 7 条：让销售自己判断是售后还是新需求）——没有能记的在推项目、有能记售后回访的交付结清项目时，
 * 回「请选在推项目，或选交付结清的项目记售后回访」和 售后 那一组；标了售后回访却没给项目的同样要人选
 */
export async function 定沟通挂哪个项目(
  me: 谁, customerId: string, projectId: string | null | undefined, 售后回访?: boolean,
): Promise<{ ok: true; projectId: string; 售后回访: boolean } | { ok: false; error: string; 没项目?: true; 售后?: 可记项目[] }> {
  if (projectId) {
    const 错 = await 核沟通项目(me, customerId, projectId, 售后回访);
    return 错 ? { ok: false, error: 错 } : { ok: true, projectId, 售后回访: !!售后回访 };
  }
  const 们 = await 可记沟通项目们(me, customerId);
  if (售后回访) return { ok: false, error: 们.售后.length ? 请选在推或售后话 : 售后只在交付结清话, ...(们.售后.length ? { 售后: 们.售后 } : {}) };
  if (们.可记.length === 1) return { ok: true, projectId: 们.可记[0].id, 售后回访: false };
  if (们.可记.length > 1) return { ok: false, error: 沟通要选项目话 };
  if (们.售后.length) return { ok: false, error: 请选在推或售后话, 售后: 们.售后, ...(们.在推数 === 0 ? { 没项目: true as const } : {}) };
  if (们.总数 === 0) return { ok: false, error: 沟通没项目话, 没项目: true };
  if (们.在推数 === 0) return { ok: false, error: 沟通没在推项目话, 没项目: true };
  return { ok: false, error: 沟通都不能记话 };
}
