"use server";

/**
 * 合并客户第一批 · 服务端动作（2026-11-25，客户 E-277 / E-280；方案 docs/合并客户-第一批-落地.md）。
 *
 * 界面（第三阶段）只调这里。前端传来的只认 id（和两个勾选），谁能并、能撤、能换、能合成全在数据层按登录的人重新判：
 *   - 合并预览 / 执行合并 / 撤回合并：lib/enterprise/customer-merge.ts
 *   - 合成联系人（同一位客户下两位是同一个人）：同上，合成单 kind = 联系人
 *   - 项目换客户：lib/enterprise/project-move-customer.ts；换完 8 秒撤销条上的「撤销」= 撤销换客户（按那次日志反着做，只认自己刚换的那一次）
 *   - 项目合并（第二批 2a，同负责人的两个线索）：lib/enterprise/project-merge.ts；撤回同一张合并单表（kind = 项目），撤回合并单 也认
 *   - 搜要并的那家：只搜自己能并的（负责人是自己、不在公海），系统管理员不限（E-277 f2：免得变成全公司查号）
 * 首页 AI 不给这些动作（合并是结构性改动，要人在预览里核对、勾选）：lib/ai 不引这个文件。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 是系统管理员, 只读角色, 只看的人 } from "@/lib/enterprise/permissions";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 交接中的客户, 离职交接中的客户, 离职交接中的项目 } from "@/lib/enterprise/handover-db";
import { 客户关键词条件, 搜索词 } from "@/lib/search-keyword";
import { 客户显名, 显名列 } from "@/lib/enterprise/customer-title";
import { 客户编号文字 } from "@/lib/customer-no";
import {
  合并预览, 执行合并, 撤回合并, 合成联系人, 撤回期限天数, 客户单, 联系人单, 读没还原,
  type 合并预览结果, type 合并完, type 没还原, type 同一个人, type 撤回完,
} from "@/lib/enterprise/customer-merge";
import { 项目单 } from "@/lib/enterprise/project-merge-guard";
import { 项目换客户预览, 项目换客户, 撤销换客户 as 撤销换客户库, type 换客户预览结果, type 换完 } from "@/lib/enterprise/project-move-customer";
import {
  项目合并预览, 执行项目合并, 撤回项目合并, 能并进的项目, 项目的合并单,
  type 项目合并预览结果, type 项目合并完, type 撤回项目合并完, type 项目合并单一条, type 并进候选,
} from "@/lib/enterprise/project-merge";

type 结果<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const 是id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 64;
const 坏参数 = { ok: false as const, error: "参数不对，刷新再试" };
const 我 = async () => {
  const u = await requireUser();
  return { id: u.id, name: u.name, role: u.role };
};
const 刷新 = (...ids: (string | null | undefined)[]) => {
  for (const id of ids) if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/customers");
};

/** 这几位客户登录的人都看得到（走带限定的 prisma）：预览会摆两家的资料，看不到的不给，免得拿 id 探别人的客户 */
async function 都看得到(ids: string[]): Promise<boolean> {
  const 要 = [...new Set(ids)];
  return (await prisma.customer.count({ where: { id: { in: 要 } } })) === 要.length;
}
const 看不到 = { ok: false as const, error: "客户不存在或你看不到，刷新看看" };

/** 「是同一个人」几对：只认 {留, 并} 两个 id，多余的字段丢掉 */
function 规整对们(v: unknown): 同一个人[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 200) return null;
  const out: 同一个人[] = [];
  for (const x of v) {
    if (!x || typeof x !== "object" || !是id((x as 同一个人).留) || !是id((x as 同一个人).并)) return null;
    out.push({ 留: (x as 同一个人).留, 并: (x as 同一个人).并 });
  }
  return out;
}

export type 合并候选 = { id: string; name: string; 编号: string | null; 负责人: string | null };

