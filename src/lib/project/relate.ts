/**
 * 企业版项目关联客户 / 联系人（2026-10-29 P17，迁移 094 / 095）。
 *
 * 一个项目除了主客户（Project.customerId）还牵着几家别的客户——总包、分包、投资、监理……每家在这个项目里是哪一方（项目身份，多选）
 * 记在关联那一行上，不记在客户身上：同一家在 A 项目是总包、在 B 项目是业主。联系人同理：项目角色（多选）+ 项目立场（单选，
 * 和我方销售的关系）记在 项目-联系人 那一行上。
 *
 * 主客户、主联系人不搬进关联表：Project.customerId / contactId 意思不变、照旧在「编辑项目」里换。
 * 关联客户块里主客户总排第一、标「主客户」，给它勾身份时才 upsert 一行（主那行解除不了）；没勾过就没有那行——所以不用回填。
 * 主联系人一样；换了主联系人，原来那位勾过的行留着、变成普通关联。
 *
 * 谁能改：同 改项目画像（能管项目：负责人本人、老板、主管；公海里的先领取）。
 * 能加谁：客户得是我看得到的（限定层 customer.findUnique）；联系人得是我看得到的（主客户看得到、或挂在一位看得到的客户上，
 * 同 联系人挂靠 看得到的人）。只读的同事客户（虚线下属、互看）也能挂：挂上去不改那位客户本身。
 * 谁能看：项目页上 露客户 才给这一块（同画像）；每一行再认一遍（主客户按 露客户，别家只按限定层），看不到的那家只写「同事的客户」、
 * 不给名字也不给链接。
 *
 * 选项来自企业字典 projCustRole / projContactRole / projStance（设置里改、能停用）：新选的得是启用着的，已经存着、后来停用的
 * 不动就留着（同 改项目画像）。字典校验要读库，放在事务外
 */
import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { 看全部 } from "../team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选项, 选的原因, type 字典种类 } from "@/lib/enterprise/dict";
import { 能管项目, 露客户, 看得到的客户 } from "./db";
import { 读产品需求 as 读多选, 存产品需求 as 存多选 } from "./profile-rules";
import { 客户显名, 引用联系人, 短号, 概览名称 } from "./relate-names";
import type { 阶段字典 } from "./stage-dict";

type 谁 = { id: string; role: string };
type 结果 = { ok: true } | { ok: false; error: string };

/** 一个项目最多挂几家客户、几位联系人（不含主的）：再多就不是「这个项目里的人」了，界面也摆不下 */
export const 关联上限 = 30;

const 关着 = { ok: false as const, error: "此版本没有项目关联" };
const 项目不在 = { ok: false as const, error: "这个项目已经不在了，刷新看看" };
const 客户不在 = { ok: false as const, error: "这位客户已经不在了（或你看不到），刷新看看" };
const 人不在 = { ok: false as const, error: "这位联系人已经不在了（或你看不到），刷新看看" };
const 已关联 = { ok: false as const, error: "已经关联过了，刷新看看" };
const 管不了 = (p: { pooledAt: Date | null }) => ({ ok: false as const, error: p.pooledAt ? "这个项目在公海里，先领取再改" : "只有项目负责人、老板或主管能改" });

/** 多选：要是字符串数组；新选的得在启用着的里，已经存着的（停用了也算）不再对字典 */
async function 认多选(kind: 字典种类, 名: string, v: unknown, 已有: readonly string[]): Promise<{ ok: true; 值: string | null } | { ok: false; error: string }> {
  if (v != null && (!Array.isArray(v) || v.some((x) => typeof x !== "string"))) return { ok: false, error: `${名}要选列表里的项` };
  const 选的 = ((v as string[] | null) ?? []).map((x) => x.trim()).filter(Boolean);
  if (!选的.length) return { ok: true, 值: null };
  const 能选 = await 可选项(kind);
  const 不认 = 选的.find((x) => !已有.includes(x) && !能选.includes(x));
  if (不认) return { ok: false, error: `「${不认}」不在${名}里（可能刚被停用），刷新后再选` };
  return { ok: true, 值: 存多选(选的) };
}

/** 单选（项目立场）：没换原样留，换了对字典；空 = 清掉 */
async function 认立场(v: unknown, 原: string | null): Promise<{ ok: true; 值: string | null } | { ok: false; error: string }> {
  if (v != null && typeof v !== "string") return { ok: false, error: "项目立场要选列表里的项" };
  const t = typeof v === "string" ? v.trim() : "";
  if (t && t === 原) return { ok: true, 值: t };
  return 选的原因("projStance", t);
}

