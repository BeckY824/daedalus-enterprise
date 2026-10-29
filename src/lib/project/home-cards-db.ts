/**
 * 企业版首页四张指标卡的取数（口径在 home-cards.ts）。
 * 走带限定的 prisma：业务员只数自己看得到的，老板数全员——和点进 /projects?f=… 用的是同一个 prisma、同一组条件。
 * 项目卡一条 count；即将逾期要算回收日（起点取建项目、最近留痕、客户最近跟进三者最晚的），库里粗筛后只读算日子要的几列。
 * 今日待办数的是这个人名下今天到期的计划和待办，逾期的另给（逾期待办）；用复盘页同一个 复盘待办计数，卡上的数 = 点进去的条数。
 * 只数 首页摆的卡 里的，没摆的不查。
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { 项目回收日, 算超时要的 } from "./db";
import { 字典of } from "./stage-dict";
import type { 组织规则 } from "./org-rules";
import { 复盘待办计数 } from "./board-todos-db";
import { dayjs } from "@/lib/utils";
import { 首页卡条件, 即将逾期, 即将逾期粗筛, 首页摆的卡, type 首页卡键, type 首页卡数 } from "./home-cards";

/** 粗筛出来的项目里，回收日真在 即将逾期天数 以内的 id（项目页 f=due-soon 也用它） */
export async function 即将逾期的项目(规则: 组织规则, 今: Date = new Date()): Promise<string[]> {
  const where = 即将逾期粗筛(规则, 字典of(企业版()), 今);
  if (!where) return [];
  const 们 = await prisma.project.findMany({ where, select: 算超时要的 });
  return 们.filter((p) => 即将逾期(项目回收日(规则, p), 今)).map((p) => p.id);
}

/** 我 = 当前登录的人（今日待办数他名下的）；摆的 默认就是首页那一列，单测可以传别的 */
export async function 数首页卡(我: string, 今: Date = new Date(), 摆的: readonly 首页卡键[] = 首页摆的卡): Promise<首页卡数> {
  const 规则 = await 生效组织规则();
  const 字典 = 字典of(企业版());
  let 逾期待办: number | undefined;
  const 数 = async (键: 首页卡键): Promise<number> => {
    if (键 === "today-todo") {
      const 计数 = await 复盘待办计数(我, dayjs(今));
      逾期待办 = 计数.overdue;
      return 计数.today;
    }
    if (键 === "due-soon") return (await 即将逾期的项目(规则, 今)).length;
    return prisma.project.count({ where: 首页卡条件(键, 规则, 字典, 今) });
  };
  const 数们 = await Promise.all(摆的.map(数));
  const 卡数: 首页卡数 = Object.fromEntries(摆的.map((键, i) => [键, 数们[i]]));
  if (逾期待办 !== undefined) 卡数.逾期待办 = 逾期待办;
  return 卡数;
}
