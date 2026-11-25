"use server";

/**
 * 合并客户第一批 · 服务端动作（2026-11-25，客户 E-277 / E-280；方案 docs/合并客户-第一批-落地.md）。
 *
 * 界面（第三阶段）只调这里。前端传来的只认 id（和两个勾选），谁能并、能撤、能换、能合成全在数据层按登录的人重新判：
 *   - 合并预览 / 执行合并 / 撤回合并：lib/enterprise/customer-merge.ts
 *   - 合成联系人（同一位客户下两位是同一个人）：同上，合成单 kind = 联系人
 *   - 项目换客户：lib/enterprise/project-move-customer.ts
 *   - 搜要并的那家：只搜自己能并的（负责人是自己、不在公海），系统管理员不限（E-277 f2：免得变成全公司查号）
 * 首页 AI 不给这些动作（合并是结构性改动，要人在预览里核对、勾选）：lib/ai 不引这个文件。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 是系统管理员 } from "@/lib/enterprise/permissions";
import { 客户关键词条件, 搜索词 } from "@/lib/search-keyword";
import { 客户显名, 显名列 } from "@/lib/enterprise/customer-title";
import { 客户编号文字 } from "@/lib/customer-no";
import {
  合并预览, 执行合并, 撤回合并, 合成联系人, 撤回期限天数, 客户单, 联系人单,
  type 合并预览结果, type 合并完, type 没还原, type 同一个人,
} from "@/lib/enterprise/customer-merge";
import { 项目换客户预览, 项目换客户, type 换客户预览结果 } from "@/lib/enterprise/project-move-customer";

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
export async function 撤回合并单(mergeId: string): Promise<结果<{ 没还原: 没还原[] }>> {
  const me = await 我();
  if (!是id(mergeId)) return 坏参数;
  const m = await prisma.entCustomerMerge.findUnique({ where: { id: mergeId }, select: { fromId: true, intoId: true, kind: true } });
  const r = await 撤回合并(prisma, mergeId, me);
  if (r.ok && m) {
    if (m.kind === 客户单) 刷新(m.intoId, m.fromId);
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

export async function 给项目换客户(projectId: string, 目标id: string): Promise<结果<{ 沟通: number; 挂靠: number }>> {
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

export type 合并单一条 = {
  id: string;
  /** 客户：别的客户并进这位；联系人：这位客户名下单独合成的两位联系人（合并客户时勾的随客户合并单走，不单列） */
  kind: string;
  从: string; 编号: string | null;
  /** 联系人单：合成进的那位（留下的联系人）名字 */
  到?: string;
  at: string; status: string;
  /** 这会儿能不能撤：合并的人本人或系统管理员、没撤过、没过期 */
  能撤: boolean;
};

/** 并进这位客户的合并单 + 这位客户名下单独合成的联系人（客户详情的历史变更、撤回入口用）。看得到这位客户的才给 */
export async function 并进来的合并单(customerId: string): Promise<合并单一条[]> {
  const me = await requireUser();
  if (!企业版() || !是id(customerId)) return [];
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!c) return [];
  const 管 = 是系统管理员(me, await 权限组织());
  const 人们 = await 看全部(() => prisma.contact.findMany({ where: { customerId, deletedAt: null }, select: { id: true, name: true } }));
  const 人名 = new Map(人们.map((x) => [x.id, x.name]));
  const 们 = await prisma.entCustomerMerge.findMany({
    where: { OR: [{ kind: 客户单, intoId: customerId }, ...(人们.length ? [{ kind: 联系人单, parentId: null, intoId: { in: [...人名.keys()] } }] : [])] },
    orderBy: { at: "desc" }, take: 50,
  });
  const 线 = Date.now() - 撤回期限天数 * 86_400_000;
  return 们.map((m) => ({
    id: m.id, kind: m.kind, 从: m.fromName, 编号: m.kind === 客户单 ? 客户编号文字(m.fromNo) ?? null : null,
    ...(m.kind === 联系人单 ? { 到: 人名.get(m.intoId) ?? "" } : {}),
    at: m.at.toISOString(), status: m.status,
    能撤: m.status === "已合并" && m.at.getTime() >= 线 && (m.byUserId === me.id || 管),
  }));
}