/** 搜要并进来的那家（不含留下那家自己）。不是企业版、词太短给空 */
export async function 搜合并候选(留下id: string, 关键词: string): Promise<合并候选[]> {
  const me = await requireUser();
  if (!企业版() || !是id(留下id) || typeof 关键词 !== "string") return [];
  const 词 = 搜索词(关键词.trim().slice(0, 50));
  if (!词) return [];
  const 管 = 是系统管理员(me, await 权限组织());
  const 条件 = await 客户关键词条件(词, true, me.id);
  if (!Object.keys(条件).length) return [];
  const 们 = await 看全部(() => prisma.customer.findMany({
    where: { AND: [条件, { id: { not: 留下id } }, ...(管 ? [] : [{ salesOwnerId: me.id, pool: null }])] },
    orderBy: [{ lastFollowAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    take: 10,
    select: { ...显名列, salesOwner: { select: { name: true } } },
  }));
  return 们.map((c) => ({ id: c.id, name: 客户显名(c), 编号: 客户编号文字(c.customerNo) ?? null, 负责人: c.salesOwner?.name ?? null }));
}

/** 登录的人能不能并 / 换到同事的客户（= 系统管理员）：界面只用来挑说法（搜不到时那句、后果框谁能撤），谁能做照旧在数据层判 */
export async function 能并同事的(): Promise<boolean> {
  const me = await requireUser();
  return 企业版() && 是系统管理员(me, await 权限组织());
}

export async function 预览合并(留下id: string, 并掉id: string): Promise<结果<{ 预览: 合并预览结果 }>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return 坏参数;
  if (!(await 都看得到([留下id, 并掉id]))) return 看不到;
  return { ok: true, 预览: await 合并预览(prisma, 留下id, 并掉id, me) };
}

export async function 合并客户(留下id: string, 并掉id: string, opt: { 已核对?: boolean; 同一个人?: unknown } = {}): Promise<结果<合并完>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return 坏参数;
  const 对们 = 规整对们(opt?.同一个人);
  if (!对们) return 坏参数;
  const r = await 执行合并(prisma, 留下id, 并掉id, me, { 已核对: opt?.已核对 === true, 同一个人: 对们 });
  if (r.ok) 刷新(留下id, 并掉id);
  return r;
}

/** 撤回合并客户 / 撤回单独合成的联系人（同一张合并单表） */
export async function 撤回合并单(mergeId: string): Promise<结果<撤回完>> {
  const me = await 我();
  if (!是id(mergeId)) return 坏参数;
  const m = await prisma.entCustomerMerge.findUnique({ where: { id: mergeId }, select: { fromId: true, intoId: true, kind: true } });
  const r = await 撤回合并(prisma, mergeId, me);
  if (r.ok && m) {
    if (m.kind === 客户单) 刷新(m.intoId, m.fromId);
    else if (m.kind === 项目单) 刷新项目(m.intoId, m.fromId);
    else {
      const c = await prisma.contact.findUnique({ where: { id: m.intoId }, select: { customerId: true } });
      刷新(c?.customerId);
    }
  }
  return r;
}

export async function 合成两位联系人(留id: string, 并id: string): Promise<结果<{ mergeId: string }>> {
  const me = await 我();
  if (!是id(留id) || !是id(并id)) return 坏参数;
  const r = await 合成联系人(prisma, 留id, 并id, me);
  if (r.ok) {
    const c = await prisma.contact.findUnique({ where: { id: 留id }, select: { customerId: true } });
    刷新(c?.customerId);
  }
  return r;
}

export async function 预览项目换客户(projectId: string, 目标id: string): Promise<结果<{ 预览: 换客户预览结果 }>> {
  const me = await 我();
  if (!是id(projectId) || !是id(目标id)) return 坏参数;
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { customerId: true } });
  if (!p || !(await 都看得到([p.customerId, 目标id]))) return 看不到;
  return { ok: true, 预览: await 项目换客户预览(prisma, projectId, 目标id, me) };
}

export async function 给项目换客户(projectId: string, 目标id: string): Promise<结果<换完>> {
  const me = await 我();
  if (!是id(projectId) || !是id(目标id)) return 坏参数;
  const 原 = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { customerId: true } }));
  const r = await 项目换客户(prisma, projectId, 目标id, me);
  if (r.ok) {
    刷新(原?.customerId, 目标id);
    revalidatePath(`/projects/${projectId}`);
  }
  return r;
}

/* ─────────── 项目合并（第二批 2a） ─────────── */

/** 项目详情、客户详情、两个项目所在客户的列表都刷一遍 */
async function 刷新项目(...projectIds: string[]) {
  const ps = await 看全部(() => prisma.project.findMany({ where: { id: { in: projectIds } }, select: { customerId: true } }));
  for (const id of projectIds) revalidatePath(`/projects/${id}`);
  revalidatePath("/projects");
  刷新(...ps.map((p) => p.customerId));
}

/** 这几个项目登录的人都看得到（走带限定的 prisma）：免得拿 id 探别人的项目 */
async function 项目都看得到(ids: string[]): Promise<boolean> {
  const 要 = [...new Set(ids)];
  return (await prisma.project.count({ where: { id: { in: 要 } } })) === 要.length;
}
const 项目看不到 = { ok: false as const, error: "项目不存在或你看不到，刷新看看" };

