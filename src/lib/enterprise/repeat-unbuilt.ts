/**
 * 「挂靠申请」页「重复咨询待补建」一栏 + 销售管理「补建」/「不补建」（机制总表 P-公海-15 后半；我方 回E223 第一节 ①，客户 E-227 同意三处默认）。
 * 记录本身在 unbuilt-record.ts（出口 C 整笔没建时 repeat-inquiry-actions.ts 没人接收尾 写进撞号台账）。
 *
 * 谁看得到（读待补建栏）：
 *   - 这条线的销售管理（能分配线索）、条线总管理、系统管理员：客户编号、渠道、对接人、沟通方式 / 时间 / 内容、没建原因、通知了谁、交的人和时间、处理结果。
 *     线 = 记录里定的线；记录线判不出、或这个人没设业务线 = 两条线都算（同 出口C没人接收件人）。不写客户名。他们也能点「补建」「不补建」
 *     （规则「线索分配」关着时通知只发系统管理员，系统管理员也得点得了）
 *   - 交的市场同事：只看到自己交的几条和处理结果，只有客户编号（没有渠道以外的同事客户信息，也没有选人框）
 *   - 别人（销售等）：这一栏不出现
 * 补建（按点的那一刻定落给谁）：
 *   1. 客户负责人能接（在职销售 / 销售管理、参与状态正常、没到持有上限）→ 建在他名下，指定分配
 *   2. 还不能（或点之前能接、进事务这一刻刚到持有上限：同 P-公海-15 到上限照挑不到人处理）→ 按区域定线、自动分配再挑一次（同出口 C 交销售：交销售候选 + 挑接手人，事务里复核），自动分配
 *   3. 还挑不到 → 回「要手选」+ 这条线能接的销售（可指定的人、线对得上、没到持有上限），销售管理选一位再点，指定分配（事务里再核一次：在职、线、参与状态、持有上限）
 *   建法同出口 C：项目名「重复咨询-客户编号」第 2 次起加序、来源 / 原始客户 / 序号同出口 C（查重领取建线索项目），创建人 = 交的市场同事，
 *   渠道、对接人、沟通都用记录里的；沟通记录人 = 市场同事、时间照当时填的，首条沟通标建项目带出（三态额度）；一条算数的分配记录（from = 市场同事，by = 点的人）、
 *   市场建给销售进线索验证、重算客户状态；自动分配 / 手选另在项目上记「分配新线索…给…」；序号撞了唯一索引整笔重来（最多 3 次）。记录标「已补建」+ 谁 / 几点 / 补成哪条线索；接手的销售收分配通知，市场同事收「已补建」。
 * 不补建：原因必填，标「已关闭」，通知市场同事。客户中途进了公海：进公海那一刻自动关（unbuilt-record.ts 待补建进公海关）；点的时候才发现在公海也就地关。
 * 并发：两个人同时点同一条，事务里重读这一条、还是「待补建」才往下写（SQLite 写事务独占，后进来的读到已处理），只成一次，后到的回「已被处理」。
 */
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { getBusiness } from "@/lib/business";
import { 看全部 } from "@/lib/team-scope";
import { FOLLOW_TYPE_MAP } from "@/lib/constants";
import type { 规整好的沟通 } from "@/lib/project/wizard";
import { 持有上限起点, 写前核上限, 整批或不做 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 企业版 } from "./switch";
import { 权限组织 } from "./org";
import { 是系统管理员of, 管理员类别们of, type 组织 } from "./org-core";
import { 能分配线索, 不能当负责人话, 只读角色, 只读话of, 能看项目, 权限项目选, 带已加入 } from "./permissions";
import { 市场进不了详情的 } from "./market-view-db";
import { 项目链接们 } from "@/lib/project/customer-detail-direct";
import { 分配方式叫法 } from "./dict";
import { 可指定的人, 指定问题, 本月分配行, 读挑人底子, 读线部门 } from "./assign-eta";
import { 企划线索计数key, 计不计数, 挑接手人, 本月已分, 配额of, 满了, 月份 } from "./lead-assign";
import { 找待用补位, 用掉补位, 待用补位行 } from "./invalid-makeup";
import { 写流转线, 换人定线 } from "./flow-line";
import { 算市场建给销售, 市场分配进线索验证 } from "./market-assign-node";
import { 客户状态自动, 跟着项目重算 } from "./cust-status-auto-db";
import { 存沟通后重算三态 } from "./tri-state-db";
import { 分配通知 } from "./notice-sources";
import { notify } from "./notify";
import { 交接中的客户 } from "./handover-db";
import { 查重领取建线索项目, 查重领取记沟通, 落对接人, 查重领取换人, 查重领取作废, type 查重领取候选 } from "./dedupe-claim";
import { 负责人能接, 交销售候选, 出口C的线, 出口C项目名, 序号撞了 } from "./repeat-inquiry";
import { 未建条们, 改未建条, 未建键, 拆未建键, 进公海关原因, type 未建线索记录, type 未建处理, type 未建状态 } from "./unbuilt-record";

