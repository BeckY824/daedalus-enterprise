"use server";

/**
 * 公海的动作（2026-10-03，0.46.15 第 6 块）：放进公海、领取、老板分配（2026-10-20）、撤销（每个动作的提示条上都有）。
 * 规矩在 lib/pool.ts、自动掉公海在 lib/pool-db.ts。
 */
import { 转交商机 } from "@/lib/opportunity-activity";
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { 公海分不给 } from "@/lib/owners";
import { 看全部, 虚线只读挡 } from "@/lib/team-scope";
import { 权限组织 } from "@/lib/enterprise/org";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 能管公海, 能转出自己的, 只读角色, 只读角色话, 没设业务角色, 没业务角色不能领话, 能领公海, 不能领公海话 } from "@/lib/enterprise/permissions";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { recordAudit } from "@/lib/audit";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 带走并记下, 还项目, 数进手的持有项目, type 带走的 } from "@/lib/carry-over-db";
import { 记换负责人, 是我刚换的, 撤销时限毫秒, 公海前负责人, 公海客户原负责人是, 删被撤的换负责人记录, 还原进公海前负责人 } from "@/lib/owner-log-db";
import type { 带走数 } from "@/lib/carry-over";
import { 拦原负责人, 原负责人不能领回提示, 公海规则 } from "@/lib/enterprise/pool-rules";
import { 领客户带走公海项目, 客户名下在推项目进公海, 客户进公海清负责人 } from "@/lib/enterprise/pool-link";
import { 带待办勾 } from "@/lib/project/carry-tasks";
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";
import { 企业版 } from "@/lib/enterprise/switch";
import { 进公海挂靠通知 } from "@/lib/enterprise/attach-approval";
import { 可选项, 选的原因 } from "@/lib/enterprise/dict";
import { 回收原因前缀 } from "@/lib/project/timeout";
import { 要选退回原因提示 } from "@/lib/enterprise/unified-pool";
import { 公海分配通知, 客户放回公海通知, 客户撤销放回通知 } from "@/lib/enterprise/notice-sources";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 能进公海的阶段, 超上限n } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 历史负责人们, 还原清掉的组员 } from "@/lib/project/pool-owner";
import { 换负责人待办 } from "@/lib/project/carry-tasks";
import { 查完再写 } from "@/lib/check-then-write";
import { 有同事在推的客户, 同事在推不能放公海话, 同事在推项目说法, 订单项目说法 } from "@/lib/enterprise/colleague-projects";
import { 交接中的客户 } from "@/lib/enterprise/handover-db";
import { Prisma } from "@/generated/prisma";
import { 客户退回前查联系方式, 退回号码种类表 } from "@/lib/enterprise/return-contact-check";
import { 还负责人 } from "@/lib/project/owner-write";

export type 公海结果 =
  | {
      ok: true;
      /** 真动了几位 */
      updated: number;
      /** 本来就是这样的（已在公海 / 本来就不在公海） */
      unchanged: number;
      /** 不是自己的、自己又不是管理员——放不进去 */
      没权限: number;
      /** 放进公海：名下有没结束的订单阶段项目、没放的几位（企业版，B1-4） */
      有订单?: number;
      /** 拦住那几位的订单项目：自己负责的写名字，同事的只给个数（P-看-12 例外） */
      订单项目?: string;
      /** 放进公海：正在转让交接中、没放的几位（企业版，C3-2） */
      交接中?: number;
      /** 放进公海：名下有同事负责、还没结束的项目，没放的几位（企业版 P-公海-06，11-05） */
      同事在推?: number;
      /** 拦住那几位的同事项目个数：「客户A」有 2 个同事在推的项目…（P-看-12 例外，只写个数，Even C4） */
      同事项目?: string;
      /** 放进公海：联系方式空着或有号码不对、没放的几位（企业版，M-公海-15） */
      联系方式不全?: number;
      /** 领取时跟着过来的没做完的活 */
      带走?: 带走数;
      /** 领取前各归谁：撤销领取时还给他、放回公海 */
      原负责人?: { id: string; 值: string }[];
      /** 领取时带过来的是哪几条活：撤销只还这几条 */
      带过来?: 带走的;
      /** 老板分配：分给了谁（id、名字），撤销时按他认「还归他」 */
      给谁?: { id: string; name: string };
      /** 企业版：跟着客户一起领 / 分过来的项目公海里的项目，撤销时放回项目公海（交互规则 B，10-30）；
       *  放进公海时 = 跟着一起进项目公海的客户负责人自己的项目，撤销时还给他（P-公海-06，11-05） */
      公海项目?: string[];
    }
  | { ok: false; error: string };

function 刷新(ids: string[]) {
  revalidatePath("/customers");
  revalidatePath("/pool");
  if (ids.length === 1) revalidatePath(`/customers/${ids[0]}`);
  revalidatePath("/dashboard");
}

