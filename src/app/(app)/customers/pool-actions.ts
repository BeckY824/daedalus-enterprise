"use server";

/**
 * 公海的动作（2026-10-03，0.46.15 第 6 块）：放进公海、领取、老板分配（2026-10-20）、撤销（每个动作的提示条上都有）。
 * 规矩在 lib/pool.ts、自动掉公海在 lib/pool-db.ts。
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { 公海分不给 } from "@/lib/owners";
import { 看全部, 虚线只读挡 } from "@/lib/team-scope";
import { 权限组织 } from "@/lib/enterprise/org";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 能管公海, 能放回客户公海, 只读角色, 只读话of, 没设业务角色, 没业务角色不能领话, 能领公海, 不能领公海话 } from "@/lib/enterprise/permissions";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { recordAudit } from "@/lib/audit";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 带走并记下在事务里, 还项目, 带走公海项目, type 带走的 } from "@/lib/carry-over-db";
import { 记换负责人, 是我刚换的, 撤销时限毫秒, 公海前负责人, 公海客户原负责人是, 删被撤的换负责人记录, 还原进公海前负责人 } from "@/lib/owner-log-db";
import type { 带走数 } from "@/lib/carry-over";
import { 拦原负责人, 原负责人不能领回提示, 公海规则 } from "@/lib/enterprise/pool-rules";
import { 客户名下在推项目进公海, 客户进公海清负责人 } from "@/lib/enterprise/pool-link";
import { 带待办勾, 跟着客户痕, 公海分配痕 } from "@/lib/project/carry-tasks";
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";
import { 企业版 } from "@/lib/enterprise/switch";
import { 进公海挂靠通知 } from "@/lib/enterprise/attach-approval";
import { 可选项, 选的原因, 分配方式叫法, 我能用的分配方式, 挡分配方式 } from "@/lib/enterprise/dict";
import { 回收原因前缀 } from "@/lib/project/timeout";
import { 要选退回原因提示 } from "@/lib/enterprise/unified-pool";
import { 公海分配通知, 客户放回公海通知, 客户撤销放回通知, 同事待分配随客户通知 } from "@/lib/enterprise/notice-sources";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 在事务里分公海项目们, type 分项目上下文, type 分项目们结果, type 整包撤销 } from "@/lib/enterprise/pool-assign-projects";
import { 能进公海的阶段, 持有上限起点, 整批核上限, 整批或不做, 领公海项目准备, 领取公海项目们, 在事务里领公海项目们, type 领项目上下文 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 公海按线拦 } from "@/lib/enterprise/pool-line-guard";
import { 历史负责人, 历史负责人们, 还原清掉的组员 } from "@/lib/project/pool-owner";
import { 换负责人待办 } from "@/lib/project/carry-tasks";
import { 查完再写 } from "@/lib/check-then-write";
import { 有同事在推的客户, 同事在推不能放公海话, 同事在推项目说法, 订单项目说法 } from "@/lib/enterprise/colleague-projects";
import { 交接中的客户 } from "@/lib/enterprise/handover-db";
import { 客户验证中不能放公海 } from "@/lib/project/lead-verify-guard";
import { Prisma } from "@/generated/prisma";
import { 客户退回前查联系方式, 退回号码种类表 } from "@/lib/enterprise/return-contact-check";
import { 还负责人 } from "@/lib/project/owner-write";
import { 要补潜客培育, 零项目客户补潜客培育, 撤回补的潜客培育 } from "@/lib/project/nurture";
import { 系统分配方式 } from "@/lib/project/proj-fields";
import { 写公海领取, 还公海领取前的客户分配, type 出公海原值 } from "@/lib/enterprise/customer-assign-way";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 全公司查号, 首条撞的 } from "@/lib/enterprise/contact-dedupe";
import { 认跟进方式 } from "@/lib/enterprise/dict";
import { 规整沟通 } from "@/lib/project/wizard";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 挑接手人, 挑的理由, 本月已分, 配额of, 满了 } from "@/lib/enterprise/lead-assign";
import { 本月分配行, 读挑人底子 } from "@/lib/enterprise/assign-eta";
import { 找待用补位, 用掉补位, 待用补位行 } from "@/lib/enterprise/invalid-makeup";
import { 分配通知 } from "@/lib/enterprise/notice-sources";
import { 存沟通后重算三态 } from "@/lib/enterprise/tri-state-db";
import { 进出公海重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 读客户状态, 项目的客户们, 原状态记到出公海痕, 存原状态, 读原状态, 写回出公海前状态, 写回进公海前状态 } from "@/lib/enterprise/cust-status-undo";
import {
  能查重领取, 不是市场成员查重领取话, 没撞上公海话, 查重领取作废, 查重领取换人, 公海客户的原负责人, 客户创建人, 要回避, 最近的公海项目, 最近的在推项目,
  查重领取候选们, 查重领取理由, 候选挑不到为什么, 挑不到话, 查重领取记沟通, 查重领取口径, 撞上的联系人, 查重领取建线索项目, 认对接人, 落对接人, 发起人领不回, type 认好的对接人, type 录的对接人,
} from "@/lib/enterprise/dedupe-claim";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import { 落到渠道, 新数据渠道不行 } from "@/lib/enterprise/channel-main";
import { 算市场建给销售, 市场分配进线索验证 } from "@/lib/enterprise/market-assign-node";
import type { 可选渠道 } from "@/components/ChannelPicker";

import { 客户显名, 客户引, 全称或显名, 显名列 } from "@/lib/enterprise/customer-title";
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
      /** 放进公海：名下有线索在验证中（等市场复核等）、没放的几位（企业版 X-77，审核 11-18） */
      验证中?: number;
      /** 领取时跟着过来的没做完的活 */
      带走?: 带走数;
      /** 领取前各归谁：撤销领取时还给他、放回公海 */
      原负责人?: 出公海原值[];
      /** 领取时带过来的是哪几条活：撤销只还这几条 */
      带过来?: 带走的;
      /** 老板分配：分给了谁（id、名字），撤销时按他认「还归他」 */
      给谁?: { id: string; name: string };
      /** 企业版：跟着客户一起领 / 分过来的项目公海里的项目，撤销时放回项目公海（交互规则 B，10-30）；
       *  放进公海时 = 跟着一起进项目公海的客户负责人自己的项目，撤销时还给他（P-公海-06，11-05） */
      公海项目?: string[];
      /** 领取时一起勾的项目行（领取 带 项目ids）：领到哪几个、没领到的各为什么；和客户同一个事务、同一次核持有上限 */
      项目?: { 领到: string[]; 没领到: { id: string; 原因: string }[]; 整包?: 整包撤销 };
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
 * 放进公海：能转让这位客户的才能放（permissions.ts 能放回客户公海，P-公海-02；别人的客户你放不进去——那等于替同事把人扔了）。可批量，
 * 放不了的那几位跳过并说一声。企业版负责人清空、原负责人记历史（M-公海-03，pool-link.ts 客户进公海清负责人）；
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
  const 这些 = await prisma.customer.findMany({ where: { id: { in: ids } }, select: { ...显名列, salesOwnerId: true, pool: { select: { customerId: true } } } });
  const 已在 = 这些.filter((c) => c.pool);
  const 组织 = await 权限组织();
  // P-公海-02：能放回 = 能转让（负责人本人、实线直属上级、条线总管理、系统管理员），逐位判；按钮同一处判（P-公海-05）
  const 有权限 = 这些.filter((c) => 能放回客户公海(me, { salesOwnerId: c.salesOwnerId, 在公海: !!c.pool }, 组织));
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
  // X-77「推进和放公海都拦」（审核 11-18 P0）：名下有线索在验证中的不能放，放了验证状态被清、市场复核这一步就没了
  const 验证中 = 企业版() && 有权限.length ? await 客户验证中不能放公海(prisma, 有权限.map((c) => c.id)) : new Map<string, string>();
  const 能放 = 有权限.filter((c) => !有订单.has(c.id) && !交接中.has(c.id) && !同事在推.has(c.id) && !号码错.has(c.id) && !验证中.has(c.id));
  // 同事的项目平时看不到，被拦时只说个数（P-看-12 例外、Even C4），按选的先后列
  const 被同事拦 = 有权限.filter((c) => 同事在推.has(c.id)).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  // 别的照放时提示条只说「N 位…没放」，那就带上客户名
  // 客户名称选填（11-19）：说法里叫显名（简称 → 全称 → 客户编号），不出「」
  const 同事项目 = 被同事拦.length ? await 同事在推项目说法(prisma, 被同事拦.map((c) => ({ ...c, name: 客户显名(c) })), 被同事拦.length > 1 || 能放.length > 0) : "";
  const 没权限 = 这些.length - 已在.length - 有权限.length;
  /** 报错里叫哪位（11-19 客户名称选填：没全称按简称 → 客户编号叫，不出「」） */
  const 叫 = (c: (typeof 有权限)[number] | undefined) => (c ? 客户显名(c) : "");
  if (!能放.length) {
    if (有订单.size) return { ok: false, error: 有订单不能放提示(b.customer, 订单项目) };
    if (验证中.size) {
      const [id, 话] = [...验证中][0];
      return { ok: false, error: 有权限.length > 1 ? 话.replace("这位客户", `「${叫(有权限.find((c) => c.id === id))}」`) : 话 };
    }
    if (交接中.size) return { ok: false, error: 交接中不能放提示(b.customer) };
    if (同事在推.size) return { ok: false, error: 同事在推不能放公海话(被同事拦.map((c) => 客户显名(c)), b.customer, 同事项目) };
    if (号码错.size) {
      const [id, 话] = [...号码错][0];
      const 名 = 有权限.length > 1 ? `「${叫(有权限.find((c) => c.id === id))}」` : "";
      return { ok: false, error: `${名}${话}` };
    }
    return 没权限 ? { ok: false, error: `只有负责人、直属上级或总管理能把${b.customer}放回公海` } : { ok: true, updated: 0, unchanged: 已在.length, 没权限: 0 };
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
    ...(验证中.size ? { 验证中: 验证中.size } : {}),
    ...(公海项目.length ? { 公海项目 } : {}),
  };
}