/** 这一栏在页面上的锚点：出口 C 没建的那条通知点进来就落在这一栏 */
export const 待补建栏id = "repeat-unbuilt";
export const 待补建栏链接 = `/projects/attach#${待补建栏id}`;
/** 已处理的留在栏里多少天（待补建的一直在） */
export const 已处理留天 = 30;
export const 不补建原因上限 = 200;

export const 不能处理待补建话 = "只有这条线的销售管理、总管理、系统管理员能处理重复咨询待补建";
export const 待补建找不到话 = "这条待补建记录找不到了，刷新页面看看";
export const 不补建要原因话 = "请写不补建的原因（会告诉交的同事）";
export const 交接中不补建话 = "这位客户正在转让交接中，等接手人确认后再补建";
export const 客户不在了话 = "这位客户已经不在了（可能在回收站），这次没补建；可以点「不补建」写原因关掉";
export const 负责人刚变了话 = "客户的负责人刚变了，这次没补建，请再点一次";
export const 手选的人接不了话 = "选的人现在接不了（暂停、停用、线对不上或到了持有上限），换一位";
export const 同时补建太多话 = "同时分配的太多，这次没补建，请稍后再试";
/** 后到的那一下：这条已被别人处理（并发只成一次） */
export const 已被处理话 = (r: 未建线索记录) =>
  `这条已经${r.状态 === "已补建" ? "补建" : "关闭"}了${r.处理?.谁 ? `（${r.处理.谁.名} 处理）` : r.处理?.自动 ? "（客户已进公海，自动关闭）" : ""}，不用再处理`;
export const 要手选话 = (为什么: string) => `客户负责人接不了，按区域自动分配也挑不到人（${为什么}）：请从这条线能接的销售里选一位`;
export const 补建成了话 = (接手人: string, 法: NonNullable<未建处理["线索"]>["落法"]) =>
  法 === "负责人" ? `已补建，建在客户负责人 ${接手人} 名下` : 法 === "自动分配" ? `已补建，按区域自动分配给 ${接手人}` : `已补建，交给 ${接手人} 跟进`;

/** 能不能看 / 处理这条线的待补建：系统管理员都行；条线总管理、能分配线索的销售管理看自己的线（线判不出、自己没设线 = 都算） */
export function 能管待补建(org: 组织, userId: string, 线: "内贸" | "外贸" | null): boolean {
  if (是系统管理员of(org, userId)) return true;
  const 类 = 管理员类别们of(org, userId);
  const 他的线 = org.成员.get(userId)?.line ?? null;
  const 线对 = !线 || !他的线 || 他的线 === 线;
  if (!线对) return false;
  return 类.has("总管理员") || (类.has("销售管理") && 能分配线索({ id: userId }, org));
}
/** 这一栏给不给他看（不看某一条的线）：系统管理员、条线总管理、能分配线索的销售管理 */
export const 是待补建管理人 = (org: 组织, userId: string) => 能管待补建(org, userId, null);

/**
 * 处理结果写成一句（栏里两种人都看这一句；不带客户名）。
 * 已补建的带 线索：名 = 话里「补成线索「名」」那一段（界面把这段换成链接）；链接只在看的人进得了那条项目时给（服务端判，同 项目页去向：
 * 市场没挡、能看项目、没删），给的是最终地址（看得到客户的直接落客户页项目页签，lib/project/customer-detail-direct.ts）；进不了的只有字、没有链接
 */
export type 处理结果 = { 话: string; 谁: string | null; 时间: string; 线索?: { 名: string; 链接: string | null } };
const 补成线索头 = (名: string) => `补成线索「${名}」`;
function 结果of(r: 未建线索记录, 链接们: ReadonlyMap<string, string>): 处理结果 | null {
  const h = r.处理;
  if (r.状态 === "待补建" || !h) return null;
  const 线索 = r.状态 === "已补建" ? h.线索 : undefined;
  const 话 = 线索
    ? `${补成线索头(线索.名)}，${线索.落法 === "负责人" ? "建在客户负责人" : 线索.落法 === "自动分配" ? "按区域自动分配给" : "交给"} ${线索.接手人.名}${线索.落法 === "负责人" ? " 名下" : " 跟进"}`
    : h.自动 ? 进公海关原因 : `不补建：${h.原因 ?? ""}`;
  return { 话, 谁: h.谁?.名 ?? null, 时间: h.时间, ...(线索 ? { 线索: { 名: 线索.名, 链接: 链接们.get(线索.id) ?? null } } : {}) };
}

