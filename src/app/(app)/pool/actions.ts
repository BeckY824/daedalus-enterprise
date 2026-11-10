"use server";

/**
 * 企业版统一公海的两个新动作（2026-10-29，P7）：标无效客户、恢复有效客户。领取照用原来的（客户公海 领取、项目公海 领取项目）。
 * 10-30 交互改版补两个：老板、主管把项目行分给同事（分配公海项目，客户行照用 分配公海）；领 / 分项目行的撤销（撤销公海项目，规则 B）。
 * 规矩：老板、主管能标无效；恢复 = 系统管理员、回收站副手（V3.5.1）。只认还在客户公海里的客户（项目行的客户归别人，不在这里标）。
 * 先拦权限、再看参数：权限矩阵拿空参数调，得先说「无权」（tests/permissions/matrix.test.ts）
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { 公海分不给 } from "@/lib/owners";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能管公海, 能恢复 } from "@/lib/enterprise/permissions";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 查完再写 } from "@/lib/check-then-write";
import { 记转让 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 单项目客户跟着领, 客户整包出公海, 领项目连带超上限, type 整包出公海 } from "@/lib/enterprise/pool-link";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";
import { 历史负责人 } from "@/lib/project/pool-owner";
import { 换负责人待办, 待办痕, 带待办勾 } from "@/lib/project/carry-tasks";
import { 公海分配通知, 同事待分配随客户通知, type 同事待分配条 } from "@/lib/enterprise/notice-sources";
import { 公海项目市场转, 转客户给销售 } from "@/lib/enterprise/market-transfer";
import { 分配方式叫法 } from "@/lib/enterprise/dict";
import { 撤销公海 } from "@/app/(app)/customers/pool-actions";
import type { 带走的 } from "@/lib/carry-over-db";
import { 换负责人 } from "@/lib/project/owner-write";

export type 标记结果 = { ok: true; updated: number; unchanged: number } | { ok: false; error: string };

const 只企业版项目模式 = { ok: false as const, error: "统一公海只在企业版项目模式里有" };

async function 开着(): Promise<boolean> {
  return 企业版() && (await getBusiness()).projectMode === true;
}

/** 参数规整：只认字符串 id，去重，最多 500 个（一页最多 100 行，留余量给以后批量） */
function 规整ids(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 500);
}

function 刷新() {
  revalidatePath("/pool");
  revalidatePath("/customers");
  revalidatePath("/projects");
}