/** 事务外按可见范围读项目：看不到的项目和不存在一样 */
async function 读项目(projectId: unknown) {
  if (typeof projectId !== "string" || !projectId) return null;
  return prisma.project.findFirst({ where: { id: projectId }, select: { id: true, customerId: true, contactId: true, ownerId: true, pooledAt: true } });
}

/** 联系人看不看得到（同 customers/[id]/contact-link-actions.ts 看得到的人）：主客户看得到，或挂在一位看得到的客户上 */
async function 看得到的人(contactId: unknown) {
  if (typeof contactId !== "string" || !contactId) return null;
  const 人 = await 看全部(() => prisma.contact.findUnique({ where: { id: contactId }, select: { id: true, name: true, gender: true, customer: { select: { id: true, name: true, shortName: true } } } }));
  if (!人) return null;
  const 主见 = await prisma.contact.findUnique({ where: { id: contactId }, select: { id: true } });
  const 挂见 = 主见 ? null : await prisma.contactCustomer.findFirst({ where: { contactId }, select: { id: true } });
  return 主见 || 挂见 ? 人 : null;
}

// ─── 关联客户 ───

/** 加一家关联客户（可以顺手带上身份）。主客户不用加：它总在第一行，直接勾身份 */
export async function 加关联客户(me: 谁, projectId: string, customerId: string, roles?: unknown): Promise<结果 & { 名?: string }> {
  if (!企业版()) return 关着;
  const p = await 读项目(projectId);
  if (!p) return 项目不在;
  if (typeof customerId !== "string" || !customerId) return { ok: false, error: "请选一位客户" };
  if (customerId === p.customerId) return { ok: false, error: "这就是项目的主客户，直接在它那一行勾身份" };
  const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, shortName: true } });
  if (!c) return 客户不在;
  const 身份 = await 认多选("projCustRole", "项目身份", roles, []);
  if (!身份.ok) return 身份;
  return 查完再写(async (tx) => {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { ownerId: true, pooledAt: true, customerId: true } });
    if (!现) return 项目不在;
    if (!能管项目(me, 现)) return 管不了(现);
    if (现.customerId === customerId) return { ok: false as const, error: "这就是项目的主客户，直接在它那一行勾身份" };
    if (await tx.projectCustomer.findFirst({ where: { projectId: p.id, customerId }, select: { id: true } })) return 已关联;
    const 已有 = await tx.projectCustomer.count({ where: { projectId: p.id, customerId: { not: 现.customerId } } });
    if (已有 >= 关联上限) return { ok: false as const, error: `一个项目最多关联 ${关联上限} 家客户` };
    try {
      await tx.projectCustomer.create({ data: { projectId: p.id, customerId, roles: 身份.值 } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return 已关联;
      throw e;
    }
    return { ok: true as const, 名: 客户显名(c) };
  });
}

/** 改一家的项目身份：主客户第一次勾时 upsert 一行；别的得已经关联着 */
export async function 改客户身份(me: 谁, projectId: string, customerId: string, roles: unknown): Promise<结果 & { 名?: string; 变了?: boolean }> {
  if (!企业版()) return 关着;
  const p = await 读项目(projectId);
  if (!p) return 项目不在;
  if (typeof customerId !== "string" || !customerId) return 客户不在;
  const 行 = await prisma.projectCustomer.findFirst({ where: { projectId: p.id, customerId }, select: { roles: true } });
  if (!行 && customerId !== p.customerId) return { ok: false, error: "这家已经不在关联里了，刷新看看" };
  const 原 = 行?.roles ?? null;
  const 身份 = await 认多选("projCustRole", "项目身份", roles, 读多选(原));
  if (!身份.ok) return 身份;
  const c = await 看全部(() => prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, shortName: true } }));
  if (!c) return 客户不在;
  if (身份.值 === 原) return { ok: true, 名: 客户显名(c), 变了: false };
  return 查完再写(async (tx) => {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { ownerId: true, pooledAt: true, customerId: true } });
    if (!现) return 项目不在;
    if (!能管项目(me, 现)) return 管不了(现);
    const 有 = await tx.projectCustomer.findFirst({ where: { projectId: p.id, customerId }, select: { id: true } });
    if (有) await tx.projectCustomer.update({ where: { id: 有.id }, data: { roles: 身份.值 } });
    else if (customerId === 现.customerId) await tx.projectCustomer.create({ data: { projectId: p.id, customerId, roles: 身份.值 } });
    else return { ok: false as const, error: "这家已经不在关联里了，刷新看看" };
    return { ok: true as const, 名: 客户显名(c), 变了: true };
  });
}