/**
 * 企业版统一公海（P7，迁移 080）：每位客户累计主动退回几次。放进公海 +1、撤销放进 −1（不到 0），
 * 超时回收、离职交接、撤销领取放回去的都不算。走裸 SQL：只是个计数，不该顶掉 updatedAt（「最近更新」排序）
 */
async function 记退回(ids: string[], 加: 1 | -1) {
  if (!企业版() || !ids.length) return;
  await prisma.$executeRaw(加 === 1
    ? Prisma.sql`UPDATE "Customer" SET "poolReturns" = "poolReturns" + 1 WHERE "id" IN (${Prisma.join(ids)})`
    : Prisma.sql`UPDATE "Customer" SET "poolReturns" = MAX(0, "poolReturns" - 1) WHERE "id" IN (${Prisma.join(ids)})`);
}

/** 企业版统一公海（P7，迁移 079）：这几位里标了无效的（还在公海里的）。标了无效的不能领、不能分 */
async function 无效的(ids: string[]): Promise<Set<string>> {
  if (!企业版() || !ids.length) return new Set();
  // 带否定条件 Prisma 不会自己拆批，过 999 个参数报 P2029（11-03 B2-3）：500 个一批查
  const 无效 = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const 这批 = ids.slice(i, i + 500);
    for (const c of await 看全部(() => prisma.customer.findMany({ where: { id: { in: 这批 }, pool: { isNot: null }, poolInvalidAt: { not: null } }, select: { id: true } }))) 无效.add(c.id);
  }
  return 无效;
}
const 无效不能领提示 = "标了无效的客户不能领取，要系统管理员先恢复";

/** 客户放回公海时能选的退回原因（企业版字典「回收原因」，停用的不出）；别的版本 = 空，不问 */
export async function 退回原因选项(): Promise<string[]> {
  await requireUser();
  return 可选项("recycle");
}

const 有订单不能放提示 = (客户: string, 订单项目: string) => `${客户}名下有没结束的订单阶段项目${订单项目 ? `（${订单项目}）` : ""}，不能放回公海`;
const 交接中不能放提示 = (客户: string) => `这位${客户}正在转让交接中，先撤回交接再放回公海`;

/**
 * 放进公海：负责人本人或管理员才能放（别人的客户你放不进去——那等于替同事把人扔了）。可批量，
 * 不是自己的那几位跳过并说一声。企业版负责人清空、原负责人记历史（M-公海-03，pool-link.ts 客户进公海清负责人）；
 * 别的版本原负责人不动，领的人来了才换。
 * 企业版要选退回原因（字典「回收原因」，字典里一项都没启用时不拦），存成「回收原因：X」，统一公海「入池原因」列读它（M-公海-09）；
 * 别的版本不问，照旧记「手动」
 * 企业版 P-公海-06（11-05）：客户负责人自己负责、还没结束的项目一起进项目公海（同项目放回公海：清负责人、记 pool-release、关待办）；
 * 名下有同事负责、还没结束的项目的，整位拦住（M-公海-02 例外二）
 */