/** 补成的线索里，这个人进得了的那几条 → 最终地址（进不了、删了的不在里面） */
async function 进得了的线索(me: Pick<SessionUser, "id"> & { role?: string | null }, org: 组织, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const [行, 市场挡] = await Promise.all([
    看全部(() => prisma.project.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true, ...权限项目选 } })),
    市场进不了详情的(me.id, ids),
  ]);
  const 能进 = 行.filter((r) => !市场挡.has(r.id) && 能看项目(me, 带已加入(r), org)).map((r) => r.id);
  if (!能进.length) return new Map();
  const 地址 = await 项目链接们(me, 能进);
  return new Map(能进.map((id) => [id, 地址.get(id) ?? `/projects/${encodeURIComponent(id)}`]));
}

export type 待补建行 = {
  键: string;
  状态: 未建状态;
  类: 未建线索记录["类"];
  客户编号: string;
  渠道: string;
  对接人: string;
  沟通方式: string;
  沟通时间: string;
  沟通内容: string;
  没建原因: string;
  通知了: string;
  交的人: string;
  交的时间: string;
  结果: 处理结果 | null;
};
/** 交的市场同事看到的：只有客户编号、交的时间、状态、处理结果 */
export type 我交的待补建 = { 键: string; 客户编号: string; 交的时间: string; 状态: 未建状态; 结果: 处理结果 | null };
/** 管 = null：这一栏不给他看；我交的 = 空：他没交过（或不是市场同事） */
export type 待补建栏 = { 管: 待补建行[] | null; 我交的: 我交的待补建[] };

const 方式of = (r: 未建线索记录) => r.沟通.方式 || FOLLOW_TYPE_MAP[r.沟通.类型]?.label || r.沟通.类型;
const 留着 = (r: 未建线索记录, 起: number) => r.状态 === "待补建" || new Date(r.处理?.时间 ?? r.交的时间).getTime() >= 起;
const 排 = <T extends { 状态: 未建状态; 交的时间: string; 结果: 处理结果 | null }>(a: T, b: T) =>
  a.状态 === "待补建" && b.状态 === "待补建" ? a.交的时间.localeCompare(b.交的时间)
    : a.状态 === "待补建" ? -1 : b.状态 === "待补建" ? 1 : (b.结果?.时间 ?? "").localeCompare(a.结果?.时间 ?? "");

/** 页面那一栏的数据（挂靠申请页 page.tsx 调）：看不到 = 管 null；市场同事自己交的另给一份 */
export async function 读待补建栏(me: Pick<SessionUser, "id"> & { role?: string | null }): Promise<待补建栏> {
  const 空: 待补建栏 = { 管: null, 我交的: [] };
  if (!企业版()) return 空;
  const org = await 权限组织();
  if (!org) return 空;
  const 管人 = 是待补建管理人(org, me.id);
  // 不截条数：截了最早的待补建会悄悄不出现（待补建的一直留着；已处理的按处理时间留 已处理留天，台账行的时间对不上处理时间，只能读出来再筛）。
  // 只有出口 C 整笔没建的那几行有这一列，量小
  const 行们 = await 看全部(() => prisma.entDupeHit.findMany({ where: { unbuilt: { not: null } }, select: { id: true, unbuilt: true }, orderBy: { createdAt: "desc" } }));
  const 起 = Date.now() - 已处理留天 * 86_400_000;
  const 条们 = 行们.flatMap((行) => 未建条们(行.unbuilt).map((x) => ({ 键: 未建键(行.id, x.位), r: x.记录 }))).filter((x) => 留着(x.r, 起));
  const 我交的条 = 条们.filter((x) => x.r.交的人.id === me.id);
  const 我管的 = 管人 ? 条们.filter((x) => 能管待补建(org, me.id, x.r.线)) : [];
  const 线索ids = [...new Set([...我交的条, ...我管的].flatMap((x) => (x.r.状态 === "已补建" && x.r.处理?.线索 ? [x.r.处理.线索.id] : [])))];
  const 链接们 = await 进得了的线索(me, org, 线索ids);
  const 我交的 = 我交的条.map(({ 键, r }) => ({ 键, 客户编号: r.客户编号, 交的时间: r.交的时间, 状态: r.状态, 结果: 结果of(r, 链接们) })).sort(排);
  if (!管人) return { 管: null, 我交的 };
  // 号码撞上的那位联系人：名字现读（不是客户名；联系人删了就说删了）
  const 联系人ids = [...new Set(我管的.flatMap((x) => ("撞上的联系人" in x.r.对接人 ? [x.r.对接人.撞上的联系人] : [])))];
  const 联系人 = new Map((联系人ids.length ? await 看全部(() => prisma.contact.findMany({ where: { id: { in: 联系人ids }, deletedAt: null }, select: { id: true, name: true } })) : []).map((c) => [c.id, c.name]));
  const 管 = 我管的.map(({ 键, r }): 待补建行 => {
    const 对接人 = "撞上的联系人" in r.对接人
      ? (联系人.has(r.对接人.撞上的联系人) ? `${联系人.get(r.对接人.撞上的联系人) || "未写名字"}（号码撞上的联系人）` : "号码撞上的联系人（已删，补建时不挂对接人）")
      : `${r.对接人.新建.名字}${r.对接人.新建.职务 ? ` · ${r.对接人.新建.职务}` : ""}（新的人，补建时建）`;
    return {
      键, 状态: r.状态, 类: r.类, 客户编号: r.客户编号, 渠道: r.渠道.名, 对接人, 沟通方式: 方式of(r), 沟通时间: r.沟通.时间, 沟通内容: r.沟通.内容,
      没建原因: r.没建原因, 通知了: r.通知了.人.length ? `${r.通知了.类别 ?? ""}：${r.通知了.人.map((x) => x.名).join("、")}` : "没有能通知的人",
      交的人: r.交的人.名, 交的时间: r.交的时间, 结果: 结果of(r, 链接们),
    };
  }).sort(排);
  return { 管, 我交的 };
}

