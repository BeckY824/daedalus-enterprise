"use server";

import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选项 } from "@/lib/enterprise/dict";
import type { 一条方式 } from "@/lib/follow-habit";
import { 常用沟通方式of } from "@/lib/follow-habit-db";

/** 企业版沟通方式的启用项（10-31，字典 followMethod）：记沟通的几张表单打开时取；别的版本给 null，表单照旧用类型下拉 */
export async function 沟通方式选项(): Promise<string[] | null> {
  await requireUser();
  if (!企业版()) return null;
  const 们 = await 可选项("followMethod");
  return 们.length ? 们 : null;
}

/** 企业版发起主体的启用项（11-01，字典 followInitiator）：记沟通的表单打开时取；别的版本给 null，表单不摆这一格 */
export async function 发起主体选项(): Promise<string[] | null> {
  await requireUser();
  if (!企业版()) return null;
  const 们 = await 可选项("followInitiator");
  return 们.length ? 们 : null;
}

/**
 * 记一条沟通默认选哪种沟通方式（11-17 客户答复「建议记录个人使用习惯」，lib/follow-habit.ts）：
 * 这个人自己记的最近 20 条沟通（哪个客户、哪个项目都算；任务、提醒、回收站里的不算），用得最多的那种。
 * 企业版只认现在字典里还启用着的方式；一条都没有回 null，表单照原来的默认走。只读，不另存任何东西
 */
export async function 我常用的沟通方式(): Promise<一条方式 | null> {
  const me = await requireUser();
  return 常用沟通方式of(me.id);
}