export async function 放进公海(ids: string[], 原因?: unknown): Promise<公海结果> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  const 虚线 = await 虚线只读挡(defaultClient, ids);
  if (虚线) return { ok: false, error: 虚线 };
  const 这些 = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
  const 已在 = 这些.filter((c) => c.pool);
  const 组织 = await 权限组织();
  const 管 = 能管公海(me, 组织);
  // 11-02：自己的也得是销售 / 销售管理才能放（管理员只读、没设业务角色的没权限）
  const 自己能放 = 能转出自己的(me, 组织);
  const 有权限 = 这些.filter((c) => !c.pool && (管 || (自己能放 && c.salesOwnerId === me.id)));
  // 企业版：名下有没结束的订单阶段项目的不能放（11-03 完成度 B1-4，同项目放回公海「订单阶段的项目不能放回公海」）。
  // 不按谁在看限定：别人负责的订单项目也算
  const 订单们 = 企业版() && 有权限.length
    ? await 看全部(() => prisma.project.findMany({
        where: { customerId: { in: 有权限.map((c) => c.id) }, pooledAt: null, result: null, phase: { notIn: [...能进公海的阶段] } },
        select: { customerId: true, name: true, ownerId: true }, orderBy: { createdAt: "asc" },
      }))
    : [];
  const 有订单 = new Set(订单们.map((p) => p.customerId));
  const 订单项目 = 订单项目说法(订单们, me.id);
  // 正在转让交接中的不能放（11-03 完成度 C3-2）：放了接手人确认后客户归他、公海那行还在，他看不到也领不到。别人发起的交接也算
  const 交接中 = 企业版() && 有权限.length ? await 看全部(() => 交接中的客户(有权限.map((c) => c.id))) : new Set<string>();
  // P-公海-06 / M-公海-02 例外二：名下有同事负责、还没结束的项目的不能放（同事的项目不跟着进公海，客户进了他就跟不了）
  const 同事在推 = 企业版() && 有权限.length ? await 有同事在推的客户(prisma, 有权限) : new Set<string>();
  // M-公海-15（11-05 用户）：客户电话、联系人、项目联系人的号码要有、而且全对才能放（谁放都一样）
  const 号码错 = 企业版() && 有权限.length ? await 看全部(async () => 客户退回前查联系方式(prisma, 有权限.map((c) => c.id), await 退回号码种类表())) : new Map<string, string>();
  const 能放 = 有权限.filter((c) => !有订单.has(c.id) && !交接中.has(c.id) && !同事在推.has(c.id) && !号码错.has(c.id));
  // 同事的项目平时看不到，被拦时只说个数（P-看-12 例外、Even C4），按选的先后列
  const 被同事拦 = 有权限.filter((c) => 同事在推.has(c.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  // 别的照放时提示条只说「N 位…没放」，那就带上客户名
  const 同事项目 = 被同事拦.length ? await 同事在推项目说法(prisma, 被同事拦, 被同事拦.length > 1 || 能放.length > 0) : "";
  const 没权限 = 这些.length - 已在.length - 有权限.length;
  if (!能放.length) {
    if (有订单.size) return { ok: false, error: 有订单不能放提示(b.customer, 订单项目) };
    if (交接中.size) return { ok: false, error: 交接中不能放提示(b.customer) };
    if (同事在推.size) return { ok: false, error: 同事在推不能放公海话(被同事拦.map((c) => c.name), b.customer, 同事项目) };
    if (号码错.size) {
      const [id, 话] = [...号码错][0];
      const 名 = 有权限.length > 1 ? `「${有权限.find((c) => c.id === id)?.name ?? ""}」` : "";
      return { ok: false, error: `${名}${话}` };
    }
    return 没权限 ? { ok: false, error: `只有负责人或总管理、销售管理能把${b.customer}放回公海` } : { ok: true, updated: 0, unchanged: 已在.length, 没权限: 0 };
  }
  // 能放了才问原因：放不了的那句（虚线、没权限、已在公海）照旧先说
  const 选 = await 选的原因("recycle", 原因);
  if (!选.ok) return 选;
  if (企业版() && !选.值 && (await 可选项("recycle")).length) return { ok: false, error: 要选退回原因提示 };
  const reason = 选.值 ? `${回收原因前缀}${选.值}` : "手动";
  // 负责人要清空，也算一次换负责人：先钉住老签约「签约那一刻是谁的」（事务外，同领取）
  if (企业版()) await 钉住老签约();
  const 公海项目 = 企业版()
    ? await 查完再写((tx) => 放进公海连项目(tx, 能放, me.id, reason))
    : (await prisma.customerPool.createMany({ data: 能放.map((c) => ({ customerId: c.id, userId: me.id, reason })) }), []);
  忘掉企业版范围(); // 原负责人回避名单变了，这一下就要看不到（范围缓存 10 秒）
  // 进公海关掉的挂靠申请：事务提交了再通知申请人（P-挂靠-01 / 02）
  if (企业版()) await 进公海挂靠通知(能放.map((c) => c.id));
  await 记退回(能放.map((c) => c.id), 1);
  // P-公海-03：别人放的，告诉原负责人一声（自己放自己的不发）
  await 客户放回公海通知(me, 能放, 选.值, 公海项目);
  await recordAudit({
    user: me, action: "pool", entity: "Customer", entityId: 能放.length === 1 ? 能放[0].id : null,
    summary: `把 ${能放.length} 名${b.customer}放进公海`,
    detail: { ids: 能放.map((c) => c.id), ...(选.值 ? { 原因: 选.值 } : {}) },
  });
  刷新(ids);
  return {
    ok: true, updated: 能放.length, unchanged: 已在.length, 没权限,
    ...(有订单.size ? { 有订单: 有订单.size, 订单项目 } : {}), ...(交接中.size ? { 交接中: 交接中.size } : {}), ...(同事在推.size ? { 同事在推: 同事在推.size, 同事项目 } : {}),
    ...(号码错.size ? { 联系方式不全: 号码错.size } : {}),
    ...(公海项目.length ? { 公海项目 } : {}),
  };
}

/**
 * 企业版放进公海（P-公海-06）：客户进客户公海，客户负责人自己负责、还没结束的线索 / 商机项目一起进线索公海（pool-link.ts 客户名下在推项目进公海），
 * 客户负责人清空、原负责人记历史（M-公海-03），返回这些项目 id（撤销用）。同事的、订单阶段的上面已经整位拦掉；退回次数客户这边 +1（记退回），项目不再另加
 */
async function 放进公海连项目(tx: Prisma.TransactionClient, 们: { id: string; salesOwnerId: string }[], 操作人: string, reason: string): Promise<string[]> {
  return 看全部(async () => {
    await tx.customerPool.createMany({ data: 们.map((c) => ({ customerId: c.id, userId: 操作人, reason })) });
    // 先项目后清负责人：项目那边靠客户原来的负责人认「他自己负责的」
    const 项目 = await 客户名下在推项目进公海(tx, 们, 操作人, reason === "手动" ? null : reason, new Date());
    await 客户进公海清负责人(tx, 们, 操作人);
    return 项目;
  });
}

/**
 * 撤销放进公海时把跟着进项目公海的项目还给原负责人（P-公海-06）：只认最近一条是我在撤销时限内放的 pool-release、项目还在公海里的；
 * 关掉的待办重新打开给他，进公海时清掉的组员按快照还回去（X-72），那行 pool-release 删掉——只是撤回，不算放回过一次
 */
async function 撤回连带项目(tx: Prisma.TransactionClient, 客户们: string[], 项目们: unknown[], 操作人: string): Promise<void> {
  const ids = 项目们.filter((x): x is string => typeof x === "string");
  if (!ids.length || !客户们.length) return;
  await 看全部(async () => {
    const 们 = await tx.project.findMany({ where: { id: { in: ids }, customerId: { in: 客户们 }, pooledAt: { not: null } }, select: { id: true, customerId: true, name: true, pooledAt: true } });
    for (const p of 们) {
      const 痕 = await tx.projectNodeLog.findFirst({ where: { projectId: p.id }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { id: true, kind: true, userId: true, fromOwnerId: true, at: true } });
      if (!痕 || 痕.kind !== "pool-release" || 痕.userId !== 操作人 || !痕.fromOwnerId) continue;
      if (痕.at.getTime() < Date.now() - 撤销时限毫秒) continue;
      await 换负责人待办(tx, p, null, 痕.fromOwnerId, true);
      await tx.project.update({ where: { id: p.id }, data: { ...还负责人(痕.fromOwnerId), pooledAt: null } });
      await 还原清掉的组员(tx, p.id, 痕.at, 痕.fromOwnerId);
      await tx.projectNodeLog.delete({ where: { id: 痕.id } });
    }
  });
}

/**
 * 领取：从公海里拿出来，负责人换成我，原负责人在他身上没做完的活跟着过来（和批量分配同一条规矩）。
 * 只领还在公海里的。**在事务里逐位删公海那一行、删到了才算我领到**：两个人同时点，后到的那位删到 0 行，
 * 这一位算「已被领走」——原来查和删分在事务两边，两边都报「已领取」，负责人归后到的、活却被先到的带走了（复查）。
 * 领的时间记进 CustomerClaim：自动掉公海从它算起，领走当天没跟进，第二天不会又被扫回去。
 * 带待办（企业版 C-06，公海页页头的勾，没传按默认勾）：跟着带过来的公海项目，进公海时关掉的那批待办重新打开给我
 */
export async function 领取(ids: string[], 带待办?: boolean): Promise<公海结果> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  // 管理员只读（11-02）：公海看得到、领不走。下面的事务包着 看全部，team-scope 拦不到
  if (企业版() && 只读角色(me, await 权限组织())) return { ok: false, error: 只读角色话 };
  // 没设业务角色的不能领（11-03 用户定）：权限只认业务角色，账号 ADMIN / MANAGER 不算。别人分给他（分配公海）不走这里
  if (企业版() && 没设业务角色(await 权限组织(), me.id)) return { ok: false, error: 没业务角色不能领话 };
  // 角色不领公海的（市管、渠运、项目组员、只看某人的，V3.5.1）
  if (企业版() && !能领公海(me, await 权限组织())) return { ok: false, error: 不能领公海话 };
  // 正在移交 / 交接中的不能领（X-38 → P-转-05）：自动回收可能把等确认的客户放进公海，领走了接手人确认时就落空
  const 移交中 = await 移交中不能领(ids, "领");
  if (移交中) return { ok: false, error: 移交中 };
  // 企业版「非原负责人均可领取」（pool-rules.ts，10-26 定稿）：不让原负责人自己领回。
  // 负责人还是他的 = 部署前进公海的老数据（存量脚本没跑到的空档也挡住），新进的认下面 公海客户原负责人是
  const 不能领 = 拦原负责人()
    ? new Set((await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: me.id, pool: { isNot: null } }, select: { id: true } }))).map((c) => c.id))
    : new Set<string>();
  // M-公海-03 起进公海负责人清空：最近一次进公海时的负责人是我的，也领不回（只认最近一次，曾经负责过、后来转走的不拦）
  if (拦原负责人()) {
    const 我放的 = await 看全部(() => 公海客户原负责人是(prisma, [me.id], ids));
    for (const id of 我放的.keys()) 不能领.add(id);
  }
  // 客户挂在「没人负责」占位账号下（导入的原系统公海、离职转公海）：客户上看不出原负责人，
  // 按名下公海项目的历史负责人认，是我放回的就领不回（11-03 完成度 B4-3；领客户会把这些项目一起带走）
  if (拦原负责人()) {
    const 占位的 = (await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids }, pool: { isNot: null }, salesOwner: { email: 无负责人占位邮箱 } }, select: { id: true } }))).map((c) => c.id);
    if (占位的.length) {
      const 公海项目们 = await 看全部(() => prisma.project.findMany({ where: { customerId: { in: 占位的 }, pooledAt: { not: null } }, select: { id: true, customerId: true } }));
      const 原 = await 历史负责人们(prisma, 公海项目们.map((p) => p.id));
      for (const p of 公海项目们) if (原.get(p.id) === me.id) 不能领.add(p.customerId);
    }
  }
  // 企业版：标了无效的不能领（统一公海 P7），和原负责人领不回一样算「没权限」那几位
  const 无效 = await 无效的(ids);
  const 原负责人的 = 不能领.size;
  for (const id of 无效) 不能领.add(id);
  if (不能领.size && 不能领.size === new Set(ids).size) return { ok: false, error: 原负责人的 ? 原负责人不能领回提示 : 无效不能领提示 };
  const 超 = await 带走公海项目超上限([...new Set(ids)].filter((x) => !不能领.has(x)), me.id);
  if (超) return { ok: false, error: 超 };
  // 换负责人之前先把老签约「签约那一刻是谁的」钉住（排查 X1，和批量分配一样）
  await 钉住老签约();
  const 领到: { id: string; 值: string }[] = [];
  for (const id of [...new Set(ids)].filter((x) => !不能领.has(x))) {
    /*
      看全部（团队版业务员，lib/team-scope.ts）：业务员能领，是因为这位在公海里；删掉公海那一行之后、负责人改成我之前，
      他在业务员眼里「不见了」——限定着读会读不到、返回 null，公海那一行却已经删了：客户出了公海、没归任何领的人（2026-10-04 五人实测）。
      能不能领只看「删到了公海那一行」，事务里不用再限定
    */
    /*
      团队范围同步（2026-10-14）：先改负责人、最后删公海那一行。同步日志按这个顺序推，
      哪怕被切进前后两次推送（或连的是还没修的旧服务端，逐包按前一包落下后的状态核）也都过得去：
      改负责人那一刻还在公海（人人可写），删公海那一刻已经归我。反过来先删公海，客户在服务端眼里就成了原负责人的私客、
      这台再改负责人被拒——各台负责人对不上（五台实测）。能不能领仍只看「删到了公海那一行」：删到 0 行就整个回滚。
    */
    const 原 = await 看全部(() => prisma.$transaction(async (tx) => {
      if (!(await tx.customerPool.findUnique({ where: { customerId: id }, select: { customerId: true } }))) return null;
      const c = await tx.customer.findUnique({ where: { id }, select: { salesOwnerId: true, poolInvalidAt: true } });
      // 客户没了：抛出去整个回滚
      if (!c) throw new Error("客户不在了");
      // 查完到这一刻之间被标了无效（企业版统一公海）：不领
      if (企业版() && c.poolInvalidAt) throw new Error("已标无效");
      if (c.salesOwnerId !== me.id) await tx.customer.update({ where: { id }, data: { salesOwnerId: me.id } });
      await tx.customerClaim.upsert({ where: { customerId: id }, update: { userId: me.id, at: new Date() }, create: { customerId: id, userId: me.id } });
      const 删 = await tx.customerPool.deleteMany({ where: { customerId: id } });
      if (!删.count) throw new Error("已被领走");
      return c.salesOwnerId;
    })).catch((e) => {
      if (e instanceof Error && (e.message === "客户不在了" || e.message === "已被领走" || e.message === "已标无效")) return null;
      throw e;
    });
    if (原 !== null) 领到.push({ id, 值: 原 });
  }
  if (!领到.length) return { ok: true, updated: 0, unchanged: ids.length - 不能领.size, 没权限: 不能领.size };
  const { 数: 带走, 记下: 带过来 } = await 带走并记下(领到.map((x) => ({ customerId: x.id, 旧: x.值 })), me.id, me.id, "claim");
  // 企业版：名下放在项目公海里的项目一起归我（领客户即领项目，pool-link.ts）
  const 公海项目 = await 领客户带走公海项目(领到.map((x) => x.id), me.id, me.id, 带待办勾(带待办));
  if (公海项目.length) 带走.项目 = (带走.项目 ?? 0) + 公海项目.length;
  await recordAudit({
    user: me, action: "claim", entity: "Customer", entityId: 领到.length === 1 ? 领到[0].id : null,
    summary: `从公海领取 ${领到.length} 名${b.customer}`,
    detail: { ids: 领到.map((x) => x.id), 原负责人: 领到.map((x) => ({ id: x.id, salesOwnerId: x.值 })) },
  });
  刷新(ids);
  return { ok: true, updated: 领到.length, unchanged: ids.length - 领到.length - 不能领.size, 没权限: 不能领.size, 带走, 原负责人: 领到, 带过来, 公海项目 };
}

