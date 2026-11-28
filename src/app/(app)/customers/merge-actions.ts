"use server";

/**
 * 合并客户第一批 · 服务端动作（2026-11-25，客户 E-277 / E-280；方案 docs/合并客户-第一批-落地.md）。
 *
 * 界面（第三阶段）只调这里。前端传来的只认 id（和两个勾选），谁能并、能撤、能换、能合成全在数据层按登录的人重新判：
 *   - 合并预览 / 执行合并 / 撤回合并：lib/enterprise/customer-merge.ts
 *   - 合成联系人（同一位客户下两位是同一个人）：同上，合成单 kind = 联系人
 *   - 项目换客户：lib/enterprise/project-move-customer.ts；换完 8 秒撤销条上的「撤销」= 撤销换客户（按那次日志反着做，只认自己刚换的那一次）
 *   - 项目合并（第二批 2a，同负责人的两个线索）：lib/enterprise/project-merge.ts；撤回同一张合并单表（kind = 项目），撤回合并单 也认
 *   - 跨负责人合并申请（第二批 2b）：lib/enterprise/merge-request.ts；发起 / 同意或拒绝 / 撤回 / 系统管理员作废，等我同意的、我发起的两张列表
 *   - 搜要并的那家：系统管理员不限；别人搜看得到、不在公海的（同事负责的标要申请），看不到的同事客户只按完整号码精确命中（第二批 2b-3；E-277 f2：免得变成全公司查号）
 * 首页 AI 不给这些动作（合并是结构性改动，要人在预览里核对、勾选）：lib/ai 不引这个文件。
 */
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
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
  type 项目合并预览结果, type 项目合并完, type 撤回项目合并完, type 项目合并单一条, type 并进候选们,
} from "@/lib/enterprise/project-merge";
import {
  发起合并申请, 处理合并申请, 撤回合并申请, 作废合并申请, 申请状态, 同意状态, 合并申请预览, 给发起人藏名, 读选择, 看不到那家叫法, 显示状态of, 拒绝原因超话,
  type 发起完, type 处理完, type 快照, type 凭, type 涉及项目, type 合并申请预览结果,
} from "@/lib/enterprise/merge-request";
import {
  发起跨负责人并, 跨并预览, 处理跨并申请, 撤回跨并申请, 算确认人, 跨并状态, type 确认人层级,
} from "@/lib/enterprise/project-merge-request";
import { 跨并通知 } from "@/lib/enterprise/project-merge-request-notice";
import { 通知里的客户名 } from "@/lib/enterprise/notice-mask";
import { 两家在我清单成对 } from "@/lib/enterprise/dupe-groups";
import { 全公司查号 } from "@/lib/enterprise/contact-dedupe";
import { 拒绝原因上限, 合并申请页 } from "./merge-request-words";
import { 验号码 } from "@/lib/enterprise/contact-format";

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

export type 合并候选 = {
  id: string; name: string; 编号: string | null; 负责人: string | null;
  /** 同事负责（第二批 2b）：不能直接并，要发合并申请；界面标「同事负责 · 要申请」 */
  要申请?: boolean;
  /** 看不到的同事客户、按完整号码搜到的：只给编号和负责人（name 空），预览时带上这个号让服务端再核一次 */
  按号?: string;
};

/** 搜到的看不到的同事客户最多几家（按完整号码精确命中，一个号通常只有一家） */
const 按号最多 = 3;

/**
 * 关键词是不是一个完整号码（手机号或邮箱，规整后能当查重键）：是就给 全公司查号 用的三样，不是给 null。
 * 方案第二批第 11 件第 3 条：看不到的同事客户只按完整号码精确命中，不按客户编号、不按片段
 */
function 完整号码(词: string): { 类型: "手机号" | "邮箱"; 值: string; 键: string } | null {
  const 类型 = 词.includes("@") ? "邮箱" as const : "手机号" as const;
  const r = 验号码(类型, 词);
  return r.ok && r.键 ? { 类型, 值: r.值, 键: r.键 } : null;
}