/** 从被并掉的那个项目出发，留下的候选（同客户、同负责人、没结束；已签合同、到商机 / 订单的灰着带原因） */
export async function 项目合并候选(并掉id: string): Promise<并进候选[]> {
  const me = await 我();
  if (!是id(并掉id) || !(await 项目都看得到([并掉id]))) return [];
  return 能并进的项目(prisma, 并掉id, me);
}

export async function 预览项目合并(留下id: string, 并掉id: string): Promise<结果<{ 预览: 项目合并预览结果 }>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return 坏参数;
  if (!(await 项目都看得到([留下id, 并掉id]))) return 项目看不到;
  return { ok: true, 预览: await 项目合并预览(prisma, 留下id, 并掉id, me) };
}

/** 被并项目的组员不并进留下的项目（E-331），没有勾选；谁能并数据层判 */
export async function 合并项目(留下id: string, 并掉id: string): Promise<结果<项目合并完>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return 坏参数;
  const r = await 执行项目合并(prisma, 留下id, 并掉id, me);
  if (r.ok) await 刷新项目(留下id, 并掉id);
  return r;
}

/** 单撤一张项目合并单（撤回合并单 也认项目单，这个给项目页直接用，返回形状同） */
export async function 撤回项目合并单(mergeId: string): Promise<结果<撤回项目合并完>> {
  const me = await 我();
  if (!是id(mergeId)) return 坏参数;
  const m = await prisma.entCustomerMerge.findUnique({ where: { id: mergeId }, select: { fromId: true, intoId: true, kind: true } });
  if (!m || m.kind !== 项目单) return { ok: false, error: "找不到这张合并单" };
  const r = await 撤回项目合并(prisma, mergeId, me);
  if (r.ok) await 刷新项目(m.intoId, m.fromId);
  return r;
}

/** 这个项目相关的项目合并单（并进来的、并出去的）：历史变更、「已并入」那一行用。看得到这个项目的才给 */
export async function 项目合并单们(projectId: string): Promise<项目合并单一条[]> {
  const me = await 我();
  if (!企业版() || !是id(projectId) || !(await 项目都看得到([projectId]))) return [];
  return 项目的合并单(prisma, projectId, me);
}

/** 撤销刚做的项目换客户（撤销条上的「撤销」）：logId = 给项目换客户 返回的那条日志；谁能撤、还能不能撤数据层判 */
export async function 撤销换客户(logId: string): Promise<结果> {
  const me = await 我();
  if (!是id(logId)) return 坏参数;
  const 日志 = await prisma.auditLog.findUnique({ where: { id: logId }, select: { entityId: true, detail: true } });
  const r = await 撤销换客户库(prisma, logId, me);
  if (r.ok && 日志?.entityId) {
    try {
      const d = JSON.parse(日志.detail ?? "{}") as { 从?: string; 到?: string };
      刷新(d.从, d.到);
    } catch { 刷新(); }
    revalidatePath(`/projects/${日志.entityId}`);
  }
  return r;
}

export type 合并单一条 = {
  id: string;
  /** 客户：别的客户并进这位；联系人：这位客户名下单独合成的两位联系人（合并客户时勾的随客户合并单走，不单列） */
  kind: string;
  从: string; 编号: string | null;
  /** 联系人单：合成进的那位（留下的联系人）名字 */
  到?: string;
  at: string; status: string;
  /**
   * 这会儿能不能撤（和服务端拦法对齐，免得摆了按钮点了才说不行）：没撤过、没过期、不是只读 / 只看某人；
   * 客户单：系统管理员，或合并的人本人且留下那家仍归本人负责、不在公海；两家都不在转让 / 离职交接中。
   * 联系人单：系统管理员，或合成的人本人且这位客户仍归本人负责、不在公海；客户不在转让交接中
   */
  能撤: boolean;
  /** 撤回过的：没还原的那几条（存在合并单 undoLeft 里，刷新后照样看得到）；先拆开过单独合成的一句话 */
  没还原?: Pick<没还原, "类" | "原因">[];
  提示?: string;
  /** 客户单：留下那家有备注、被并那家的备注没合进来，记在合并单里可查 */
  被并备注?: string;
};

