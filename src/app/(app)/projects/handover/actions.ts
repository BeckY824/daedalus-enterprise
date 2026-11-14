"use server";

/**
 * 「项目 → 离职交接」（11-03 B7-2）的服务端动作：交一位客户、交一个项目、全部交给一个人。
 * 谁能交、交给谁、怎么交见 lib/enterprise/offboard-handover.ts。不是企业版一律 FORBIDDEN。
 * 11-13 起（客户原话「离职交接也必须接手人点确认才生效」，不做开关）：这里只发起，记一行待确认交接、数据留在离职的人名下，
 * 接手人收到「等你确认」（交接通知，站内待办 + 飞书，P-转-05）；接手人在客户页确认了才转，确认 / 拒收 / 撤回 / 改接手人走
 * customers/handover-actions.ts。持有上限（M-公海-18）在确认那一刻核（offboard-handover.ts 确认离职交接）
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 交接挡, 发起交一位客户, 发起交一个项目, 发起全部交给 } from "@/lib/enterprise/offboard-handover";
import { 交接通知 } from "@/lib/enterprise/notice-sources";

type 结果 = { ok: true; message: string; 交接?: string } | { ok: false; error: string };

const 刷新 = () => {
  for (const p of ["/projects/handover", "/projects", "/customers", "/leads", "/channels", "/settings"]) revalidatePath(p);
};

async function 先挡(fromId: string, toId: string) {
  if (!企业版()) throw new Error("FORBIDDEN");
  const me = await requireUser();
  const 话 = await 交接挡(me, fromId, toId);
  if (话 === "FORBIDDEN") throw new Error("FORBIDDEN");
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [fromId, toId].filter((x) => typeof x === "string" && x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { me, 话, 从: 名.get(fromId) ?? "", 给: 名.get(toId) ?? "" };
}

const 等确认 = (给: string) => `已交给 ${给}，等 TA 确认后才转过去`;

export async function 交接客户(fromId: string, customerId: string, toId: string): Promise<结果> {
  const { me, 话, 从, 给 } = await 先挡(fromId, toId);
  if (话) return { ok: false, error: 话 };
  if (typeof customerId !== "string" || !customerId) return { ok: false, error: "这位客户已不在 TA 名下" };
  const r = await 发起交一位客户(me, fromId, customerId, toId);
  if (!r.ok) return r;
  const 客户 = (await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }))?.name ?? "";
  await recordAudit({ user: me, action: "handover", entity: "Customer", entityId: customerId, summary: `离职交接：客户「${客户}」从「${从}」交给「${给}」，等对方确认`, detail: { from: fromId, to: toId, 交接: r.交接, 待确认: true } });
  await 交接通知(me, r.交接, "发起");
  刷新();
  return { ok: true, message: 等确认(给), 交接: r.交接 };
}

export async function 交接项目(fromId: string, projectId: string, toId: string): Promise<结果> {
  const { me, 话, 从, 给 } = await 先挡(fromId, toId);
  if (话) return { ok: false, error: 话 };
  if (typeof projectId !== "string" || !projectId) return { ok: false, error: "这个项目已不在 TA 名下，刷新看看" };
  const r = await 发起交一个项目(me, fromId, projectId, toId);
  if (!r.ok) return r;
  const 项目 = (await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }))?.name ?? "";
  await recordAudit({ user: me, action: "handover", entity: "Project", entityId: projectId, summary: `离职交接：项目「${项目}」从「${从}」交给「${给}」，等对方确认`, detail: { from: fromId, to: toId, 交接: r.交接, 待确认: true } });
  await 交接通知(me, r.交接, "发起");
  刷新();
  return { ok: true, message: 等确认(给), 交接: r.交接 };
}

export async function 交接全部(fromId: string, toId: string): Promise<结果> {
  const { me, 话, 从, 给 } = await 先挡(fromId, toId);
  if (话) return { ok: false, error: 话 };
  const r = await 发起全部交给(me, fromId, toId);
  if (!r.ok) return r;
  if (!r.交接) return { ok: true, message: "TA 名下已经没有要交的了" };
  await recordAudit({
    user: me, action: "handover", entity: "User", entityId: fromId,
    summary: `离职交接：「${从}」名下${r.段}全部交给「${给}」，等对方确认`,
    detail: { to: toId, 交接: r.交接, 待确认: true, 客户: r.客户.length, 项目: r.项目.length },
  });
  await 交接通知(me, r.交接, "发起");
  刷新();
  return { ok: true, message: `已把 ${r.段} 交给 ${给}，等 TA 确认后才转过去`, 交接: r.交接 };
}
