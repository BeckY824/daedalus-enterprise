"use server";

/**
 * 企业版联系人挂多位客户（2026-10-29 P13 第 1 条，迁移 090）：一位联系人一个主客户（Contact.customerId，号码、跟进、
 * 「主要联系人」都跟主客户走），另外还能挂到别的已有客户上（ContactCustomer 一行一位，带一句职位 / 关系说明）。
 * 四个动作：挂到客户、改挂靠说明、解除挂靠、换主客户。主客户那一行解不掉，只能换。
 *
 * 权限：业务员只能动自己负责的 + 公海客户（同 关联客户 的 能改）。挂的时候联系人自己要看得到（主客户看得到，或已挂在看得到的客户上）；
 * 解除 / 改说明看挂的那一位客户；换主客户新旧两位都要能改。读列表在 lib/enterprise/customer-v2-db.ts 的 客户的联系人们
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 看全部, 同事的客户, 只读话 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 不在了 } from "@/lib/not-there";
import { 挂靠说明上限 } from "@/lib/enterprise/customer-v2";

type 结果 = { ok: true } | { ok: false; error: string };
const 关着 = { ok: false as const, error: "这个版本没有联系人挂靠" };
const 人不在 = { ok: false as const, error: "这位联系人已经不在了（或你看不到），刷新看看" };

function 规整说明(v: unknown): { ok: true; 值: string | null } | { ok: false; error: string } {
  const s = (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "") || null;
  if (s && s.length > 挂靠说明上限) return { ok: false, error: `职位 / 关系说明最多 ${挂靠说明上限} 个字` };
  return { ok: true, 值: s };
}

function 刷新(...ids: (string | null | undefined)[]) {
  for (const id of ids) if (id) revalidatePath(`/customers/${id}`);
  revalidatePath("/contacts");
}

/** 能不能在这位客户身上挂 / 解联系人：看得到、不是只读的同事客户 / 虚线下属客户（同 link-actions.ts 的 能改） */
async function 能改(id: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (typeof id !== "string" || !id) return { ok: false, error: "请选一位客户" };
  const c = await prisma.customer.findUnique({ where: { id }, select: { name: true } });
  if (!c) return { ok: false, error: "这位客户已经不在了（或你看不到），刷新看看" };
  if (await 同事的客户(defaultClient, id)) return { ok: false, error: await 只读话(defaultClient) };
  return { ok: true, name: c.name };
}

/** 联系人看不看得到：主客户看得到，或挂在一位看得到的客户上。看得到才回名字和主客户 */
async function 看得到的人(contactId: unknown) {
  if (typeof contactId !== "string" || !contactId) return null;
  const 人 = await 看全部(() => prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true, customerId: true, customer: { select: { name: true } } } }));
  if (!人) return null;
  const 主见 = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
  const 挂见 = 主见 ? null : await prisma.contactCustomer.findFirst({ where: { contactId }, select: { id: true } });
  return 主见 || 挂见 ? 人 : null;
}