/** 解除一家关联客户。主客户解不了（在「编辑项目」里换主客户） */
export async function 解除关联客户(me: 谁, projectId: string, customerId: string): Promise<结果 & { 名?: string }> {
  if (!企业版()) return 关着;
  const p = await 读项目(projectId);
  if (!p) return 项目不在;
  if (typeof customerId !== "string" || !customerId) return 客户不在;
  if (customerId === p.customerId) return { ok: false, error: "主客户解除不了，要换在「编辑项目」里换" };
  const c = await 看全部(() => prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, shortName: true } }));
  return 查完再写(async (tx) => {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { ownerId: true, pooledAt: true, customerId: true } });
    if (!现) return 项目不在;
    if (!能管项目(me, 现)) return 管不了(现);
    if (现.customerId === customerId) return { ok: false as const, error: "主客户解除不了，要换在「编辑项目」里换" };
    const n = await tx.projectCustomer.deleteMany({ where: { projectId: p.id, customerId } });
    if (!n.count) return { ok: false as const, error: "这家已经不在关联里了，刷新看看" };
    return { ok: true as const, 名: c ? 客户显名(c) : 短号(customerId) };
  });
}

// ─── 关联联系人 ───

/** 加一位关联联系人（可以顺手带上角色、立场）。主联系人不用加：它总在第一行 */
export async function 加关联联系人(me: 谁, projectId: string, contactId: string, 改: { roles?: unknown; stance?: unknown } = {}): Promise<结果 & { 名?: string }> {
  if (!企业版()) return 关着;
  const p = await 读项目(projectId);
  if (!p) return 项目不在;
  if (typeof contactId !== "string" || !contactId) return { ok: false, error: "请选一位联系人" };
  if (contactId === p.contactId) return { ok: false, error: "这就是项目的主联系人，直接在它那一行改角色、立场" };
  const 人 = await 看得到的人(contactId);
  if (!人) return 人不在;
  const 角色 = await 认多选("projContactRole", "项目角色", 改.roles, []);
  if (!角色.ok) return 角色;
  const 立场 = await 认立场(改.stance, null);
  if (!立场.ok) return 立场;
  return 查完再写(async (tx) => {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { ownerId: true, pooledAt: true, contactId: true } });
    if (!现) return 项目不在;
    if (!能管项目(me, 现)) return 管不了(现);
    if (现.contactId === contactId) return { ok: false as const, error: "这就是项目的主联系人，直接在它那一行改角色、立场" };
    if (await tx.projectContact.findFirst({ where: { projectId: p.id, contactId }, select: { id: true } })) return 已关联;
    const 已有 = await tx.projectContact.count({ where: { projectId: p.id, ...(现.contactId ? { contactId: { not: 现.contactId } } : {}) } });
    if (已有 >= 关联上限) return { ok: false as const, error: `一个项目最多关联 ${关联上限} 位联系人` };
    try {
      await tx.projectContact.create({ data: { projectId: p.id, contactId, roles: 角色.值, stance: 立场.值 } });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return 已关联;
      throw e;
    }
    return { ok: true as const, 名: 引用联系人(人) };
  });
}

/** 改一位的项目角色 / 立场（没传的不动）：主联系人第一次改时 upsert 一行；别的得已经关联着 */
export async function 改联系人角色立场(me: 谁, projectId: string, contactId: string, 改: { roles?: unknown; stance?: unknown }): Promise<结果 & { 名?: string; 变了?: boolean }> {
  if (!企业版()) return 关着;
  if (!改 || typeof 改 !== "object") return { ok: false, error: "要改什么？" };
  const p = await 读项目(projectId);
  if (!p) return 项目不在;
  if (typeof contactId !== "string" || !contactId) return 人不在;
  const 行 = await prisma.projectContact.findFirst({ where: { projectId: p.id, contactId }, select: { roles: true, stance: true } });
  if (!行 && contactId !== p.contactId) return { ok: false, error: "这位已经不在关联里了，刷新看看" };
  const 新: { roles?: string | null; stance?: string | null } = {};
  if ("roles" in 改) {
    const r = await 认多选("projContactRole", "项目角色", 改.roles, 读多选(行?.roles));
    if (!r.ok) return r;
    if (r.值 !== (行?.roles ?? null)) 新.roles = r.值;
  }
  if ("stance" in 改) {
    const s = await 认立场(改.stance, 行?.stance ?? null);
    if (!s.ok) return s;
    if (s.值 !== (行?.stance ?? null)) 新.stance = s.值;
  }
  const 人 = await 看全部(() => prisma.contact.findUnique({ where: { id: contactId }, select: { name: true, gender: true, customer: { select: { id: true, name: true, shortName: true } } } }));
  if (!人) return 人不在;
  if (!Object.keys(新).length) return { ok: true, 名: 引用联系人(人), 变了: false };
  return 查完再写(async (tx) => {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { ownerId: true, pooledAt: true, contactId: true } });
    if (!现) return 项目不在;
    if (!能管项目(me, 现)) return 管不了(现);
    const 有 = await tx.projectContact.findFirst({ where: { projectId: p.id, contactId }, select: { id: true } });
    if (有) await tx.projectContact.update({ where: { id: 有.id }, data: 新 });
    else if (contactId === 现.contactId) await tx.projectContact.create({ data: { projectId: p.id, contactId, ...新 } });
    else return { ok: false as const, error: "这位已经不在关联里了，刷新看看" };
    return { ok: true as const, 名: 引用联系人(人), 变了: true };
  });
}

