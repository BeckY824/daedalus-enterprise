/**
 * 企业版沟通记录谁能改、谁能删（2026-10-31 M-权限-09，11-02 再定，11-09 按 M-权限-09 原口径收紧）：
 * - 管理（销售管理 / 市场管理 / 总管理）以下都算普通用户，负责人本人也算：单条沟通不能改、不能删。界面不给入口，服务端也拒。
 * - 改 = 负责人（这条沟通挂的项目的负责人，或客户的负责人；项目、客户在公海里不算），且是管理：
 *   负责人要有销售 / 销售管理 / 渠运角色（同 负责人能改of），再要有管理角色。管理员（admin）只读。
 * - 删 = 系统管理员，或负责人本人（V3.5.1，同 permissions.ts 能删除）且是管理。删了照旧软删进回收站。
 *   本人刚记的不再能自己撤（P-沟通-01，11-09）；只有 AI 卡片「撤销」、完成小框「撤销记一笔」按 卡片刚记的能撤 单独放行。
 * - 批量删（PLUS 成员）不在这里。
 * 账号是管理员 / 主管不算，只认业务角色。改这个口径只改这里。
 *
 * 不是企业版一律 true：团队版 / 桌面端还按原来的规矩（同事的客户只读那条）。
 */
import { cache } from "react";
import { 企业版 } from "./switch";
import { 权限组织, type 组织 } from "./org";
import { 能删除, 有业务角色, 只读角色, 只读话of, 没设业务角色, 能改客户 } from "./permissions";
import { defaultClient, prisma } from "@/lib/prisma";
import { 限定的我, 看全部 } from "@/lib/team-scope";
import { 能往项目记沟通 } from "@/lib/project/follow-needs-project";
import { 看得到的客户 } from "@/lib/project/db";
import { 全进程上下文 } from "@/lib/process-als";
import { 要挂项目的类型 } from "@/lib/project/follow-needs-project-text";
import { 同号标题 } from "./same-number-collab";
import type { Prisma } from "@/generated/prisma";

export const 不能改沟通话 = "沟通记录只有管理（销售管理、市场管理、总管理）能改";
export const 不能删沟通话 = "沟通记录只有管理（销售管理、市场管理、总管理）或系统管理员能删";

type 谁 = { id: string; role: string };

/**
 * 纯函数：是不是负责人（负责人们里有自己、有销售 / 销售管理 / 渠运角色、不是只读角色）。
 * 客户事项挡（待办、计划、联系人）照这个；沟通的改、删还要再是管理（能改沟通of / 能删沟通of）
 */
export function 负责人能改of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  if (!org || 只读角色(me, org)) return false;
  return 负责人们.includes(me.id) && 有业务角色(me, org, "sales", "sales_mgr", "channel_ops");
}

/** 纯函数：管理（销售管理 / 市场管理 / 总管理）。M-权限-09：这以下的人单条沟通不能改、不能删 */
export function 管沟通的(me: 谁, org: 组织 | null): boolean {
  return 有业务角色(me, org, "sales_mgr", "marketing_mgr", "director");
}

/** 纯函数：改 = 负责人且是管理。负责人们 = 这条沟通挂的项目负责人、客户负责人（在公海的不给）。企业版 org 没给 = 拒 */
export function 能改沟通of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  return 管沟通的(me, org) && 负责人能改of(me, 负责人们, org);
}

/** 纯函数：删 = 系统管理员，或负责人们里有自己且是管理（负责人们同 能改沟通of） */
export function 能删沟通of(me: 谁, 负责人们: readonly (string | null | undefined)[], org: 组织 | null): boolean {
  return 管沟通的(me, org) && [null, ...负责人们].some((x) => 能删除(me, org, x));
}

/** AI 卡片「撤销」、完成小框「撤销记一笔」能撤的窗口（P-沟通-01：本人撤销沟通去掉了，这两处单独判定） */
export const 卡片撤销窗口分钟 = 10;
export const 卡片撤销过时话 = `只能撤销自己刚记的（${卡片撤销窗口分钟} 分钟内），这条撤不了了`;

/** 纯函数：AI 卡片撤销 / 撤销记一笔——本人记的、记下 卡片撤销窗口分钟 以内。普通删沟通不认它 */
export function 卡片刚记的能撤(me: { id: string }, f: { ownerId: string | null; createdAt: Date }, now: Date = new Date()): boolean {
  if (!f.ownerId || f.ownerId !== me.id) return false;
  return now.getTime() - f.createdAt.getTime() <= 卡片撤销窗口分钟 * 60_000;
}

