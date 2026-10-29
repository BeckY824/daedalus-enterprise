"use server";

/**
 * 企业版项目关联客户 / 联系人的写（2026-10-29 P17）。规矩和读写在 lib/project/relate.ts，这里只管登录、开关、操作日志和刷新。
 * 挑客户用客户页那个 搜客户（customers/[id]/pick.ts），挑联系人用这里的 搜项目联系人
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 引用联系人 } from "@/lib/project/relate-names";
import { 加关联客户, 改客户身份, 解除关联客户, 加关联联系人, 改联系人角色立场, 解除关联联系人 } from "@/lib/project/relate";

const 没开 = { ok: false as const, error: "项目模式没开：请老板在「设置 → 业务配置」里打开" };

async function 开着(): Promise<boolean> {
  return (await getBusiness()).projectMode === true;
}

/** 项目页、项目列表、这几位客户的页（客户页上有「参与的项目」）都刷新 */
function 刷新(projectId: string, ...customerIds: (string | null | undefined)[]) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  for (const c of new Set(customerIds)) if (c) revalidatePath(`/customers/${c}`);
}

async function 记一笔(me: Awaited<ReturnType<typeof requireUser>>, projectId: string, 说: string, 客户?: string | null) {
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
  await recordAudit({ user: me, action: "update", entity: "Project", entityId: projectId, summary: `编辑项目「${p?.name ?? ""}」：${说}` });
  刷新(projectId, p?.customerId, 客户);
}

const 连 = (xs: unknown) => (Array.isArray(xs) && xs.length ? xs.filter((x) => typeof x === "string").join("、") : "无");

export async function 加关联客户Action(projectId: string, customerId: string, roles?: string[] | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加关联客户(me, projectId, customerId, roles);
    if (!r.ok) return r;
    await 记一笔(me, projectId, `关联客户「${r.名}」，身份 ${连(roles)}`, customerId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

export async function 改客户身份Action(projectId: string, customerId: string, roles: string[] | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 改客户身份(me, projectId, customerId, roles);
    if (!r.ok) return r;
    if (r.变了) await 记一笔(me, projectId, `「${r.名}」的项目身份改成 ${连(roles)}`, customerId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

export async function 解除关联客户Action(projectId: string, customerId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 解除关联客户(me, projectId, customerId);
    if (!r.ok) return r;
    await 记一笔(me, projectId, `解除关联客户「${r.名}」`, customerId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

export async function 加关联联系人Action(projectId: string, contactId: string, 改?: { roles?: string[] | null; stance?: string | null }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加关联联系人(me, projectId, contactId, 改 ?? {});
    if (!r.ok) return r;
    await 记一笔(me, projectId, `关联联系人「${r.名}」`);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

export async function 改联系人角色立场Action(projectId: string, contactId: string, 改: { roles?: string[] | null; stance?: string | null }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 改联系人角色立场(me, projectId, contactId, 改);
    if (!r.ok) return r;
    if (r.变了) {
      const 说 = [改 && "roles" in 改 ? `项目角色改成 ${连(改.roles)}` : "", 改 && "stance" in 改 ? `项目立场改成 ${改.stance || "无"}` : ""].filter(Boolean).join("，");
      await 记一笔(me, projectId, `「${r.名}」的${说}`);
    }
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

export async function 解除关联联系人Action(projectId: string, contactId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 解除关联联系人(me, projectId, contactId);
    if (!r.ok) return r;
    await 记一笔(me, projectId, `解除关联联系人「${r.名}」`);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

export type 可挑联系人 = { id: string; 名: string; 附注: string | null };

/**
 * 加关联联系人时挑人：没输字给这个项目主客户、关联客户名下的人（多半就是要加的）；输了字按姓名或客户名搜，
 * 项目牵着的那几家的人排前面。只回看得到的（限定层：联系人跟主客户走），号码不出（只给职位当附注）
 */
export async function 搜项目联系人(projectId: string, 关键词: string): Promise<可挑联系人[]> {
  await requireUser();
  if (!企业版() || typeof projectId !== "string" || typeof 关键词 !== "string") return [];
  const p = await prisma.project.findFirst({ where: { id: projectId }, select: { customerId: true, contactId: true } });
  if (!p) return [];
  const 牵着 = new Set([p.customerId, ...(await 看全部(() => prisma.projectCustomer.findMany({ where: { projectId }, select: { customerId: true } }))).map((x) => x.customerId)]);
  const 已有 = new Set([p.contactId, ...(await 看全部(() => prisma.projectContact.findMany({ where: { projectId }, select: { contactId: true } }))).map((x) => x.contactId)].filter(Boolean));
  const 词 = 关键词.trim().slice(0, 50);
  const rows = await prisma.contact.findMany({
    where: 词 ? { OR: [{ name: { contains: 词 } }, { customer: { name: { contains: 词 } } }, { customer: { shortName: { contains: 词 } } }] } : { customerId: { in: [...牵着] } },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    take: 40,
    select: { id: true, name: true, gender: true, position: true, customerId: true, customer: { select: { id: true, name: true, shortName: true } } },
  });
  return rows
    .filter((c) => !已有.has(c.id))
    .sort((a, b) => Number(牵着.has(b.customerId)) - Number(牵着.has(a.customerId)))
    .slice(0, 20)
    .map((c) => ({ id: c.id, 名: 引用联系人(c), 附注: [c.name, c.position].filter(Boolean).join(" · ") || null }));
}