/** 解除一位关联联系人。主联系人解不了（在「编辑项目」里换） */
export async function 解除关联联系人(me: 谁, projectId: string, contactId: string): Promise<结果 & { 名?: string }> {
  if (!企业版()) return 关着;
  const p = await 读项目(projectId);
  if (!p) return 项目不在;
  if (typeof contactId !== "string" || !contactId) return 人不在;
  if (contactId === p.contactId) return { ok: false, error: "主联系人解除不了，要换在「编辑项目」里换" };
  const 人 = await 看全部(() => prisma.contact.findUnique({ where: { id: contactId }, select: { name: true, gender: true, customer: { select: { id: true, name: true, shortName: true } } } }));
  return 查完再写(async (tx) => {
    const 现 = await tx.project.findUnique({ where: { id: p.id }, select: { ownerId: true, pooledAt: true, contactId: true } });
    if (!现) return 项目不在;
    if (!能管项目(me, 现)) return 管不了(现);
    if (现.contactId === contactId) return { ok: false as const, error: "主联系人解除不了，要换在「编辑项目」里换" };
    const n = await tx.projectContact.deleteMany({ where: { projectId: p.id, contactId } });
    if (!n.count) return { ok: false as const, error: "这位已经不在关联里了，刷新看看" };
    return { ok: true as const, 名: 人 ? 引用联系人(人) : 短号(contactId) };
  });
}

// ─── 读 ───

export type 关联客户行 = {
  customerId: string;
  /** 客户显名；看不到的那家是「同事的客户」 */
  名: string;
  /** 鼠标悬停看的全称（看不到的为空） */
  全称: string;
  身份: string[];
  主: boolean;
  /** 能不能点进客户页、看名字 */
  看得到: boolean;
};
export type 关联联系人行 = {
  contactId: string;
  /** 引用联系人（隶属客户|显示姓名）；看不到的那位是「同事的联系人」 */
  名: string;
  /** 原名（悬停看、看不到的为空） */
  姓名: string;
  /** 隶属客户：看得到才给，点过去 */
  customerId: string | null;
  角色: string[];
  立场: string | null;
  主: boolean;
  看得到: boolean;
};
export type 项目关联 = {
  客户们: 关联客户行[];
  联系人们: 关联联系人行[];
  /** 三个字典启用着的项（停用了还存着的界面上自己并进去） */
  选项: { 身份: string[]; 角色: string[]; 立场: string[] };
  上限: number;
};

/** 同事的客户 / 联系人：项目里挂着、我看不到的那一行怎么叫（不露名字） */
export const 看不到的客户 = "同事的客户";
export const 看不到的联系人 = "同事的联系人";

/**
 * 项目页上的关联块：主客户 / 主联系人排第一，其余按挂上的先后。
 * 调用方先按 露客户 认过这个项目（同画像），这里每一行再认一遍：看不到的只给占位名
 */