/**
 * 记录人本人限时改（M-权限-09 的例外，客户 11-19 第 32 题 A 定稿）：
 * ① 30 分钟从提交写进系统那一刻（createdAt，服务器时间）算，不按沟通日期；过了不出入口、服务端拒。
 * ② 只有记这条的本人（ownerId，项目组员记的也算）；原本就能改的（身为负责人的管理，能改沟通of）照旧不受这个时限。
 * ③ 只改沟通内容、方式（含发起主体）、沟通时间；客户 / 项目 / 节点挂接不动，也不能改成待办（saveFollowUp 按 本人改只改内容话 拒别的格）。
 * ④ 下一步跟着改见 下一步跟着改of。⑤ 改过的标「已修改」、日志记改动格；只能改不能删；记录人本人 30 分钟内改（管理改自己记的也算）不自动推进节点。
 * 我方加的收窄（回复客户时说明）：项目已结束 / 进了公海 / 本人已出组时，30 分钟内也不能改（本人限时改挡）；没挂项目的，客户进了公海也不能改。
 * 只认人记的沟通：待办 / 提醒不走这条路；导入建的（EntImportRow 有这条）、同号协作的系统留痕（标题「同号再次录入…」）不算本人记的
 */
export const 本人改沟通窗口分钟 = 30;
export const 本人改沟通过时话 = `提交超过 ${本人改沟通窗口分钟} 分钟，不能再改`;
export const 本人改沟通项目话 = "这条沟通挂的项目你已经记不了沟通（已结束、进了公海或你已不在项目组），不能再改";
export const 本人改不能变待办话 = "沟通不能改成待办或提醒";
export const 本人改公海话 = "这位客户已经进了公海，不能再改这条沟通";
/** 改项目沟通 带了下一步但这条已经不够格跟着改（页面开着时组员新记了一条等，低-6）：沟通照存、下一步丢掉，回这句 */
export const 下一步没同步话 = "沟通改好了；下一步没有同步到项目（项目上有了更新的沟通，或这条记的时候没写下一步），要改下一步请记一条新沟通";
/** ③：本人限时改时标题、状态、时长、提醒时间、联系人、商机、参与人和改前不同就拒 */
export const 本人改只改内容话 = `${本人改沟通窗口分钟} 分钟内只能改沟通内容、方式和时间`;

/** 这条本人还能改到几点（写入时刻 + 窗口）：前端拿它决定「修改」出不出、几点收起 */
export function 本人可改到(createdAt: Date): Date {
  return new Date(createdAt.getTime() + 本人改沟通窗口分钟 * 60_000);
}

/** 纯函数：是我记的、写入还不到 本人改沟通窗口分钟（含正好 30 分钟那一刻） */
export function 本人限时可改of(me: { id: string }, f: { ownerId: string | null; createdAt: Date }, now: Date = new Date()): boolean {
  if (!f.ownerId || f.ownerId !== me.id) return false;
  return now.getTime() <= 本人可改到(f.createdAt).getTime();
}

/**
 * 本人限时改时下一步（项目上的下一步做什么 / 下一步时间）能不能跟着改（④，客户 11-19 第 32 题 A 定稿）：
 * 这条是这个项目最近记的一条（按写入时刻）、记录人就是项目负责人、改的人是他本人且还在 30 分钟内、他能管这个项目（组员记的本来就不填下一步）。
 * 还要这条记的时候确实写过下一步（写过下一步：记项目沟通 写了下一步文字或时间，操作日志 detail 带「写了下一步」，见 follow-edited.ts）——
 * 首页 AI 卡、完成计划小框记的挂上了项目、成了最近一条，但项目上的下一步是更早那条写的，不能拿这条去改（审核中-1）。
 * 导入建的、系统留痕不会有这个标记，自然不算。只有这样项目上的下一步才是这条写进去的，改了才同步回项目；别的情形不出这两格
 */
export function 下一步跟着改of(
  me: { id: string },
  f: { id: string; ownerId: string | null; createdAt: Date },
  p: { ownerId: string | null; 最近一条id: string | null | undefined; 能管: boolean; 写过下一步: boolean },
  now: Date = new Date(),
): boolean {
  return p.能管 && p.写过下一步 && !!p.ownerId && f.ownerId === p.ownerId && f.id === p.最近一条id && 本人限时可改of(me, f, now);
}