/**
 * 搜要并进来的那家（不含留下那家自己）。不是企业版、词太短给空。
 * 系统管理员不限；别人（第二批 2b）：先搜自己看得到、不在公海的（同事负责的标 要申请），
 * 看不到的同事客户只在词是完整号码、精确撞上时才列，只给编号和负责人（E-277 f2：不变成全公司查客户）
 */
export async function 搜合并候选(留下id: string, 关键词: string): Promise<合并候选[]> {
  const me = await requireUser();
  if (!企业版() || !是id(留下id) || typeof 关键词 !== "string") return [];
  const 词 = 搜索词(关键词.trim().slice(0, 50));
  if (!词) return [];
  const org = await 权限组织();
  const 管 = 是系统管理员(me, org);
  const 能写 = !!org && !只读角色(me, org) && !只看的人(org, me.id);
  const 条件 = await 客户关键词条件(词, true, me.id);
  const 选列 = { ...显名列, salesOwnerId: true, salesOwner: { select: { name: true } } } as const;
  const 排 = [{ lastFollowAt: "desc" as const }, { createdAt: "desc" as const }, { id: "desc" as const }];
  // 系统管理员看全部；别人走带限定的 prisma（= 看得到的），只读 / 只看某人的照旧只列自己负责的（反正并不了、也发不了申请）
  const 们 = Object.keys(条件).length
    ? await (管 ? 看全部 : <T,>(f: () => T) => f())(() => prisma.customer.findMany({
        where: { AND: [条件, { id: { not: 留下id } }, ...(管 ? [] : [{ pool: null }, ...(能写 ? [] : [{ salesOwnerId: me.id }])])] },
        orderBy: 排, take: 10, select: 选列,
      }))
    : [];
  const 出 = 们.map((c): 合并候选 => ({
    id: c.id, name: 客户显名(c), 编号: 客户编号文字(c.customerNo) ?? null, 负责人: c.salesOwner?.name ?? null,
    ...(!管 && c.salesOwnerId !== me.id ? { 要申请: true } : {}),
  }));
  const 号 = !管 && 能写 ? 完整号码(词) : null;
  if (号) {
    const 已有 = new Set([留下id, ...出.map((c) => c.id)]);
    const ids = (await 全公司查号(prisma, 号.类型, 号.值, 号.键)).filter((id) => !已有.has(id));
    if (ids.length) {
      const 撞的 = await 看全部(() => prisma.customer.findMany({
        where: { id: { in: ids }, pool: null, deletedAt: null, NOT: { salesOwnerId: me.id } },
        orderBy: 排, take: 按号最多, select: { id: true, customerNo: true, salesOwner: { select: { name: true } } },
      }));
      for (const c of 撞的) 出.push({ id: c.id, name: "", 编号: 客户编号文字(c.customerNo) ?? null, 负责人: c.salesOwner?.name ?? null, 要申请: true, 按号: 词 });
    }
  }
  return 出;
}

/**
 * 发合并申请前的预览（第二批 2b-3）：留下那家要看得到；并进来那家看得到，或带着搜到它的那个完整号码、服务端再核一次撞得上
 * （免得拿 id 挨个探同事的客户）。判法、给多少都在 merge-request.ts 合并申请预览
 */
export async function 预览合并申请(留下id: string, 并掉id: string, 按号?: string): Promise<结果<{ 预览: 合并申请预览结果 }>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id) || (按号 !== undefined && typeof 按号 !== "string")) return 坏参数;
  if (!(await 都看得到([留下id])) || !(await 并掉那家放行(留下id, 并掉id, 按号))) return 看不到;
  return { ok: true, 预览: await 合并申请预览(prisma, 留下id, 并掉id, me) };
}

/**
 * 并进来那家放行（预览合并申请、发起客户合并申请共用一个判法）：看得到；看不到的，要带着搜到它的那个完整号码、服务端再核一次撞得上。
 * 不放行一律回「看不到」，不往下走数据层（数据层跑在 看全部 里，拦下的原因会带出客户名、业务线、交接状态）
 */
