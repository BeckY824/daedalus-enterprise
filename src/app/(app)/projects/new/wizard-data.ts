import { 负责人候选 } from "@/lib/owners";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我能用的分配方式 } from "@/lib/enterprise/dict";
import { 企业版字典 } from "@/lib/project/nodes";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import type { 建档数据 } from "./ProjectWizard";
import type { SessionUser } from "@/lib/auth";

/**
 * 向导要的数据：建档页和客户页「新增客户」弹窗（U-新建-01）共用。调用方自己先认人、判项目模式。
 * 单独一个文件、只 import type 向导：客户页的服务端代码从 screen.tsx 拿会把整个向导（连渠道选择器）
 * 打进客户列表首屏，弹窗那边是点了才加载的（速度闸门，10-31）
 */
export async function 建档向导数据(me: SessionUser): Promise<建档数据> {
  // 企业版开了超时回收：首条沟通要填下一步时间（lib/project/wizard.ts 规整向导 也拦）；企业版没开也能选填（验收 #4）
  const [users, 规则] = await Promise.all([负责人候选(), 生效组织规则()]);
  // 企业版新建线索：渠道、负责人、跟进节点、客户是否明确回复必选（lib/project/wizard.ts 规整向导 + 建档向导 也拦）
  const 企业 = 企业版()
    ? { 渠道们: await 可选渠道们(), 节点们: 企业版字典.节点们.线索, 分配方式们: await 我能用的分配方式(me) }
    : null;
  return { users, 要下一步: 规则.超时回收.开, 企业 };
}
