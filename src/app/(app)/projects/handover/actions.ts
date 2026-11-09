"use server";

/**
 * 「项目 → 离职交接」（11-03 B7-2）的服务端动作：交一位客户、交一个项目、全部交给一个人。
 * 谁能交、交给谁、怎么交见 lib/enterprise/offboard-handover.ts。不是企业版一律 FORBIDDEN。
 * 交之前核持有上限（交了超上限，M-公海-18）：超了不交，说清谁、上限、现有几个
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 当前是共享区 } from "@/lib/shared-ws/current";
import { 交接挡, 交了超上限, 交一位客户, 交一个项目, 全部交给 } from "@/lib/enterprise/offboard-handover";

type 结果 = { ok: true; message: string } | { ok: false; error: string };

const 刷新 = () => {
  for (const p of ["/projects/handover", "/projects", "/customers", "/leads", "/channels", "/settings"]) revalidatePath(p);
};

async function 先挡(fromId: string, toId: string) {
  if (!企业版()) throw new Error("FORBIDDEN");
  const me = await requireUser();
  if (await 当前是共享区()) throw new Error("FORBIDDEN");
  const 话 = await 交接挡(me, fromId, toId);
  if (话 === "FORBIDDEN") throw new Error("FORBIDDEN");
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [fromId, toId].filter((x) => typeof x === "string" && x) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { me, 话, 从: 名.get(fromId) ?? "", 给: 名.get(toId) ?? "" };
}

export async function 交接客户(fromId: string, customerId: string, toId: string): Promise<结果> {
  const { me, 话, 从, 给 } = await 先挡(fromId, toId);
  if (话) return { ok: false, error: 话 };
  if (typeof customerId !== "string" || !customerId) return { ok: false, error: "这位客户已不在 TA 名下" };
  const 超 = await 交了超上限(fromId, toId, { 客户: customerId });
  if (超) return { ok: false, error: 超 };
  if (!(await 交一位客户(me, fromId, customerId, toId))) return { ok: false, error: "这位客户已不在 TA 名下，刷新看看" };
  const 客户 = (await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } }))?.name ?? "";
  await recordAudit({ user: me, action: "handover", entity: "Customer", entityId: customerId, summary: `离职交接：客户「${客户}」从「${从}」交给「${给}」`, detail: { from: fromId, to: toId } });
  刷新();
  return { ok: true, message: `已交给 ${给}` };
}

export async function 交接项目(fromId: string, projectId: string, toId: string): Promise<结果> {
  const { me, 话, 从, 给 } = await 先挡(fromId, toId);
  if (话) return { ok: false, error: 话 };
  if (typeof projectId !== "string" || !projectId) return { ok: false, error: "这个项目已不在 TA 名下，刷新看看" };
  const 超 = await 交了超上限(fromId, toId, { 项目: projectId });
  if (超) return { ok: false, error: 超 };
  if (!(await 交一个项目(me, fromId, projectId, toId))) return { ok: false, error: "这个项目已不在 TA 名下，刷新看看" };
  const 项目 = (await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }))?.name ?? "";
  await recordAudit({ user: me, action: "handover", entity: "Project", entityId: projectId, summary: `离职交接：项目「${项目}」从「${从}」交给「${给}」`, detail: { from: fromId, to: toId } });
  刷新();
  return { ok: true, message: `已交给 ${给}` };
}

export async function 交接全部(fromId: string, toId: string): Promise<结果> {
  const { me, 话, 从, 给 } = await 先挡(fromId, toId);
  if (话) return { ok: false, error: 话 };
  const 超 = await 交了超上限(fromId, toId, "全部");
  if (超) return { ok: false, error: 超 };
  const r = await 全部交给(me, fromId, toId);
  const 段 = [
    r.客户.length && `${r.客户.length} 位客户`,
    r.项目.length && `${r.项目.length} 个项目`,
    r.商机.length && `${r.商机.length} 个商机`,
    r.待办.length + r.计划.length && `${r.待办.length + r.计划.length} 条待办和计划`,
    r.线索.length && `${r.线索.length} 条线索`,
    r.渠道.length && `${r.渠道.length} 个渠道`,
  ].filter(Boolean).join("、");
  await recordAudit({
    user: me, action: "handover", entity: "User", entityId: fromId,
    summary: `离职交接：「${从}」名下${段 || "没有要交的"}全部交给「${给}」`,
    detail: { to: toId, 客户: r.客户.length, 项目: r.项目.length, 商机: r.商机.length, 待办: r.待办.length, 计划: r.计划.length, 线索: r.线索.length, 渠道: r.渠道.length },
  });
  刷新();
  return { ok: true, message: 段 ? `已把 ${段} 交给 ${给}` : "TA 名下已经没有要交的了" };
}