async function 并掉那家放行(留下id: string, 并掉id: string, 按号?: string): Promise<boolean> {
  if (await 都看得到([并掉id])) return true;
  // 疑似重复清单上「要申请」的平级同事同名客户：服务端按清单同一个判法重判两家成对
  if (await 两家在我清单成对(prisma, await 我(), await 权限组织(), 留下id, 并掉id)) return true;
  const 号 = 按号 ? 完整号码(搜索词(按号.trim().slice(0, 50)) ?? "") : null;
  return !!号 && (await 全公司查号(prisma, 号.类型, 号.值, 号.键)).includes(并掉id);
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

/** 从被并掉的那个项目出发，留下的候选（同客户、同负责人、没结束；已签合同、到商机 / 订单的灰着带原因，灰的只列前几个、带总数） */
export async function 项目合并候选(并掉id: string): Promise<并进候选们> {
  const me = await 我();
  if (!是id(并掉id) || !(await 项目都看得到([并掉id]))) return { 列: [], 灰共: 0 };
  return 能并进的项目(prisma, 并掉id, me);
}

export async function 预览项目合并(留下id: string, 并掉id: string): Promise<结果<{ 预览: 项目合并预览结果 }>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return 坏参数;
  if (!(await 项目都看得到([留下id, 并掉id]))) return 项目看不到;
  return { ok: true, 预览: await 项目合并预览(prisma, 留下id, 并掉id, me) };
}

/** 被并项目的组员不并进留下的项目（E-331），没有勾选；谁能并数据层判 */
export async function 合并项目(留下id: string, 并掉id: string, 已核未开票 = false): Promise<结果<项目合并完>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return 坏参数;
  const r = await 执行项目合并(prisma, 留下id, 并掉id, me, { 已核未开票 });
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

/* ───────────────────────── 合并申请（第二批 2b）───────────────────────── */

/** 申请动过就刷两家详情和客户列表；最后一位同意执行了合并，同第一批合并客户 */
async function 刷新申请(requestId: string) {
  const r = await 看全部(() => prisma.entMergeRequest.findUnique({ where: { id: requestId }, select: { fromId: true, intoId: true } }));
  if (r) 刷新(r.intoId, r.fromId);
}

/**
 * 发合并申请：把 并掉id 并进 留下id，要两家负责人、名下没结束项目的负责人都同意。勾选同第一批合并预览。
 * 两家看不看得到同预览合并申请（按号 = 搜到那家时用的完整号码，见 并掉那家放行）：不能绕过预览拿 id 直接发
 */
export async function 发起客户合并申请(
  留下id: string, 并掉id: string, opt: { 已核对?: boolean; 同一个人?: unknown; 按号?: string } = {},
): Promise<结果<发起完>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id) || 留下id === 并掉id) return 坏参数;
  const 按号 = opt?.按号;
  if (按号 !== undefined && typeof 按号 !== "string") return 坏参数;
  const 对们 = 规整对们(opt?.同一个人);
  if (!对们) return 坏参数;
  if (!(await 都看得到([留下id])) || !(await 并掉那家放行(留下id, 并掉id, 按号))) return 看不到;
  const r = await 发起合并申请(prisma, 留下id, 并掉id, me, { 已核对: opt?.已核对 === true, 同一个人: 对们 });
  if (r.ok) 刷新(留下id, 并掉id);
  return r;
}

/** 同意人同意 / 拒绝。拒绝可带一句原因（选填，最多 100 字：界面超了点不了，这里再拦一道，不悄悄截） */
export async function 处理客户合并申请(requestId: string, 结论: "同意" | "拒绝", 原因?: string): Promise<结果<处理完>> {
  const me = await 我();
  if (!是id(requestId) || (结论 !== "同意" && 结论 !== "拒绝") || (原因 !== undefined && typeof 原因 !== "string")) return 坏参数;
  if (原因 && 原因.trim().length > 拒绝原因上限) return { ok: false, error: 拒绝原因超话 };
  const r = await 处理合并申请(prisma, requestId, me, 结论, { 原因 });
  if (r.ok) await 刷新申请(requestId);
  return r;
}

/** 发起人撤回（只在待同意时） */
export async function 撤回客户合并申请(requestId: string): Promise<结果> {
  const me = await 我();
  if (!是id(requestId)) return 坏参数;
  const r = await 撤回合并申请(prisma, requestId, me);
  if (r.ok) await 刷新申请(requestId);
  return r;
}

