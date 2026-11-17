/**
 * 企业版「沟通必须挂项目」（11-17 客户定，取代 P-界面-35「没项目记为客户沟通」、X-144「没挂上照存客户沟通」）：
 *   - 沟通记录（电话、微信、WhatsApp、邮件、拜访……除了待办 / 提醒）新建时必须挂本客户一个在推项目（没结局、不在公海、没删）；
 *   - 能挂的人：项目负责人（能管项目，含系统管理员），或已进组的项目组员（别人名下的项目，记录上显示谁记的，负责人不变）；
 *   - 几个能挂的在推项目时要人选，不猜；只有一个就挂它；
 *   - 待办 / 提醒、背调结果存档（不挂项目也能存）、同号再次录入系统自动留的记录不受限。
 * 客户页记沟通（saveFollowUp）、项目详情记沟通（记项目沟通）、首页 AI 对话框、完成跟进计划都认这一份。
 * 组员看客户是连带只读（P-看-08，限定层拦在下面新建）：核过「能往项目记沟通」的那一笔，两条写入路各自按全部写（只写沟通和连带几样），
 * 组员在只读客户上只能新记沟通，改已有的、建待办 / 计划照旧只读（P-沟通-04）。
 */
import { prisma } from "../prisma";
import { 看全部 } from "../team-scope";
import { 全进程上下文 } from "../process-als";
import { 企业版 } from "../enterprise/switch";
import { 权限组织 } from "../enterprise/org";
import type { 组织 } from "../enterprise/org-core";
import { 能编辑项目, 只读角色, 没设业务角色, type 谁 } from "../enterprise/permissions";

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
 * 公海里的、只读角色（管理员只读、教练）、没设业务角色的组员不行
 */
export function 能往项目记沟通(me: 谁, p: { ownerId: string; pooledAt?: Date | null }, org: 组织 | null, 组员状态: string | null | undefined): boolean {
  if (能编辑项目(me, p, org)) return true;
  return 企业版() && !!org && !p.pooledAt && 组员状态 === "JOINED" && !只读角色(me, org) && !没设业务角色(org, me.id);
}

export type 可记项目 = { id: string; name: string };

/** 这位客户名下的项目：一共几个、在推几个、我能记沟通的在推项目（最近动过的在前） */
export async function 可记沟通项目们(me: 谁, customerId: string): Promise<{ 总数: number; 在推数: number; 可记: 可记项目[] }> {
  const org = await 权限组织();
  // 组员不一定看得到这位客户（P-看-08 连带只读）：项目按客户 id 取全，能不能记下面逐个判
  const 们 = await 看全部(() => prisma.project.findMany({
    where: { customerId },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: { id: true, name: true, ownerId: true, pooledAt: true, result: true, members: { where: { userId: me.id }, select: { inviteStatus: true } } },
  }));
  const 在推 = 们.filter((p) => !p.result && !p.pooledAt);
  return {
    总数: 们.length,
    在推数: 在推.length,
    可记: 在推.filter((p) => 能往项目记沟通(me, p, org, p.members[0]?.inviteStatus)).map((p) => ({ id: p.id, name: p.name })),
  };
}

/** 选定的项目核一遍：这位客户的、在推、我能记；不行回那一句 */
export async function 核沟通项目(me: 谁, customerId: string, projectId: string): Promise<string | null> {
  const p = await 看全部(() => prisma.project.findUnique({
    where: { id: projectId },
    select: { customerId: true, ownerId: true, pooledAt: true, result: true, members: { where: { userId: me.id }, select: { inviteStatus: true } } },
  }));
  if (!p || p.customerId !== customerId) return 沟通项目不在话;
  if (p.pooledAt) return 沟通项目在公海话;
  if (p.result) return 沟通项目已结束话;
  if (!能往项目记沟通(me, p, await 权限组织(), p.members[0]?.inviteStatus)) return 沟通不是组员话;
  return null;
}

/**
 * 新记一条沟通挂哪个项目：给了就核那一个；没给 —— 能记的在推项目只有一个就挂它，几个就要人选，没有就说先建项目。
 * 没项目 = true：前端该摆「新建项目」
 */
export async function 定沟通挂哪个项目(me: 谁, customerId: string, projectId: string | null | undefined): Promise<{ ok: true; projectId: string } | { ok: false; error: string; 没项目?: true }> {
  if (projectId) {
    const 错 = await 核沟通项目(me, customerId, projectId);
    return 错 ? { ok: false, error: 错 } : { ok: true, projectId };
  }
  const 们 = await 可记沟通项目们(me, customerId);
  if (们.可记.length === 1) return { ok: true, projectId: 们.可记[0].id };
  if (们.可记.length > 1) return { ok: false, error: 沟通要选项目话 };
  if (们.总数 === 0) return { ok: false, error: 沟通没项目话, 没项目: true };
  if (们.在推数 === 0) return { ok: false, error: 沟通没在推项目话, 没项目: true };
  return { ok: false, error: 沟通都不能记话 };
}
