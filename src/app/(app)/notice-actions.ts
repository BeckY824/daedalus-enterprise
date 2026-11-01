"use server";
/**
 * 企业版站内通知（2026-11-01）：顶栏铃铛读、标已读；设置 → 组织里的「飞书推送」开关。
 *
 * 通知只看、只标自己的。飞书推送开关只认业务角色：总管理员类（总管理 / 管理员）能改；
 * 账号角色（老板 / 主管）不算，没设业务角色 = 不能改。
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { prisma } from "@/lib/prisma";
import { 拆角色 } from "@/lib/enterprise/org-core";
import { 我的通知, 未读通知数, 标通知已读, 全部通知已读, type 通知行 } from "@/lib/enterprise/notify";
import { 飞书推送开着, 飞书推送开关键, 推送凭据 } from "@/lib/enterprise/feishu-push";

export async function 读我的通知(): Promise<{ 行们: 通知行[]; 未读: number }> {
  if (!企业版()) return { 行们: [], 未读: 0 };
  const me = await requireUser();
  const [行们, 未读] = await Promise.all([我的通知(me.id), 未读通知数(me.id)]);
  return { 行们, 未读 };
}

export async function 读未读通知数(): Promise<number> {
  if (!企业版()) return 0;
  const me = await requireUser();
  return 未读通知数(me.id);
}

export async function 标已读(id: string): Promise<number> {
  if (!企业版()) return 0;
  const me = await requireUser();
  await 标通知已读(me.id, id);
  return 未读通知数(me.id);
}

export async function 全部标已读(): Promise<number> {
  if (!企业版()) return 0;
  const me = await requireUser();
  await 全部通知已读(me.id);
  return 0;
}

/* ───────────────────────── 飞书推送开关 ───────────────────────── */

export type 飞书推送概况 = { 开: boolean; 能改: boolean; 配了应用: boolean; 配了地址: boolean };

/** 直接看 EntMember 上存的业务角色：组织里「没设业务角色按账号角色推」那层兜底这里不认（11-01：权限只认业务角色） */
async function 能改推送(meId: string): Promise<boolean> {
  const [u, m] = await Promise.all([
    prisma.user.findUnique({ where: { id: meId }, select: { active: true } }),
    prisma.entMember.findUnique({ where: { userId: meId }, select: { bizRole: true } }),
  ]);
  return !!u?.active && 拆角色(m?.bizRole).some((r) => r === "director" || r === "admin");
}

export async function 读飞书推送(): Promise<飞书推送概况 | null> {
  if (!企业版()) return null;
  const me = await requireUser();
  const [开, 能改, 凭据] = await Promise.all([飞书推送开着(), 能改推送(me.id), 推送凭据()]);
  return { 开, 能改, 配了应用: 凭据 !== null, 配了地址: !!process.env.ENT_PUBLIC_URL?.trim() };
}

export async function 设飞书推送(开: boolean): Promise<{ ok: true; 概况: 飞书推送概况 } | { ok: false; error: string }> {
  if (!企业版()) return { ok: false, error: "只有企业版能用" };
  const me = await requireUser();
  if (!(await 能改推送(me.id))) return { ok: false, error: "只有总管理员能改飞书推送" };
  if (开 === (await 飞书推送开着())) return { ok: true, 概况: (await 读飞书推送())! };
  await setSetting(飞书推送开关键, 开 === true);
  await recordAudit({ user: me, action: "update", entity: "Setting", entityId: 飞书推送开关键, summary: `${开 ? "打开" : "关掉"}飞书推送` });
  revalidatePath("/settings");
  return { ok: true, 概况: (await 读飞书推送())! };
}
