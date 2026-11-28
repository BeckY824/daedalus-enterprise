/**
 * 企业版跨负责人项目直接合并 · 申请（阶段 1：库表 + 服务端核心，无页面入口；E-380，方案 wt/plan-cross-owner-merge.md、终审 review/plan-xmerge-final.md）。
 *
 * 范围：同一位客户下、负责人不同、都在线索阶段、没结束的两个项目；只动这两个，并完归留下那个项目的负责人。
 * 数据层的挪、结束、台账、30 天撤回全部复用 project-merge.ts（挪 / 撤回项目合并），这里只管「谁能发、谁确认、什么时候失效」。
 *
 *   谁发起：留下那个项目的负责人发申请；确认人（原负责人的实线上级 / 同线条线总管理 / 都没有给系统管理员）自己发起 = 直接并（不建申请，留痕「本人发起」）；
 *          系统管理员发起也是直接并；被并走那位（原负责人）不能发起。其余人不能发。
 *   谁确认：被并走那个项目的负责人的实线直属上级、同业务线条线总管理（任一位都能点），两者都没有才给系统管理员。
 *   失效：5 个工作日（复用 merge-request.ts 的 到期时刻）；确认时再判（两个项目的负责人、阶段 / 结局、回款提成、被判无效四项有变，或 拦的原因 拦下）= 已失效并写原因。
 *   确认：同事务调 project-merge.ts 的 挪()（经 执行项目合并 的 跨负责人 opt），被并走的原负责人记 1 个并走待补（占过名额才记），申请置已合并。
 *   互斥：这两个项目所属客户有客户合并申请（EntMergeRequest）在等同意时不能发；反过来 merge-request.ts 发起前判 也认这里待确认的申请。
 *   暂停：待确认期间被并走的那条新线索的「验证时限」（lead-verify-timeout.ts）和「超时自动转」（reply-overdue.ts）两处扫描都跳过（人工判仍可进行）；
 *        申请结束（失效 / 确认 / 拒绝 / 撤回）后从头计时：验证时限起钟取 max(原起钟, 申请结束时刻)，超时自动转链在待确认期间每遍重置起点 = 现在。
 *
 * 函数签名见 wt/xmerge-api.md。通知、页面、异议接入、台账列后面阶段做。
 */
import type { PrismaClient, Prisma } from "@/generated/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 权限组织, 是系统管理员of, type 组织 } from "./org";
import { 管理员类别们of } from "./org-core";
import { 只读角色, 只看的人 } from "./permissions";
import { 接手问题 } from "./lead-assign";
import { 条线的线 } from "./line-viewer";
import { 原负责人上级, 系统管理员们 } from "./tri-state-people";
import { 是项目线 } from "./assign-line";
import { 拦下, 合并事务选项, 并发失败话, 刚被改过话, type 合并人 } from "./customer-merge";
import { 拒绝原因上限 } from "@/app/(app)/customers/merge-request-words";
import { 到期时刻, 到期了, 到期话, 等待工作日 } from "./merge-request";
import { 跨并通知 } from "./project-merge-request-notice";
import { 拦的原因, 读项目, 现在交给, 执行项目合并, 读快照, 比四项, 四项, 变动话, type 快照, type 变动项, type 项目快照, type 跨并信息, type 项目行, type 项目合并完 } from "./project-merge";

type 库 = PrismaClient;
type Tx = Prisma.TransactionClient;
type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export const 跨并状态 = { 待确认: "待确认", 执行中: "执行中", 已合并: "已合并", 已拒绝: "已拒绝", 已失效: "已失效", 已撤回: "已撤回" } as const;
export { 等待工作日 as 跨并等待工作日, 到期话 as 跨并到期话 };
export const 层级 = { 上级: "实线上级", 条线: "条线总管理", 管理员: "系统管理员" } as const;
export type 确认人层级 = (typeof 层级)[keyof typeof 层级];
export type 确认人 = { userId: string; 层级: 确认人层级 };