/** 老板、主管把公海里的客户标成无效：标了的领不了、分不了。已经是无效的算没变 */
export async function 标无效客户(ids: string[]): Promise<标记结果> {
  const me = await requireUser();
  if (!能管公海(me, await 权限组织())) return { ok: false, error: "只有总管理和销售管理能标无效客户" };
  if (!(await 开着())) return 只企业版项目模式;
  const 们 = 规整ids(ids);
  if (!们.length) return { ok: true, updated: 0, unchanged: 0 };
  // 只改还在公海里、还没标的：领走了的不标（标了也没意义，还会在他以后再进公海时冒出来）
  const r = await prisma.customer.updateMany({ where: { id: { in: 们 }, pool: { isNot: null }, poolInvalidAt: null }, data: { poolInvalidAt: new Date() } });
  if (r.count) {
    await recordAudit({
      user: me, action: "pool-invalid", entity: "Customer", entityId: 们.length === 1 ? 们[0] : null,
      summary: `把公海里 ${r.count} 名客户标成无效客户`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: r.count, unchanged: 们.length - r.count };
}

/** 系统管理员、回收站副手能恢复：清掉无效标记，客户还在公海里，照常能领 */
export async function 恢复有效客户(ids: string[]): Promise<标记结果> {
  const me = await requireUser();
  if (!能恢复(me, await 权限组织())) return { ok: false, error: "只有系统管理员或回收站副手能恢复无效客户" };
  if (!(await 开着())) return 只企业版项目模式;
  const 们 = 规整ids(ids);
  if (!们.length) return { ok: true, updated: 0, unchanged: 0 };
  const r = await prisma.customer.updateMany({ where: { id: { in: 们 }, poolInvalidAt: { not: null } }, data: { poolInvalidAt: null } });
  if (r.count) {
    await recordAudit({
      user: me, action: "pool-restore", entity: "Customer", entityId: 们.length === 1 ? 们[0] : null,
      summary: `把 ${r.count} 名无效客户恢复成有效`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: r.count, unchanged: 们.length - r.count };
}

/**
 * 分配时客户在客户公海里、整包出公海的那几位（P-公海-10）：撤销条原样带回 撤销公海项目，整包退回。
 * 形状同客户公海分配的撤销条（原 = 客户 id + 出公海前的负责人、带过来、公海项目），撤销时照 撤销公海 认，前端传的不信
 */
export type 整包撤销 = { 原: { id: string; 值: string }[]; 带过来: 带走的; 公海项目: string[] };

export type 分项目结果 =
  | { ok: true; 分到: string[]; 没分到: { id: string; 原因: string }[]; 给谁: { id: string; name: string }; 整包?: 整包撤销 }
  | { ok: false; error: string };

/**
 * 老板、主管把线索公海里的项目分给同事（10-30，P0 #6）：权限同客户公海的 分配公海，持有上限照拦指派（超上限）。
 * 规矩同 领取公海项目：标了无效的客户的项目分不了；记一行 pool-claim（操作人 = 我，到 = 给的那位），撤销认的就是这一行；
 * 客户不在客户公海里：分到的只换项目负责人，客户负责人不变；客户在客户公海里：客户和名下别的公海项目整包出公海给这位（P-公海-10，11-09 定，
 * 只有能管公海的销售管理、总管理走得到这里）。一个一个分，分不了的说原因，不整批失败。
 * 带待办（C-06，公海页页头的勾，没传按默认勾）：进公海时关掉的那批待办重新打开给分到的人
 */
export async function 分配公海项目(ids: string[], userId: string, 带待办?: boolean): Promise<分项目结果> {
  const me = await requireUser();
  const org = await 权限组织();
  if (!能管公海(me, org)) return { ok: false, error: "只有总管理和销售管理能把公海里的项目分给同事" };
  if (!(await 开着())) return 只企业版项目模式;
  const 给 = await prisma.user.findFirst({ where: { id: String(userId ?? ""), active: true }, select: { id: true, name: true } });
  if (!给) return { ok: false, error: "这位同事不在了或已停用，换一位" };
  // 只分给能当负责人的；不是系统管理员只分给同业务线的（11-03 B2-7）
  const 不行 = await 公海分不给(me, 给.id);
  if (不行) return { ok: false, error: 不行 };
  const 们 = 规整ids(ids);
  const 规则 = await 生效组织规则();
  const 带 = 带待办勾(带待办);
  const 分到: string[] = [];
  const 没分到: { id: string; 原因: string }[] = [];
  let 跟来 = 0;
  let 连客户 = 0;
  const 整包: 整包撤销 = { 原: [], 带过来: { 计划: [], 待办: [], 商机: [], 项目: [] }, 公海项目: [] };
  // 客户在客户公海里的会整包换客户负责人（P-公海-10）、客户还在市场手里的整体给这位销售（P-公海-11）：事务外先钉住老签约（没缺的就不写）
  if (企业版()) await 钉住老签约();
  const way = 企业版() ? await 分配方式叫法(0) : "";
  const 随客户: 同事待分配条[] = [];
  for (const id of 们) {
    // 整包带过来的：事务撞上别的写入会重跑，每轮先清零，成了才加
    let 包: 整包出公海 | null = null;
    let 同事待分配: 同事待分配条[] = [];
    const 原因 = await 看全部(() => 查完再写(async (tx) => {
      包 = null;
      同事待分配 = [];
      const p = await tx.project.findUnique({ where: { id }, select: { id: true, name: true, phase: true, node: true, result: true, ownerId: true, pooledAt: true, customerId: true } });
      if (!p) return "这个项目已经不在了";
      if (!p.pooledAt) return "已经被人领走了";
      const c = await tx.customer.findUnique({ where: { id: p.customerId }, select: { poolInvalidAt: true, pool: { select: { customerId: true } } } });
      if (c?.pool && c.poolInvalidAt) return "客户标了无效，要总管理先恢复";
      const 出整包 = 企业版() && !!c?.pool;
      // 客户还在市场手里、分给销售 = 市场第一次分给销售，客户整体给他，记「分配」（P-公海-11；不看客户创建人），同事待分配的随客户进手一起数
      const 转 = 出整包 || !org ? null : await 公海项目市场转(tx, org, p, 给.id, false);
      const 超 = await 领项目连带超上限(tx, 规则, 给.id, p, 转?.另进 ?? 0, 出整包);
      if (超) return 超;
      await tx.project.update({ where: { id }, data: { ...换负责人(给.id), pooledAt: null, nextStepAt: null, nextStepText: null } });
      // 公海里的项目 ownerId 是空的（企业版进公海清负责人）：从谁 记留痕里的历史负责人
      const 原 = (await 历史负责人(tx, id)) ?? (p.ownerId || null);
      // 市场转客户的待办计划还归市场（P-转-10），勾不算数
      const 这带 = 转 ? undefined : 带;
      const 几条 = await 换负责人待办(tx, p, 原, 给.id, 这带);
      await 记转让(tx, p, me.id, 原, 给.id, "pool-claim", 待办痕(这带, 几条));
      if (出整包) 包 = await 客户整包出公海(tx, p.customerId, 给.id, me.id, 带, "pool-assign");
      else await 单项目客户跟着领(tx, p.customerId, 给.id, me.id, 这带);
      if (转) 同事待分配 = (await 转客户给销售(tx, p.customerId, 转.原, 给.id, me.id, way)).同事待分配;
      return null;
    }));
    if (原因) 没分到.push({ id, 原因 });
    else {
      分到.push(id);
      随客户.push(...同事待分配);
    }
    const 带来 = 包 as 整包出公海 | null;
    if (!原因 && 带来) {
      连客户 += 1;
      跟来 += 带来.公海项目.length;
      整包.原.push({ id: 带来.customerId, 值: 带来.旧 });
      整包.公海项目.push(...带来.公海项目);
      for (const k of ["计划", "待办", "商机", "项目"] as const) 整包.带过来[k]!.push(...(带来.带过来[k] ?? []));
    }
  }
  if (分到.length) {
    await recordAudit({
      user: me, action: "pool-assign", entity: "Project", entityId: 分到.length === 1 ? 分到[0] : null,
      summary: `把线索公海里 ${分到.length} 个项目分给 ${给.name}`,
      detail: { ids: 分到, 给: 给.id },
    });
    刷新();
    await 公海分配通知(me, 给.id, "项目", 分到, 跟来, 连客户);
    if (随客户.length) await 同事待分配随客户通知(me.id, 给.id, 随客户);
  }
  return { ok: true, 分到, 没分到, 给谁: 给, ...(整包.原.length ? { 整包 } : {}) };
}

/** 撤销条带回来的 整包 不可信：只留形状对的，id 都是字符串 */
function 规整整包(x: unknown): 整包撤销 | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const 原 = Array.isArray(o.原)
    ? o.原.filter((r): r is { id: string; 值: string } => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && typeof (r as { 值?: unknown }).值 === "string")
        .map((r) => ({ id: r.id, 值: r.值 })).slice(0, 500)
    : [];
  if (!原.length) return null;
  const 带 = (o.带过来 ?? {}) as Record<string, unknown>;
  return { 原, 带过来: { 计划: 规整ids(带.计划), 待办: 规整ids(带.待办), 商机: 规整ids(带.商机), 项目: 规整ids(带.项目) }, 公海项目: 规整ids(o.公海项目) };
}

/**
 * 撤销刚才从项目公海领 / 分走的项目（规则 B，6 秒内点）：项目回项目公海，负责人还给原来那位。
 * 认不认看留痕（撤回项目公海）：得是我在撤销时限内领 / 分给 现 的那一下。撤分配只有老板、主管能点
 * 分配时客户整包出了客户公海的（整包，P-公海-10）：整包退回——客户回客户公海、负责人还原，一起带出的项目回线索公海，
 * 带过来的活还回去，被撤的换负责人记录删掉（P-撤销-01、M-公海-01）。走 撤销公海 的分配那一支，认不认按它（得是我刚把客户从原负责人换给 给谁 的）。
 * 只退这次带出的：整包 是这次分配返回的，别的客户、项目不碰
 */
export async function 撤销公海项目(动作: "领取" | "分配", ids: string[], 给谁?: string, 整包?: 整包撤销): Promise<标记结果> {
  const me = await requireUser();
  if (动作 === "分配" && (!能管公海(me, await 权限组织()) || !给谁)) return { ok: false, error: "只有总管理和销售管理能撤销分配" };
  if (!(await 开着())) return 只企业版项目模式;
  const 现 = 动作 === "分配" ? String(给谁) : me.id;
  const 们 = 规整ids(ids);
  let 撤了 = 0;
  for (const id of 们) {
    if (await 看全部(() => 查完再写((tx) => 撤回项目公海(tx, id, 现, me.id)))) 撤了++;
  }
  const 包 = 动作 === "分配" ? 规整整包(整包) : null;
  if (包) {
    const r = await 撤销公海("分配", 包.原, 包.带过来, 现, 包.公海项目);
    if (!r.ok) return r;
  }
  if (撤了) {
    忘掉企业版范围(); // 回到公海，原负责人回避名单变了
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: 们.length === 1 ? 们[0] : null,
      summary: `撤销${动作}：${撤了} 个项目放回线索公海`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: 撤了, unchanged: 们.length - 撤了 };
}
