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
import { 改直达链接们 } from "@/lib/project/customer-detail-direct";

/** 铃铛里一批最多判几条能放弃（通知最近 30 条，带放弃链接的只是其中一部分） */
const 铃铛放弃最多 = 30;

export async function 读我的通知(): Promise<{ 行们: 通知行[]; 未读: number }> {
  if (!企业版()) return { 行们: [], 未读: 0 };
  const me = await requireUser();
  const [行们, 未读] = await Promise.all([我的通知(me.id), 未读通知数(me.id)]);
  // 带「放弃（豁免）」的（分到我的线索、超时提醒，11-21）：此刻还能放弃的才给按钮（发的时候能、现在不能了的不给）。
  // 一条都没带就不查；带了的一批判（lead-giveup.ts 我能放弃的，只查本人）
  const 能 = 行们.some((r) => 放弃链接项目(r.link))
    ? new Set((await 我能放弃的(me, new Date(), 铃铛放弃最多)).map((x) => x.projectId))
    : new Set<string>();
  // 去项目页的链接换成项目页会跳去的最终地址（跳转优化 PR-A：点了不经过重定向那段空白；?giveup=1 照样带着，同项目页那条跳转）。
  // 放弃项目 按原链接认，先认再换
  const 到 = await 改直达链接们(me, 行们.map((r) => r.link));
  return {
    行们: 行们.map((r, i) => {
      const id = 放弃链接项目(r.link);
      return { ...r, link: 到[i], ...(id && 能.has(id) ? { 放弃项目: id } : {}) };
    }),
    未读,
  };
}

export async function 读未读通知数(): Promise<number> {
  if (!企业版()) return 0;
  const me = await requireUser();
  return 未读通知数(me.id);
}

/** 铃铛每分钟问一次：未读数 + 最新一条通知的时间（毫秒；没有通知 = 0）。数据失效判「来了新通知」看最新时间，不看未读数（读了几条同时来了新的，数不变也算） */
export async function 读通知动静(): Promise<{ 未读: number; 最新: number }> {
  if (!企业版()) return { 未读: 0, 最新: 0 };
  const me = await requireUser();
  const [未读, 最新] = await Promise.all([未读通知数(me.id), prisma.entNotice.aggregate({ where: { userId: me.id }, _max: { createdAt: true } })]);
  return { 未读, 最新: 最新._max.createdAt?.getTime() ?? 0 };
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
