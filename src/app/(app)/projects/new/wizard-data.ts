import { 负责人候选 } from "@/lib/owners";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 企业版 } from "@/lib/enterprise/switch";
import { 新建分配方式数据 } from "@/lib/project/after-create-assign";
import { 企业版字典 } from "@/lib/project/nodes";
import { 计时起点, 节点超时天数 } from "@/lib/project/timeout";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import type { 建档数据 } from "./ProjectWizard";
import type { SessionUser } from "@/lib/auth";
import { 新建只给自己 } from "@/lib/enterprise/import-perm";

/**
 * 向导要的数据：客户页「新增客户」、项目页「新增项目」、新线索页的建档弹窗（U-新建-01）共用。调用方自己先认人、判项目模式。
 * 单独一个文件、只 import type 向导：客户页的服务端代码从 screen.tsx 拿会把整个向导（连渠道选择器）
 * 打进客户列表首屏，弹窗那边是点了才加载的（速度闸门，10-31）
 */
export async function 建档向导数据(me: SessionUser): Promise<建档数据> {
  // 企业版开了超时回收：首条沟通要填下一步时间（lib/project/wizard.ts 规整向导 也拦）；企业版没开也能选填（验收 #4）
  // 企业版新建线索：渠道、负责人、跟进节点必选（节点只到线索验证，11-05 去掉明确回复）（lib/project/wizard.ts 规整向导 + 建档向导 也拦）
  // 四样互不依赖，一起取（11-01 速度闸门：原来渠道、分配方式各等一轮）
  const 企 = 企业版();
  const [users, 规则, 渠道们, 分配方式们, 只给自己] = await Promise.all([
    负责人候选(),
    生效组织规则(),
    企 ? 可选渠道们() : null,
    企 ? 新建分配方式数据(me) : null,
    企 ? 新建只给自己(me) : false,
  ]);
  // 客户只给自己（10-27 会议）：新建弹窗没开项目时「客户负责人」不给选（服务端 saveCustomer 同样落到自己）
  const 企业 = 企 ? { 渠道们: 渠道们!, 节点们: 企业版字典.节点们.线索, ...分配方式们!, 客户只给自己: 只给自己, 回收预估: 回收预估(规则) } : null;
  return { users, 要下一步: 规则.超时回收.开, 企业 };
}

/**
 * 新建的项目哪天会被超时回收（指定回复时间晚于它就黄条提示）：起点日 + 所选进程的天数，外贸按外贸那套（timeout.ts 超时回收日 同一个算法）。
 * 11-18 起下一步时间只提醒、不收回，回收日不看下一步时间。超时回收关着 = null（不提示）
 */
function 回收预估(规则: Awaited<ReturnType<typeof 生效组织规则>>) {
  if (!规则.超时回收.开) return null;
  const 们 = (线: string) => Object.fromEntries(企业版字典.节点们.线索.map((n) => [n, 节点超时天数(规则, n, 企业版字典, 线) ?? 0]));
  return { 起点日: 计时起点(规则, new Date()).format("YYYY-MM-DD"), 内贸: 们("内贸"), 外贸: 们("外贸") };
}
