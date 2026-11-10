/**
 * 企业版首页四张指标卡的取数（口径在 home-cards.ts）。
 * 数谁的：看板的人（board-member.ts）给的那一圈 = 项目列表按负责人能看到的人（组织范围of）——最下级只自己，
 * 总管理 / 管理员全员，别的上级自己 + 实线下属整条链 + 虚线下属；没设业务角色谁都不数。
 * 11-01 起和复盘一样只按负责人数：市场「自己建的项目」那一圈（M-角色-03/04）不再算进首页卡，项目列表里照样看得到（只读）。
 * 在带限定的 prisma 之上再加这一圈的条件（首页卡范围），和点进 /projects?f=… 用的是同一个 prisma、同一组条件、同一圈人。
 * 项目卡一条 count；即将逾期要算回收日（起点取建项目、最近留痕、客户最近跟进三者最晚的），库里先按三样都够早筛一遍（即将逾期紧筛）再只读算日子要的几列。
 * 只数 首页摆的卡 里的，没摆的不查。
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { 项目回收日, 算超时要的, 超时成员线 } from "./db";
import { 字典of } from "./stage-dict";
import type { 组织规则 } from "./org-rules";
import { 看板的人 } from "./board-member";
import type { Prisma } from "@/generated/prisma";
import { 首页卡条件, 即将逾期, 即将逾期紧筛, 首页摆的卡, type 首页卡键, type 首页卡数 } from "./home-cards";

/** 卡和项目页按哪一圈负责人筛：undefined = 不另筛（老板 / 总管理员、或不是企业版） */
export async function 首页卡的人(user: { id: string; role: string }): Promise<readonly string[] | undefined> {
  return (await 看板的人(user)).谁;
}

/**
 * 卡和点卡进去的项目页按哪一圈筛（Prisma where）：undefined = 不另筛（总管理 / 管理员、或不是企业版）。
 * 负责人在 首页卡的人 里（同复盘，只按负责人）
 */
export async function 首页卡范围(user: { id: string; role: string }): Promise<Prisma.ProjectWhereInput | undefined> {
  const 谁 = await 首页卡的人(user);
  if (!谁) return undefined;
  return { ownerId: { in: [...谁] } };
}

/** 库里先筛（即将逾期紧筛）出来的项目里，回收日真在 即将逾期天数 以内的 id（项目页 f=due-soon 也用它）；圈 = 首页卡范围（undefined = 不另筛） */
export async function 即将逾期的项目(规则: 组织规则, 今: Date = new Date(), 圈?: Prisma.ProjectWhereInput): Promise<string[]> {
  const 粗 = 即将逾期紧筛(规则, 字典of(企业版()), 今);
  if (!粗) return [];
  const [们, 成员] = await Promise.all([prisma.project.findMany({ where: { AND: [粗, ...(圈 ? [圈] : [])] }, select: 算超时要的 }), 超时成员线(规则)]);
  return 们.filter((p) => 即将逾期(项目回收日(规则, p, 成员), 今)).map((p) => p.id);
}

/** user = 当前登录的人（按他能看的那一圈数）；摆的 默认就是首页那一列，单测可以传别的 */
export async function 数首页卡(user: { id: string; role: string }, 今: Date = new Date(), 摆的: readonly 首页卡键[] = 首页摆的卡): Promise<首页卡数> {
  const [规则, 圈] = await Promise.all([生效组织规则(), 首页卡范围(user)]);
  const 字典 = 字典of(企业版());
  const 数 = async (键: 首页卡键): Promise<number> => {
    if (键 === "due-soon") return (await 即将逾期的项目(规则, 今, 圈)).length;
    // 卡的条件和圈里都可能有 OR，放进 AND 不打架
    return prisma.project.count({ where: { AND: [首页卡条件(键, 规则, 字典, 今), ...(圈 ? [圈] : [])] } });
  };
  const 数们 = await Promise.all(摆的.map(数));
  return Object.fromEntries(摆的.map((键, i) => [键, 数们[i]]));
}