/** 补建时还挑不到人：这条线能接的销售（能被指定、线对得上、能当负责人、没到持有上限） */
export async function 手选候选(org: 组织, 线: "内贸" | "外贸" | null): Promise<{ id: string; 名: string }[]> {
  const 规则 = await 生效组织规则();
  const ids = (await 可指定的人(org)).filter((id) => {
    const 他的线 = org.成员.get(id)?.line ?? null;
    return (!线 || !他的线 || 他的线 === 线) && !不能当负责人话(org, id);
  });
  const 没满: string[] = [];
  for (const id of ids) {
    const 起 = await 看全部(() => 持有上限起点(prisma, 规则, id));
    if (!起 || 起.有 + 1 <= 起.上限) 没满.push(id);
  }
  if (!没满.length) return [];
  const 名们 = await prisma.user.findMany({ where: { id: { in: 没满 }, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return 名们.map((u) => ({ id: u.id, 名: u.name }));
}

export type 补建结果 =
  | { ok: true; 提示: string }
  | { ok: false; error: string; 刷新?: true }
  | { ok: false; 要手选: { 为什么: string; 候选: { id: string; 名: string }[] } };

/** 事务里发现这一条已经不是「待补建」了（别人刚处理过）：整笔回滚，回 已被处理话 */
class 已处理错 extends Error {
  constructor(readonly 现: 未建线索记录 | null) { super("已处理"); }
}
class 补建作废 extends Error {}

type 读到 = { 行id: string; 位: number; 客户id: string; r: 未建线索记录 };
/** 找这一条 + 核权限；还待补建才回 */
async function 找这条(org: 组织, me: { id: string }, 键: unknown): Promise<读到 | { ok: false; error: string; 刷新?: true }> {
  const k = 拆未建键(键);
  if (!k) return { ok: false, error: 待补建找不到话, 刷新: true };
  const 行 = await 看全部(() => prisma.entDupeHit.findUnique({ where: { id: k.行id }, select: { id: true, unbuilt: true, customerId: true } }));
  const 条 = 未建条们(行?.unbuilt).find((x) => x.位 === k.位);
  if (!行 || !条) return { ok: false, error: 待补建找不到话, 刷新: true };
  if (!能管待补建(org, me.id, 条.记录.线)) return { ok: false, error: 不能处理待补建话 };
  if (条.记录.状态 !== "待补建") return { ok: false, error: 已被处理话(条.记录), 刷新: true };
  return { 行id: 行.id, 位: k.位, 客户id: 行.customerId, r: 条.记录 };
}

/** 事务里重读这一条：还是那一条（交的时间对得上）、还待补建才往下（并发只成一次） */
async function 重读这条(tx: Pick<typeof prisma, "entDupeHit">, a: 读到): Promise<string> {
  const 现 = await tx.entDupeHit.findUnique({ where: { id: a.行id }, select: { unbuilt: true } });
  const 条 = 未建条们(现?.unbuilt).find((x) => x.位 === a.位);
  if (!条 || 条.记录.交的时间 !== a.r.交的时间 || 条.记录.状态 !== "待补建") throw new 已处理错(条?.记录 ?? null);
  return 现!.unbuilt!;
}

/** 门：企业版、有组织、不是只读角色 */
async function 门(me: SessionUser): Promise<{ org: 组织 } | { ok: false; error: string }> {
  if (!企业版()) return { ok: false, error: "企业版才有重复咨询待补建" };
  const org = await 权限组织();
  if (!org) return { ok: false, error: 不能处理待补建话 };
  if (只读角色(me, org)) return { ok: false, error: 只读话of(me, org) };
  return { org };
}

/** 进公海了才点：就地关（条件写，别人刚处理过就不动） */
async function 就地进公海关(a: 读到): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const 文 = await 重读这条(tx, a).catch(() => null);
    if (!文) return;
    const 新 = 改未建条(文, a.位, (r) => ({ ...r, 状态: "已关闭", 处理: { 谁: null, 时间: new Date().toISOString(), 原因: 进公海关原因, 自动: "进公海" } }));
    if (新) await tx.entDupeHit.update({ where: { id: a.行id }, data: { unbuilt: 新 } });
  });
}

