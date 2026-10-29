/**
 * 企业版客户与联系人改版（2026-10-29，定稿 P5）里要读写库的部分。纯函数和口子在 customer-v2.ts。
 *   级别D改C一次 —— 老库里客户级别 D 的一次改成 C（定稿 P5 第 23 条：级别只剩 S / A / B / C）。
 *                    不放迁移：迁移只加表加列（migrations/README.md），数据改动放代码里、记一笔只做一次（照 project/expected-deal.ts）
 *   号码种类表 —— 号码类型字典（contactKind）→ 每一项存成哪种 kind、怎么验
 *   验联系人号码们 / 存联系人号码 —— 联系人「联系方式」几行（类型 + 号码）的校验和落库
 *   关联客户们 —— 客户页「关联客户」卡片的列表（两头都看得到同一行；改 / 删在 customers/[id]/link-actions.ts）
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { getSetting, setSetting } from "@/lib/settings";
import { 企业版 } from "./switch";
import { 企业字典 } from "./dict";
import { 号码归属地 } from "./phone-region";
import { 认号码种类, 验一行号码, 老三格, 内置号码种类, 自定种类前缀, 每人最多号码, 另一头, type 号码种类 } from "./customer-v2";
import { 字典定义 } from "./dict-kinds";

// ---------- 级别 D → C ----------

export const 级别改过记号键 = "entCust.levelD2C";
const g = globalThis as unknown as { __entLevelD2C?: Promise<number> };

/** 改一遍，返回改了几位。不是企业版、或已经改过：什么都不做 */
export async function 级别D改C(): Promise<number> {
  if (!企业版()) return 0;
  if (await getSetting<boolean>(级别改过记号键)) return 0;
  // 老库里 D 也可能存成小写（规整外贸档案 认等级 之前的导入），一起改
  const r = await prisma.customerExtra.updateMany({ where: { level: { in: ["D", "d"] } }, data: { level: "C" } });
  await setSetting(级别改过记号键, true);
  return r.count;
}

/** 服务启动时排着跑（instrumentation.ts）；同一进程只跑一次，出错下次启动再试 */
export function 级别D改C一次(): Promise<number> {
  g.__entLevelD2C ??= 级别D改C().catch((e) => {
    g.__entLevelD2C = undefined;
    console.error("[客户级别] D 改 C 出错，下次再试", e);
    return 0;
  });
  return g.__entLevelD2C;
}

// ---------- 联系人号码 ----------

/** 号码类型字典的全部项（停用的也在：老号还用着那一类，照样认、照样显示）。active = 下拉里还能新选 */
export async function 号码种类表(): Promise<(号码种类 & { active: boolean })[]> {
  if (!企业版()) return 内置号码种类.map((x, i) => ({ 名: 字典定义.contactKind.默认[i], kind: x.kind, 验: x.验, active: true }));
  return (await 企业字典("contactKind")).map((项) => ({ ...认号码种类(项), active: 项.active }));
}

/** 存库的 kind → 显示的叫法：字典里有就用字典现在的叫法；自定的取 custom: 后面那段；都没有原样 */
export function 种类叫法(表: readonly 号码种类[], kind: string): string {
  const 有 = 表.find((x) => x.kind === kind);
  if (有) return 有.名;
  if (kind.startsWith(自定种类前缀)) return kind.slice(自定种类前缀.length);
  const i = 内置号码种类.findIndex((x) => x.kind === kind);
  return i >= 0 ? 字典定义.contactKind.默认[i] : kind;
}

export type 交上来的号 = { kind: string; value: string };
export type 验好的行 = { kind: string; value: string; numberKey: string; region: string | null };

/**
 * 联系人表单交上来的几行号码（事务外调：要读字典）。kind 必须是字典里的一类（停用的也认：老号原样交回来），
 * 或者这位联系人原来就有的那一类（字典里那项被改名 / 自定的被删）。同类同号的只留一行；空行跳过
 */