/** 系统管理员作废一张待同意的申请（同意人停用、等不到人时） */
export async function 作废客户合并申请(requestId: string): Promise<结果> {
  const me = await 我();
  if (!是id(requestId)) return 坏参数;
  const r = await 作废合并申请(prisma, requestId, me);
  if (r.ok) await 刷新申请(requestId);
  return r;
}

/**
 * 显示状态：见 merge-request.ts 显示状态of（「已失效」里分出「已作废」，2b-3 第二段审查第 4 条）。
 * 同意人.项目 / 项目数：给发起人时，他涉及的项目里有发起人看不到的（或在看不到那家名下的）给 []，项目数照实（同 merge-request.ts 给发起人看）
 */
export type 合并申请一条 = {
  id: string; 状态: string; 显示状态: string; 原因: string | null;
  留下: { id: string; 名: string }; 并掉: { id: string; 名: string };
  发起人: string; 发起: Date; 到期: Date; 结束: Date | null; mergeId: string | null;
  同意人: { userId: string; 名: string; 凭: 凭[]; 项目: 涉及项目[]; 项目数: number; 状态: string; 一句: string | null; 处理: Date | null }[];
};

const 读JSON = <T,>(v: string, 缺: T): T => { try { return JSON.parse(v) as T; } catch { return 缺; } };

/**
 * 两张列表共用：客户名取发起那一刻的快照（同意人多半看不到对方那家，免得为显名去读别人的客户），
 * 人名现查。最多 50 张，新的在前。
 * 给发起人（我发起的）：按号放行进来、他看不到的那家不写名字（换成 看不到那家叫法），拒绝原因、失效原因里提到的也换掉，同通知口径
 */
async function 申请们(where: Prisma.EntMergeRequestWhereInput, 给发起人 = false): Promise<合并申请一条[]> {
  if (!企业版()) return [];
  const 行们 = await 看全部(() => prisma.entMergeRequest.findMany({ where, include: { approvers: { orderBy: { createdAt: "asc" } } }, orderBy: { at: "desc" }, take: 50 }));
  const 人ids = [...new Set(行们.flatMap((r) => [r.byUserId, ...r.approvers.map((x) => x.userId)]))];
  const 人们 = 人ids.length ? await 看全部(() => prisma.user.findMany({ where: { id: { in: 人ids } }, select: { id: true, name: true } })) : [];
  const 叫 = new Map(人们.map((u) => [u.id, u.name]));
  // 给发起人：同意人涉及的项目只留发起人看得到的（用带限定的 prisma 查，不包 看全部）
  const 项目ids = 给发起人 ? [...new Set(行们.flatMap((r) => r.approvers.flatMap((x) => 读JSON<涉及项目[]>(x.projects, []).map((p) => p.id))))] : [];
  const 看得到项目 = new Set(项目ids.length ? (await prisma.project.findMany({ where: { id: { in: 项目ids } }, select: { id: true } })).map((p) => p.id) : []);
  return 行们.map((r) => {
    const 快 = 读JSON<快照>(r.snapshot, { 客户: {}, 项目: {} });
    const 藏 = 给发起人 && 读选择(r.choices).并掉看不到;
    const 能看 = (p: 涉及项目) => 看得到项目.has(p.id) && !(藏 && p.customerId === r.fromId);
    const 项目们 = (v: string) => {
      const 们 = 读JSON<涉及项目[]>(v, []);
      return { 项目: !给发起人 || 们.every(能看) ? 们 : [], 项目数: 们.length };
    };
    const 客 = (id: string) => ({ id, 名: 藏 && id === r.fromId ? 看不到那家叫法(读选择(r.choices).并掉编号) : 快.客户?.[id]?.名 ?? "已不在的客户" });
    const 话 = (v: string | null) => (v && 藏 ? 给发起人藏名(r, v) : v);
    return {
      id: r.id, 状态: r.status, 显示状态: 显示状态of(r), 原因: 话(r.reason), 留下: 客(r.intoId), 并掉: 客(r.fromId),
      发起人: 叫.get(r.byUserId) ?? "同事", 发起: r.at, 到期: r.expiresAt, 结束: r.endedAt, mergeId: r.mergeId,
      同意人: r.approvers.map((x) => ({
        userId: x.userId, 名: 叫.get(x.userId) ?? "同事", 凭: 读JSON<凭[]>(x.why, []), ...项目们(x.projects),
        状态: x.status, 一句: 话(x.note), 处理: x.decidedAt,
      })),
    };
  });
}