/**
 * 记录里的沟通还原成 查重领取记沟通 要的样子。记录里的方式 = 原来的 好.method，只有「其他」类没选方式（企业版只有这一种会空）时存的是类型的叫法「其他记录」：
 * 只把那一种还原成空。线上会议、邮件沟通、WhatsApp、微信沟通 和类型同名，是正常选的方式，照原样（同出口 C 直接建的）
 */
function 还原沟通(r: 未建线索记录): 规整好的沟通 {
  const 没选 = r.沟通.类型 === "OTHER" && r.沟通.方式 === FOLLOW_TYPE_MAP.OTHER?.label;
  return { type: r.沟通.类型, method: 没选 ? null : r.沟通.方式 || null, initiator: r.沟通.发起方, content: r.沟通.内容, occurredAt: new Date(r.沟通.时间), nextStepAt: null, nextStepText: null };
}

type 落法 = NonNullable<未建处理["线索"]>["落法"];
type 落点 = { 法: 落法; 接手人: string; 候: 查重领取候选 | null; 手选线: "内贸" | "外贸" | null };

/** 手选的那位事务里再核一次（点之前列候选时能接，进事务这一刻可能刚被暂停 / 停用 / 改了线）：在职、线对得上、能被指定、能当负责人 */
async function 手选还能接(tx: Pick<typeof prisma, "user" | "entMember">, org: 组织, id: string, 线: "内贸" | "外贸" | null): Promise<boolean> {
  if (!(await tx.user.findUnique({ where: { id }, select: { active: true } }))?.active) return false;
  const 他的线 = (await tx.entMember.findUnique({ where: { userId: id }, select: { line: true } }))?.line ?? null;
  if (线 && 他的线 && 他的线 !== 线) return false;
  return !(await 指定问题(org, id)) && !不能当负责人话(org, id);
}
/** 事务里核出手选的人接不了了：整笔回滚，回 手选的人接不了话（界面留着选人框换一位） */
class 手选接不了 extends Error {}

/**
 * 落给谁（按这一刻）：负责人能接 → 他；还不能（或 跳过负责人：进事务时他刚到持有上限）→ 按区域自动分配；还挑不到 → 手选（没带指定 = 回要手选）
 */
async function 定落点(org: 组织, c: { id: string; salesOwnerId: string | null }, r: 未建线索记录, 规则: Awaited<ReturnType<typeof 生效组织规则>>, 指定: unknown, 跳过负责人: boolean): Promise<落点 | 补建结果> {
  const 负责人 = c.salesOwnerId;
  if (!跳过负责人 && 负责人 && (await 负责人能接(org, 负责人))) {
    const 起 = await 看全部(() => 持有上限起点(prisma, 规则, 负责人));
    if (!起 || 起.有 + 1 <= 起.上限) return { 法: "负责人", 接手人: 负责人, 候: null, 手选线: null };
  }
  const 读 = await 交销售候选(org, r.交的人.id, c.id, 负责人 ?? "");
  if (读.ok) return { 法: "自动分配", 接手人: "", 候: 读.候, 手选线: null };
  const 手选线 = 读.没人接.线 ?? r.线;
  const 候选 = await 手选候选(org, 手选线);
  if (typeof 指定 !== "string" || !指定) return { ok: false, 要手选: { 为什么: 读.没人接.为什么, 候选 } };
  if (!候选.some((x) => x.id === 指定)) return { ok: false, error: 手选的人接不了话 };
  return { 法: "手选", 接手人: 指定, 候: null, 手选线 };
}

/**
 * 补建（见文件头）。指定 = 第 3 步销售管理手选的那位（前两步能落人时不认它，按点的那一刻算）。
 * 回 要手选 = 前两步都挑不到，界面列候选让他选一位再点。成了带客户 id（动作那层刷新客户详情页用，不回给界面）
 */