/**
 * 企业版放进公海（P-公海-06）：客户进客户公海，客户负责人自己负责、还没结束的线索 / 商机项目一起进线索公海（pool-link.ts 客户名下在推项目进公海），
 * 客户负责人清空、原负责人记历史（M-公海-03），返回这些项目 id（撤销用）。同事的、订单阶段的上面已经整位拦掉；退回次数客户这边 +1（记退回），项目不再另加
 */
async function 放进公海连项目(tx: Prisma.TransactionClient, 们: { id: string; salesOwnerId: string }[], 操作人: string, reason: string): Promise<string[]> {
  return 看全部(async () => {
    // 进公海前存的客户状态记在客户公海这一行（项目进了公海会重算它），撤销放进时从这里读、原样还回（cust-status-undo.ts）。
    // 公海那一行和每行 pool-release 同一个时刻：撤销时按它认「这一下跟着进公海的项目还回来没有」
    const 原 = await 读客户状态(tx, 们.map((c) => c.id));
    const 现在 = new Date();
    await tx.customerPool.createMany({ data: 们.map((c) => ({ customerId: c.id, userId: 操作人, reason, at: 现在, ...(原.has(c.id) ? { prevCustStatus: 存原状态(原.get(c.id)) } : {}) })) });
    // 先项目后清负责人：项目那边靠客户原来的负责人认「他自己负责的」
    const 项目 = await 客户名下在推项目进公海(tx, 们, 操作人, reason === "手动" ? null : reason, 现在);
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
    const 还了 = new Set<string>();
    for (const p of 们) {
      const 痕 = await tx.projectNodeLog.findFirst({ where: { projectId: p.id }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { id: true, kind: true, userId: true, fromOwnerId: true, at: true } });
      if (!痕 || 痕.kind !== "pool-release" || 痕.userId !== 操作人 || !痕.fromOwnerId) continue;
      if (痕.at.getTime() < Date.now() - 撤销时限毫秒) continue;
      await 换负责人待办(tx, p, null, 痕.fromOwnerId, true);
      await tx.project.update({ where: { id: p.id }, data: { ...还负责人(痕.fromOwnerId), pooledAt: null } });
      await 还原清掉的组员(tx, p.id, 痕.at, 痕.fromOwnerId);
      await tx.projectNodeLog.delete({ where: { id: 痕.id } });
      还了.add(p.customerId);
    }
    // 还给原负责人 = 出了公海又在推：客户状态重算（cust-status-auto-db.ts 进出公海重算）
    await 进出公海重算(tx, 还了);
  });
}

/**
 * 领取：从公海里拿出来，负责人换成我，原负责人在他身上没做完的活跟着过来（和批量分配同一条规矩）。
 * 只领还在公海里的。**在事务里逐位删公海那一行、删到了才算我领到**：两个人同时点，后到的那位删到 0 行，
 * 这一位算「已被领走」——原来查和删分在事务两边，两边都报「已领取」，负责人归后到的、活却被先到的带走了（复查）。
 * 领的时间记进 CustomerClaim：自动掉公海从它算起，领走当天没跟进，第二天不会又被扫回去。
 * 带待办（企业版 C-06，公海页页头的勾，没传按默认勾）：跟着带过来的公海项目，进公海时关掉的那批待办重新打开给我
 */
