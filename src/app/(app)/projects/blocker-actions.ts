"use server";

/**
 * 企业版卡点的接口（2026-10-26，11-01 改版）。读写和谁能动在 lib/project/blocker.ts，这里只管登录、开关、操作日志和刷新。
 * 项目模式没开、不是企业版：每个动作都直接拦，一行不写。
 * 11-01 起没有指认 / 转让 / 退回 / 改进度：看得到就能认领，认领人各自点「我已完成」，最后一位写解决方案和结果
 */
import { revalidatePath } from "next/cache";
import { requireUser, type SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import {
  发布卡点, 认领卡点, 完成卡点, 删卡点, 存卡点默认, 存卡点角色开关, 我的卡点, 新增原因, 改原因名, 改原因状态, 删原因, 合并原因, 原因字典,
  type 卡点结果,
} from "@/lib/project/blocker";
import type { 发布输入 } from "@/lib/project/blocker-rules";
import { 卡点发布通知, 卡点通知 } from "@/lib/enterprise/notice-sources";

const 没开 = { ok: false as const, error: "项目模式没开：请总管理员在「设置 → 业务配置」里打开" };
const 不是企业版 = { ok: false as const, error: "卡点是企业版的功能" };

async function 拦(): Promise<{ ok: false; error: string } | null> {
  if (!((await getBusiness()).projectMode === true)) return 没开;
  if (!企业版()) return 不是企业版;
  return null;
}

function 刷新(projectId: string) {
  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/overview");
}

/** 动作做成了：记一行操作日志、刷新项目页 */
async function 收尾(me: SessionUser, r: 卡点结果, 说: (code: string, 解决了: boolean) => string) {
  if (!r.ok) return r;
  await recordAudit({ user: me, action: "update", entity: "EntBlocker", entityId: r.projectId, summary: 说(r.code, !!r.解决了) });
  刷新(r.projectId);
  return { ok: true as const, 解决了: !!r.解决了 };
}

/** 发布卡点：「暂无卡点」不生成记录，返回 ok 不带 code */
export async function 发布卡点Action(followUpId: string, input: 发布输入) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    const r = await 发布卡点(me, followUpId, input);
    if (!r.ok) return r;
    if (!r.code) return { ok: true as const, code: undefined };
    await recordAudit({ user: me, action: "create", entity: "EntBlocker", entityId: r.projectId, summary: `发布卡点 ${r.code}` });
    刷新(r.projectId!);
    await 卡点发布通知(me, r.code);
    return { ok: true as const, code: r.code };
  } catch (e) { return 不在了(e); }
}

export async function 认领卡点Action(blockerId: string) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    const r = await 认领卡点(me, blockerId);
    if (r.ok) await 卡点通知(me, r.code, "认领");
    return 收尾(me, r, (c) => `认领卡点 ${c}`);
  } catch (e) { return 不在了(e); }
}

/** 我已完成：最后一位要带解决方案、解决结果 */
export async function 完成卡点Action(blockerId: string, input: { note?: string; solution?: string; result?: string }) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    const r = await 完成卡点(me, blockerId, input ?? {});
    if (r.ok && r.解决了) await 卡点通知(me, r.code, "解决");
    return 收尾(me, r, (c, 解决了) => (解决了 ? `卡点 ${c} 已解决` : `卡点 ${c} 我已完成`));
  } catch (e) { return 不在了(e); }
}

/** 删卡点：只有总管理（director），删了不进回收站 */
export async function 删卡点Action(blockerId: string) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    const r = await 删卡点(me, blockerId);
    if (!r.ok) return r;
    await recordAudit({ user: me, action: "delete", entity: "EntBlocker", entityId: r.projectId, summary: `删除卡点 ${r.code}` });
    刷新(r.projectId);
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

/** 设置 → 项目模式 → 卡点默认值 */
export async function 存卡点默认Action(patch: unknown) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    const r = await 存卡点默认(me, patch);
    if (!r.ok) return r;
    await recordAudit({ user: me, action: "update", entity: "Setting", entityId: "entBlockerDefaults", summary: "修改卡点默认值", detail: r.默认 });
    revalidatePath("/settings");
    return { ok: true as const, 默认: r.默认! };
  } catch (e) { return 不在了(e); }
}

/** 设置 → 项目模式 → 卡点：按业务角色启用 / 停用、只看自己 / 可看全部 */
export async function 存卡点角色开关Action(patch: unknown) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    const r = await 存卡点角色开关(me, patch);
    if (!r.ok) return r;
    await recordAudit({ user: me, action: "update", entity: "Setting", entityId: "entBlockerRoles", summary: "修改卡点角色开关", detail: r.开关 });
    revalidatePath("/settings");
    revalidatePath("/overview");
    return { ok: true as const, 开关: r.开关! };
  } catch (e) { return 不在了(e); }
}

/* 阻碍原因字典（总管理，业务角色 director）：增、改名、启用 / 停用（待审核的启用 = 审核通过）、删（没用过的）、合并 */
async function 字典收尾(me: SessionUser, r: { ok: boolean; error?: string }, 说: string) {
  if (!r.ok) return r as { ok: false; error: string };
  await recordAudit({ user: me, action: "update", entity: "EntBlockerReason", entityId: "dict", summary: 说 });
  revalidatePath("/settings");
  revalidatePath("/overview");
  return { ok: true as const, 字典: await 原因字典() };
}

export async function 新增原因Action(name: string) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    return 字典收尾(me, await 新增原因(me, name), `新增阻碍原因「${String(name ?? "").trim()}」`);
  } catch (e) { return 不在了(e); }
}

export async function 改原因名Action(id: string, name: string) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    return 字典收尾(me, await 改原因名(me, id, name), `阻碍原因改名为「${String(name ?? "").trim()}」`);
  } catch (e) { return 不在了(e); }
}

export async function 改原因状态Action(id: string, status: "启用" | "停用") {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    return 字典收尾(me, await 改原因状态(me, id, status), `阻碍原因${status}`);
  } catch (e) { return 不在了(e); }
}

export async function 删原因Action(id: string) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    return 字典收尾(me, await 删原因(me, id), "删除阻碍原因");
  } catch (e) { return 不在了(e); }
}

export async function 合并原因Action(从id: string, 到id: string) {
  try {
    const me = await requireUser();
    const 挡 = await 拦();
    if (挡) return 挡;
    return 字典收尾(me, await 合并原因(me, 从id, 到id), "合并阻碍原因");
  } catch (e) { return 不在了(e); }
}

/** 「我的卡点」看板（项目列表页）刷新用 */
export async function 我的卡点Action() {
  try {
    const me = await requireUser();
    if (await 拦()) return [];
    return await 我的卡点(me);
  } catch { return []; }
}