/** 等我同意的：还在待同意、我那一行也还没处理 */
export async function 等我同意的合并申请(): Promise<合并申请一条[]> {
  const me = await requireUser();
  return 申请们({ status: 申请状态.待同意, approvers: { some: { userId: me.id, status: 同意状态.待同意 } } });
}

/** 我发起的：各种状态都列（结束了的看结果） */
export async function 我发起的合并申请(): Promise<合并申请一条[]> {
  const me = await requireUser();
  return 申请们({ byUserId: me.id }, true);
}


/* ─────────── 跨负责人项目合并（阶段 2，E-380；服务端判定在 lib/enterprise/project-merge-request.ts，这里只管取数、转发、发通知） ─────────── */

/** 一个并进来的候选：同一位客户名下、别人负责、线索阶段在推的项目。只给名字、节点、负责人名（不给沟通、联系人这些内页信息） */
export type 跨并候选 = { id: string; name: string; node: string; 负责人: string };

/** 从留下的项目（这个）出发，列同客户别人负责的在推线索项目。谁能发由 预览 / 发起 再判；这里只给「是留下项目的负责人 / 系统管理员 / 这条的确认人」列 */
export async function 跨并候选们(留下id: string): Promise<跨并候选[]> {
  const me = await 我();
  if (!企业版() || !是id(留下id) || !(await 项目都看得到([留下id]))) return [];
  const org = await 权限组织();
  if (!org || 只读角色(me, org) || 只看的人(org, me.id)) return [];
  const A = await 看全部(() => prisma.project.findFirst({ where: { id: 留下id, deletedAt: null }, select: { id: true, customerId: true, ownerId: true, result: true, pooledAt: true, awaitAssignAt: true } }));
  if (!A || !A.ownerId || A.result || A.pooledAt || A.awaitAssignAt) return [];
  const 行们 = await 看全部(() => prisma.project.findMany({
    where: { customerId: A.customerId, id: { not: A.id }, ownerId: { not: A.ownerId, notIn: [""] }, deletedAt: null, result: null, pooledAt: null, awaitAssignAt: null, phase: "线索" },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }], take: 30, select: { id: true, name: true, node: true, ownerId: true, bizLine: true },
  }));
  const 管 = 是系统管理员(me, org);
  const 能 = 行们.filter((b) => b.ownerId && (A.ownerId === me.id || 管 || 算确认人(org, { ownerId: b.ownerId, bizLine: b.bizLine }).some((x) => x.userId === me.id)));
  const 人们 = 能.length ? await 看全部(() => prisma.user.findMany({ where: { id: { in: [...new Set(能.map((b) => b.ownerId!))] } }, select: { id: true, name: true } })) : [];
  const 叫 = new Map(人们.map((u) => [u.id, u.name]));
  return 能.map((b) => ({ id: b.id, name: b.name || "未命名项目", node: b.node, 负责人: 叫.get(b.ownerId!) ?? "同事" }));
}

export type 跨并预览话 =
  | { ok: true; 直接: boolean; 确认人: { 名: string; 层级: 确认人层级 }[]; 留下: { id: string; name: string; 负责人: string }; 并掉: { id: string; name: string; 负责人: string } }
  | { ok: false; 原因: string[] };

