"use server";
/**
 * 客户三态的按钮（三态落地计划 P6）：我还在跟 / 写理由继续持有（上级代选同一个入口）、被挡裁决的暂缓回收 / 让同事结束项目。
 * 只套登录和刷新，规矩全在 lib/enterprise/tri-state-hold.ts。移交、放公海走现有的转让、放进公海动作。界面另做
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 继续持有, 暂缓回收动作, 让同事结束项目动作, type 三态动作结果 } from "@/lib/enterprise/tri-state-hold";
import { 读占位词, 存占位词 } from "@/lib/enterprise/tri-state-db";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能改后台设置 } from "@/lib/enterprise/permissions";

const 刷新 = (id: string) => {
  revalidatePath("/customers");
  revalidatePath(`/customers/${id}`);
};

/** 沉睡时「我还在跟」（理由可空）；待回收时「写理由继续持有」（理由必填）；直属上级点 = 代选 */
export async function 三态继续持有(customerId: string, 理由?: string | null): Promise<三态动作结果> {
  const me = await requireUser();
  const r = await 继续持有(me, customerId, 理由);
  if (r.ok) 刷新(customerId);
  return r;
}

/** 被挡裁决：暂缓回收（不扣继续持有额度，30 天内不再推） */
export async function 三态暂缓回收(customerId: string, 理由?: string | null): Promise<三态动作结果> {
  const me = await requireUser();
  const r = await 暂缓回收动作(me, customerId, 理由);
  if (r.ok) 刷新(customerId);
  return r;
}

/** 被挡裁决：让同事结束项目（通知同事、留痕） */
export async function 三态让同事结束项目(customerId: string): Promise<三态动作结果> {
  const me = await requireUser();
  const r = await 让同事结束项目动作(me, customerId);
  if (r.ok) 刷新(customerId);
  return r;
}

/** 后台读占位词表（T2，界面以后做）：能改后台设置的人才读得到 */
export async function 三态读占位词(): Promise<{ ok: true; 词们: readonly string[] } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!能改后台设置(me, await 权限组织())) return { ok: false, error: "只有系统管理员能看占位词表" };
  return { ok: true, 词们: await 读占位词() };
}

/** 后台改占位词表（T2）：整张换掉，回规整后的 */
export async function 三态存占位词(词们: string[]): Promise<{ ok: true; 词们: string[] } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!能改后台设置(me, await 权限组织())) return { ok: false, error: "只有系统管理员能改占位词表" };
  if (!Array.isArray(词们)) return { ok: false, error: "词表格式不对" };
  return { ok: true, 词们: await 存占位词(词们) };
}
