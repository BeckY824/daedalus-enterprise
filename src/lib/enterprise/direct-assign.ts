/**
 * 市场成员新建时直接把负责人选成别人 = 一次指定分配，记一条分配记录（11-18 加急）。
 *
 * 客户 11-18 定「指定分配也计数」；同日补充：只针对市场成员、市场管理新建客户 / 线索时把负责人直接选成销售，销售自己新建的不适用。
 * 以前这种分法只发「分给你」通知、不写 EntLeadAssign，接手人本月已分一直是 0，自动分配顺序只剩开号先后，「快轮到我」的数也不对。
 *
 * - 谁算市场成员：业务角色有市场管理（marketing_mgr）或渠道运营（channel_ops），只认 EntMember 业务角色，不看账号 ADMIN / MANAGER；
 *   按部门认的市场成员（X-93）不算（客户原话说的是这两种岗位，和 按区域分配 同一组）
 * - 只记「新建」：新建客户页（客户自带的潜客培育项目）、建档向导 / 新线索 / 首页 AI 新线索卡（走建档向导）、建档只建客户、客户页新增项目。
 *   改负责人、转让、公海分配、导入都不是新建，不记
 * - 以项目为单位：企业版只用项目（新线索 = 线索阶段的项目），一个新建动作落一个项目，一条记录挂 projectId；
 *   客户层不另记（建档向导里客户随项目一起转给销售，客户、项目各记一条就重了）
 * - 已经走分配线索（指定 / 自动 / 定时到点）写过记录的不重复记：同一个项目有记录就跳过；项目还在公海、待分配、定时分配里的不记（那是别的分法）
 * - 字段同 leads/assign-actions 指定分配：way = 分配方式字典第 0 项的叫法（默认「指定分配」），kind 营销（项目没有线索种类这一格），
 *   counted 走 计不计数、month 走 月份()；fromUserId = 建的人（新线索建出来那一刻在他手上，同建档向导自动分配记的）
 * - 记完照分配通知末尾那样推一次「快轮到」（notice-sources 分配后估算推送），排位跟着变
 * - 只是顺带记数：读写出错只打日志、不连累已经建好的客户和项目（同通知）
 */
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "./switch";
import { 读组织 } from "./org";
import type { 组织 } from "./org-core";
import { 按区域分配of, 默认分配方向, 本人事业部, type 定线号 } from "./customer-region";
import type { 客户地址 } from "./customer-v2";
import { 分配方式叫法 } from "./dict";
import { 读线部门 } from "./assign-eta";
import { 客户号们 } from "./assign-direction-db";
import { 企划线索计数key, 月份, 计不计数, type 线 } from "./lead-assign";
import { 分配后估算推送 } from "./notice-sources";

/** 这次新建算不算市场成员的指定分配：建的人是市场成员（按业务角色）、负责人是另一个人 */
export function 新建算指定分配(org: Pick<组织, "成员">, 建的人: string, 负责人: string | null | undefined): boolean {
  return !!负责人 && 负责人 !== 建的人 && 按区域分配of(org, 建的人);
}

/**
 * 记哪条线：项目业务线（内贸 / 外贸，建档时选的）→ 客户区域（客户地址空看项目所在地）→ 客户的号 → 接手人的事业部 → null。
 * 「暂不分配」、没填的往下判
 */
export function 新建指定方向(x: {
  业务线: string | null | undefined; 客户?: Partial<客户地址> | null; 项目?: Partial<客户地址> | null; 号们?: readonly 定线号[]; 接手人线?: 线 | null;
}): 线 | null {
  if (x.业务线 === "内贸" || x.业务线 === "外贸") return x.业务线;
  return 默认分配方向({ 客户: x.客户, 项目: x.项目, 号们: x.号们 ?? [], 本人线: x.接手人线 ?? null }).线;
}

const 址 = { addrCountry: true, addrProvince: true, addrCity: true, addrDistrict: true } as const;

/** 写那一条；没写（不算 / 已有记录 / 项目不在）回 false */
async function 写一条(me: { id: string }, projectId: string, org: 组织): Promise<boolean> {
  // 建好以后项目多半已经不在我名下（转给销售了），放开范围读
  const p = await 看全部(() => prisma.project.findUnique({
    where: { id: projectId },
    select: { ownerId: true, customerId: true, bizLine: true, pooledAt: true, awaitAssignAt: true, scheduledAssignAt: true, ...址, customer: { select: 址 } },
  }));
  if (!p || p.pooledAt || p.awaitAssignAt || p.scheduledAssignAt) return false;
  if (!新建算指定分配(org, me.id, p.ownerId)) return false;
  if (await prisma.entLeadAssign.findFirst({ where: { projectId }, select: { id: true } })) return false;
  const { customer, ownerId, bizLine, addrCountry, addrProvince, addrCity, addrDistrict } = p;
  const line = 新建指定方向({
    业务线: bizLine, 客户: customer, 项目: { addrCountry, addrProvince, addrCity, addrDistrict },
    号们: await 客户号们(p.customerId), 接手人线: 本人事业部(org, await 读线部门(), ownerId),
  });
  const kind = "营销" as const;
  const [企划算数, way] = await Promise.all([getSetting<boolean>(企划线索计数key), 分配方式叫法(0)]);
  await prisma.entLeadAssign.create({
    data: { projectId, toUserId: ownerId, fromUserId: me.id, byUserId: me.id, line, kind, counted: 计不计数(kind, 企划算数), month: 月份(), way },
  });
  return true;
}

/**
 * 新建完调这一句（事务提交以后）：市场成员把新建的这个项目直接给了别人，就记一条指定分配、推一次「快轮到」。
 * 不是企业版、不是市场成员、负责人是自己、已有分配记录的什么都不做。回写没写（测试用）
 */
export async function 记新建指定分配(me: { id: string }, projectId: string | null | undefined): Promise<boolean> {
  if (!企业版() || !projectId) return false;
  let 写了 = false;
  try {
    写了 = await 写一条(me, projectId, await 读组织());
  } catch (e) {
    console.warn("[分配记录] 新建指定分配没记上：", e instanceof Error ? e.message : e);
    return false;
  }
  if (写了) await 分配后估算推送();
  return 写了;
}