/**
 * 企业版正在移交 / 交接中的客户（申请移交、交接要确认，X-38 → P-转-05）领不走、分不出去，整批拒：
 * 等接手人确认、拒收或发起人撤回之后再领。别人发起的也算（看全部）
 */
async function 移交中不能领(ids: string[], 动作: "领" | "分"): Promise<string | null> {
  if (!企业版() || !ids.length) return null;
  const 中 = await 看全部(() => 交接中的客户([...new Set(ids)]));
  if (!中.size) return null;
  const b = await getBusiness();
  return `${中.size} 名${b.customer}正在移交（等接手人确认），${动作 === "领" ? "不能领取" : "不能分配"}；等对方确认、拒收或撤回后再${动作 === "领" ? "领" : "分"}${中.size < new Set(ids).size ? "，整批已阻止" : ""}`;
}

/**
 * 领 / 分公海客户会把名下线索公海里的项目一起带走（pool-link 领客户带走公海项目）：一次进好几个，
 * 加上手上已有的超了持有上限就整批不领、不分，回一句说清谁、上限、现有几个（M-公海-18，11-09）。
 * 只数还在公海里的客户；规则在这里（事务外）读
 */
async function 带走公海项目超上限(ids: string[], 给: string): Promise<string | null> {
  if (!企业版() || !公海规则.领客户带走公海里的项目 || !ids.length) return null;
  const 在公海 = (await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids }, pool: { isNot: null } }, select: { id: true } }))).map((c) => c.id);
  const 进 = await 数进手的持有项目(在公海, 给, { 公海: true });
  return 进 ? 超上限n(prisma, await 生效组织规则(), 给, 进) : null;
}