export async function 挂到客户(contactId: string, customerId: string, note?: string | null): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    const 说 = 规整说明(note);
    if (!说.ok) return 说;
    const 人 = await 看得到的人(contactId);
    if (!人) return 人不在;
    const 这位 = await 能改(customerId);
    if (!这位.ok) return 这位;
    if (人.customerId === customerId) return { ok: false, error: `「${这位.name}」就是「${人.name}」的主客户` };
    const 已挂 = { ok: false as const, error: `「${人.name}」已经挂在「${这位.name}」上了` };
    const 有 = await 看全部(() => prisma.contactCustomer.findUnique({ where: { contactId_customerId: { contactId, customerId } } }));
    if (有) return 已挂;
    try {
      await 看全部(() => prisma.contactCustomer.create({ data: { contactId, customerId, note: 说.值 } }));
    } catch (e) {
      // 唯一键兜底：两个人同时挂同一对
      if ((e as { code?: string })?.code === "P2002") return 已挂;
      throw e;
    }
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: customerId,
      summary: `把联系人「${人.name}」（主客户「${人.customer.name}」）挂到「${这位.name}」${说.值 ? `（${说.值}）` : ""}`,
      detail: { 联系人: 人.name, 主客户: 人.customer.name, 挂到: 这位.name, 说明: 说.值 ?? "（空）" },
    });
    刷新(customerId, 人.customerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 取一行挂靠，并确认挂的那位客户我能改 */
async function 取一行(linkId: unknown) {
  if (typeof linkId !== "string" || !linkId) return { ok: false as const, error: "这条挂靠已经不在了，刷新看看" };
  const 行 = await 看全部(() =>
    prisma.contactCustomer.findUnique({ where: { id: linkId }, include: { contact: { select: { name: true, customerId: true } } } }));
  if (!行) return { ok: false as const, error: "这条挂靠已经不在了，刷新看看" };
  const 这位 = await 能改(行.customerId);
  if (!这位.ok) return 这位;
  return { ok: true as const, 行, 客户名: 这位.name };
}

export async function 改挂靠说明(linkId: string, note: string | null): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    const 说 = 规整说明(note);
    if (!说.ok) return 说;
    const r = await 取一行(linkId);
    if (!r.ok) return r;
    if ((r.行.note ?? null) === 说.值) return { ok: true };
    await 看全部(() => prisma.contactCustomer.update({ where: { id: r.行.id }, data: { note: 说.值 } }));
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: r.行.customerId,
      summary: `改联系人「${r.行.contact.name}」在「${r.客户名}」的职位 / 关系说明`,
      detail: { 原值: r.行.note ?? "（空）", 新值: 说.值 ?? "（空）" },
    });
    刷新(r.行.customerId, r.行.contact.customerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 解除挂靠(linkId: string): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    const r = await 取一行(linkId);
    if (!r.ok) return r;
    if (r.行.customerId === r.行.contact.customerId) return { ok: false, error: "主客户不能解除，只能换成别的客户" };
    await 看全部(() => prisma.contactCustomer.deleteMany({ where: { id: r.行.id } }));
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: r.行.customerId,
      summary: `把联系人「${r.行.contact.name}」从「${r.客户名}」解除挂靠`,
      detail: { 联系人: r.行.contact.name, 说明: r.行.note ?? "（空）" },
    });
    刷新(r.行.customerId, r.行.contact.customerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 换主客户：新主客户得是这位已挂着的或别的已有客户。号码几行（ContactMethod 记着客户）跟到新主客户；
 * 原主客户留成一行挂靠（人还在那边，只是不当主）；「主要联系人」说的是主客户那边的，换过去先摘掉。跟进记录不动
 */
export async function 换主客户(contactId: string, newCustomerId: string): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    if (typeof contactId !== "string" || !contactId) return 人不在;
    // 主客户那一头要能改：限定层查得到这位联系人（挂靠看得到的不算）
    const 人 = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true, customerId: true } });
    if (!人) return 人不在;
    const 原 = await 能改(人.customerId);
    if (!原.ok) return 原;
    const 新 = await 能改(newCustomerId);
    if (!新.ok) return 新;
    if (人.customerId === newCustomerId) return { ok: false, error: `「${新.name}」已经是主客户了` };
    await 看全部(() =>
      prisma.$transaction(async (tx) => {
        await tx.contact.update({ where: { id: contactId }, data: { customerId: newCustomerId, isPrimary: false } });
        await tx.contactMethod.updateMany({ where: { contactId }, data: { customerId: newCustomerId } });
        for (const customerId of [人.customerId, newCustomerId]) {
          await tx.contactCustomer.upsert({
            where: { contactId_customerId: { contactId, customerId } },
            create: { contactId, customerId },
            update: {},
          });
        }
      }));
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: newCustomerId,
      summary: `联系人「${人.name}」的主客户从「${原.name}」换成「${新.name}」（「${原.name}」留作挂靠）`,
      detail: { 联系人: 人.name, 原主客户: 原.name, 新主客户: 新.name },
    });
    刷新(人.customerId, newCustomerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}