export const 拒绝必填话 = "拒绝要写一句原因";
export const 拒绝原因超话 = `拒绝原因最多 ${拒绝原因上限} 字`;
export const 客户合并申请挡话 = "这位客户有一张客户合并申请在等同意，先处理那张再发跨负责人合并";
export const 渠运不开话 = "这位客户的负责人不是销售，暂不开跨负责人合并";
export const 兼市场不开话 = "这位客户的负责人兼市场管理，暂不开跨负责人合并";

/** 客户负责人必须是销售（不是渠运、不兼市场管理）；null = 行，有话 = 不开（E-380:13） */
function 客户负责人拦(org: 组织, salesOwnerId: string | null | undefined): string | null {
  if (!salesOwnerId || 接手问题(org, salesOwnerId, null) !== null) return 渠运不开话;
  if (管理员类别们of(org, salesOwnerId).has("市场管理")) return 兼市场不开话;
  return null;
}
async function 客户负责人拦于(db: Tx | 库, org: 组织, customerId: string): Promise<string | null> {
  const 客户 = await 看全部(() => db.customer.findFirst({ where: { id: customerId }, select: { salesOwnerId: true } }));
  return 客户负责人拦(org, 客户?.salesOwnerId);
}

const 名 = (p: Pick<项目行, "name">) => p.name || "未命名项目";
const 只读身份 = (me: 合并人, org: 组织 | null) => !!org && (只读角色(me, org) || !!只看的人(org, me.id));

/* ───────────────────────── 确认人 ───────────────────────── */

/**
 * 确认人（E-380:11，判定 二#12）：被并走那个项目的负责人（原负责人）的实线直属上级（停用了按停用前手填的上级，还在职才算）、
 * 同业务线条线总管理（线按被并项目的业务线，没填按原负责人的线）；两者都没有才给系统管理员。去掉原负责人本人；只留在职的。
 * 一个人两个身份只出一行（上级优先）
 */
export function 算确认人(org: 组织, B: { ownerId: string; bizLine?: string | null }): 确认人[] {
  const 线 = 是项目线(B.bizLine) && (B.bizLine === "内贸" || B.bizLine === "外贸") ? B.bizLine : org.成员.get(B.ownerId)?.line ?? null;
  const 出: 确认人[] = [];
  const 加 = (id: string | null | undefined, 层: 确认人层级) => {
    if (id && id !== B.ownerId && org.成员.has(id) && !出.some((x) => x.userId === id)) 出.push({ userId: id, 层级: 层 });
  };
  加(原负责人上级(org, B.ownerId), 层级.上级);
  if (线) for (const id of org.成员.keys()) if (条线的线(org, id) === 线) 加(id, 层级.条线);
  if (!出.length) for (const id of 系统管理员们(org)) 加(id, 层级.管理员);
  return 出;
}
const 层级们话 = (人们: readonly 确认人[]) => [...new Set(人们.map((x) => x.层级))].join("、");

/* ───────────────────────── 快照（确认时比四项） ───────────────────────── */

export { 四项, 读快照, 比四项, 变动话 };
export type { 快照, 变动项, 项目快照 };

/* ───────────────────────── 发起 ───────────────────────── */

export type 发起完 =
  | { 方式: "直接并"; mergeId: string; 条数: 项目合并完["条数"] }
  | { 方式: "申请"; requestId: string; 确认人: 确认人[]; expiresAt: Date };

/** 发起前的几道判（发起、预览共用）：null = 能发；返回「谁能发起的结论」带上 直接 / 申请 */
export type 发起判 = { ok: true; 直接: boolean; 确认人: 确认人[]; A: 项目行; B: 项目行 } | { ok: false; 原因: string[] };