/**
 * 老板把公海里的客户直接分给一位业务员（2026-10-20，客户需求：原来公海里的只能业务员自己领）。
 * 规矩和领取一模一样，只是「领的人」换成选中的那位：钉住老签约、原负责人没做完的活跟着过去、记领取时间（自动掉公海从它算起）、
 * 能撤销、记操作日志。同步顺序也照领取：先改负责人、最后删公海那一行（删到 0 行 = 已经被人领走，这一位跳过）。
 * 只给老板和业务主管（2026-10-20）；只分给在职成员。带待办同 领取（C-06）
 */
export async function 分配公海(ids: string[], userId: string, 带待办?: boolean): Promise<公海结果> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!能管公海(me, await 权限组织())) return { ok: false, error: `只有总管理和销售管理能把公海里的${b.customer}分给同事` };
  const 给 = await prisma.user.findFirst({ where: { id: String(userId ?? ""), active: true }, select: { id: true, name: true } });
  if (!给) return { ok: false, error: "这位同事不在了或已停用，换一位" };
  // 只分给能当负责人的；不是系统管理员只分给同业务线的（11-03 B2-7）
  const 不行 = await 公海分不给(me, 给.id);
  if (不行) return { ok: false, error: 不行 };
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  const 移交中 = await 移交中不能领(ids, "分");
  if (移交中) return { ok: false, error: 移交中 };
  // 企业版：标了无效的分不出去（统一公海 P7），算「没权限」那几位
  const 无效 = await 无效的(ids);
  if (无效.size && 无效.size === new Set(ids).size) return { ok: false, error: "标了无效的客户不能分配，要系统管理员先恢复" };
  const 超 = await 带走公海项目超上限([...new Set(ids)].filter((x) => !无效.has(x)), 给.id);
  if (超) return { ok: false, error: 超 };
  await 钉住老签约();
  const 分到: { id: string; 值: string }[] = [];
  for (const id of [...new Set(ids)].filter((x) => !无效.has(x))) {
    const 原 = await 看全部(() => prisma.$transaction(async (tx) => {
      if (!(await tx.customerPool.findUnique({ where: { customerId: id }, select: { customerId: true } }))) return null;
      const c = await tx.customer.findUnique({ where: { id }, select: { salesOwnerId: true, poolInvalidAt: true } });
      if (!c) throw new Error("客户不在了");
      if (企业版() && c.poolInvalidAt) throw new Error("已标无效");
      if (c.salesOwnerId !== 给.id) await tx.customer.update({ where: { id }, data: { salesOwnerId: 给.id } });
      await tx.customerClaim.upsert({ where: { customerId: id }, update: { userId: 给.id, at: new Date() }, create: { customerId: id, userId: 给.id } });
      const 删 = await tx.customerPool.deleteMany({ where: { customerId: id } });
      if (!删.count) throw new Error("已被领走");
      return c.salesOwnerId;
    })).catch((e) => {
      if (e instanceof Error && (e.message === "客户不在了" || e.message === "已被领走" || e.message === "已标无效")) return null;
      throw e;
    });
    if (原 !== null) 分到.push({ id, 值: 原 });
  }
  if (!分到.length) return { ok: true, updated: 0, unchanged: ids.length - 无效.size, 没权限: 无效.size };
  const { 数: 带走, 记下: 带过来 } = await 带走并记下(分到.map((x) => ({ customerId: x.id, 旧: x.值 })), 给.id, me.id, "pool-assign");
  const 公海项目 = await 领客户带走公海项目(分到.map((x) => x.id), 给.id, me.id, 带待办勾(带待办));
  if (公海项目.length) 带走.项目 = (带走.项目 ?? 0) + 公海项目.length;
  await recordAudit({
    user: me, action: "assign", entity: "Customer", entityId: 分到.length === 1 ? 分到[0].id : null,
    summary: `把公海里 ${分到.length} 名${b.customer}分给「${给.name}」`,
    detail: { ids: 分到.map((x) => x.id), 给: 给.id, 原负责人: 分到.map((x) => ({ id: x.id, salesOwnerId: x.值 })) },
  });
  刷新(ids);
  await 公海分配通知(me, 给.id, "客户", 分到.map((x) => x.id), 公海项目.length);
  return { ok: true, updated: 分到.length, unchanged: ids.length - 分到.length - 无效.size, 没权限: 无效.size, 带走, 原负责人: 分到, 带过来, 给谁: 给, 公海项目 };
}

