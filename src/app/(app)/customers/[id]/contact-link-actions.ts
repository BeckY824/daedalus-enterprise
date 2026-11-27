"use server";

/**
 * 企业版联系人挂多位客户（2026-10-29 P13 第 1 条，迁移 090）：一位联系人一个主客户（Contact.customerId，号码、跟进、
 * 「主要联系人」都跟主客户走），另外还能挂到别的已有客户上（ContactCustomer 一行一位，带一句职位 / 关系说明）。
 * 四个动作：挂到客户、改挂靠说明、解除挂靠、换主客户。主客户那一行解不掉，只能换。
 *
 * 权限（11-18 审核 P0-2 收紧）：要动的客户得「能改」，不只是看得到——看得到、不是只读的同事 / 虚线下属客户之外，
 * 再过 客户事项挡（同 saveContact、detachContact：负责人本人或系统管理员，另放这位客户下在推项目的负责人；公海里的先领）。
 * 原来只判看得到：限定层的写范围含下属和公海，销管能动下属客户的、谁都能把公海客户的联系人连号码搬到自己名下。
 * - 挂到客户：挂到的那位、联系人的主客户，两头都要能改（主客户看不到 / 不能改的，不能把人挂过来）
 * - 解除 / 改说明：挂的那一位客户要能改；主客户那头不用（这行挂靠记在挂的那位身上，联系人本身不动）
 * - 换主客户：新旧两位都要能改
 * 读列表在 lib/enterprise/customer-v2-db.ts 的 客户的联系人们
 *
 * 另有 设为主号（12-15 第三批 B，P-合并-05）：联系人「⋯」里点哪个手机号设成主号（电话格）。谁能设 = 能改这位联系人的人，
 * 同 saveContact 那两道（客户看得到、不是只读的，再过 客户事项挡）；只读管理员、销售教练、切换视图都在这两道里拦
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 看全部, 同事的客户, 只读话, 只读客户 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 不在了 } from "@/lib/not-there";
import { 挂靠说明上限, 每人最多号码 } from "@/lib/enterprise/customer-v2";
import { 客户事项挡 } from "@/lib/enterprise/follow-perm";
import { 客户显名, 全称或显名, 显名列 } from "@/lib/enterprise/customer-title";
import { 设默认号 } from "@/lib/enterprise/default-number";

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

/** 能不能在这位客户身上挂 / 解联系人：看得到、不是只读的同事客户 / 虚线下属客户，且过 客户事项挡（能改这位客户） */
async function 能改(me: Awaited<ReturnType<typeof requireUser>>, id: string): Promise<{ ok: true; name: string; 日志名: string } | { ok: false; error: string }> {
  if (typeof id !== "string" || !id) return { ok: false, error: "请选一位客户" };
  const c = await prisma.customer.findUnique({ where: { id }, select: 显名列 });
  if (!c) return { ok: false, error: "这位客户已经不在了（或你看不到），刷新看看" };
  if (await 同事的客户(defaultClient, id)) return { ok: false, error: await 只读话(defaultClient) };
  const 挡 = await 客户事项挡(me, id);
  if (挡) return { ok: false, error: 挡 };
  // 全称选填（11-19）：提示里叫显名（简称 → 全称 → 客户编号），日志里叫全称或显名（有全称照旧写全称），都不出空引号
  return { ok: true, name: 客户显名(c), 日志名: 全称或显名(c) };
}

/** 联系人看不看得到：主客户看得到，或挂在一位看得到的客户上。看得到才回名字和主客户 */
async function 看得到的人(contactId: unknown) {
  if (typeof contactId !== "string" || !contactId) return null;
  const 人 = await 看全部(() => prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true, customerId: true, customer: { select: 显名列 } } }));
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
    const 这位 = await 能改(me, customerId);
    if (!这位.ok) return 这位;
    if (人.customerId === customerId) return { ok: false, error: `「${这位.name}」就是「${人.name}」的主客户` };
    // 主客户那头也要能改：不然公海客户、下属客户的联系人能借挂靠挪到自己客户名下（11-18 审核 P0-2）
    const 主 = await 能改(me, 人.customerId);
    if (!主.ok) return 主;
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
      summary: `把联系人「${人.name}」（主客户「${全称或显名(人.customer)}」）挂到「${这位.日志名}」${说.值 ? `（${说.值}）` : ""}`,
      detail: { 联系人: 人.name, 主客户: 全称或显名(人.customer), 挂到: 这位.日志名, 说明: 说.值 ?? "（空）" },
    });
    刷新(customerId, 人.customerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 取一行挂靠，并确认挂的那位客户我能改 */
async function 取一行(me: Awaited<ReturnType<typeof requireUser>>, linkId: unknown) {
  if (typeof linkId !== "string" || !linkId) return { ok: false as const, error: "这条挂靠已经不在了，刷新看看" };
  const 行 = await 看全部(() =>
    prisma.contactCustomer.findUnique({ where: { id: linkId }, include: { contact: { select: { name: true, customerId: true } } } }));
  if (!行) return { ok: false as const, error: "这条挂靠已经不在了，刷新看看" };
  const 这位 = await 能改(me, 行.customerId);
  if (!这位.ok) return 这位;
  return { ok: true as const, 行, 客户名: 这位.日志名 };
}

export async function 改挂靠说明(linkId: string, note: string | null): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    const 说 = 规整说明(note);
    if (!说.ok) return 说;
    const r = await 取一行(me, linkId);
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
    const r = await 取一行(me, linkId);
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
    const 原 = await 能改(me, 人.customerId);
    if (!原.ok) return 原;
    const 新 = await 能改(me, newCustomerId);
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
      summary: `联系人「${人.name}」的主客户从「${原.日志名}」换成「${新.日志名}」（「${原.日志名}」留作挂靠）`,
      detail: { 联系人: 人.name, 原主客户: 原.日志名, 新主客户: 新.日志名 },
    });
    刷新(人.customerId, newCustomerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/**
 * 设为主号：把这位联系人的某个手机号（号码几行里那一行的 id，界面上的号可能打了码）写进电话格。
 * 原来的主号照样留在号码几行里（没有就补一行），两条都不删；查重、撞号照旧按全部号码比。挂靠过来的到主客户那头设
 */
export async function 设为主号(contactId: string, 号码id: string): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    if (typeof contactId !== "string" || !contactId) return 人不在;
    if (typeof 号码id !== "string" || !号码id) return { ok: false, error: "请选一个号码" };
    // 主客户那一头要看得到（限定层查）、不是只读的，再过 客户事项挡（同 saveContact）
    const 人 = await prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, name: true, customerId: true, customer: { select: { ...显名列, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } } } },
    });
    if (!人) return 人不在;
    if (await 只读客户(defaultClient, 人.customer)) return { ok: false, error: await 只读话(defaultClient) };
    const 挡 = await 客户事项挡(me, 人.customerId);
    if (挡) return { ok: false, error: 挡 };
    const r = await prisma.$transaction((tx) => 设默认号(tx, contactId, 号码id));
    if (!r.ok) return r;
    if (r.没变) return { ok: true };
    await recordAudit({
      user: me, action: "update", entity: "Contact", entityId: contactId,
      summary: `把${全称或显名(人.customer)}的联系人「${人.name || "—"}」的主号换成 ${r.新}`,
      detail: { 原主号: r.原 ?? "（空）", 新主号: r.新, ...(r.补了原号 ? { 说明: "原主号补进号码几行" } : r.原号满了 ? { 说明: `号码已记满 ${每人最多号码} 个，原主号没补进号码几行，只记在这条里` } : {}) },
    });
    刷新(人.customerId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}