export async function 补建待补建记录(me: SessionUser, 键: unknown, 指定?: unknown): Promise<补建结果 | { ok: true; 提示: string; 客户id: string }> {
  const g = await 门(me);
  if ("ok" in g) return g;
  const { org } = g;
  const a = await 找这条(org, me, 键);
  if ("ok" in a) return a;
  const { r } = a;
  const c = await 看全部(() => prisma.customer.findUnique({ where: { id: a.客户id }, select: { id: true, customerNo: true, salesOwnerId: true, pool: { select: { customerId: true } } } }));
  if (!c) return { ok: false, error: 客户不在了话 };
  if (c.pool) {
    await 就地进公海关(a);
    return { ok: false, error: 进公海关原因, 刷新: true };
  }
  if ((await 交接中的客户([c.id])).size) return { ok: false, error: 交接中不补建话 };
  const 规则 = await 生效组织规则();
  const 交的人 = r.交的人.id;
  const 好 = 还原沟通(r);
  const [企划算数, 状态开] = await Promise.all([getSetting<boolean>(企划线索计数key), 客户状态自动()]);
  const 算数 = 计不计数("营销", 企划算数);

  // 外圈：负责人点之前能接、进事务这一刻刚到持有上限（同 P-公海-15「负责人已到持有上限，同样照挑不到人处理」）= 跳过他再定一次落点，往下走自动分配
  let 跳过负责人 = false;
  for (;;) {
    const 落 = await 定落点(org, c, r, 规则, 指定, 跳过负责人);
    if ("ok" in 落) return 落;
    const { 法, 候, 手选线 } = 落;
    let 接手人 = 落.接手人;
    const 线 = 候 ? 候.向.线 : await 出口C的线(org, 接手人, c.id, 交的人);
    const [way, 线设] = await Promise.all([分配方式叫法(法 === "自动分配" ? 1 : 0), 法 === "自动分配" ? 读线部门() : Promise.resolve(null)]);
    const 月 = 候?.月 ?? 月份();
    const 跳过 = new Set(候?.底.不参与 ?? []);
    let 底 = 候?.底 ?? null;
    let 重挑 = 0;
    let 撞号 = 0;
    let 结果: { id: string; 名: string; 补发: boolean } | null = null;
    for (;;) {
      if (候 && 底) {
        const 挑 = 挑接手人(底.排位(), 跳过, 候.查满, 底.不限额);
        // 事务里复核顺延到没人：这一刻挑不到了，照第 3 步让他手选
        if (!挑) return { ok: false, 要手选: { 为什么: "这条线能接的销售刚被分满了", 候选: await 手选候选(org, 候.向.线 ?? r.线) } };
        接手人 = 挑;
      }
      try {
        const 跑 = await 整批或不做(() => 看全部(() => prisma.$transaction(async (tx) => {
          const 文 = await 重读这条(tx, a);
          const 现 = await tx.customer.findUnique({ where: { id: c.id }, select: { salesOwnerId: true, customerNo: true, pool: { select: { customerId: true } } } });
          if (!现) throw new 补建作废(客户不在了话);
          if (现.pool) throw new 补建作废(进公海关原因);
          if (法 === "负责人" && 现.salesOwnerId !== 接手人) throw new 补建作废(负责人刚变了话);
          if (法 !== "自动分配") await 写前核上限(tx, await 持有上限起点(tx, 规则, 接手人), 1, "分配");
          if (法 === "手选" && !(await 手选还能接(tx, org, 接手人, 手选线))) throw new 手选接不了();
          let 补位id: string | null = null;
          if (候 && 底) {
            if (挑接手人(底.排位(undefined, await 本月分配行(候.人们, 候.月, tx), 底.用补位 ? await 待用补位行(候.人们, tx) : undefined), 跳过, 候.查满, 底.不限额) !== 接手人) throw new 查重领取换人(false);
            补位id = 底.用补位 ? await 找待用补位(tx, 接手人, 候.向.线) : null;
            if (!补位id && 候.查满 && !底.不限额 && 满了(await 本月已分(接手人, 候.月, tx), await 配额of(接手人, tx))) throw new 查重领取换人(true);
          }
          // 对接人：号码撞上的那位还在就挂他（不改他），删了就不挂；新的人这时才在客户下建（不设主联系人）
          let 对接人id: string | null = null;
          if ("撞上的联系人" in r.对接人) {
            对接人id = (await tx.contact.findFirst({ where: { id: r.对接人.撞上的联系人, customerId: c.id, deletedAt: null }, select: { id: true } }))?.id ?? null;
          } else {
            对接人id = await 落对接人(tx, c.id, { 建: { name: r.对接人.新建.名字, position: r.对接人.新建.职务 } }, 交的人);
          }
          const id = await 查重领取建线索项目(tx, {
            customerId: c.id, 项目名: (序) => 出口C项目名(现.customerNo, 序), 接手人, 创建人: 交的人, 渠道: r.渠道.id, 对接人: 对接人id, 线, 分配方式: way,
          });
          if (法 === "自动分配") await 换人定线(tx, { 项目: [id] }, { 操作人: me.id, 接手人, 自动: true, 方向: 线 }, { org, 设: 线设! });
          else await 写流转线(tx, 线!, { 项目: [id] });
          const 记 = await tx.entLeadAssign.create({
            data: { projectId: id, toUserId: 接手人, fromUserId: 交的人, byUserId: me.id, line: 线, kind: "营销", counted: 算数 && !补位id, month: 月, way },
            select: { id: true },
          });
          if (补位id && !(await 用掉补位(tx, 补位id, 记.id, id))) throw new 查重领取换人(false);
          if (算市场建给销售(org, 交的人, 接手人)) await 市场分配进线索验证(tx, [id], 接手人, me.id);
          // 沟通：记录人 = 交的市场同事、时间照当时填的；同一事务刚建的线索项目，首条沟通标建项目带出（三态额度 PR 442）
          await 查重领取记沟通(tx, 交的人, id, 好, new Date(), true);
          await 跟着项目重算(tx, 状态开, [c.id]);
          const 名 = (await tx.project.findUnique({ where: { id }, select: { name: true } }))?.name ?? "";
          const 接手人名 = (await tx.user.findUnique({ where: { id: 接手人 }, select: { name: true } }))?.name ?? 接手人;
          const 新 = 改未建条(文, a.位, (x) => ({
            ...x, 状态: "已补建", 处理: { 谁: { id: me.id, 名: me.name }, 时间: new Date().toISOString(), 线索: { id, 名, 接手人: { id: 接手人, 名: 接手人名 }, 落法: 法 } },
          }));
          if (!新) throw new 已处理错(null);
          await tx.entDupeHit.update({ where: { id: a.行id }, data: { unbuilt: 新 } });
          return { id, 名, 补发: !!补位id };
        })));
        if (!跑.ok) {
          // 进事务这一刻到了持有上限：负责人 = 跳过他往下走自动分配；手选的人 = 换一位
          if (法 === "负责人") break;
          return { ok: false, error: 法 === "手选" ? 手选的人接不了话 : 跑.超 };
        }
        结果 = 跑.值;
        break;
      } catch (e) {
        if (e instanceof 已处理错) return { ok: false, error: e.现 ? 已被处理话(e.现) : 待补建找不到话, 刷新: true };
        if (e instanceof 补建作废) {
          if (e.message === 进公海关原因) await 就地进公海关(a);
          return { ok: false, error: e.message, 刷新: true };
        }
        if (e instanceof 手选接不了) return { ok: false, error: 手选的人接不了话 };
        if (e instanceof 查重领取作废) return { ok: false, error: e.message.replace("这次没领", "这次没补建") };
        if (e instanceof 查重领取换人 && 候) {
          if (e.满) { 跳过.add(接手人); continue; }
          if (++重挑 > 5) return { ok: false, error: 同时补建太多话 };
          底 = await 读挑人底子(候.人们, 候.月, 候.补位);
          continue;
        }
        // 同一位客户两笔同时建、序号撞了唯一索引（多进程时两笔事务各读到同一个最大号）：整笔已回滚，重来一次（再来读到对方那条，接着往下排）
        if (序号撞了(e) && ++撞号 < 3) continue;
        throw e;
      }
    }
    if (!结果) { 跳过负责人 = true; continue; }
    const 接手人名 = await 补建收尾(me, a, c.id, r, { 法, 接手人, 线, way, 月, counted: 算数 && !结果.补发, 补发: 结果.补发 }, 结果);
    return { ok: true, 提示: 补建成了话(接手人名, 法), 客户id: c.id };
  }
}