/** 点了候选以后读：直接并还是发申请、谁来确认；不能的写原因 */
export async function 预览跨并(留下id: string, 并掉id: string): Promise<跨并预览话> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id)) return { ok: false, 原因: [坏参数.error] };
  if (!(await 项目都看得到([留下id]))) return { ok: false, 原因: [项目看不到.error] };
  const r = await 跨并预览(prisma, 留下id, 并掉id, me);
  if (!r.ok) return { ok: false, 原因: r.原因 };
  const 人们 = await 看全部(() => prisma.user.findMany({ where: { id: { in: [...r.确认人.map((x) => x.userId), r.A.ownerId!, r.B.ownerId!] } }, select: { id: true, name: true } }));
  const 叫 = new Map(人们.map((u) => [u.id, u.name]));
  return {
    ok: true, 直接: r.直接,
    确认人: r.确认人.map((x) => ({ 名: 叫.get(x.userId) ?? "同事", 层级: x.层级 })),
    留下: { id: r.A.id, name: r.A.name || "未命名项目", 负责人: 叫.get(r.A.ownerId!) ?? "同事" },
    并掉: { id: r.B.id, name: r.B.name || "未命名项目", 负责人: 叫.get(r.B.ownerId!) ?? "同事" },
  };
}

export type 跨并发起结果 = { 方式: "直接并"; mergeId: string } | { 方式: "申请"; requestId: string; 到期: Date };

export async function 发起跨并(留下id: string, 并掉id: string): Promise<结果<跨并发起结果>> {
  const me = await 我();
  if (!是id(留下id) || !是id(并掉id) || 留下id === 并掉id) return 坏参数;
  if (!(await 项目都看得到([留下id]))) return 项目看不到;
  const r = await 发起跨负责人并(prisma, 留下id, 并掉id, me);
  if (!r.ok) return r;
  await 刷新项目(留下id, 并掉id);
  if (r.方式 === "直接并") return { ok: true, 方式: "直接并", mergeId: r.mergeId };
  await 跨并通知(prisma, r.requestId, "发起", me);
  return { ok: true, 方式: "申请", requestId: r.requestId, 到期: r.expiresAt };
}

async function 刷新跨并(requestId: string) {
  const r = await 看全部(() => prisma.entProjectMergeRequest.findUnique({ where: { id: requestId }, select: { fromProjectId: true, intoProjectId: true } }));
  if (r) await 刷新项目(r.fromProjectId, r.intoProjectId);
  revalidatePath(合并申请页);
}

/** 确认 / 拒绝（拒绝原因必填、≤100 字）。成了发通知；没成因为「已失效」（四项有变、被拦、到期）也发失效通知 */
export async function 处理跨并(requestId: string, 结论: "确认" | "拒绝", 原因?: string): Promise<结果<{ 状态: string }>> {
  const me = await 我();
  if (!是id(requestId) || (结论 !== "确认" && 结论 !== "拒绝") || (原因 !== undefined && typeof 原因 !== "string")) return 坏参数;
  if (原因 && 原因.trim().length > 拒绝原因上限) return { ok: false, error: 拒绝原因超话 };
  const r = await 处理跨并申请(prisma, requestId, me, 结论, { 原因 });
  if (r.ok) {
    await 跨并通知(prisma, requestId, r.状态 === 跨并状态.已拒绝 ? "拒绝" : "确认", me, 原因 ?? "");
    await 刷新跨并(requestId);
    return { ok: true, 状态: r.状态 };
  }
  const 行 = await 看全部(() => prisma.entProjectMergeRequest.findUnique({ where: { id: requestId }, select: { status: true, reason: true } }));
  if (行?.status === 跨并状态.已失效) {
    await 跨并通知(prisma, requestId, "失效", null, 行.reason ?? "");
    await 刷新跨并(requestId);
  }
  return r;
}

/** 发起人撤回（只在待确认） */
export async function 撤回跨并申请单(requestId: string): Promise<结果> {
  const me = await 我();
  if (!是id(requestId)) return 坏参数;
  const r = await 撤回跨并申请(prisma, requestId, me);
  if (r.ok) {
    await 跨并通知(prisma, requestId, "撤回", me);
    await 刷新跨并(requestId);
  }
  return r;
}

/**
 * 申请页「项目合并」一节的行。确认人看得到要并的两条项目的必要信息：项目名、节点、负责人、所属客户（打码名）、沟通条数、谁发起、几时失效；
 * 不给联系人、号码、回款这些内页。项目名等现查（改名了跟着变），查不到的退回发起那一刻的快照名
 */
