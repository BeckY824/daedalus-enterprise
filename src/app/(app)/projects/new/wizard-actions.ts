"use server";

import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 建档向导数据 } from "./wizard-data";
import type { 建档数据 } from "./ProjectWizard";

/**
 * 项目首页「新增项目」→「新客户」点了才取向导数据（11-01）：不压项目首页的服务端时间（速度闸门）。
 * 和 /projects/new 同一份数据、同一道项目模式的门
 */
export async function 取建档数据(): Promise<建档数据 | null> {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) return null;
  return 建档向导数据(me);
}
