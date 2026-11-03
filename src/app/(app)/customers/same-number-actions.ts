"use server";

/**
 * 建档向导查重撞了之后的出口：把这次的来源和内容写进现有项目（同号再次录入，lib/enterprise/same-number-collab.ts）。
 * 判断、写入都在核心函数；这里只认人、验号码。
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 同号再次录入 } from "@/lib/enterprise/same-number-collab";

export type 同号录入结果 = { ok: true; 反馈: string } | { ok: false; error: string };

export async function 同号协同录入(类型: string, 值: string, 录入: { 渠道id?: string | null; 内容?: string | null }): Promise<同号录入结果> {
  const me = await requireUser();
  if (!企业版()) return { ok: false, error: "企业版才有这个功能" };
  const 号 = 验号码(类型, 值);
  if (!号.ok) return { ok: false, error: 号.提示 };
  const r = await 同号再次录入(me, 号, { 入口: "手工建档", 渠道id: 录入.渠道id ?? null, 内容: String(录入.内容 ?? "").slice(0, 2000) });
  if (!r.走) return { ok: false, error: "这个号码现在不能写进现有项目了，请重新查重" };
  revalidatePath("/projects");
  return { ok: true, 反馈: r.反馈 };
}
