"use server";
/**
 * 设置 → AI 接入 →「语音转文字」的服务器动作（11-22，录音点评 PR4）：认人以后调 lib/enterprise/coach-rec-asr-settings.ts。
 * 谁能改、切换视图只读、审计都在那边判；这里不收、不回任何密钥内容
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 读转写设置 as 读, 设录音点评开关 as 设开关, 设大文件交法 as 设交法, 测转写连接 as 测, type 转写设置概况 } from "@/lib/enterprise/coach-rec-asr-settings";

export async function 读转写设置(): Promise<转写设置概况 | { ok: false; status: 403; error: string } | null> {
  return 读(await requireUser());
}

export async function 设录音点评开关(开: boolean) {
  const r = await 设开关(await requireUser(), 开 === true);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

export async function 设大文件交法(交法: string) {
  return 设交法(await requireUser(), 交法);
}

export async function 测转写连接() {
  return 测(await requireUser());
}