export async function 项目关联们(me: { id: string }, projectId: string): Promise<项目关联 | null> {
  if (!企业版()) return null;
  const p = await 读项目(projectId);
  if (!p) return null;
  const [客户行, 联系人行, 主联系人, 身份, 角色, 立场] = await Promise.all([
    看全部(() => prisma.projectCustomer.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" }, select: { customerId: true, roles: true, customer: { select: { id: true, name: true, shortName: true } } } })),
    看全部(() => prisma.projectContact.findMany({ where: { projectId: p.id }, orderBy: { createdAt: "asc" }, select: { contactId: true, roles: true, stance: true, contact: { select: { id: true, name: true, gender: true, customerId: true, customer: { select: { id: true, name: true, shortName: true } } } } } })),
    p.contactId ? 看全部(() => prisma.contact.findUnique({ where: { id: p.contactId! }, select: { id: true, name: true, gender: true, customerId: true, customer: { select: { id: true, name: true, shortName: true } } } })) : null,
    可选项("projCustRole"), 可选项("projContactRole"), 可选项("projStance"),
  ]);
  const 主客户 = 客户行.find((r) => r.customerId === p.customerId)?.customer
    ?? await 看全部(() => prisma.customer.findUnique({ where: { id: p.customerId }, select: { id: true, name: true, shortName: true } }));

  const 人们 = [...(主联系人 ? [主联系人] : []), ...联系人行.map((r) => r.contact)];
  const 客户id = [...new Set([p.customerId, ...客户行.map((r) => r.customerId), ...人们.map((c) => c.customerId)])];
  const 见客户 = await 看得到的客户(客户id);
  // 联系人挂在看得到的客户上也算看得到（限定层的 contactCustomer 只回看得到的客户那几行）
  const 挂见 = new Set((await prisma.contactCustomer.findMany({ where: { contactId: { in: 人们.map((c) => c.id) } }, select: { contactId: true } })).map((x) => x.contactId));
  // 「项目负责人看得到自己项目的主客户」只认主客户那一家（露客户）；关联的别家只按限定层，负责人也不例外——
  // 不然老板挂上一家同事的客户、或我后来看不到某家了，名字会从这里漏出去
  const 露 = (customerId: string) => customerId === p.customerId ? 露客户(me, { customerId, ownerId: p.ownerId, pooledAt: p.pooledAt }, 见客户) : 见客户.has(customerId);

  const 客户们: 关联客户行[] = [];
  const 一家 = (c: { id: string; name: string; shortName: string | null }, roles: string | null, 主: boolean) => {
    const 见 = 露(c.id);
    客户们.push({ customerId: c.id, 名: 见 ? 客户显名(c) : `${看不到的客户} ${短号(c.id)}`, 全称: 见 ? c.name : "", 身份: 读多选(roles), 主, 看得到: 见 });
  };
  if (主客户) 一家(主客户, 客户行.find((r) => r.customerId === p.customerId)?.roles ?? null, true);
  for (const r of 客户行) if (r.customerId !== p.customerId) 一家(r.customer, r.roles, false);

  const 联系人们: 关联联系人行[] = [];
  const 一位 = (c: NonNullable<typeof 主联系人>, row: { roles: string | null; stance: string | null } | undefined, 主: boolean) => {
    const 见 = 露(c.customerId) || 挂见.has(c.id);
    const 主客户见 = 露(c.customerId);
    联系人们.push({
      contactId: c.id,
      // 隶属客户是同事的（只是挂在我看得到的客户上）：客户那段写占位，姓名照常
      名: !见 ? `${看不到的联系人} ${短号(c.id)}` : 主客户见 ? 引用联系人(c) : 引用联系人({ ...c, customer: { id: c.customerId, name: 看不到的客户 } }),
      姓名: 见 ? c.name : "",
      customerId: 见 && 主客户见 ? c.customerId : null,
      角色: 读多选(row?.roles), 立场: row?.stance ?? null, 主, 看得到: 见,
    });
  };
  if (主联系人) 一位(主联系人, 联系人行.find((r) => r.contactId === 主联系人.id), true);
  for (const r of 联系人行) if (r.contactId !== p.contactId) 一位(r.contact, r, false);

  return { 客户们, 联系人们, 选项: { 身份, 角色, 立场 }, 上限: 关联上限 };
}

export type 参与项目行 = { projectId: string; 名: string; 身份: string[]; 主: boolean };

/**
 * 客户页「参与的项目」（只读）：这位客户以关联客户挂在哪些项目上、是哪一方。
 * 限定层按项目可见范围滤（ProjectCustomer 跟项目走，team-scope.ts），看不到的项目不出现。
 * 主客户那几行（这位客户是项目主客户、又勾过身份的）也回来，界面上并进原来的项目列表那几行里
 */
export async function 客户参与的项目(customerId: string, 字典: 阶段字典): Promise<参与项目行[] | null> {
  if (!企业版()) return null;
  const 行 = await prisma.projectCustomer.findMany({
    where: { customerId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { roles: true, project: { select: { id: true, name: true, phase: true, node: true, result: true, productNeeds: true, customerId: true, addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true } } },
  });
  return 行.map((r) => ({ projectId: r.project.id, 名: 概览名称(r.project, 字典), 身份: 读多选(r.roles), 主: r.project.customerId === customerId }));
}