export type 跨并申请一条 = {
  id: string; 状态: string; 原因: string | null; 客户: string;
  留下: { id: string; 名: string; 节点: string; 负责人: string; 沟通: number };
  并掉: { id: string; 名: string; 节点: string; 负责人: string; 沟通: number };
  发起人: string; 发起人id: string; 发起: Date; 到期: Date; 结束: Date | null; mergeId: string | null;
  确认人: { userId: string; 名: string; 层级: string }[];
};

async function 跨并行们(where: Prisma.EntProjectMergeRequestWhereInput, 只留我是确认人?: string): Promise<跨并申请一条[]> {
  if (!企业版()) return [];
  const 行们 = (await 看全部(() => prisma.entProjectMergeRequest.findMany({ where, orderBy: { at: "desc" }, take: 50 })))
    .filter((r) => !只留我是确认人 || 读JSON<{ userId: string }[]>(r.confirmerIds, []).some((x) => x.userId === 只留我是确认人));
  if (!行们.length) return [];
  const 项ids = [...new Set(行们.flatMap((r) => [r.fromProjectId, r.intoProjectId]))];
  const 确 = 行们.map((r) => ({ r, 们: 读JSON<{ userId: string; 层级: string }[]>(r.confirmerIds, []) }));
  const 人ids = [...new Set([...行们.flatMap((r) => [r.byUserId, r.fromOwnerId, r.intoOwnerId]), ...确.flatMap((x) => x.们.map((c) => c.userId))])];
  const [项目们, 人们, 客户们, 沟通们] = await 看全部(() => Promise.all([
    prisma.project.findMany({ where: { id: { in: 项ids } }, select: { id: true, name: true, node: true } }),
    prisma.user.findMany({ where: { id: { in: 人ids } }, select: { id: true, name: true } }),
    prisma.customer.findMany({ where: { id: { in: [...new Set(行们.map((r) => r.customerId))] } }, select: { id: true, name: true, shortName: true, customerNo: true } }),
    prisma.followUpProject.groupBy({ by: ["projectId"], where: { projectId: { in: 项ids } }, _count: { _all: true } }),
  ]));
  const 项 = new Map(项目们.map((p) => [p.id, p]));
  const 叫 = new Map(人们.map((u) => [u.id, u.name]));
  const 客 = new Map(客户们.map((c) => [c.id, c]));
  const 数 = new Map(沟通们.map((g) => [g.projectId, g._count._all]));
  return 确.map(({ r, 们 }) => {
    const 快 = 读JSON<{ 项目?: Record<string, { 名?: string }> }>(r.snapshot, {}).项目 ?? {};
    const 边 = (id: string, 负责人: string) => ({ id, 名: 项.get(id)?.name || 快[id]?.名 || "未命名项目", 节点: 项.get(id)?.node ?? "", 负责人: 叫.get(负责人) ?? "同事", 沟通: 数.get(id) ?? 0 });
    const c = 客.get(r.customerId);
    return {
      id: r.id, 状态: r.status, 原因: r.reason, 客户: c ? 通知里的客户名(c) : "一位客户",
      留下: 边(r.intoProjectId, r.intoOwnerId), 并掉: 边(r.fromProjectId, r.fromOwnerId),
      发起人: 叫.get(r.byUserId) ?? "同事", 发起人id: r.byUserId, 发起: r.at, 到期: r.expiresAt, 结束: r.endedAt, mergeId: r.mergeId,
      确认人: 们.map((c2) => ({ userId: c2.userId, 名: 叫.get(c2.userId) ?? "同事", 层级: c2.层级 })),
    };
  });
}

/** 等我确认的：待确认、我在确认人名单里 */
export async function 等我确认的跨并申请(): Promise<跨并申请一条[]> {
  const me = await requireUser();
  return 跨并行们({ status: 跨并状态.待确认, confirmerIds: { contains: me.id } }, me.id);
}

/** 我发起的：各种状态都列 */
export async function 我发起的跨并申请(): Promise<跨并申请一条[]> {
  const me = await requireUser();
  return 跨并行们({ byUserId: me.id });
}