/**
 * 导入建的、同号协作系统留痕的沟通（低-3）：ownerId 是原业务员 / 录入人、createdAt 是导入那一刻，看着像「本人刚记的」，其实不是人记的——
 * 不走本人限时改，也不算 ④ 的「负责人本人记的最近一条」。按 EntImportRow（entity followup）和系统留痕标题认，不改导入的 createdAt。一次一句
 */
export async function 系统记的沟通们(fs: readonly { id: string; title: string }[]): Promise<Set<string>> {
  const 们 = new Set(fs.filter((f) => f.title.startsWith(同号标题)).map((f) => f.id));
  const 余 = fs.filter((f) => !们.has(f.id)).map((f) => f.id);
  if (余.length) {
    const rows = await 看全部(() => defaultClient.entImportRow.findMany({ where: { entity: "followup", targetId: { in: 余 } }, select: { targetId: true } }));
    for (const r of rows) 们.add(r.targetId);
  }
  return 们;
}

/** 本人限时改适用（纯判断 + 一句查系统记的）：我记的、30 分钟内、是沟通类型（待办 / 提醒不算，低-4）、不是导入 / 系统留痕 */
export async function 本人限时适用(me: { id: string }, f: { id: string; ownerId: string | null; createdAt: Date; type: string; title: string }, now: Date = new Date()): Promise<boolean> {
  if (!本人限时可改of(me, f, now) || !要挂项目的类型(f.type)) return false;
  return !(await 系统记的沟通们([f])).has(f.id);
}

/**
 * 本人限时改的服务端挡（saveFollowUp 用；不是企业版不走这里）：null = 放行。
 * 不是我记的 → 不能改沟通话；过了时限 → 本人改沟通过时话；没设业务角色 / 只读角色照旧拒；
 * 挂在项目上的，我得还能往这个项目记沟通（负责人或已进组的组员、项目没结束没进公海，同 能往项目记沟通）——
 * 这条是我方加的收窄（客户 11-19 第 32 题 A 定稿没提，回复客户时说明）
 */
export async function 本人限时改挡(me: 谁, f: { id: string; ownerId: string | null; createdAt: Date; type: string; title: string; customerId: string }, now: Date = new Date()): Promise<string | null> {
  if (!f.ownerId || f.ownerId !== me.id) return 不能改沟通话;
  // 待办 / 提醒（低-4）、导入建的和系统留痕（低-3）不走本人限时改：照原口径只有管理能改
  if (!要挂项目的类型(f.type) || (await 系统记的沟通们([f])).has(f.id)) return 不能改沟通话;
  if (!本人限时可改of(me, f, now)) return 本人改沟通过时话;
  const org = await 权限组织();
  if (!org || 没设业务角色(org, me.id)) return 没业务角色话;
  if (只读角色(me, org)) return 只读话of(me, org);
  // 组员看客户是连带只读，项目按 id 取全（同 定沟通挂哪个项目），能不能记下面判
  const 挂 = await 看全部(() => defaultClient.followUpProject.findUnique({
    where: { followUpId: f.id },
    select: { project: { select: { ownerId: true, pooledAt: true, result: true, members: { where: { userId: me.id }, select: { inviteStatus: true } } } } },
  }));
  if (挂?.project && (挂.project.result || !能往项目记沟通(me, 挂.project, org, 挂.project.members[0]?.inviteStatus))) return 本人改沟通项目话;
  // 没挂项目的老沟通（低-5）：客户进了公海也不能改（同挂项目的「进了公海」那条收窄）
  if (!挂?.project && (await 看全部(() => defaultClient.customerPool.count({ where: { customerId: f.customerId } })))) return 本人改公海话;
  return null;
}

/*
 * 改项目沟通 顺带改下一步（低-6）：要和这条沟通写在同一个事务里。saveFollowUp 是服务端动作、参数前端能传，不能收回调；
 * 改项目沟通 在这里登记「改 followUpId 时顺带跑这一段」，saveFollowUp 在自己的事务里、写完这条沟通后取出来跑。前端调不到这里
 */
type 顺带 = { followUpId: string; fn: (tx: Prisma.TransactionClient) => Promise<void> };
const 改沟通顺带中 = 全进程上下文<顺带>("follow-edit-extra");
export function 改沟通时顺带<T>(followUpId: string, fn: 顺带["fn"], run: () => Promise<T>): Promise<T> {
  return 改沟通顺带中.run({ followUpId, fn }, run);
}
export function 改沟通的顺带(followUpId: string): 顺带["fn"] | null {
  const s = 改沟通顺带中.getStore();
  return s && s.followUpId === followUpId ? s.fn : null;
}

