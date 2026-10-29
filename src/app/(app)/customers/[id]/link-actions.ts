"use server";

/**
 * 关联客户（企业版，2026-10-29，定稿 P5 待定 15，迁移 075）：客户页上「关联客户」卡片的三个动作。
 * 手动挑一位 + 一句说明，两边客户页都看得到同一行（一对只记一行：小 id 在 customerId，见 关联对）。不做关系图。
 * 读列表在 lib/enterprise/customer-v2-db.ts 的 关联客户们（页面服务端组件直接调）
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 看全部, 同事的客户, 只读话 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 不在了 } from "@/lib/not-there";
import { 关联对, 关联说明上限 } from "@/lib/enterprise/customer-v2";

type 结果 = { ok: true } | { ok: false; error: string };

function 规整说明(v: unknown): { ok: true; 值: string | null } | { ok: false; error: string } {
  const s = (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "") || null;
  if (s && s.length > 关联说明上限) return { ok: false, error: `关系说明最多 ${关联说明上限} 个字` };
  return { ok: true, 值: s };
}

function 刷新(...ids: string[]) {
  for (const id of ids) revalidatePath(`/customers/${id}`);
}

/**
 * 能不能在这位客户身上动关联：看得到（限定层查得到）、不是只读的同事客户 / 虚线下属客户。
 * 关联是两头的，挂的那一头（我正在看的这位）要能改；另一头只要看得到就行——挑的时候下拉里也只列看得到的
 */
async function 能改(id: string): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const c = await prisma.customer.findUnique({ where: { id }, select: { name: true } });
  if (!c) return { ok: false, error: "这位客户已经不在了（或你看不到），刷新看看" };
  if (await 同事的客户(defaultClient, id)) return { ok: false, error: await 只读话(defaultClient) };
  return { ok: true, name: c.name };
}

export async function 关联客户(customerId: string, otherId: string, note?: string | null): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: "这个版本没有关联客户" };
    if (typeof customerId !== "string" || typeof otherId !== "string") return { ok: false, error: "请选一位客户" };
    const 对 = 关联对(customerId, otherId);
    if (!对) return { ok: false, error: "不能关联客户自己" };
    const 说 = 规整说明(note);
    if (!说.ok) return 说;
    const 这位 = await 能改(customerId);
    if (!这位.ok) return 这位;
    const 那位 = await prisma.customer.findUnique({ where: { id: otherId }, select: { name: true } });
    if (!那位) return { ok: false, error: "要关联的那位客户已经不在了（或你看不到），换一位" };
    // 唯一键兜底：两个人同时点关联同一对，后到的那次落到这里
    const 有 = await 看全部(() => prisma.entCustomerLink.findUnique({ where: { customerId_otherId: 对 } }));
    if (有) return { ok: false, error: `「${这位.name}」和「${那位.name}」已经关联过了` };
    try {
      await prisma.entCustomerLink.create({ data: { ...对, note: 说.值, userId: me.id } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return { ok: false, error: `「${这位.name}」和「${那位.name}」已经关联过了` };
      throw e;
    }
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: customerId,
      summary: `关联客户：「${这位.name}」↔「${那位.name}」${说.值 ? `（${说.值}）` : ""}`,
      detail: { 客户: 这位.name, 关联到: 那位.name, 说明: 说.值 ?? "（空）" },
    });
    刷新(customerId, otherId);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

/** 取这一行，并确认我是从看得到、能改的那一头来的 */
async function 取一行(linkId: string, 从: string) {
  if (typeof linkId !== "string" || typeof 从 !== "string") return { ok: false as const, error: "这条关联已经不在了，刷新看看" };
  const 行 = await 看全部(() => prisma.entCustomerLink.findUnique({ where: { id: linkId } }));
  if (!行 || (行.customerId !== 从 && 行.otherId !== 从)) return { ok: false as const, error: "这条关联已经不在了，刷新看看" };
  const 这位 = await 能改(从);
  if (!这位.ok) return 这位;
  const 另 = 行.customerId === 从 ? 行.otherId : 行.customerId;
  const 那位 = await 看全部(() => prisma.customer.findUnique({ where: { id: 另 }, select: { name: true } }));
  return { ok: true as const, 行, 这位: 这位.name, 那位: 那位?.name ?? "（已删除）", 另 };
}

export async function 改关联说明(linkId: string, 从: string, note: string | null): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: "这个版本没有关联客户" };
    const 说 = 规整说明(note);
    if (!说.ok) return 说;
    const r = await 取一行(linkId, 从);
    if (!r.ok) return r;
    if ((r.行.note ?? null) === 说.值) return { ok: true };
    await 看全部(() => prisma.entCustomerLink.update({ where: { id: linkId }, data: { note: 说.值 } }));
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: 从,
      summary: `改关联说明：「${r.这位}」↔「${r.那位}」`,
      detail: { 原值: r.行.note ?? "（空）", 新值: 说.值 ?? "（空）" },
    });
    刷新(从, r.另);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}

export async function 取消关联(linkId: string, 从: string): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: "这个版本没有关联客户" };
    const r = await 取一行(linkId, 从);
    if (!r.ok) return r;
    await 看全部(() => prisma.entCustomerLink.deleteMany({ where: { id: linkId } }));
    await recordAudit({
      user: me, action: "update", entity: "Customer", entityId: 从,
      summary: `取消关联：「${r.这位}」↔「${r.那位}」`,
      detail: { 说明: r.行.note ?? "（空）" },
    });
    刷新(从, r.另);
    return { ok: true };
  } catch (e) {
    return 不在了(e);
  }
}