/**
 * 撤销放进公海：把这几位从公海里拿回来。企业版负责人按那条 pool-release 还回去、那条删掉（P-撤销-01）；别的版本负责人本来就没动过。
 * 撤销领取：负责人还给原来的人、再放回公海；**只还领取时带过来的那几条活**（带过来），
 * 领取之前就归我的计划、待办、商机不动（复查：原来按「我名下没做完的」整个转回去，把我自己的也送走了）。
 * 只撤自己刚才那一下：只认「现在还归我、不在公海」的那几位；原负责人已经停用的不还（还给停用的人等于丢进黑洞），留在我这儿。
 * 无负责人占位账号也是停用的，但还给它就是回到没人负责的公海，不是黑洞，照撤（11-02，见 lib/pool.ts）。
 * 撤销分配（老板）：同撤销领取，「我」换成分到的那位（给谁）——只认现在还归他、不在公海的，他名下带过去的活还回去
 * 负责人真换过的还要对上换负责人记录（2026-10-28）：最近一条得是我把他从原负责人换到现在这位的。
 * 不然业务员把自己的客户当「刚领的」撤，原负责人随手填个同事，就绕过交接把客户塞到同事名下
 * 企业版被撤的那条换负责人记录删掉、不另记（P-撤销-01，操作日志 AuditLog 由界面按动作记）；进公海那条 pool-release 留着，它记着原负责人
 * 企业版跟着客户一起领 / 分过来的项目公海里的项目（公海项目）放回项目公海，认不认由 撤回项目公海 看留痕（10-30）
 */