/** 补建成了之后：操作日志（自动分配 / 手选另记项目上「分配新线索…给…」，同出口 C 交销售）、通知接手人和交的市场同事、重算客户三态；回接手人的名字 */
async function 补建收尾(
  me: SessionUser, a: 读到, 客户id: string, r: 未建线索记录,
  落: { 法: 落法; 接手人: string; 线: "内贸" | "外贸" | null; way: string; 月: string; counted: boolean; 补发: boolean }, 结果: { id: string; 名: string },
): Promise<string> {
  const { 法, 接手人, 线, way, 月, counted, 补发 } = 落;
  const b = await getBusiness();
  const 接手人名 = (await prisma.user.findUnique({ where: { id: 接手人 }, select: { name: true } }))?.name ?? 接手人;
  await recordAudit({
    user: me, action: "create", entity: "Project", entityId: 结果.id,
    summary: `补建重复咨询待补建（客户 ${r.客户编号}，${r.交的人.名} 交的）：新建线索「${结果.名}」${法 === "负责人" ? `建在客户负责人「${接手人名}」名下` : 法 === "自动分配" ? `按区域自动分配给「${接手人名}」` : `由销售管理手选交给「${接手人名}」`}，沟通记录人仍是 ${r.交的人.名}`,
    detail: { 补建: true, 台账: a.行id, 位: a.位, 客户: 客户id, 落法: 法, 接手人, 渠道: r.渠道.id, 线, 分配方式: way, counted, month: 月, 交的人: r.交的人.id },
  });
  if (法 !== "负责人") {
    // 项目上也记一条（同出口 C 交销售 / 查重领取）：项目的操作日志里看得到这次分配
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: 结果.id,
      summary: `分配新线索「${结果.名}」给 ${接手人名}${线 ? `（${线}）` : ""}${补发 ? "，判无效补发、不计数" : counted ? "" : "，不计数"}`,
      detail: { toUserId: 接手人, fromUserId: r.交的人.id, line: 线, kind: "营销", counted, month: 月, 分配方式: way, 补建: true },
    });
  }
  await 分配通知(me, [{ projectId: 结果.id, toUserId: 接手人 }], 法 === "自动分配",
    `老客户重复咨询补建：${r.交的人.名} 之前查号码撞上这位${b.customer}，当时没建成；${me.name} 补建了这条线索给你（创建人记 ${r.交的人.名}，${b.customer}负责人不变），当时的沟通记在它上面。如与原项目同一需求，线索验证时选「重复线索」`);
  await notify([r.交的人.id], {
    kind: "重复咨询待补建", key: `repeat-unbuilt-done:${未建键(a.行id, a.位)}`,
    title: `重复咨询已补建：${r.客户编号}`,
    body: `你交的客户 ${r.客户编号} 那次咨询，${me.name} 已补建成线索「${结果.名}」，交给 ${接手人名} 跟进；你在项目列表里能看到进度`,
    link: 待补建栏链接,
  });
  await 存沟通后重算三态(客户id);
  return 接手人名;
}