/*
 * AI 卡片撤销走 deleteFollowUp（软删、审计、最近跟进重算都在里面），但 deleteFollowUp 是谁都能调的服务端动作，
 * 不能凭「本人刚记的」放行（那就是去掉的本人撤销）。只有 undoProposal 在这里面调的那一条才放行；这个文件不是服务端动作文件，前端调不到
 */
const 卡片撤销中 = 全进程上下文<string>("ai-card-undo");
export function 卡片撤销放行<T>(followUpId: string, fn: () => Promise<T>): Promise<T> {
  return 卡片撤销中.run(followUpId, fn);
}
export function 在卡片撤销里(followUpId: string): boolean {
  return 卡片撤销中.getStore() === followUpId;
}

/** 这条沟通的负责人们：客户负责人（客户不在公海）+ 挂的项目的负责人（项目不在公海） */
export async function 沟通负责人们(customerId: string, followUpId?: string): Promise<string[]> {
  const c = await defaultClient.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
  const 们: string[] = [];
  if (c?.salesOwnerId && !c.pool) 们.push(c.salesOwnerId);
  if (followUpId) {
    const 挂 = await defaultClient.followUpProject.findMany({ where: { followUpId }, select: { project: { select: { ownerId: true, pooledAt: true } } } });
    for (const x of 挂) if (x.project && !x.project.pooledAt) 们.push(x.project.ownerId);
  }
  return 们;
}

/** 能不能改这条沟通（服务端用）：不是企业版 true */
export async function 能改这条沟通(me: 谁, f: { customerId: string; id?: string }): Promise<boolean> {
  if (!企业版()) return true;
  return 能改沟通of(me, await 沟通负责人们(f.customerId, f.id), await 权限组织());
}

/** 能不能删这条沟通（服务端用）：不给 f = 页面级（这位客户 / 项目下的沟通），按客户负责人判；不是企业版 true */
export async function 能删沟通(me: 谁, f: { customerId: string; id?: string }): Promise<boolean> {
  if (!企业版()) return true;
  return 能删沟通of(me, await 沟通负责人们(f.customerId, f.id), await 权限组织());
}

/**
 * 页面渲染用（11-12 客户详情速度）：客户页、项目区都要问「这位客户下的沟通能不能改 / 删」，每问一次读一遍客户负责人（2 句）。
 * 同一次请求里同一位客户只读一次（React cache）；口径同 能改这条沟通 / 能删沟通 不给 f.id 的那种。服务端动作照旧用上面两个现读
 */
const 页面客户沟通负责人们 = cache((customerId: string) => 沟通负责人们(customerId));
export async function 页面能改沟通(me: 谁, customerId: string): Promise<boolean> {
  if (!企业版()) return true;
  return 能改沟通of(me, await 页面客户沟通负责人们(customerId), await 权限组织());
}
export async function 页面能删沟通(me: 谁, customerId: string): Promise<boolean> {
  if (!企业版()) return true;
  return 能删沟通of(me, await 页面客户沟通负责人们(customerId), await 权限组织());
}

export const 没业务角色话 = "你还没有业务角色，不能改数据，请找总管理设置";
export const 不能改客户事项话 = "只有负责人能改这位客户的待办、计划和联系人";

/**
 * 企业版客户详情上跟着客户走的小事（待办、下次计划、联系人移出 / 挂回，11-02）：同沟通——客户负责人或这位客户下项目的负责人改，
 * 没业务角色、管理员、公海里的拒；上级、总管理只看。不是企业版 null（团队版限定层照旧）
 */
export async function 客户事项挡(me: 谁, customerId: string | null | undefined): Promise<string | null> {
  if (!企业版()) return null;
  const org = await 权限组织();
  if (!org || 没设业务角色(org, me.id)) return 没业务角色话;
  if (只读角色(me, org)) return 只读话of(me, org);
  if (!customerId) return null;
  const c = await defaultClient.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c) return null; // 不在了：后面照原样报
  if (c.pool) return "这位客户在公海里，先领取再改";
  if (能改客户(me, { salesOwnerId: c.salesOwnerId, 在公海: false }, org)) return null;
  const 项目 = await defaultClient.project.findMany({ where: { customerId, pooledAt: null }, select: { ownerId: true } });
  return 负责人能改of(me, 项目.map((x) => x.ownerId), org) ? null : 不能改客户事项话;
}

export const 只有负责人改客户话 = "只有负责人或系统管理员能改客户资料（上级、条线总管理只能看、转让）";
export const 公海先领话 = "公海里的客户先领取或分配，再改";