export async function 撤销公海(动作: "放进" | "领取" | "分配", 原: { id: string; 值: string }[], 带过来?: 带走的, 给谁?: string, 公海项目?: string[]): Promise<公海结果> {
  const me = await requireUser();
  const ids = 原.map((x) => x.id);
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  if (动作 === "分配" && (!能管公海(me, await 权限组织()) || !给谁)) return { ok: false, error: "只有总管理和销售管理能撤销分配" };
  /** 这几位现在归谁：领取 = 我，分配 = 分到的那位 */
  const 现 = 动作 === "分配" ? 给谁! : me.id;
  if (动作 === "放进") {
    // 先认出真撤得动的那几位，退回计数只减它们（企业版统一公海）
    // 企业版：放进去超过撤销时限就撤不回（原负责人不能自己领回）
    const 时限内 = 企业版() ? { at: { gte: new Date(Date.now() - 撤销时限毫秒) } } : {};
    // 原负责人放进去之后自己看不到这位（回避，11-03），包 看全部 才撤得动；只认自己放进去的、时限内的，范围没放宽
    const 撤 = (await 看全部(() => prisma.customerPool.findMany({ where: { customerId: { in: ids }, userId: me.id, ...时限内 }, select: { customerId: true } }))).map((x) => x.customerId);
    // 企业版：负责人还回去（P-撤销-01）；跟着一起进线索公海的那几个项目同一个事务里还给原负责人（P-公海-06）
    if (企业版() && 撤.length) await 钉住老签约();
    const r = 企业版()
      ? await 查完再写((tx) => 看全部(async () => {
          const 删 = await tx.customerPool.deleteMany({ where: { customerId: { in: 撤 }, userId: me.id } });
          if (Array.isArray(公海项目) && 公海项目.length) await 撤回连带项目(tx, 撤, 公海项目, me.id);
          await 还原进公海前负责人(tx, 撤);
          return 删;
        }))
      : await 看全部(() => prisma.customerPool.deleteMany({ where: { customerId: { in: 撤 }, userId: me.id } }));
    if (r.count) {
      忘掉企业版范围();
      await 记退回(撤, -1);
      // 前面那条「放回了公海」已经发给原负责人了：告诉他客户回来了
      await 客户撤销放回通知(me, 撤);
      await recordAudit({
        user: me, action: "pool", entity: "Customer", entityId: 撤.length === 1 ? 撤[0] : null,
        summary: `撤销了刚才的放进公海：${r.count} 位客户回到原负责人名下`,
        detail: { ids: 撤 },
      });
    }
    刷新(ids);
    return { ok: true, updated: r.count, unchanged: ids.length - r.count, 没权限: 0 };
  }
  const 还归我 = await prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: 现, pool: null }, select: { id: true } });
  const 在职的 = new Set((await prisma.user.findMany({ where: { id: { in: 原.map((x) => x.值) }, OR: [{ active: true }, { email: 无负责人占位邮箱 }] }, select: { id: true } })).map((u) => u.id));
  const 换过 = 原.filter((x) => x.值 !== 现);
  const 我换的 = await 是我刚换的(换过.map((x) => ({ customerId: x.id, 原: x.值, 现 })), me.id);
  // 负责人没换过的（原负责人自己领回 / 分给原负责人）没有换负责人记录，认领取记录：时限内领给 现 的才撤。
  // 不认的话，主管填 给谁 = 负责人，就能把任意一位（看不到的、虚线只读的）客户塞进公海（2026-10-28 审查）
  const 没换过 = 原.filter((x) => x.值 === 现).map((x) => x.id);
  const 刚领的 = new Set(没换过.length
    ? (await 看全部(() => prisma.customerClaim.findMany({
        where: { customerId: { in: 没换过 }, userId: 现, at: { gte: new Date(Date.now() - 撤销时限毫秒) } },
        select: { customerId: true },
      }))).map((c) => c.customerId)
    : []);
  const 退 = 原.filter((x) => 还归我.some((c) => c.id === x.id) && 在职的.has(x.值) && (x.值 === 现 ? 刚领的.has(x.id) : 我换的.has(x.id)));
  await 钉住老签约();
  for (const x of 退) {
    await prisma.$transaction(async (tx) => {
      // 先放回公海、再把负责人还回去（团队范围同步：放回公海那一刻还归我，之后人人可写；反过来还完负责人我就写不了公海那一行）
      await tx.customerPool.create({ data: { customerId: x.id, userId: me.id, reason: "手动" } });
      // 历史负责人记在还负责人之前：业务员互看时，还完这位就是同事的客户，挂在下面新建会被挡
      if (企业版()) await 删被撤的换负责人记录(tx, x.id, x.值, 现);
      else await 记换负责人(tx, [{ customerId: x.id, from: 现, to: x.值 }], me.id, "undo");
      await tx.customer.update({ where: { id: x.id }, data: { salesOwnerId: x.值 } });
      await tx.customerClaim.deleteMany({ where: { customerId: x.id, userId: 现 } });
      // 领取 / 分配时带过来的活还回去：还挂在领到的人名下、还没做完的才还。
      // 还给谁：x.值 是占位账号时活本来挂在进公海前的负责人名下，按 pool-release 认；客户本身回占位账号
      if (带过来) {
        const 实际旧 = 企业版() ? await 公海前负责人(tx, x.id, x.值) : x.值;
        await tx.followPlan.updateMany({ where: { id: { in: 带过来.计划 }, customerId: x.id, ownerId: 现, done: false }, data: { ownerId: 实际旧 } });
        await tx.task.updateMany({ where: { id: { in: 带过来.待办 }, customerId: x.id, ownerId: 现, done: false }, data: { ownerId: 实际旧 } });
        await 转交商机(tx, { id: { in: 带过来.商机 }, customerId: x.id, ownerId: 现, status: "OPEN" }, 实际旧);
        await 还项目(tx, 带过来.项目, x.id, 现, 实际旧, me.id);
      }
      if (企业版() && Array.isArray(公海项目) && 公海项目.length) {
        // 包 看全部：客户刚放回公海，限定着查不到它下面的项目
        await 看全部(async () => {
          const 们 = await tx.project.findMany({ where: { id: { in: 公海项目.filter((p) => typeof p === "string") }, customerId: x.id }, select: { id: true } });
          for (const p of 们) await 撤回项目公海(tx, p.id, 现, me.id);
        });
      }
    });
  }
  if (退.length) {
    await recordAudit({
      user: me, action: 动作 === "分配" ? "assign" : "claim", entity: "Customer", entityId: 退.length === 1 ? 退[0].id : null,
      summary: `撤销了刚才的公海${动作 === "分配" ? "分配" : "领取"}：${退.length} 位客户放回公海`,
      detail: { ids: 退.map((x) => x.id), 原负责人: 退.map((x) => ({ id: x.id, salesOwnerId: x.值 })) },
    });
  }
  刷新(ids);
  return { ok: true, updated: 退.length, unchanged: ids.length - 退.length, 没权限: 0 };
}