export async function 领取(ids: string[], 带待办?: boolean, 项目ids: string[] = []): Promise<公海结果> {
  const me = await requireUser();
  const b = await getBusiness();
  const 项目们 = Array.isArray(项目ids) ? [...new Set(项目ids.filter((x): x is string => typeof x === "string" && !!x))] : [];
  // 只勾了项目行：同 领取公海项目们（一个事务、整批核持有上限）
  if (!ids.length && 项目们.length) {
    const r = await 领取公海项目们(me, 项目们, 带待办勾(带待办));
    if (!r.ok) return r;
    await 记项目领取(me, r.领到);
    return { ok: true, updated: 0, unchanged: 0, 没权限: 0, 项目: { 领到: r.领到, 没领到: r.没领到 } };
  }
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  // 管理员只读（11-02）：公海看得到、领不走。下面的事务包着 看全部，team-scope 拦不到
  if (企业版() && 只读角色(me, await 权限组织())) return { ok: false, error: 只读话of(me, await 权限组织()) };
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
  // 一起勾的项目行：事务外先备好（进门、钉老签约）；进不了门的整批项目各记一句，客户照领
  const 项目备 = 项目们.length ? await 领公海项目准备(me, 项目们, 带待办勾(带待办)) : null;
  // 换负责人之前先把老签约「签约那一刻是谁的」钉住（排查 X1，和批量分配一样）
  await 钉住老签约();
  const r = await 公海客户出手([...new Set(ids)].filter((x) => !不能领.has(x)), me.id, me.id, "claim", 带待办勾(带待办),
    项目备?.ok ? { me, 上下文: 项目备.上下文, ids: 项目们 } : undefined, undefined, 要补潜客培育(企业版(), b.projectMode));
  if (!r.ok) return { ok: false, error: r.超 };
  const { 到: 领到, 数: 带走, 记下: 带过来, 公海项目, 项目结果 } = r.值;
  const 项目 = 项目们.length
    ? 项目备?.ok ? { 领到: 项目结果?.领到 ?? [], 没领到: 项目结果?.没领到 ?? [] } : { 领到: [], 没领到: 项目们.map((id) => ({ id, 原因: (项目备 as { error: string }).error })) }
    : undefined;
  if (项目结果?.同事待分配.length) await 同事待分配随客户通知(me.id, me.id, 项目结果.同事待分配);
  await 记项目领取(me, 项目结果?.领到 ?? []);
  if (!领到.length) {
    if (项目?.领到.length) 刷新(ids);
    return { ok: true, updated: 0, unchanged: ids.length - 不能领.size, 没权限: 不能领.size, ...(项目 ? { 项目 } : {}) };
  }
  if (公海项目.length) 带走.项目 = (带走.项目 ?? 0) + 公海项目.length;
  await recordAudit({
    user: me, action: "claim", entity: "Customer", entityId: 领到.length === 1 ? 领到[0].id : null,
    summary: `从公海领取 ${领到.length} 名${b.customer}`,
    detail: { ids: 领到.map((x) => x.id), 原负责人: 领到.map((x) => ({ id: x.id, salesOwnerId: x.值 })) },
  });
  刷新(ids);
  return { ok: true, updated: 领到.length, unchanged: ids.length - 领到.length - 不能领.size, 没权限: 不能领.size, 带走, 原负责人: 领到, 带过来, 公海项目, ...(项目 ? { 项目 } : {}) };
}

/** 一起领到的项目行：操作日志一条、刷新项目页（单个领 领取项目 那边按个记，这里一批一条） */
async function 记项目领取(me: { id: string; name: string }, 领到: string[]): Promise<void> {
  if (!领到.length) return;
  const 名 = 领到.length === 1 ? (await prisma.project.findUnique({ where: { id: 领到[0] }, select: { name: true } }))?.name ?? "" : "";
  await recordAudit({
    user: me, action: "update", entity: "Project", entityId: 领到.length === 1 ? 领到[0] : null,
    summary: 领到.length === 1 ? `从线索公海领取项目「${名}」` : `从线索公海领取 ${领到.length} 个项目`, ...(领到.length > 1 ? { detail: { ids: 领到 } } : {}),
  });
  revalidatePath("/projects");
  revalidatePath("/pool");
  revalidatePath("/dashboard");
}

/**
 * 公海客户出手（领取、分配公海共用）：一个事务里逐位出公海归 给、名下的活带过来、名下线索公海里的项目一起归他，
 * 领取时一起勾的项目行也在这个事务里领（项目），分配时一起勾的项目行也在这个事务里分（分项目）。持有上限整批核（M-公海-18，11-10 用户定）：动手前记下名下原有几个，全部写完再数，
 * 超了就抛 整批超上限、整个事务回滚，一个都不出公海（回 ok: false + 那句话）；并发的两次后到的那次整批失败（事务一个接一个跑）。
 * 能不能领只看事务里「还在公海、客户还在、没标无效」：被人先领走的、刚标了无效的跳过，不算没领成的那批。
 * 团队范围同步的顺序照旧：每位先改负责人、最后删公海那一行。
 * 补培育（企业版项目模式，调用方事务外判好 要补潜客培育）：出了公海、名下一个项目都没有的（回收站里的也算有），同一个事务里补一个潜客培育项目
 * （M-公海-14：客户公海里能零项目，出来就得带 1 个），负责人 = 给、创建人 = 操作人；在核持有上限之前建，+1 一起算进上限（M-公海-18），
 * 超了整批不出公海、也不补。补的 id 记进 记下.培育，撤销时没动过的删掉
 */
