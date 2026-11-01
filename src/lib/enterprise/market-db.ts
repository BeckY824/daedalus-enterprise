/**
 * 读库算市场成员（11-01）：部门设置 + 逐人设的都从 Setting 里读，读不出当没设（部门按名字带「市场」认，逐人当没有）。
 * market.ts 给客户端组件也用，不能 import prisma，读库的放这里；visibility.ts 用自己传进来的 db，单独读
 */
import { prisma } from "@/lib/prisma";
import { 市场部门key, 市场成员key, 市场成员们, 规整市场部门 } from "./market";
import type { 组织 } from "./org-core";

async function 设的(key: string): Promise<string[] | null> {
  const v = await prisma.setting.findUnique({ where: { key }, select: { value: true } });
  if (!v) return null;
  try {
    return 规整市场部门(JSON.parse(v.value));
  } catch {
    return null;
  }
}

export async function 读市场成员们(org: 组织): Promise<Set<string>> {
  const [部门, 人] = await Promise.all([设的(市场部门key), 设的(市场成员key)]);
  return 市场成员们(org, 部门, 人);
}
