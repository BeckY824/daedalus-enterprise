/**
 * 企业版首页四张指标卡的取数（口径在 home-cards.ts）。
 * 数谁的：看板的人（board-member.ts）给的那一圈——业务员只自己，老板 / 总管理员全员，别的上级自己 + 直属和间接下属；
 * 在带限定的 prisma 之上再加 ownerId in 这一圈，和点进 /projects?f=… 用的是同一个 prisma、同一组条件、同一圈人。
 * 项目卡一条 count；即将逾期要算回收日（起点取建项目、最近留痕、客户最近跟进三者最晚的），库里粗筛后只读算日子要的几列。
 * 只数 首页摆的卡 里的，没摆的不查。
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { 项目回收日, 算超时要的 } from "./db";
import { 字典of } from "./stage-dict";
import type { 组织规则 } from "./org-rules";
import { 看板的人 } from "./board-member";
import { 首页卡条件, 即将逾期, 即将逾期粗筛, 首页摆的卡, type 首页卡键, type 首页卡数 } from "./home-cards";

/** 卡和项目页按哪一圈负责人筛：undefined = 不另筛（老板 / 总管理员、或不是企业版） */
export async function 首页卡的人(user: { id: string; role: string }): Promise<readonly string[] | undefined> {
  return (await 看板的人(user)).谁;
}
const 负责人在 = (谁?: readonly string[]) => (谁 ? { ownerId: { in: [...谁] } } : {});

/** 粗筛出来的项目里，回收日真在 即将逾期天数 以内的 id（项目页 f=due-soon 也用它）；谁 = 只数这些人负责的 */
export async function 即将逾期的项目(规则: 组织规则, 今: Date = new Date(), 谁?: readonly string[]): Promise<string[]> {
  const 粗 = 即将逾期粗筛(规则, 字典of(企业版()), 今);
  if (!粗) return [];
  const 们 = await prisma.project.findMany({ where: { ...粗, ...负责人在(谁) }, select: 算超时要的 });
  return 们.filter((p) => 即将逾期(项目回收日(规则, p), 今)).map((p) => p.id);
}

/** user = 当前登录的人（按他能看的那一圈数）；摆的 默认就是首页那一列，单测可以传别的 */
export async function 数首页卡(user: { id: string; role: string }, 今: Date = new Date(), 摆的: readonly 首页卡键[] = 首页摆的卡): Promise<首页卡数> {
  const [规则, 谁] = await Promise.all([生效组织规则(), 首页卡的人(user)]);
  const 字典 = 字典of(企业版());
  const 数 = async (键: 首页卡键): Promise<number> => {
    if (键 === "due-soon") return (await 即将逾期的项目(规则, 今, 谁)).length;
    return prisma.project.count({ where: { ...首页卡条件(键, 规则, 字典, 今), ...负责人在(谁) } });
  };
  const 数们 = await Promise.all(摆的.map(数));
  return Object.fromEntries(摆的.map((键, i) => [键, 数们[i]]));
}