async function 公海客户出手(
  ids: string[], 给: string, 操作人: string, kind: "claim" | "pool-assign", 带待办: boolean | undefined,
  项目?: { me: Parameters<typeof 在事务里领公海项目们>[1]; 上下文: 领项目上下文; ids: string[] },
  分项目?: { ids: string[]; 上下文: 分项目上下文 },
  补培育 = false,
  /**
   * 查重领取（F-016）用：补的潜客培育记哪种分配方式（不给按 kind 定）；然后 = 同一个事务里、核持有上限之前再做的那几样
   *（新建线索项目、记分配、写沟通），抛错整笔回滚、一个都不出公海；公海项目痕 = 带出线索公海的项目那行 pool-claim 的原因开头（不给：管理分出去的记 公海分配痕）
   */
  附?: { 补的方式?: string; 公海项目痕?: string; 然后?: (tx: Prisma.TransactionClient, 出: { 到: 出公海原值[]; 记下: 带走的; 公海项目: string[] }) => Promise<void> },
) {
  const 规则 = await 生效组织规则();
  return 整批或不做(() => 查完再写(async (tx) => {
    // 动手前记下这几位（客户行 + 项目行的客户）存的客户状态，事务末尾记到这一下的出公海留痕上，撤销时原样还回（cust-status-undo.ts）
    const 动手时 = new Date();
    const 原状态 = await 读客户状态(tx, [...ids, ...(await 项目的客户们(tx, [...(项目?.ids ?? []), ...(分项目?.ids ?? [])]))]);
    const 起 = await 持有上限起点(tx, 规则, 给);
    /*
      看全部（团队版业务员，lib/team-scope.ts）：业务员能领，是因为这位在公海里；删掉公海那一行之后、负责人改成我之前，
      他在业务员眼里「不见了」——限定着读会读不到。能不能领只看事务里还在公海，不用再限定
    */
    const 客户部分 = await 看全部(async () => {
      const 到: 出公海原值[] = [];
      for (const id of ids) {
        if (!(await tx.customerPool.findUnique({ where: { customerId: id }, select: { customerId: true } }))) continue;
        const c = await tx.customer.findUnique({ where: { id }, select: { salesOwnerId: true, poolInvalidAt: true } });
        // 客户没了、查完到这一刻之间被标了无效（企业版统一公海）：不领
        if (!c || (企业版() && c.poolInvalidAt)) continue;
        // 团队范围同步（2026-10-14）：先改负责人、最后删公海那一行
        if (c.salesOwnerId !== 给) await tx.customer.update({ where: { id }, data: { salesOwnerId: 给 } });
        // 客户状态原值不在这里记：事务末尾 原状态记到出公海痕 统一记（prevCustStatus 先清掉，免得留着上一次领取的）
        await tx.customerClaim.upsert({ where: { customerId: id }, update: { userId: 给, at: new Date(), prevCustStatus: null }, create: { customerId: id, userId: 给 } });
        await tx.customerPool.deleteMany({ where: { customerId: id } });
        // 出客户公海归 给：客户分配记「公海领取」（领取、分配公海都是，customer-assign-way.ts）；盖掉的原值带回去，撤销按它还
        const 分 = await 写公海领取(tx, id);
        到.push({ id, 值: c.salesOwnerId, ...(分 ? { 分: 分.原 } : {}) });
      }
      const { 数, 记下 } = await 带走并记下在事务里(tx, 到.map((x) => ({ customerId: x.id, 旧: x.值 })), 给, 操作人, kind);
      // 企业版：名下放在项目公海里的项目一起归他（领客户即领项目，pool-link.ts）
      const 公海项目 = 企业版() && 公海规则.领客户带走公海里的项目 && 到.length ? await 带走公海项目(tx, 到.map((x) => x.id), 给, 操作人, 带待办, 附?.公海项目痕 ?? (kind === "pool-assign" && 操作人 !== 给 ? 公海分配痕 : null)) : [];
      return { 到, 数, 记下, 公海项目 };
    });
    const 项目结果 = 项目?.ids.length ? await 在事务里领公海项目们(tx, 项目.me, 项目.ids, 项目.上下文) : null;
    // 分配时一起勾的项目行（总管理公海页客户行 + 项目行一起分，11-11）：同一个事务里分，和客户合起来核
    const 分项目结果 = 分项目?.ids.length ? await 看全部(() => 在事务里分公海项目们(tx, 操作人, 给, 分项目.ids, 分项目.上下文)) : null;
    // 零项目客户出公海补潜客培育（M-公海-14）：放在核上限前面，补的这个也算进持有数。
    // 名下只有已结束的历史分析回填项目的也补（11-18「领走补一个能推进的项目」，nurture.ts 算有项目）：那几个已随客户带出公海（带走公海项目）
    if (补培育 && 客户部分.到.length) {
      // 补的项目分配方式：领取记「公海捞取」，分配公海记「指定分配」（11-18 复盘第 5 类：原来不写）
      const 补了 = await 零项目客户补潜客培育(tx, 客户部分.到.map((x) => x.id), 操作人, 附?.补的方式 ?? (kind === "claim" ? 系统分配方式.公海捞取 : 系统分配方式.指定分配));
      if (补了.size) 客户部分.记下.培育 = [...补了.values()];
    }
    // 查重领取的那几样（新建线索项目、记分配、写沟通）放在核上限前面：新建的那条也算进接手人的持有数（同补培育）
    if (附?.然后) await 看全部(() => 附.然后!(tx, 客户部分));
    // 出了公海的客户：带出线索公海的项目又在推、补了潜客培育、查重领取新建了线索，客户状态都按项目重算（B37「随领取和项目变动自然落库」，
    // cust-status-auto-db.ts 进出公海重算；带走公海项目 里已算过的再算一遍，没变的不写）
    await 进出公海重算(tx, 客户部分.到.map((x) => x.id));
    // 在里面领 / 分项目行的帮手也记过一遍（读的是客户这一半动过以后的值），这里最后记、以动手前的为准
    await 原状态记到出公海痕(tx, 原状态, 动手时);
    await 整批核上限(tx, 起, kind === "claim" ? "领" : "接");
    return { ...客户部分, 项目结果, 分项目结果 };
  }));
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
 * 老板把公海里的客户直接分给一位业务员（2026-10-20，客户需求：原来公海里的只能业务员自己领）。
 * 规矩和领取一模一样，只是「领的人」换成选中的那位：钉住老签约、原负责人没做完的活跟着过去、记领取时间（自动掉公海从它算起）、
 * 能撤销、记操作日志。同步顺序也照领取：先改负责人、最后删公海那一行（删到 0 行 = 已经被人领走，这一位跳过）。
 * 只给老板和业务主管（2026-10-20）；只分给在职成员。带待办同 领取（C-06）。
 * 项目ids：公海页同时勾了的项目行（11-11，M-公海-18）：和客户行同一个事务分（在事务里分公海项目们）、合起来核持有上限，
 * 超了客户、项目一个都不分；客户行整批被拦（移交中、全是无效）时项目行也不分。结果的 项目 = 分到 / 没分到（字段名同领取）、整包（撤销用）
 */
export async function 分配公海(ids: string[], userId: string, 带待办?: boolean, 项目ids: string[] = []): Promise<公海结果> {
  const me = await requireUser();
  const b = await getBusiness();
  const org = await 权限组织();
  if (!能管公海(me, org)) return { ok: false, error: `只有总管理和销售管理能把公海里的${b.customer}分给同事` };
  const 项目们 = Array.isArray(项目ids) ? [...new Set(项目ids.filter((x): x is string => typeof x === "string" && !!x))].slice(0, 500) : [];
  // 项目行只在企业版项目模式的统一公海里有（同 分配公海项目）
  if (项目们.length && !(企业版() && b.projectMode === true)) return { ok: false, error: "统一公海只在企业版项目模式里有" };
  const 给 = await prisma.user.findFirst({ where: { id: String(userId ?? ""), active: true }, select: { id: true, name: true } });
  if (!给) return { ok: false, error: "这位同事不在了或已停用，换一位" };
  // 只分给能当负责人的，不限业务线（P-转-08）；操作人只能动本线的另在下面拦（P-公海-07）
  const 不行 = await 公海分不给(me, 给.id);
  if (不行) return { ok: false, error: 不行 };
  if (!ids.length && !项目们.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  // 销管、条线总管理只能分本业务线的（P-公海-07）：混了别线的整批不分
  const 别线 = await 公海按线拦(prisma, me, org, { 客户: ids, 项目: 项目们 }, "分配");
  if (别线) return { ok: false, error: 别线 };
  const 移交中 = await 移交中不能领(ids, "分");
  if (移交中) return { ok: false, error: 移交中 };
  // 企业版：标了无效的分不出去（统一公海 P7），算「没权限」那几位
  const 无效 = await 无效的(ids);
  if (无效.size && 无效.size === new Set(ids).size) return { ok: false, error: "标了无效的客户不能分配，要系统管理员先恢复" };
  await 钉住老签约();
  // 一起勾的项目行：分配方式叫法事务外读（事务里读设置会等到超时）
  const 分项目 = 项目们.length ? { ids: 项目们, 上下文: { org, way: 企业版() ? await 分配方式叫法(0) : "", 带: 带待办勾(带待办) } } : undefined;
  // 一个事务分完、整批核持有上限（M-公海-18，11-10）：超了一个都不分；一起勾的项目行同一个事务、合起来核（11-11）
  const r = await 公海客户出手([...new Set(ids)].filter((x) => !无效.has(x)), 给.id, me.id, "pool-assign", 带待办勾(带待办), undefined, 分项目, 要补潜客培育(企业版(), b.projectMode));
  if (!r.ok) return { ok: false, error: r.超 };
  const { 到: 分到, 数: 带走, 记下: 带过来, 公海项目, 分项目结果 } = r.值;
  const 项目 = 分项目结果 ? { 领到: 分项目结果.分到, 没领到: 分项目结果.没分到, ...(分项目结果.整包.原.length ? { 整包: 分项目结果.整包 } : {}) } : undefined;
  await 记项目分配(me, 给, 分项目结果);
  if (!分到.length) {
    if (项目?.领到.length) 刷新(ids);
    return { ok: true, updated: 0, unchanged: ids.length - 无效.size, 没权限: 无效.size, ...(项目 ? { 项目, 给谁: 给 } : {}) };
  }
  if (公海项目.length) 带走.项目 = (带走.项目 ?? 0) + 公海项目.length;
  await recordAudit({
    user: me, action: "assign", entity: "Customer", entityId: 分到.length === 1 ? 分到[0].id : null,
    summary: `把公海里 ${分到.length} 名${b.customer}分给「${给.name}」`,
    detail: { ids: 分到.map((x) => x.id), 给: 给.id, 原负责人: 分到.map((x) => ({ id: x.id, salesOwnerId: x.值 })) },
  });
  刷新(ids);
  await 公海分配通知(me, 给.id, "客户", 分到.map((x) => x.id), 公海项目.length);
  return { ok: true, updated: 分到.length, unchanged: ids.length - 分到.length - 无效.size, 没权限: 无效.size, 带走, 原负责人: 分到, 带过来, 给谁: 给, 公海项目, ...(项目 ? { 项目 } : {}) };
}

/** 一起分出去的项目行：事务提交了才记操作日志、发分配通知、告诉随客户换了负责人的同事（同 分配公海项目） */
async function 记项目分配(me: Awaited<ReturnType<typeof requireUser>>, 给: { id: string; name: string }, 结果: 分项目们结果 | null | undefined): Promise<void> {
  if (!结果?.分到.length) return;
  const { 分到, 跟来, 连客户, 随客户 } = 结果;
  await recordAudit({
    user: me, action: "pool-assign", entity: "Project", entityId: 分到.length === 1 ? 分到[0] : null,
    summary: `把线索公海里 ${分到.length} 个项目分给 ${给.name}`,
    detail: { ids: 分到, 给: 给.id },
  });
  revalidatePath("/projects");
  await 公海分配通知(me, 给.id, "项目", 分到, 跟来, 连客户);
  if (随客户.length) await 同事待分配随客户通知(me.id, 给.id, 随客户);
}


/** 撤销时负责人已经不是领到 / 分到的那位了（事务里抛、整笔回滚，也是回给人看的话的前半句） */
const 负责人被改过 = "负责人刚被别人改过，这次没有撤销";
/** 撤销时出公海补的潜客培育项目已经动过了（记了沟通、换了节点、编辑过……）：这一位不撤，整笔回滚（P-撤销-01，nurture.ts 潜客培育动没动） */
const 培育项目动过 = "刚补的潜客培育项目已经有人动过（记了沟通、换了节点或编辑过），这次没有撤销";

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
 * 出公海时给零项目客户补的潜客培育项目（带过来.培育，M-公海-14）：没动过的整条删掉，客户按原样回到零项目；动过的这一位不撤（不然客户回了公海、
 * 名下挂着同事在推的项目，M-公海-02 例外二）
 */
export async function 撤销公海(动作: "放进" | "领取" | "分配", 原: 出公海原值[], 带过来?: 带走的, 给谁?: string, 公海项目?: string[]): Promise<公海结果> {
  const me = await requireUser();
  const ids = 原.map((x) => x.id);
  if (!ids.length) return { ok: true, updated: 0, unchanged: 0, 没权限: 0 };
  if (动作 === "分配") {
    const org = await 权限组织();
    if (!能管公海(me, org) || !给谁) return { ok: false, error: "只有总管理和销售管理能撤销分配" };
    // 销管、条线总管理只能撤本业务线的（P-公海-07）
    const 别线 = await 公海按线拦(prisma, me, org, { 客户: ids, 项目: Array.isArray(公海项目) ? 公海项目.filter((x): x is string => typeof x === "string") : [] }, "撤销分配");
    if (别线) return { ok: false, error: 别线 };
  }
  /** 这几位现在归谁：领取 = 我，分配 = 分到的那位 */
  const 现 = 动作 === "分配" ? 给谁! : me.id;
  if (动作 === "放进") {
    // 先认出真撤得动的那几位，退回计数只减它们（企业版统一公海）
    // 企业版：放进去超过撤销时限就撤不回（原负责人不能自己领回）
    const 时限内 = 企业版() ? { at: { gte: new Date(Date.now() - 撤销时限毫秒) } } : {};
    // 原负责人放进去之后自己看不到这位（回避，11-03），包 看全部 才撤得动；只认自己放进去的、时限内的，范围没放宽
    const 找 = (db: Pick<Prisma.TransactionClient, "customerPool">) =>
      db.customerPool.findMany({ where: { customerId: { in: ids }, userId: me.id, ...时限内 }, select: { customerId: true, at: true, prevCustStatus: true } });
    let 撤: string[];
    let r: { count: number };
    if (企业版()) {
      // 企业版：负责人还回去（P-撤销-01）；跟着一起进线索公海的那几个项目同一个事务里还给原负责人（P-公海-06）
      if ((await 看全部(() => 找(prisma))).length) await 钉住老签约();
      // 哪几位真撤回了在事务里认（复审 11-25）：事务外认完到这里之间被人领走的不算，也不给它写回客户状态
      ({ 撤, r } = await 查完再写((tx) => 看全部(async () => {
        const 行 = await 找(tx);
        const 这几位 = 行.map((x) => x.customerId);
        if (!这几位.length) return { 撤: [] as string[], r: { count: 0 } };
        const 删 = await tx.customerPool.deleteMany({ where: { customerId: { in: 这几位 }, userId: me.id } });
        if (Array.isArray(公海项目) && 公海项目.length) await 撤回连带项目(tx, 这几位, 公海项目, me.id);
        await 还原进公海前负责人(tx, 这几位);
        // 客户状态还回进公海前存的值（记在客户公海那一行，cust-status-undo.ts；撤回连带项目 里重算过，要放在它后面）。
        // 没记的（别的入池、老行）、跟着进公海的项目没还全的，照旧用上面的重算
        for (const x of 行) await 写回进公海前状态(tx, x.customerId, 读原状态(x.prevCustStatus), x.at, me.id);
        return { 撤: 这几位, r: 删 };
      })));
    } else {
      撤 = (await 看全部(() => 找(prisma))).map((x) => x.customerId);
      r = await 看全部(() => prisma.customerPool.deleteMany({ where: { customerId: { in: 撤 }, userId: me.id } }));
    }
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
  /*
    上面认「还归我」和下面写之间有缝（代码体检 C1，仿 X-81）：这时主管把这位转给了别人，原来照样放回公海、负责人改回旧值，
    盖掉刚做的转让。事务里按「负责人还是 现」条件写，改到 0 行整笔回滚（公海那一行、删掉的换负责人记录都不留），这一位不算撤成
  */
  const 撤成: typeof 退 = [];
  let 培育拦 = 0;
  for (const x of 退) {
    const 成 = await prisma.$transaction(async (tx) => {
      // 先放回公海、再把负责人还回去（团队范围同步：放回公海那一刻还归我，之后人人可写；反过来还完负责人我就写不了公海那一行）
      await tx.customerPool.create({ data: { customerId: x.id, userId: me.id, reason: "手动" } });
      // 历史负责人记在还负责人之前：业务员互看时，还完这位就是同事的客户，挂在下面新建会被挡
      if (企业版()) await 删被撤的换负责人记录(tx, x.id, x.值, 现, me.id);
      else await 记换负责人(tx, [{ customerId: x.id, from: 现, to: x.值 }], me.id, "undo");
      const 还 = await tx.customer.updateMany({ where: { id: x.id, salesOwnerId: 现 }, data: { salesOwnerId: x.值 } });
      if (!还.count) throw new Error(负责人被改过);
      // 出公海时盖成「公海领取」的客户分配还回原值（P-撤销-01）
      await 还公海领取前的客户分配(tx, x.id, x.分);
      // 出公海前存的客户状态记在领取这一行（cust-status-undo.ts），删之前读出来；不是 现 领的那一行不认
      const 领 = await tx.customerClaim.findUnique({ where: { customerId: x.id }, select: { userId: true, prevCustStatus: true, at: true } });
      const 原状态 = 领?.userId === 现 ? 读原状态(领.prevCustStatus) : undefined;
      await tx.customerClaim.deleteMany({ where: { customerId: x.id, userId: 现 } });
      // 领取 / 分配时带过来的活还回去：还挂在领到的人名下、还没做完的才还。
      // 还给谁：x.值 是占位账号时活本来挂在进公海前的负责人名下，按 pool-release 认；客户本身回占位账号
      if (带过来) {
        const 实际旧 = 企业版() ? await 公海前负责人(tx, x.id, x.值) : x.值;
        await tx.followPlan.updateMany({ where: { id: { in: 带过来.计划 }, customerId: x.id, ownerId: 现, done: false }, data: { ownerId: 实际旧 } });
        await tx.task.updateMany({ where: { id: { in: 带过来.待办 }, customerId: x.id, ownerId: 现, done: false }, data: { ownerId: 实际旧 } });
        await 还项目(tx, 带过来.项目, x.id, 现, 实际旧, me.id);
      }
      // 出公海时补的潜客培育项目：没动过的删掉；动过的整笔回滚，这一位不撤
      if (企业版() && Array.isArray(带过来?.培育) && 带过来.培育.length) {
        if (!(await 撤回补的潜客培育(tx, 带过来.培育, { customerId: x.id, 负责人: 现, 创建人: me.id }))) throw new Error(培育项目动过);
      }
      let 项目全回了 = true;
      if (企业版() && Array.isArray(公海项目) && 公海项目.length) {
        // 包 看全部：客户刚放回公海，限定着查不到它下面的项目
        await 看全部(async () => {
          const 们 = await tx.project.findMany({ where: { id: { in: 公海项目.filter((p) => typeof p === "string") }, customerId: x.id }, select: { id: true } });
          for (const p of 们) if (!(await 撤回项目公海(tx, p.id, 现, me.id))) 项目全回了 = false;
        });
      }
      // 客户状态（P-撤销-01 按原样回滚；撤回项目公海 里重算过，所以放在它后面）：这位这次带出来的项目全回了公海、领取行上记了原值，原样还回；
      // 撤了一半（有项目撤不成、前端少带了几个、同一位客户的项目行还没撤）、老领取行没记：带出来的项目回了公海、补的潜客培育删了，按剩下的重算
      // 领取那一刻之后建的项目（补的潜客培育前端没带回来、没删掉）还在，也算没撤完
      if (!(项目全回了 && (await 写回出公海前状态(tx, x.id, 原状态, 领?.at)))) await 进出公海重算(tx, [x.id]);
      return true;
    }).catch((e) => {
      if (e instanceof Error && e.message === 负责人被改过) return false;
      if (e instanceof Error && e.message === 培育项目动过) return (培育拦++, false);
      throw e;
    });
    if (成) 撤成.push(x);
  }
  if (撤成.length) {
    await recordAudit({
      user: me, action: 动作 === "分配" ? "assign" : "claim", entity: "Customer", entityId: 撤成.length === 1 ? 撤成[0].id : null,
      summary: `撤销了刚才的公海${动作 === "分配" ? "分配" : "领取"}：${撤成.length} 位客户放回公海`,
      detail: { ids: 撤成.map((x) => x.id), 原负责人: 撤成.map((x) => ({ id: x.id, salesOwnerId: x.值 })) },
    });
  }
  刷新(ids);
  // 一位都没撤成、全是刚被别人改走的：明说，别让界面报「已撤销」
  if (退.length && !撤成.length) return { ok: false, error: 培育拦 ? 培育项目动过 : `${负责人被改过}，刷新看看` };
  return { ok: true, updated: 撤成.length, unchanged: ids.length - 撤成.length, 没权限: 0 };
}

/** 查重领取那条沟通（同记沟通的必填：沟通方式 / 类型、内容、时间）；下一步是接手人的格，这里不收 */
export type 查重领取沟通 = { type: string; method?: string | null; initiator?: string | null; content: string; occurredAt: string };
/**
 * 新建线索项目那条路要的（查重领取口径.新建线索项目）：这次的渠道（必填，不默认带客户来源；新建线索那套主 / 子渠道，主渠道占位 id 也认）、
 * 这次的对接人（必填：选客户原有的联系人就挂他、不改他；选「新的人」填名字新建，见 dedupe-claim.ts 认对接人）
 */
export type 查重领取新项目 = { 渠道?: string | null; 对接人?: 录的对接人 | null };
export type 查重领取结果 =
  | { ok: true; 提示: string; 接手人: string; 项目: string; 为什么: string }
  | { ok: false; error: string };

/** 自动分配挑人的事务复核最多重挑几次（同 自动分给） */
const 查重领取最多重挑 = 5;

/** 查重领取框打开时取：用不用填渠道 / 对接人（看两条路的开关）、能选的渠道、这位客户的联系人、默认对接人。服务端照样重查号码，没撞上公海 = error */
export type 查重领取框 =
  | { ok: true; 新建线索项目: boolean; 客户名: string; 渠道们: 可选渠道[]; 联系人们: 框里的联系人[]; 默认对接人: string | null }
  | { ok: false; error: string };

export type 框里的联系人 = { id: string; name: string; position: string | null };

export async function 查重领取框数据(类型: string, 值: string): Promise<查重领取框> {
  const me = await requireUser();
  if (!企业版() || (await getBusiness()).projectMode !== true) return { ok: false, error: "查重领取只在企业版项目模式里有" };
  if (!能查重领取(await 权限组织(), me.id)) return { ok: false, error: 不是市场成员查重领取话 };
  const 号 = 验号码(类型, 值);
  if (!号.ok) return { ok: false, error: 号.提示 };
  const 挑 = await 首条撞的(prisma, await 全公司查号(prisma, 号.类型, 号.值, 号.键));
  if (!挑?.pool) return { ok: false, error: 没撞上公海话 };
  if (await 发起人领不回(prisma, 挑, me.id)) return { ok: false, error: 原负责人不能领回提示 };
  // 打开框就说清领不了的（交的时候 查重领取 照样再判）：自动分配用不了、移交中、标了无效
  if (!(await 我能用的分配方式(me)).some((x) => x.i === 1)) {
    return { ok: false, error: (await 挡分配方式(me, 1)) ?? `「${await 分配方式叫法(1)}」已停用，查重领取只能自动分配；请找系统管理员` };
  }
  const 移交中 = await 移交中不能领([挑.id], "领");
  if (移交中) return { ok: false, error: 移交中 };
  if ((await 无效的([挑.id])).size) return { ok: false, error: 无效不能领提示 };
  if (!查重领取口径.新建线索项目) return { ok: true, 新建线索项目: false, 客户名: 客户显名(挑), 渠道们: [], 联系人们: [], 默认对接人: null };
  const 联系人们 = await 看全部(() => prisma.contact.findMany({ where: { customerId: 挑.id, deletedAt: null }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], select: { id: true, name: true, position: true } }));
  return { ok: true, 新建线索项目: true, 客户名: 客户显名(挑), 渠道们: await 可选渠道们(), 联系人们, 默认对接人: await 撞上的联系人(prisma, 挑.id, 号) };
}

/**
 * 市场成员经号码查重领公海客户（员工反馈 F-016；客户 11-19：「可以进行该公海项目/客户的领取，但领取时……1.必须写沟通记录；2.只能自动分配」）。
 * 只认号码不认 id（同 从回收站捞回）：服务端重查一遍，首条撞的那位还在客户公海里才领；客户id 是界面看到的那位，交了就要对得上，对不上按最新结论说。
 * 一个事务里：客户整体出公海直接给自动挑中的销售（不落在市场成员名下，照 P-公海-11 客户在公海 / 市场手里整体给销售）、名下公海项目一起带走；
 * 沟通挂哪条项目分两条路（lib/enterprise/dedupe-claim.ts 查重领取口径，见那边文件头）：
 *   - 新建线索项目（现行，用户 11-19）：另建一条线索项目（这次的渠道、对接人），沟通记在它上面，市场分给销售进线索验证；不补潜客培育
 *   - 只领旧项目：最近进公海的那条公海项目；没有就补潜客培育那条；都没有取名下最近建的在推项目
 * 那条项目分配方式记「自动分配」、记一行分配记录、挂上那条沟通（P-沟通-03）。计不计本月已分照 assign-actions（P-转-29）：
 * 新建的线索项目、补的潜客培育算；从线索公海里带出来的旧项目不算（counted && !pooledAt）。客户的渠道、联系人不改。
 * 分配方式照「谁能用」（dict.ts 挡分配方式）：自动分配停用了、没给市场角色用，按现有的话拦。
 * 挑不到人（没人参与、方向对不上、都满额、都超持有上限）：不领、什么都不写，回原因（P-转-38 的说法）。
 * 原负责人回避（P-公海-04）：用户 11-19「仅对创建人豁免，对其他人有效」——发起人是原负责人且不是客户创建人照旧拦；
 * 自动分配不挑原负责人，除非他是客户创建人（dedupe-claim.ts 要回避）。
 * 事务提交后：通知接手人（P-转-17，不走接手人确认）、操作日志一条、重算客户三态
 */
export async function 查重领取(类型: string, 值: string, 沟通: 查重领取沟通, 客户id?: string | null, 新项目?: 查重领取新项目): Promise<查重领取结果> {
  const me = await requireUser();
  const b = await getBusiness();
  if (!企业版() || b.projectMode !== true) return { ok: false, error: "查重领取只在企业版项目模式里有" };
  const org = await 权限组织();
  if (!org || !能查重领取(org, me.id)) return { ok: false, error: 不是市场成员查重领取话 };
  if (!(await 规则开着("线索分配"))) return { ok: false, error: 挑不到话("规则「线索分配」没开，查重领取只能自动分配") };
  // 沟通先验（必填同记沟通）：没写的整笔不做
  if (!沟通 || typeof 沟通 !== "object") return { ok: false, error: "领取时必须写一条沟通记录" };
  const 认 = await 认跟进方式({ ...沟通 });
  if ("error" in 认) return { ok: false, error: 认.error };
  const 好 = 规整沟通({ ...认, 下一步: null, 下一步时间: null }, { 要下一步: false, 叫法: "这条" });
  if ("error" in 好) return { ok: false, error: 好.error };
  const 新建 = 查重领取口径.新建线索项目;
  // 新建线索项目那条路：这次的渠道必填（主渠道占位落成渠道、停用 / 历史渠道不认，同建档向导）
  const 渠道交 = 新建 && typeof 新项目?.渠道 === "string" ? 新项目.渠道.trim() : "";
  if (新建 && !渠道交) return { ok: false, error: "请选这次的渠道：新建的线索项目记在这个渠道上" };
  // 服务端重查：号码确实撞上这位公海客户（首条撞的、还在客户公海）
  const 号 = 验号码(类型, 值);
  if (!号.ok) return { ok: false, error: 号.提示 };
  const 挑 = await 首条撞的(prisma, await 全公司查号(prisma, 号.类型, 号.值, 号.键));
  if (!挑?.pool || (客户id && 客户id !== 挑.id)) return { ok: false, error: 没撞上公海话 };
  const cid = 挑.id;
  // 发起人是原负责人（和向导「原负责人是我」同一个判断）、又不是客户创建人：领不回
  if (await 发起人领不回(prisma, 挑, me.id)) return { ok: false, error: 原负责人不能领回提示 };
  const 原负责人 = await 公海客户的原负责人(prisma, cid);
  const 创建人 = await 客户创建人(prisma, cid);
  // 只能自动分配：自动分配这一项要还启用、这个人的角色能用（同建档向导 定分配方式）
  if (!(await 我能用的分配方式(me)).some((x) => x.i === 1)) {
    return { ok: false, error: (await 挡分配方式(me, 1)) ?? `「${await 分配方式叫法(1)}」已停用，查重领取只能自动分配；请找系统管理员` };
  }
  const 移交中 = await 移交中不能领([cid], "领");
  if (移交中) return { ok: false, error: 移交中 };
  if ((await 无效的([cid])).size) return { ok: false, error: 无效不能领提示 };
  // 对接人以这次录的为准：同名挂原人（不改原信息）、不同名在客户下新建（事务里建，挑不到人一起回滚）
  let 对接人: 认好的对接人 | null = null;
  if (新建) {
    const 认 = await 认对接人(prisma, cid, 新项目?.对接人);
    if ("error" in 认) return { ok: false, error: 认.error };
    对接人 = 认;
  }
  let 渠道 = "";
  if (新建) {
    const 落 = await 落到渠道(渠道交, me);
    if (!落.ok) return { ok: false, error: 落.error };
    const 不行 = 落.id ? await 新数据渠道不行(落.id) : "停用";
    if (不行) return { ok: false, error: 不行 === "停用" ? "这个渠道不存在或已停用，换一个" : 不行 };
    渠道 = 落.id!;
  }
  const 目标 = await 最近的公海项目(prisma, cid);
  // 回避：客户的原负责人、最近那条公海项目的历史负责人（都是「最近一次把它放进公海的人」），客户创建人豁免
  const 回避 = 拦原负责人()
    ? [原负责人, 目标 ? await 看全部(() => 历史负责人(prisma, 目标.id)) : null].filter((x): x is string => !!x && 要回避(x, 创建人))
    : [];
  // 分配方向看客户地址 → 项目所在地（只领旧项目那条路看那条公海项目）→ 客户的号 → 我的事业部
  // 判无效待补（invalid-makeup.ts）：只在这次算本月已分时用（新建线索项目、或没有公海项目可挂；同下面 查满）
  const 候 = await 查重领取候选们(org, me.id, cid, 新建 ? null : (目标?.id ?? null), 回避, 新建 || !目标);
  const way = await 分配方式叫法(1);
  // 计不计本月已分：只领旧项目那条路挂的是线索公海里带出来的那条 = 不计（同 assign-actions 这条算数 = counted && !p.pooledAt），也就不卡满额
  const 查满 = 候.查满 && (新建 || !目标);
  const 跳过 = new Set(候.底.不参与);
  let 底 = 候.底;
  let 重挑 = 0;
  let 超上限 = false;
  let 带出 = 0;
  await 钉住老签约();
  for (;;) {
    const 谁 = 挑接手人(底.排位(), 跳过, 查满, 底.不限额);
    if (!谁) {
      // 超持有上限的那句（整批超上限）带着别的销售名下的数和上限，不给市场成员看：只说原因
      if (超上限) return { ok: false, error: 挑不到话("能接的销售名下客户都到持有上限了") };
      return { ok: false, error: 挑不到话(候选挑不到为什么(候, 底)) };
    }
    const 为什么 = 查重领取理由(候, 挑的理由(底.排位(), 跳过, 查满, 谁, 底.不限额));
    let 项目id = "";
    let 算数 = false;
    try {
      const r = await 公海客户出手([cid], 谁, me.id, "pool-assign", undefined, undefined, undefined, !新建 && 要补潜客培育(企业版(), b.projectMode), {
        补的方式: way,
        // 查重领取带出线索公海的旧项目算跟着客户带过去的（超时未跟进自动转不起算，总控 11-20 定）
        公海项目痕: 跟着客户痕,
        然后: async (tx, 出) => {
          // 没出来：事务里读到刚被标了无效（公海客户出手 跳过）或刚被别人领走；回滚后按哪种说（下面 catch）
          if (出.到.length !== 1) throw new 查重领取作废("这位客户刚被别人领走了，这次没领");
          // 事务里按重读的本月分配数再挑一遍：还是他才写（同 自动分给 的复核）
          if (挑接手人(底.排位(undefined, await 本月分配行(候.人们, 候.月, tx), 底.用补位 ? await 待用补位行(候.人们, tx) : undefined), 跳过, 查满, 底.不限额) !== 谁) throw new 查重领取换人(false);
          // 判无效补发（invalid-makeup.ts，用户 11-20）：他有方向对得上的待补 = 补发，不算本月已分、不查满额
          const 补位id = 底.用补位 ? await 找待用补位(tx, 谁, 候.向.线) : null;
          if (!补位id && 查满 && !底.不限额 && 满了(await 本月已分(谁, 候.月, tx), await 配额of(谁, tx))) throw new 查重领取换人(true);
          const 挂 = 新建
            ? { id: await 新建这条(tx, { cid, 客户名: 全称或显名(挑), 谁, me: me.id, 渠道, 对接人: 对接人!, 线: 候.向.线, way, org }), 公海: false }
            : await 领旧的这条(tx, { cid, 谁, 目标, 出, way });
          项目id = 挂.id;
          算数 = 候.查满 && !挂.公海 && !补位id;
          带出 = 出.公海项目.filter((x) => x !== 项目id).length;
          const 记 = await tx.entLeadAssign.create({
            data: { projectId: 项目id, toUserId: 谁, fromUserId: 原负责人, byUserId: me.id, line: 候.向.线, kind: "营销", counted: 算数, month: 候.月, way },
            select: { id: true },
          });
          // 判无效补发：标这个待补用在这条分配上（同 assign-actions 分项目给）
          // 没标上（按说不会）= 抛换人：整笔回滚、按最新的数重挑
          if (补位id && !挂.公海 && !(await 用掉补位(tx, 补位id, 记.id, 项目id))) throw new 查重领取换人(false);
          // 新建线索项目那条路：沟通是建项目带出的首条（M-公海-54）；领旧项目的不是
          await 查重领取记沟通(tx, me.id, 项目id, 好, new Date(), 新建);
        },
      });
      // 挑中的这位超了持有上限（M-公海-18）：整笔回滚，顺延下一位
      if (!r.ok) { 超上限 = true; 跳过.add(谁); continue; }
    } catch (e) {
      if (e instanceof 查重领取换人) {
        if (e.满) { 跳过.add(谁); continue; }
        if (++重挑 > 查重领取最多重挑) return { ok: false, error: "同时分配的太多，这次没领，请稍后再试" };
        底 = await 读挑人底子(候.人们, 候.月, 候.补位);
        continue;
      }
      if (e instanceof 查重领取作废) return { ok: false, error: (await 无效的([cid])).size ? 无效不能领提示 : e.message };
      throw e;
    }
    const 人 = await prisma.user.findUnique({ where: { id: 谁 }, select: { name: true } });
    const 接手人 = 人?.name ?? 谁;
    const 项目名 = (await 看全部(() => prisma.project.findUnique({ where: { id: 项目id }, select: { name: true } })))?.name ?? "";
    await recordAudit({
      user: me, action: "claim", entity: "Customer", entityId: cid,
      summary: `经号码查重从公海领取${b.customer}${客户引(挑)}（${新建 ? "新建线索项目" : "项目"}「${项目名}」），自动分配给「${接手人}」，并记了一条沟通`,
      detail: { 查重领取: true, 新建线索项目: 新建, 号码类型: 号.类型, 项目: 项目id, 给: 谁, 原负责人, 分配方式: way, 为什么, ...(新建 ? { 渠道, 对接人: 新项目?.对接人?.名字 ?? null, 新建对接人: !!对接人 && "建" in 对接人 } : {}) },
    });
    // 项目上也记一条（同 assign-actions 分项目给）：项目的操作日志里看得到这次分配
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: 项目id,
      summary: `分配新线索「${项目名}」给 ${接手人}${候.向.线 ? `（${候.向.线}）` : ""}${算数 ? "" : "，不计数"}`,
      detail: { toUserId: 谁, fromUserId: 原负责人, line: 候.向.线, kind: "营销", counted: 算数, month: 候.月, 分配方式: way, 查重领取: true },
    });
    await 分配通知(me, [{ projectId: 项目id, toUserId: 谁 }], true,
      `${me.name} 查号码撞上公海里的这位${b.customer}，领取时记了一条沟通，${b.customer}连项目一起给你${带出 ? `；名下还有 ${带出} 条从公海带出来的旧项目` : ""}`);
    await 存沟通后重算三态(cid);
    刷新([cid]);
    revalidatePath("/projects");
    revalidatePath("/leads");
    return { ok: true, 提示: `已领取并自动分配给 ${接手人}，沟通已记在${新建 ? "新建的线索项目" : "项目"}「${项目名}」上`, 接手人, 项目: 项目名, 为什么 };
  }
}

