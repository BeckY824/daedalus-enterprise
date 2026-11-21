"use server";
/**
 * 定时分配到点前改 / 取消 / 改成现在分配（11-17，两字段方案 PR3；机制见 lib/enterprise/scheduled-assign.ts）。
 * 谁能动：录入人（还占着负责人一格的那位）和能分配的人（市场管理、销售管理、总管理员）；到点执行了（定时两列清了）就不能再改。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织 } from "@/lib/enterprise/org";
import { 指定问题 } from "@/lib/enterprise/assign-eta";
import { 挑不到原因 } from "@/lib/enterprise/await-assign-core";
import { 发待分配提醒 } from "@/lib/enterprise/lead-full-notice";
import { 执行一条定时, 清定时, 能动定时 as 能动 } from "@/lib/enterprise/scheduled-assign";
import { 认定时分配, 短时刻 } from "@/lib/project/time-fields";

type 结果 = { ok: true; 提示?: string } | { ok: false; error: string };
const 不在 = "这条定时分配已经执行、取消了，或者你看不到它，刷新看看";

async function 读定时(projectId: unknown) {
  if (typeof projectId !== "string" || !projectId) return null;
  return prisma.project.findFirst({
    where: { id: projectId, scheduledAssignAt: { not: null }, awaitAssignAt: { not: null }, pooledAt: null, result: null, phase: "线索" },
    select: { id: true, name: true, ownerId: true, creatorId: true, scheduledAssignAt: true, scheduledAssignTo: true },
  });
}

const 不能动话 = "只有录入人和市场管理、销售管理、总管理员能改这条定时分配";

function 刷新(id: string) {
  revalidatePath("/leads");
  revalidatePath("/projects");
  revalidatePath(`/projects/${id}`);
}

/** 改时间 / 改接手人（只有指定分配的定时有接手人；自动分配的不给加人） */
export async function 改定时分配(projectId: string, 输入: { 时间?: string | null; 接手人?: string | null }): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: 不在 };
    const p = await 读定时(projectId);
    if (!p) return { ok: false, error: 不在 };
    const org = await 读组织();
    if (!能动(me, p, org)) return { ok: false, error: 不能动话 };
    const 时 = 输入?.时间 === undefined ? { ok: true as const, at: p.scheduledAssignAt! } : 认定时分配(输入.时间);
    if (!时.ok) return { ok: false, error: 时.error };
    let 接手人 = p.scheduledAssignTo;
    if (p.scheduledAssignTo && 输入?.接手人 !== undefined && 输入.接手人 !== p.scheduledAssignTo) {
      if (!输入.接手人) return { ok: false, error: "请选到点分给谁" };
      const 问题 = await 指定问题(org, 输入.接手人);
      if (问题) return { ok: false, error: 问题 };
      if (!(await prisma.user.findUnique({ where: { id: 输入.接手人 }, select: { active: true } }))?.active) return { ok: false, error: "接手人不存在或已停用" };
      接手人 = 输入.接手人;
    }
    const 改 = await 看全部(() => prisma.project.updateMany({ where: { id: p.id, scheduledAssignAt: p.scheduledAssignAt }, data: { scheduledAssignAt: 时.at, scheduledAssignTo: 接手人 } }));
    if (改.count !== 1) return { ok: false, error: 不在 };
    const 名 = 接手人 ? (await prisma.user.findUnique({ where: { id: 接手人 }, select: { name: true } }))?.name ?? 接手人 : "自动分配";
    await recordAudit({ user: me, action: "update", entity: "Project", entityId: p.id, summary: `改了新线索「${p.name}」的定时分配：${短时刻(时.at)} → ${名}` });
    刷新(p.id);
    return { ok: true, 提示: `已改成 ${短时刻(时.at)} ${接手人 ? `分给 ${名}` : "自动分配"}` };
  } catch (e) {
    return 不在了(e);
  }
}

/** 取消定时：留在待分配，等能分配的人手动分（提醒他们一次） */
export async function 取消定时分配(projectId: string): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: 不在 };
    const p = await 读定时(projectId);
    if (!p) return { ok: false, error: 不在 };
    const org = await 读组织();
    if (!能动(me, p, org)) return { ok: false, error: 不能动话 };
    const 改 = await 看全部(() => prisma.project.updateMany({ where: { id: p.id, scheduledAssignAt: p.scheduledAssignAt }, data: 清定时 }));
    if (改.count !== 1) return { ok: false, error: 不在 };
    await recordAudit({ user: me, action: "update", entity: "Project", entityId: p.id, summary: `取消了新线索「${p.name}」的定时分配（原定 ${短时刻(p.scheduledAssignAt)}），留在待分配` });
    await 发待分配提醒(org, [{ id: p.id, 名: p.name }], me.name, `${me.name} 取消了定时分配（原定 ${短时刻(p.scheduledAssignAt)}）`).catch((e) => console.error("[待分配提醒] 没发出去", e));
    刷新(p.id);
    return { ok: true, 提示: "已取消定时，留在新线索待分配" };
  } catch (e) {
    return 不在了(e);
  }
}

/** 改成现在分配：立刻按原定的方式执行一次（操作人记点的人）；分不出去同到点那样留在待分配、提醒 */
export async function 定时分配现在分(projectId: string): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: 不在 };
    const p = await 读定时(projectId);
    if (!p) return { ok: false, error: 不在 };
    const org = await 读组织();
    if (!能动(me, p, org)) return { ok: false, error: 不能动话 };
    const r = await 看全部(() => 执行一条定时({ ...p, scheduledAssignAt: p.scheduledAssignAt! }, me, new Date()));
    刷新(p.id);
    return r.ok ? { ok: true, 提示: `已分给 ${r.接手人}` } : { ok: false, error: `没分出去：${挑不到原因(r.error)}。已留在新线索待分配` };
  } catch (e) {
    return 不在了(e);
  }
}
