"use server";
/**
 * 企业版站内通知（2026-11-01）：顶栏铃铛读、标已读；设置 → 组织里的「飞书推送」开关。
 *
 * 通知只看、只标自己的。飞书推送开关跟改后台设置一个口径：只有总管理（勾了「不管设置」的不行），
 * 管理员只读；账号角色不算，没设业务角色 = 不能改。
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { setSetting } from "@/lib/settings";
import { 企业版 } from "@/lib/enterprise/switch";
import { prisma } from "@/lib/prisma";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能改后台设置 } from "@/lib/enterprise/permissions";
import { 我的通知, 未读通知数, 标通知已读, 全部通知已读, type 通知行 } from "@/lib/enterprise/notify";
import { 飞书推送开着, 飞书推送开关键, 推送凭据 } from "@/lib/enterprise/feishu-push";
import { 我能放弃的, 放弃链接项目 } from "@/lib/enterprise/lead-giveup";

/** 铃铛里一批最多判几条能放弃（通知最近 30 条，带放弃链接的只是其中一部分） */
const 铃铛放弃最多 = 30;

export async function 读我的通知(): Promise<{ 行们: 通知行[]; 未读: number }> {
  if (!企业版()) return { 行们: [], 未读: 0 };
  const me = await requireUser();
  const [行们, 未读] = await Promise.all([我的通知(me.id), 未读通知数(me.id)]);
  // 带「放弃（豁免）」的（分到我的线索、超时提醒，11-21）：此刻还能放弃的才给按钮（发的时候能、现在不能了的不给）。
  // 一条都没带就不查；带了的一批判（lead-giveup.ts 我能放弃的，只查本人）
  if (!行们.some((r) => 放弃链接项目(r.link))) return { 行们, 未读 };
  const 能 = new Set((await 我能放弃的(me, new Date(), 铃铛放弃最多)).map((x) => x.projectId));
  return {
    行们: 行们.map((r) => {
      const id = 放弃链接项目(r.link);
      return id && 能.has(id) ? { ...r, 放弃项目: id } : r;
    }),
    未读,
  };
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

/** 和改后台设置一个口径（lib/enterprise/permissions.ts）：只有总管理，勾了「不管设置」的不行；管理员只读 */
async function 能改推送(meId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: meId }, select: { id: true, role: true, active: true } });
  return !!u?.active && 能改后台设置(u, await 权限组织());
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