/**
 * 企业版改客户资料挡（11-02，permissions.ts 能改客户；11-18 从 customers/actions.ts 挪来，关联客户也用）：
 * 负责人本人（销售、销售管理、渠运）或系统管理员才能改；公海里的谁都不能改；没设业务角色的一律拒。
 * 规则「按组织看客户」关着时限定层不拦，这里照样拦。新建（id 空）只挡没设业务角色的和只读角色。不是企业版 null
 */
export async function 改客户挡(me: 谁, id?: string | null): Promise<string | null> {
  if (!企业版()) return null;
  const org = await 权限组织();
  if (!org || 没设业务角色(org, me.id)) return 没业务角色话;
  // 只读管理员新建也拦（11-03 D3-7 ④）：改已有的下面 能改客户 就不给，限定层也拦
  if (!id) return 只读角色(me, org) ? 只读话of(me, org) : null;
  const c = await defaultClient.customer.findUnique({ where: { id }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c) return null; // 不在了：后面照原样报「已删除」
  return 改客户挡of(me, { salesOwnerId: c.salesOwnerId, 在公海: !!c.pool }, org);
}

/**
 * 改客户挡 的判断本身（已有客户，不查库）：客户详情页拿现成的负责人、公海标记和组织算「资料格给不给点」，
 * 和服务端 patchCustomer / patchCustomerRegion / saveCustomerNumbers 走同一段（PR #401：不为它多查库）。不是企业版 null
 */
export function 改客户挡of(me: 谁, c: { salesOwnerId: string | null; 在公海: boolean }, org: Awaited<ReturnType<typeof 权限组织>>): string | null {
  if (!企业版()) return null;
  if (!org || 没设业务角色(org, me.id)) return 没业务角色话;
  if (c.在公海) return 公海先领话;
  return 能改客户(me, { salesOwnerId: c.salesOwnerId, 在公海: false }, org) ? null : 只有负责人改客户话;
}

/**
 * 勾完成 / 取消完成自己名下的待办、计划（11-09，P-转-10）：市场把客户分给销售后这些活还归他，人已经不是负责人，
 * 只放开「不是负责人」这一条。没业务角色、只读角色、公海里的照旧拒；编辑、删除不走这里
 */
export async function 本人勾完成挡(me: 谁, customerId: string | null | undefined, ownerId: string | null | undefined): Promise<string | null> {
  const 挡 = await 客户事项挡(me, customerId);
  return 挡 === 不能改客户事项话 && ownerId === me.id ? null : 挡;
}

/**
 * 计划页上我看得到的事项有哪些够不着（11-09）：限定层放行自己和下属名下的待办、计划，客户却可能进不去（只负责项目的人，
 * 市场分出去后活还归他 P-转-10；上级看下属留下的这些也一样）。只管页面上给不给入口，谁能看、谁能改的范围不在这里定。
 * - 进不了：客户详情开不了，也记不了沟通（saveFollowUp 走限定层）。客户名不给链接，计划点完成不弹记沟通的小框
 * - 改不了：进不了里头，这位客户下也没有我负责的项目，客户事项挡 不让改删。改、删按钮不给
 * 不限定的（个人版、团队版不走这里，老板、没开按组织看的）两样都空
 */
export async function 名下事项够不着(me: 谁): Promise<{ 进不了: string[]; 改不了: string[] }> {
  if (!企业版() || !(await 限定的我(defaultClient))) return { 进不了: [], 改不了: [] };
  const [计划们, 待办们] = await Promise.all([
    prisma.followPlan.findMany({ distinct: ["customerId"], select: { customerId: true } }),
    prisma.task.findMany({ distinct: ["customerId"], select: { customerId: true } }),
  ]);
  const 事项的客户 = [...new Set([...计划们, ...待办们].map((x) => x.customerId))];
  const 进得去 = await 看得到的客户(事项的客户);
  const 进不了 = 事项的客户.filter((c) => !进得去.has(c));
  if (!进不了.length) return { 进不了: [], 改不了: [] };
  const org = await 权限组织();
  // 同 客户事项挡：项目负责人要有销售一类角色、项目不在公海、已结束的也算
  const 我的项目 = 负责人能改of(me, [me.id], org)
    ? await defaultClient.project.findMany({ where: { ownerId: me.id, pooledAt: null, customerId: { in: 进不了 } }, distinct: ["customerId"], select: { customerId: true } })
    : [];
  const 能改 = new Set(我的项目.map((x) => x.customerId));
  return { 进不了, 改不了: 进不了.filter((c) => !能改.has(c)) };
}