export async function 验联系人号码们(行们: readonly 交上来的号[] | null | undefined, 原有种类: readonly string[] = []): Promise<{ ok: true; 行们: 验好的行[] } | { ok: false; error: string }> {
  const 表 = await 号码种类表();
  const 们: 验好的行[] = [];
  for (const 行 of 行们 ?? []) {
    if (!行 || typeof 行.value !== "string" || !行.value.trim()) continue;
    const kind = typeof 行.kind === "string" ? 行.kind : "";
    const 种 = 表.find((x) => x.kind === kind) ?? (原有种类.includes(kind) ? { 名: 种类叫法(表, kind), kind } : null);
    if (!种) return { ok: false, error: "号码类型不对（可能刚被改过），刷新后再选" };
    const r = 验一行号码(种, 行.value);
    if (!r.ok) return r;
    if (们.some((x) => x.kind === kind && x.numberKey === r.键)) continue;
    们.push({ kind, value: r.值, numberKey: r.键, region: kind === "phone" ? 号码归属地("手机号", r.值)?.文字 ?? null : null });
  }
  if (们.length > 每人最多号码) return { ok: false, error: `一位联系人最多记 ${每人最多号码} 个号码` };
  return { ok: true, 行们: 们 };
}

/**
 * 把这位联系人的号码换成交上来的这几行（事务里调）：他名下原有的几行删掉重建，客户本身的号（contactId 空）不动。
 * 返回联系人老三格（第一个手机 / 邮箱 / 微信），调用方写回 Contact.phone / email / wechat
 */
export async function 存联系人号码(tx: Prisma.TransactionClient, customerId: string, contactId: string, 行们: readonly 验好的行[]) {
  await tx.contactMethod.deleteMany({ where: { contactId } });
  for (const 行 of 行们) {
    await tx.contactMethod.create({ data: { customerId, contactId, kind: 行.kind, value: 行.value, numberKey: 行.numberKey, formatStatus: "ok", region: 行.region } });
  }
  return 老三格(行们);
}

/**
 * 客户页上每位联系人的号码几行。他名下子表里一行都没有的（改版前建的、个人版导过来的）：拿老三格拼出来，编辑时照样带上
 */
export function 联系人号码们(
  联系人: { phone: string | null; email: string | null; wechat: string | null },
  子表: readonly { kind: string; value: string }[],
): 交上来的号[] {
  if (子表.length) return 子表.map((x) => ({ kind: x.kind, value: x.value }));
  return (
    [
      ["phone", 联系人.phone],
      ["email", 联系人.email],
      ["wechat", 联系人.wechat],
    ] as const
  ).flatMap(([kind, v]) => (v && v.trim() ? [{ kind, value: v }] : []));
}

// ---------- 关联客户 ----------

export type 关联一行 = {
  id: string;
  /** 另一位客户 */
  otherId: string;
  otherName: string;
  /** 我看不看得到另一位（看不到的只给名字，不给链接；同撞号时「只露客户名」的口径） */
  看得到: boolean;
  note: string | null;
  createdAt: string;
};

/**
 * 这位客户的关联（两个方向都算）。本人看不到这位客户（限定层查不到）就给空。
 * 关联表不在限定层里，另一头的名字用 看全部 取；看不看得到另算一次
 */
export async function 关联客户们(customerId: string): Promise<关联一行[]> {
  if (!企业版()) return [];
  if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return [];
  const 行们 = await 看全部(() => prisma.entCustomerLink.findMany({
    where: { OR: [{ customerId }, { otherId: customerId }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }));
  if (!行们.length) return [];
  const 另们 = 行们.map((x) => 另一头(x, customerId));
  const [名们, 能看] = await Promise.all([
    看全部(() => prisma.customer.findMany({ where: { id: { in: 另们 } }, select: { id: true, name: true } })),
    prisma.customer.findMany({ where: { id: { in: 另们 } }, select: { id: true } }),
  ]);
  const 名 = new Map(名们.map((c) => [c.id, c.name]));
  const 看 = new Set(能看.map((c) => c.id));
  return 行们.flatMap((x) => {
    const o = 另一头(x, customerId);
    const n = 名.get(o);
    return n == null ? [] : [{ id: x.id, otherId: o, otherName: n, 看得到: 看.has(o), note: x.note, createdAt: x.createdAt.toISOString() }];
  });
}