export async function 发起前判(db: Tx | 库, 留下id: string, 并掉id: string, me: 合并人, org: 组织 | null, 交给: Awaited<ReturnType<typeof 现在交给>>): Promise<发起判> {
  if (!企业版() || !org) return { ok: false, 原因: ["只有企业版能发跨负责人合并"] };
  if (只读身份(me, org)) return { ok: false, 原因: ["你现在是只读身份，不能发起合并"] };
  const [A, B] = [await 读项目(db, 留下id), await 读项目(db, 并掉id)];
  if (!A || !B) return { ok: false, 原因: ["项目不存在或已删除，刷新看看"] };
  if (A.id === B.id) return { ok: false, 原因: ["不能和自己合并，请选另一个项目"] };
  if (A.customerId !== B.customerId) return { ok: false, 原因: ["两个项目不在同一位客户名下"] };
  if (!A.ownerId || !B.ownerId) return { ok: false, 原因: ["有项目没有负责人，没人可以确认；请找系统管理员处理"] };
  if (A.ownerId === B.ownerId) return { ok: false, 原因: ["两个项目是同一位负责人，直接合并即可，不用跨负责人申请"] };
  // 被并走的负责人不能发起（E-380:11）
  if (me.id === B.ownerId) return { ok: false, 原因: ["被并走的项目的负责人不能发起，请留下项目的负责人发起"] };
  const 客拦 = await 客户负责人拦于(db, org, A.customerId);
  if (客拦) return { ok: false, 原因: [客拦] };
  const 人们 = 算确认人(org, B);
  if (!人们.length) return { ok: false, 原因: ["找不到确认人（原负责人没有上级和条线总管理，也没有系统管理员）"] };
  // 确认人自己、系统管理员发起 = 直接并；其余只有留下项目的负责人能发申请
  const 直接 = 是系统管理员of(org, me.id) || 人们.some((x) => x.userId === me.id);
  if (!直接 && me.id !== A.ownerId) return { ok: false, 原因: ["只有留下项目的负责人，或被并走那位负责人的上级 / 条线总管理 / 系统管理员能发起"] };
  const 因 = await 拦的原因(db, A, B, me, org, 交给, { 申请id: null, 发起人id: me.id, 确认人id: me.id, 发起方式: "本人发起", 确认人层级: "" });
  // 互斥：这位客户有客户合并申请在等同意
  const 客户申请 = await db.entMergeRequest.findFirst({ where: { status: { in: ["待同意", "执行中"] }, OR: [{ fromId: A.customerId }, { intoId: A.customerId }] }, select: { id: true } });
  if (客户申请) 因.push(客户合并申请挡话);
  return 因.length ? { ok: false, 原因: 因 } : { ok: true, 直接, 确认人: 人们, A, B };
}

export async function 跨并预览(db: 库, 留下id: string, 并掉id: string, me: 合并人): Promise<发起判> {
  const org = await 权限组织();
  return 发起前判(db, 留下id, 并掉id, me, org, await 现在交给(org));
}

/**
 * 发起跨负责人并：留下 id 的项目并进来、并掉 id 的项目被并走。
 * 直接并（发起人本身是确认人 / 系统管理员）：同一笔里挪完，记「本人发起」；否则建申请，等确认人
 */
