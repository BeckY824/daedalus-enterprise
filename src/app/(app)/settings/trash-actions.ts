"use server";
/**
 * 企业版回收站（设置 → 回收站，P9 2026-10-29）：看、恢复、彻底删除。
 * 谁能做、连带规矩都在 lib/enterprise/soft-delete.ts；这里先过权限门再看参数，然后留痕、刷新页面
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { 不在了 } from "@/lib/not-there";
import { 企业版 } from "@/lib/enterprise/switch";
import {
  回收站列表, 恢复, 彻底删除, 能管回收站, 能彻底删除, 回收站叫法, 软删表,
  type 回收站条目, type 软删表名,
} from "@/lib/enterprise/soft-delete";

const 没开 = { ok: false as const, error: "回收站没开（只在企业版里有）" };
const 是表 = (t: unknown): t is 软删表名 => (软删表 as readonly unknown[]).includes(t);

function 刷新() {
  for (const p of ["/customers", "/contacts", "/projects", "/follow-ups", "/settings"]) revalidatePath(p);
}

export async function 回收站列表动作(): Promise<{ ok: true; 条目: 回收站条目[]; 能彻底删除: boolean } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!企业版()) return 没开;
  if (!(await 能管回收站(me))) return { ok: false, error: "只有老板和管理员能看回收站" };
  return { ok: true, 条目: await 回收站列表(me), 能彻底删除: await 能彻底删除(me) };
}

export async function 恢复回收站(t: 软删表名, id: string) {
  try {
    const me = await requireUser();
    if (!企业版()) return 没开;
    if (!(await 能管回收站(me))) return { ok: false as const, error: "只有老板和管理员能恢复" };
    if (!是表(t) || typeof id !== "string" || !id) return { ok: false as const, error: "要恢复哪一条？刷新看看" };
    const r = await 恢复(me, t, id);
    if (!r.ok) return r;
    const 名 = await 名字(t, id);
    await recordAudit({
      user: me, action: "restore", entity: t, entityId: id,
      summary: `从回收站恢复${回收站叫法[t]}「${名}」${r.连带 ? `（连同 ${r.连带} 条一起）` : ""}`,
    });
    刷新();
    return { ok: true as const, 连带: r.连带 };
  } catch (e) { return 不在了(e); }
}

export async function 彻底删除回收站(t: 软删表名, id: string) {
  try {
    const me = await requireUser();
    if (!企业版()) return 没开;
    if (!(await 能彻底删除(me))) return { ok: false as const, error: "只有老板和总管理员能彻底删除" };
    if (!是表(t) || typeof id !== "string" || !id) return { ok: false as const, error: "要删哪一条？刷新看看" };
    const r = await 彻底删除(me, t, id);
    if (!r.ok) return r;
    await recordAudit({ user: me, action: "purge", entity: t, entityId: id, summary: `从回收站彻底删除${回收站叫法[t]}「${r.name}」` });
    刷新();
    return { ok: true as const };
  } catch (e) { return 不在了(e); }
}

/** 恢复完了取名字留痕（这会儿已经不在回收站里，平常的库就读得到） */
async function 名字(t: 软删表名, id: string): Promise<string> {
  if (t === "FollowUp") {
    const f = await prisma.followUp.findUnique({ where: { id }, select: { title: true, content: true } });
    return (f?.title || f?.content || "").slice(0, 40);
  }
  const m = { Customer: prisma.customer, Project: prisma.project, Contact: prisma.contact }[t] as unknown as {
    findUnique(a: unknown): Promise<{ name: string } | null>;
  };
  return (await m.findUnique({ where: { id }, select: { name: true } }))?.name ?? "";
}