/** 并进这位客户的合并单 + 这位客户名下单独合成的联系人（客户详情的历史变更、撤回入口用）。看得到这位客户的才给 */
export async function 并进来的合并单(customerId: string): Promise<合并单一条[]> {
  const me = await requireUser();
  if (!企业版() || !是id(customerId)) return [];
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
  if (!c) return [];
  const org = await 权限组织();
  const 管 = 是系统管理员(me, org);
  /** 能写（同服务端撤回合并 / 撤回合成第一道：只读角色、只看某人的一律不能撤） */
  const 能写 = !!org && !只读角色(me, org) && !只看的人(org, me.id);
  const 人们 = await 看全部(() => prisma.contact.findMany({ where: { customerId, deletedAt: null }, select: { id: true, name: true } }));
  const 人名 = new Map(人们.map((x) => [x.id, x.name]));
  const 们 = await prisma.entCustomerMerge.findMany({
    where: { OR: [{ kind: 客户单, intoId: customerId }, ...(人们.length ? [{ kind: 联系人单, parentId: null, intoId: { in: [...人名.keys()] } }] : [])] },
    orderBy: { at: "desc" }, take: 50,
  });
  const 线 = Date.now() - 撤回期限天数 * 86_400_000;
  // 这位客户现在仍归本人负责、不在公海（系统管理员不限）：客户单、联系人单都要，同 customer-merge.ts 撤回合并 / 撤回合成
  const 留下归我 = 管 || (c.salesOwnerId === me.id && !c.pool);
  const 还能撤 = 们.filter((m) => m.status === "已合并" && m.at.getTime() >= 线 && 能写 && (m.byUserId === me.id || 管));
  const 被并们 = [...new Set(还能撤.filter((m) => m.kind === 客户单).map((m) => m.fromId))];
  const 拦 = 还能撤.length ? await 交接拦着(customerId, 被并们) : { 转让: new Set<string>(), 离职: new Set<string>(), 还在: new Set<string>() };
  const 客户单能撤 = (fromId: string) => 留下归我 && 拦.还在.has(fromId) && ![customerId, fromId].some((id) => 拦.转让.has(id) || 拦.离职.has(id));
  return 们.map((m) => {
    const 撤 = m.status === "已撤回" ? 读没还原(m.undoLeft) : null;
    return {
      id: m.id, kind: m.kind, 从: m.fromName, 编号: m.kind === 客户单 ? 客户编号文字(m.fromNo) ?? null : null,
      ...(m.kind === 联系人单 ? { 到: 人名.get(m.intoId) ?? "" } : {}),
      at: m.at.toISOString(), status: m.status,
      能撤: 还能撤.includes(m) && (m.kind === 客户单 ? 客户单能撤(m.fromId) : 留下归我 && !拦.转让.has(customerId)),
      ...(m.status === "已撤回" ? { 没还原: (撤?.没还原 ?? []).map((x) => ({ 类: x.类, 原因: x.原因 })), ...(撤?.提示 ? { 提示: 撤.提示 } : {}) } : {}),
      ...(m.kind === 客户单 ? 被并备注of(m.detail) : {}),
    };
  });
}

/**
 * 撤回按钮摆不摆：两家在交接中的（服务端撤回合并 / 撤回合成用的同几个判断函数，同样在 看已删 + 看全部 里查——被并那家在回收站里，别人发起的交接也算）。
 *   转让 = 交接中的客户（客户单、联系人单都拦）；离职 = 离职交接中的客户 + 名下项目在离职交接中（只拦客户单，同 customer-merge.ts 离职交接拦）；
 *   还在 = 被并那家还在库里（清出回收站的服务端拦「不能撤回」）
 */
async function 交接拦着(留下id: string, 被并们: string[]): Promise<{ 转让: Set<string>; 离职: Set<string>; 还在: Set<string> }> {
  const ids = [留下id, ...被并们];
  return 看已删(() => 看全部(async () => {
    const [转让, 客户们, 项目们] = await Promise.all([
      交接中的客户(ids),
      prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, salesOwnerId: true } }),
      被并们.length ? prisma.project.findMany({ where: { customerId: { in: ids }, deletedAt: null }, select: { id: true, ownerId: true, customerId: true } }) : Promise.resolve([]),
    ]);
    const 离职 = 被并们.length ? await 离职交接中的客户(客户们) : new Set<string>();
    if (项目们.length) {
      const 项 = await 离职交接中的项目(项目们);
      for (const p of 项目们) if (项.has(p.id)) 离职.add(p.customerId);
    }
    return { 转让, 离职, 还在: new Set(客户们.map((x) => x.id)) };
  }));
}

/** 合并单明细里的 被并备注（留下那家有备注时，被并那家的没合进来） */
function 被并备注of(detail: string): { 被并备注?: string } {
  try {
    const v = (JSON.parse(detail) as { 被并备注?: unknown }).被并备注;
    return typeof v === "string" && v ? { 被并备注: v } : {};
  } catch { return {}; }
}