/** 不补建：原因必填，标已关闭，通知交的市场同事（客户 E-227 三处默认 ②） */
export async function 不补建待补建记录(me: SessionUser, 键: unknown, 原因: unknown): Promise<{ ok: true; 提示: string } | { ok: false; error: string; 刷新?: true }> {
  const g = await 门(me);
  if ("ok" in g) return g;
  const 因 = typeof 原因 === "string" ? 原因.replace(/\s+/g, " ").trim() : "";
  if (!因) return { ok: false, error: 不补建要原因话 };
  if (因.length > 不补建原因上限) return { ok: false, error: `原因最多 ${不补建原因上限} 个字` };
  const a = await 找这条(g.org, me, 键);
  if ("ok" in a) return a;
  try {
    await prisma.$transaction(async (tx) => {
      const 文 = await 重读这条(tx, a);
      const 新 = 改未建条(文, a.位, (x) => ({ ...x, 状态: "已关闭", 处理: { 谁: { id: me.id, 名: me.name }, 时间: new Date().toISOString(), 原因: 因 } }));
      if (!新) throw new 已处理错(null);
      await tx.entDupeHit.update({ where: { id: a.行id }, data: { unbuilt: 新 } });
    });
  } catch (e) {
    if (e instanceof 已处理错) return { ok: false, error: e.现 ? 已被处理话(e.现) : 待补建找不到话, 刷新: true };
    throw e;
  }
  await recordAudit({
    user: me, action: "close", entity: "EntDupeHit", entityId: a.行id,
    summary: `不补建重复咨询待补建（客户 ${a.r.客户编号}，${a.r.交的人.名} 交的）：${因}`,
    detail: { 不补建: true, 位: a.位, 客户: a.客户id, 原因: 因, 交的人: a.r.交的人.id },
  });
  await notify([a.r.交的人.id], {
    kind: "重复咨询待补建", key: `repeat-unbuilt-closed:${未建键(a.行id, a.位)}`,
    title: `重复咨询不补建：${a.r.客户编号}`,
    body: `你交的客户 ${a.r.客户编号} 那次咨询，${me.name} 决定不补建，原因：${因}`,
    link: 待补建栏链接,
  });
  return { ok: true, 提示: "已关闭，已告诉交的同事" };
}
