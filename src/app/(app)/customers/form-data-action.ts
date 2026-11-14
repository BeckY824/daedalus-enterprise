"use server";
/**
 * 客户页「新建客户 / 编辑 / 新建项目」弹窗要的那两份料（11-15 列表页瘦身）：渠道候选、建档向导数据（企业版项目模式）。
 * 原来每次打开客户列表都跟着首屏一起取、一起传（两份约 18 KB，首屏用不上），改成点开（或展开「新建 ▾」预取）时再取。
 * 只读，取法和原来 page.tsx 里那两样一样（可选渠道()、建档向导数据(me)），谁都能取：原来首屏就给了每个打开客户页的人
 */
import { requireUser } from "@/lib/auth";
import { 企业版 } from "@/lib/enterprise/switch";
import { getBusiness } from "@/lib/business";
import { 可选渠道 } from "@/lib/options";
import { 建档向导数据 } from "../projects/new/wizard-data";
import type { 建档数据 } from "../projects/new/ProjectWizard";

export type 客户页表单料 = { channels: { id: string; name: string }[]; 建档: 建档数据 | null };

export async function 取客户页表单料(): Promise<客户页表单料> {
  const me = await requireUser();
  const b = await getBusiness();
  const [channels, 建档] = await Promise.all([可选渠道(), 企业版() && b.projectMode ? 建档向导数据(me) : null]);
  return { channels, 建档 };
}
