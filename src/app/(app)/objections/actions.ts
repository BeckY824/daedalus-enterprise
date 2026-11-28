"use server";

/**
 * 转让异议（12-22 第 2 阶段 A 段）：受影响的人（被换掉的客户负责人、被随客户转走在推项目的同事）提异议。
 * 规则、裁定人怎么算见 lib/enterprise/objection.ts。只有本人能提自己那一行；不是企业版一律不给。
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 提异议 as 提 } from "@/lib/enterprise/objection";
import { 裁定, 标记已手工退回 } from "@/lib/enterprise/objection-judge";

export async function 提异议(id: string, 理由: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!企业版()) throw new Error("FORBIDDEN");
  const me = await requireUser();
  const r = await 提(me, id, 理由);
  if (!r.ok) return r;
  revalidatePath("/objections");
  return { ok: true, message: `已提交，等${r.裁定人.join("、")}（${r.角色}）裁定` };
}

/** 裁定（12-22 第 2 阶段 B 段）：只有那条异议的裁定人；决定无默认，说明必填；规则见 lib/enterprise/objection-judge.ts */
export async function 裁定异议(id: string, 决定: string, 说明: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!企业版()) throw new Error("FORBIDDEN");
  const me = await requireUser();
  const r = await 裁定(me, id, 决定, 说明);
  if (!r.ok) return r;
  revalidatePath("/objections");
  revalidatePath("/customers");
  revalidatePath("/projects");
  return { ok: true, message: r.说 };
}

/** 系统管理员手工退回做完：记留痕、通知各方 */
export async function 已手工退回(id: string, 说明: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!企业版()) throw new Error("FORBIDDEN");
  const me = await requireUser();
  const r = await 标记已手工退回(me, id, 说明);
  if (r.ok) revalidatePath("/objections");
  return r;
}
