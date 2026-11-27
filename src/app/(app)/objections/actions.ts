"use server";

/**
 * 转让异议（12-22 第 2 阶段 A 段）：受影响的人（被换掉的客户负责人、被随客户转走在推项目的同事）提异议。
 * 规则、裁定人怎么算见 lib/enterprise/objection.ts。只有本人能提自己那一行；不是企业版一律不给。
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 提异议 as 提 } from "@/lib/enterprise/objection";

export async function 提异议(id: string, 理由: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  if (!企业版()) throw new Error("FORBIDDEN");
  const me = await requireUser();
  const r = await 提(me, id, 理由);
  if (!r.ok) return r;
  revalidatePath("/objections");
  return { ok: true, message: `已提交，等${r.裁定人.join("、")}（${r.角色}）裁定` };
}
