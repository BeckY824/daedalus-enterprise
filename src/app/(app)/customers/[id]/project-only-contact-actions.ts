"use server";
/**
 * 受限客户详情里的联系人（只负责项目的人，用户 11-12 定；集合见 lib/enterprise/project-only-customers.ts）：
 *   - 新增：自动挂到自己当前那个项目上；不能设主要联系人
 *   - 改：只改自己建的、挂在自己项目上的那几位（Contact.createdById，迁移 135）；客户原有的联系人不能改、不能删
 *   - 第一期不做删除。不放开「加关联联系人」「搜项目联系人」：那样把客户原有的联系人挂到自己项目上就拿得到号码
 * 客户本身看不到，所以这里绕开限定层写（看全部），每一步前先按「仅项目」集合核过；管理员只读、切换视图的拦照旧在限定层里。
 * 撞号提示不露别的联系人和客户是谁（客户本身他就看不到）
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 看全部, 读的我 } from "@/lib/team-scope";
import { 不在了 } from "@/lib/not-there";
import { hasVisibleText } from "@/lib/form-validation";
import { 认回打码号, 号键 } from "@/lib/phone";
import { 企业版 } from "@/lib/enterprise/switch";
import { 客户事项挡 } from "@/lib/enterprise/follow-perm";
import { 仅项目可见 } from "@/lib/enterprise/project-only-customers";
import { 验联系人号码们, 存联系人号码, 号码种类表, 种类叫法 } from "@/lib/enterprise/customer-v2-db";
import { 联系人查重, type 撞到的联系人 } from "@/lib/enterprise/contact-dedupe";
import { 版本冲突, 版本条件 } from "@/lib/edit-version";
import { 联系人电话, 规整, 规整企业联系人, type 联系人字段, type 企业联系人资料 } from "./contact-input";

type 交来的 = 联系人字段 & { 版本?: string | null; 企业?: 企业联系人资料 | null; 照存?: boolean };
type 结果 = { ok: true; id: string } | { ok: false; error: string; 撞了?: 撞到的联系人[] };

const 关着 = { ok: false as const, error: "这里不能改联系人" };
const 不是你的 = { ok: false as const, error: "这位客户你只负责项目：只能在自己的项目上新增联系人，改自己新增的那几位" };

function 是对象(v: unknown): v is 交来的 {
  return !!v && typeof v === "object" && !Array.isArray(v) && typeof (v as { name?: unknown }).name === "string";
}

/** 原有的号（编辑时）：认回打码号、只查新出现的号用 */
type 原联系人 = { phone: string | null; email: string | null; wechat: string | null; contactMethods: { kind: string; value: string; numberKey: string | null }[] };

/** 校验 + 规整 + 查重（同 saveContact 的口径），撞了只说号码撞了、不说撞了谁 */
async function 准备(input: 交来的, 原: 原联系人 | null, 跳过的联系人?: string) {
  if (!hasVisibleText(input.name)) return { ok: false as const, error: "请填写联系人姓名" };
  const 企 = 规整企业联系人(input.企业 ?? {});
  if (!企.ok) return 企;
  const 原号们 = [...(原?.contactMethods ?? []), ...(原?.phone ? [{ kind: "phone", value: 原.phone }] : [])];
  const 交的号们 = input.企业 && Array.isArray(input.企业.号码们)
    ? input.企业.号码们.map((r) => (r && typeof r.value === "string" && r.value.includes("*")
        ? { ...r, value: 原号们.find((o) => o.kind === r.kind && 认回打码号(r.value, o.value) === o.value)?.value ?? r.value }
        : r))
    : null;
  const 号 = 交的号们 ? await 验联系人号码们(交的号们, 原?.contactMethods.map((x) => x.kind) ?? []) : null;
  if (号 && !号.ok) return 号;
  const 电话 = 号 ? ({ ok: true, phone: null } as const) : 联系人电话(input.phone, 原?.phone);
  if (!电话.ok) return 电话;
  const 老键 = (kind: string, v: string | null | undefined) => (v ? (kind === "phone" ? 号键(v) : v.trim().toLowerCase()) : "");
  const 查的行们 = 号
    ? 号.行们
    : ([["phone", 电话.phone], ["email", input.email], ["wechat", input.wechat]] as const)
        .map(([kind, v]) => ({ kind, value: (v ?? "").trim(), numberKey: 老键(kind, v) }))
        .filter((x) => x.numberKey);
  if (查的行们.length && input.照存 !== true) {
    const 原有 = new Set((原?.contactMethods ?? []).map((x) => `${x.kind}|${x.numberKey}`));
    if (原) for (const [kind, v] of [["phone", 原.phone], ["email", 原.email], ["wechat", 原.wechat]] as const) {
      const 键 = 老键(kind, v);
      if (键) 原有.add(`${kind}|${键}`);
    }
    const 新的 = 查的行们.filter((x) => !原有.has(`${x.kind}|${x.numberKey}`));
    const 撞了 = 新的.length ? await 联系人查重(defaultClient, 新的, await 读的我(defaultClient), 跳过的联系人) : [];
    if (撞了.length) {
      const 表 = await 号码种类表();
      const 头 = 撞了[0];
      return {
        ok: false as const,
        error: `${种类叫法(表, 头.kind)} ${头.value} 已经记在别的联系人身上，本次没保存。确认是另一个人（比如共用的总机）可以「仍然保存」`,
        // 不说撞了谁、在哪位客户下（这家客户他本来就看不到）
        撞了: 撞了.map((x) => ({ contactId: null, name: null, customerId: null, customerName: null, 同事: "同事", kind: x.kind, value: x.value })),
      };
    }
  }
  const { phone: _p, ...其余 } = 规整(input);
  return { ok: true as const, data: { ...其余, phone: 电话.phone, ...企.data }, 号 };
}