/** 新建线索项目那条路（事务里）：建在接手人名下，市场分给销售进线索验证（同新线索自动分配，market-assign-node.ts） */
async function 新建这条(
  tx: Prisma.TransactionClient,
  a: { cid: string; 客户名: string; 谁: string; me: string; 渠道: string; 对接人: 认好的对接人; 线: "内贸" | "外贸" | null; way: string; org: NonNullable<Awaited<ReturnType<typeof 权限组织>>> },
): Promise<string> {
  const 对接人 = await 落对接人(tx, a.cid, a.对接人, a.me);
  const id = await 查重领取建线索项目(tx, { customerId: a.cid, 项目名: a.客户名, 接手人: a.谁, 创建人: a.me, 渠道: a.渠道, 对接人, 线: a.线, 分配方式: a.way });
  if (算市场建给销售(a.org, a.me, a.谁)) await 市场分配进线索验证(tx, [id], a.谁, a.me);
  return id;
}

/** 只领旧项目那条路（事务里）：最近进公海的那条要真随客户带出来了；没有公海项目 = 补的潜客培育；再没有 = 名下最近建的在推项目。分配方式改成自动分配 */
async function 领旧的这条(
  tx: Prisma.TransactionClient,
  a: { cid: string; 谁: string; 目标: { id: string } | null; 出: { 记下: 带走的; 公海项目: string[] }; way: string },
): Promise<{ id: string; 公海: boolean }> {
  const id = a.目标
    ? (a.出.公海项目.includes(a.目标.id) ? a.目标.id : "")
    : a.出.记下.培育?.[0] ?? (await 最近的在推项目(tx, a.cid, a.谁)) ?? "";
  if (!id) throw new 查重领取作废(a.目标 ? "要领的那条公海项目刚被人动过，这次没领" : "这位客户名下没有能挂沟通的在推项目，这次没领");
  await tx.project.update({ where: { id }, data: { assignMode: a.way } });
  // 公海 = 从线索公海里带出来的那条：不计本月已分
  return { id, 公海: !!a.目标 };
}