export async function 发起跨负责人并(db: 库, 留下id: string, 并掉id: string, me: 合并人, opt: { 现在?: Date } = {}): Promise<结果<发起完>> {
  const 现在 = opt.现在 ?? new Date();
  const org = await 权限组织();
  const 交给 = await 现在交给(org);
  const 预判 = await 发起前判(db, 留下id, 并掉id, me, org, 交给);
  if (!预判.ok) return { ok: false, error: 预判.原因.join("；") };
  if (预判.直接) {
    const 层 = 预判.确认人.find((x) => x.userId === me.id)?.层级 ?? 层级.管理员;
    const 期望 = {
      留下负责人: 预判.A.ownerId, 并掉负责人: 预判.B.ownerId,
      // 事务里重判：我还是确认人 / 系统管理员、客户负责人还是销售（org 在手，不费事）
      另判: async (tx: Tx, A: 项目行, B: 项目行) => {
        if (!是系统管理员of(org!, me.id) && !算确认人(org!, B).some((x) => x.userId === me.id)) return "你已经不是这个项目的确认人，刷新看看";
        return 客户负责人拦于(tx, org!, A.customerId);
      },
    };
    const r = await 执行项目合并(db, 留下id, 并掉id, me, { 现在, 已核未开票: true, 跨负责人: { 申请id: null, 发起人id: me.id, 确认人id: me.id, 发起方式: "本人发起", 确认人层级: 层, 期望 } });
    return r.ok ? { ok: true, 方式: "直接并", mergeId: r.mergeId, 条数: r.条数 } : r;
  }
  try {
    return await 看全部(() => db.$transaction(async (tx) => {
      // 事务里重判一遍（防两个人同时发）
      const 判 = await 发起前判(tx, 留下id, 并掉id, me, org, 交给);
      if (!判.ok) throw new 拦下(判.原因.join("；"));
      const 快 = await 读快照(tx, 判.A, 判.B);
      const expiresAt = 到期时刻(现在);
      const 单 = await tx.entProjectMergeRequest.create({
        data: {
          fromProjectId: 判.B.id, fromOwnerId: 判.B.ownerId, intoProjectId: 判.A.id, intoOwnerId: 判.A.ownerId, customerId: 判.A.customerId, byUserId: me.id,
          confirmerIds: JSON.stringify(判.确认人), confirmerRole: 层级们话(判.确认人), status: 跨并状态.待确认, snapshot: JSON.stringify(快), at: 现在, expiresAt,
        },
      });
      const detail = JSON.stringify({ requestId: 单.id, 留下: 判.A.id, 并掉: 判.B.id, 确认人: 判.确认人, 到期: expiresAt.toISOString() });
      await tx.auditLog.createMany({
        data: [判.A, 判.B].map((p) => ({
          userId: me.id, userName: me.name, action: "project-merge-request", entity: "Project", entityId: p.id, at: 现在,
          summary: p.id === 判.A.id ? `发跨负责人合并申请：把「${名(判.B)}」并进这个项目，等${层级们话(判.确认人)}确认（${等待工作日} 个工作日内）` : `发跨负责人合并申请：这个项目并进「${名(判.A)}」，等${层级们话(判.确认人)}确认（${等待工作日} 个工作日内）`,
          detail,
        })),
      });
      return { ok: true as const, 方式: "申请" as const, requestId: 单.id, 确认人: 判.确认人, expiresAt };
    }, 合并事务选项));
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/* ───────────────────────── 结束一张申请 ───────────────────────── */

type 申请头 = { id: string; fromProjectId: string; intoProjectId: string; byUserId: string };

/** 结束（拒绝 / 失效 / 撤回）：条件更新，状态还是 来自 才改；两个项目各记一条操作日志。系统判的失效 谁 = null（日志记在发起人名下、叫「系统」） */
async function 结束(tx: Tx, r: 申请头, 来自: string, 状态: string, 原因: string, 谁: 合并人 | null, 动作: string, 现在: Date): Promise<boolean> {
  const n = await tx.entProjectMergeRequest.updateMany({ where: { id: r.id, status: 来自 }, data: { status: 状态, reason: 原因, endedAt: 现在, endedById: 谁?.id ?? null } });
  if (!n.count) return false;
  const detail = JSON.stringify({ requestId: r.id, 原因 });
  await tx.auditLog.createMany({
    data: [r.intoProjectId, r.fromProjectId].map((entityId) => ({ userId: 谁?.id ?? r.byUserId, userName: 谁?.name ?? "系统", action: 动作, entity: "Project", entityId, at: 现在, summary: `跨负责人合并申请${状态}：${原因}`, detail })),
  });
  return true;
}

/* ───────────────────────── 确认 / 拒绝 ───────────────────────── */

export type 处理完 = { 状态: (typeof 跨并状态)[keyof typeof 跨并状态]; mergeId?: string };

/**
 * 确认人点确认 / 拒绝。确认：先条件置「执行中」，再比四项、调 执行项目合并（同事务挪完并置已合并）；
 * 失败（四项有变、被 拦的原因 拦下）= 已失效并写原因，返回 ok:false + 原因；「刚被别人改过」（并发）放回待确认。拒绝原因必填
 */
export async function 处理跨并申请(db: 库, requestId: string, me: 合并人, 结论: "确认" | "拒绝", opt: { 原因?: string; 现在?: Date } = {}): Promise<结果<处理完>> {
  if (!企业版()) return { ok: false, error: "只有企业版有跨负责人合并" };
  const 现在 = opt.现在 ?? new Date();
  const org = await 权限组织();
  if (!org) return { ok: false, error: "只有企业版有跨负责人合并" };
  if (只读身份(me, org)) return { ok: false, error: `你现在是只读身份，不能${结论}合并申请` };
  const 原因 = (opt.原因 ?? "").trim();
  if (结论 === "拒绝") {
    if (!原因) return { ok: false, error: 拒绝必填话 };
    if (原因.length > 拒绝原因上限) return { ok: false, error: 拒绝原因超话 };
  }
  let 层: 确认人层级 | null = null;
  try {
    const 态 = await 看全部(() => db.$transaction(async (tx): Promise<{ 结束: string } | { 继续: true; r: NonNullable<Awaited<ReturnType<Tx["entProjectMergeRequest"]["findUnique"]>>> }> => {
      const r = await tx.entProjectMergeRequest.findUnique({ where: { id: requestId } });
      if (!r) throw new 拦下("找不到这张跨负责人合并申请");
      if (r.status !== 跨并状态.待确认) throw new 拦下(`这张申请${r.status}，不能${结论}`);
      if (到期了(r, 现在)) {
        await 结束(tx, r, 跨并状态.待确认, 跨并状态.已失效, 到期话, null, "project-merge-request-void", 现在);
        return { 结束: 到期话 };
      }
      // 确认人 = 发起时存的名单（还在职的）∪ 现在按组织重算的（原负责人没换，才认重算的）
      const 存 = JSON.parse(r.confirmerIds) as 确认人[];
      const 被并 = await tx.project.findFirst({ where: { id: r.fromProjectId }, select: { bizLine: true } });
      const 现算 = 算确认人(org, { ownerId: r.fromOwnerId, bizLine: 被并?.bizLine });
      const 我 = 存.find((x) => x.userId === me.id && org.成员.has(me.id)) ?? 现算.find((x) => x.userId === me.id);
      if (!我) throw new 拦下("你不是这张申请的确认人");
      层 = 我.层级;
      if (结论 === "拒绝") {
        if (!(await 结束(tx, r, 跨并状态.待确认, 跨并状态.已拒绝, 原因, me, "project-merge-request-reject", 现在))) throw new 拦下(刚被改过话);
        return { 结束: 跨并状态.已拒绝 };
      }
      const n = await tx.entProjectMergeRequest.updateMany({ where: { id: r.id, status: 跨并状态.待确认 }, data: { status: 跨并状态.执行中 } });
      if (!n.count) throw new 拦下(刚被改过话);
      return { 继续: true, r };
    }, 合并事务选项));
    if ("结束" in 态) {
      if (态.结束 === 到期话) return { ok: false, error: 到期话 };
      return { ok: true, 状态: 跨并状态.已拒绝 };
    }
    return await 执行申请(db, org, 态.r, me, 层 ?? 层级.管理员, 现在);
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

async function 执行申请(db: 库, org: 组织, r: NonNullable<Awaited<ReturnType<库["entProjectMergeRequest"]["findUnique"]>>>, me: 合并人, 层: 确认人层级, 现在: Date): Promise<结果<处理完>> {
  const 放回 = () => db.entProjectMergeRequest.updateMany({ where: { id: r.id, status: 跨并状态.执行中 }, data: { status: 跨并状态.待确认 } });
  const 失效 = async (话: string): Promise<结果<处理完>> => {
    await db.$transaction((tx) => 结束(tx, r, 跨并状态.执行中, 跨并状态.已失效, 话, null, "project-merge-request-void", 现在), 合并事务选项);
    return { ok: false, error: 话 };
  };
  let 结: Awaited<ReturnType<typeof 执行项目合并>>;
  try {
    const [A, B] = [await 读项目(db, r.intoProjectId), await 读项目(db, r.fromProjectId)];
    if (!A || !B) return await 失效("项目已不存在，申请已失效");
    结 = await 执行项目合并(db, r.intoProjectId, r.fromProjectId, me, {
      现在, 已核未开票: true,
      跨负责人: {
        申请id: r.id, 发起人id: r.byUserId, 确认人id: me.id, 发起方式: "申请确认", 确认人层级: 层,
        // 比四项、负责人、客户负责人都在合并事务里重判（审查必改 2、建议 3），不留事务外的空档
        期望: { 留下负责人: r.intoOwnerId, 并掉负责人: r.fromOwnerId, 快照: JSON.parse(r.snapshot) as 快照, 另判: (tx, A) => 客户负责人拦于(tx, org, A.customerId) },
      },
    });
  } catch (e) {
    await 放回();
    throw e;
  }
  if (!结.ok && 结.error === 刚被改过话) {
    await 放回();
    return { ok: false, error: 刚被改过话 };
  }
  if (!结.ok) return await 失效(`${结.error}，申请已失效`);
  return { ok: true, 状态: 跨并状态.已合并, mergeId: 结.mergeId };
}

/* ───────────────────────── 撤回 / 到期 ───────────────────────── */

/** 发起人撤回申请（只在待确认时） */
export async function 撤回跨并申请(db: 库, requestId: string, me: 合并人, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版有跨负责人合并" };
  if (只读身份(me, await 权限组织())) return { ok: false, error: "你现在是只读身份，不能撤回合并申请" };
  try {
    return await 看全部(() => db.$transaction(async (tx) => {
      const r = await tx.entProjectMergeRequest.findUnique({ where: { id: requestId } });
      if (!r) throw new 拦下("找不到这张跨负责人合并申请");
      if (r.byUserId !== me.id) throw new 拦下("只有发起人能撤回合并申请");
      if (r.status !== 跨并状态.待确认) throw new 拦下(`这张申请${r.status}，不能撤回`);
      if (!(await 结束(tx, r, 跨并状态.待确认, 跨并状态.已撤回, `${me.name}撤回了申请`, me, "project-merge-request-withdraw", 现在))) throw new 拦下(刚被改过话);
      return { ok: true as const };
    }, 合并事务选项));
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话 = 并发失败话(e);
    if (话) return { ok: false, error: 话 };
    throw e;
  }
}

/**
 * 到期扫一遍：待确认、执行中（进程在两笔之间被杀会卡在这）过了到期时刻的都记已失效；回失效了几张。每分钟的钟调 钟上扫过期跨并申请。
 * 正在执行的那笔碰上到期被扫：跨并后补记 的条件更新（状态要是执行中）会让整笔回滚，结果一致
 */
export async function 扫过期跨并申请(db: 库, 现在: Date = new Date()): Promise<number> {
  if (!企业版()) return 0;
  const 们 = await db.entProjectMergeRequest.findMany({ where: { status: { in: [跨并状态.待确认, 跨并状态.执行中] }, expiresAt: { lte: 现在 } }, select: { id: true, status: true, fromProjectId: true, intoProjectId: true, byUserId: true } });
  let n = 0;
  for (const r of 们) {
    if (await db.$transaction((tx) => 结束(tx, r, r.status, 跨并状态.已失效, 到期话, null, "project-merge-request-void", 现在), 合并事务选项)) {
      n++;
      // 到期失效通知发起人 + 确认人（阶段 2；提交以后发，从不抛）
      await 跨并通知(db, r.id, "失效", null, 到期话);
    }
  }
  return n;
}
/**
 * 系统管理员作废一张待确认的申请（方案第一节第 9 条；页面入口阶段 2 再做）。原因必填；结束为已失效、endedById = 系统管理员。
 * 不管到期没到期，只要还在待确认就能作废（执行中的那笔马上就并完或失效，不开）
 */
export async function 作废跨并申请(db: 库, requestId: string, me: 合并人, 原因: string, 现在: Date = new Date()): Promise<结果> {
  if (!企业版()) return { ok: false, error: "只有企业版有跨负责人合并" };
  const org = await 权限组织();
  if (!org || !是系统管理员of(org, me.id)) return { ok: false, error: "只有系统管理员能作废合并申请" };
  const 话 = 原因.trim();
  if (!话) return { ok: false, error: "作废要写一句原因" };
  if (话.length > 拒绝原因上限) return { ok: false, error: 拒绝原因超话 };
  try {
    return await 看全部(() => db.$transaction(async (tx) => {
      const r = await tx.entProjectMergeRequest.findUnique({ where: { id: requestId } });
      if (!r) throw new 拦下("找不到这张跨负责人合并申请");
      if (r.status !== 跨并状态.待确认) throw new 拦下(`这张申请${r.status}，不能作废`);
      if (!(await 结束(tx, r, 跨并状态.待确认, 跨并状态.已失效, 话, me, "project-merge-request-void", 现在))) throw new 拦下(刚被改过话);
      return { ok: true as const };
    }, 合并事务选项));
  } catch (e) {
    if (e instanceof 拦下) return { ok: false, error: e.message };
    const 话2 = 并发失败话(e);
    if (话2) return { ok: false, error: 话2 };
    throw e;
  }
}
export async function 钟上扫过期跨并申请(现在: Date = new Date()): Promise<number> {
  const { prisma } = await import("@/lib/prisma");
  return 扫过期跨并申请(prisma, 现在);
}

/* ───────────────────────── 暂停 / 重新起算（两处扫描用） ───────────────────────── */

/**
 * 这几个项目里，哪些是跨负责人并申请里的两条（被并走的、留下的，方向无关）、申请还在等确认 / 执行：它们的验证时限和超时自动转暂停。
 * 执行中也要没到期：卡死的执行中到期后不再算暂停（并由 扫过期跨并申请 置已失效）。
 * 到期没扫到的（过了到期时刻、还没被钟置失效）不算暂停，免得钟停了计时跟着停
 */
export async function 跨并暂停中的项目(db: Pick<库, "entProjectMergeRequest">, ids: readonly string[], 现在: Date = new Date()): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const 行 = await db.entProjectMergeRequest.findMany({
    where: { OR: [{ fromProjectId: { in: [...ids] } }, { intoProjectId: { in: [...ids] } }], status: { in: [跨并状态.待确认, 跨并状态.执行中] }, expiresAt: { gt: 现在 } },
    select: { fromProjectId: true, intoProjectId: true },
  });
  const 要 = new Set(ids);
  return new Set(行.flatMap((x) => [x.fromProjectId, x.intoProjectId]).filter((id) => 要.has(id)));
}

/** 申请结束（失效 / 拒绝 / 撤回；已合并的被并项目已结束，不用）后重新起算的时刻：每个项目最近一张结束申请的 endedAt */
export async function 跨并重新起算时刻们(db: Pick<库, "entProjectMergeRequest">, ids: readonly string[]): Promise<Map<string, Date>> {
  const 出 = new Map<string, Date>();
  if (!ids.length) return 出;
  const 行 = await db.entProjectMergeRequest.findMany({
    where: { OR: [{ fromProjectId: { in: [...ids] } }, { intoProjectId: { in: [...ids] } }], status: { in: [跨并状态.已失效, 跨并状态.已拒绝, 跨并状态.已撤回] }, endedAt: { not: null } },
    select: { fromProjectId: true, intoProjectId: true, endedAt: true },
  });
  const 要 = new Set(ids);
  for (const x of 行) {
    const t = x.endedAt!;
    for (const id of [x.fromProjectId, x.intoProjectId]) {
      if (!要.has(id)) continue;
      const 旧 = 出.get(id);
      if (!旧 || 旧.getTime() < t.getTime()) 出.set(id, t);
    }
  }
  return 出;
}

/** 客户合并申请（merge-request.ts）发起前用：这位客户名下有跨负责人项目合并申请在等确认 */
export async function 客户有跨并申请(db: Pick<库, "entProjectMergeRequest">, customerIds: readonly string[]): Promise<boolean> {
  return !!(await db.entProjectMergeRequest.findFirst({ where: { customerId: { in: [...customerIds] }, status: { in: [跨并状态.待确认, 跨并状态.执行中] } }, select: { id: true } }));
}

export type { 跨并信息 };