/** 新增联系人：挂到这位客户名下、挂到我当前这个项目上（项目要在我的「仅项目」集合里） */
export async function 新增仅项目联系人Action(customerId: unknown, projectId: unknown, input: unknown): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    if (typeof customerId !== "string" || typeof projectId !== "string" || !是对象(input)) return { ok: false, error: "参数不对" };
    const 挡 = await 客户事项挡(me, customerId);
    if (挡) return { ok: false, error: 挡 };
    const 我的 = await 仅项目可见(me, customerId);
    if (!我的?.includes(projectId)) return 不是你的;
    const 备 = await 准备(input, null);
    if (!备.ok) return 备;
    const { data, 号 } = 备;
    const id = await 看全部(() => prisma.$transaction(async (tx) => {
      const c = await tx.contact.create({ data: { ...data, isPrimary: false, customerId, createdById: me.id }, select: { id: true } });
      await tx.contactCustomer.create({ data: { contactId: c.id, customerId } });
      if (号) await tx.contact.update({ where: { id: c.id }, data: await 存联系人号码(tx, customerId, c.id, 号.行们) });
      await tx.projectContact.create({ data: { projectId, contactId: c.id } });
      return c.id;
    }));
    const 项目 = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }));
    await recordAudit({
      user: me, action: "create", entity: "Contact", entityId: id,
      summary: `在项目「${项目?.name ?? ""}」上新增联系人「${data.name}」`,
      detail: { 姓名: data.name, 职位: data.position, 项目: 项目?.name ?? null },
    });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true, id };
  } catch (e) {
    return 不在了(e);
  }
}

/** 改联系人：只改我建的、挂在我（仅项目）项目上的；不收主要联系人；版本闸门 */
export async function 改仅项目联系人Action(contactId: unknown, input: unknown): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return 关着;
    if (typeof contactId !== "string" || !是对象(input)) return { ok: false, error: "参数不对" };
    const 原 = await 看全部(() => prisma.contact.findFirst({
      where: { id: contactId, deletedAt: null },
      select: { id: true, customerId: true, createdById: true, phone: true, email: true, wechat: true, contactMethods: { select: { kind: true, value: true, numberKey: true } } },
    }));
    if (!原 || 原.createdById !== me.id) return 不是你的;
    const 挡 = await 客户事项挡(me, 原.customerId);
    if (挡) return { ok: false, error: 挡 };
    const 我的 = await 仅项目可见(me, 原.customerId);
    if (!我的?.length) return 不是你的;
    const 在我项目上 = await 看全部(() => prisma.project.count({
      where: { id: { in: 我的 }, OR: [{ contactId }, { contactLinks: { some: { contactId } } }] },
    }));
    if (!在我项目上) return 不是你的;
    const 备 = await 准备(input, 原, contactId);
    if (!备.ok) return 备;
    const { data, 号 } = 备;
    const 写了 = await 看全部(() => prisma.$transaction(async (tx) => {
      const r = await tx.contact.updateMany({ where: { id: contactId, createdById: me.id, deletedAt: null, ...版本条件(input.版本) }, data });
      if (r.count === 0) return false;
      if (号) await tx.contact.update({ where: { id: contactId }, data: await 存联系人号码(tx, 原.customerId, contactId, 号.行们) });
      return true;
    }));
    if (!写了) return { ok: false, error: 版本冲突 };
    await recordAudit({
      user: me, action: "update", entity: "Contact", entityId: contactId,
      summary: `修改自己新增的联系人「${data.name}」`,
      detail: { 姓名: data.name, 职位: data.position },
    });
    revalidatePath(`/customers/${原.customerId}`);
    return { ok: true, id: contactId };
  } catch (e) {
    return 不在了(e);
  }
}
