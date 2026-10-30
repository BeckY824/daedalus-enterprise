import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 负责人候选 } from "@/lib/owners";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我能用的分配方式 } from "@/lib/enterprise/dict";
import { 企业版字典 } from "@/lib/project/nodes";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import ProjectWizard from "./ProjectWizard";

/** 企业版从「新线索」页进来走 /leads/new（10-27）：同一个向导，标题叫「新线索」、左栏亮「新线索」 */
export async function 建档页(新线索 = false) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  // 企业版开了超时回收：首条沟通要填下一步时间（lib/project/wizard.ts 规整向导 也拦）；企业版没开也能选填（验收 #4）
  const [users, 规则] = await Promise.all([负责人候选(), 生效组织规则()]);
  // 企业版新建线索：渠道、负责人、跟进节点、客户是否明确回复必选（lib/project/wizard.ts 规整向导 + 建档向导 也拦）
  const 企业 = 企业版()
    ? { 渠道们: await 可选渠道们(), 节点们: 企业版字典.节点们.线索, 分配方式们: await 我能用的分配方式(me) }
    : null;
  return <ProjectWizard users={users} 要下一步={规则.超时回收.开} 企业={企业} 新线索={新线索} />;
}
