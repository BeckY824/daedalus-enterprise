"use server";

import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选项 } from "@/lib/enterprise/dict";

/** 企业版沟通方式的启用项（10-31，字典 followMethod）：记沟通的几张表单打开时取；别的版本给 null，表单照旧用类型下拉 */
export async function 沟通方式选项(): Promise<string[] | null> {
  await requireUser();
  if (!企业版()) return null;
  const 们 = await 可选项("followMethod");
  return 们.length ? 们 : null;
}
