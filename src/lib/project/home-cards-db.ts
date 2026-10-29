/**
 * 企业版首页四张指标卡的取数（口径在 home-cards.ts）。
 * 走带限定的 prisma：业务员只数自己看得到的，老板数全员——和点进 /projects?f=… 用的是同一个 prisma、同一组条件。
 * 前三张一条 count；即将逾期要算回收日（起点取建项目、最近留痕、客户最近跟进三者最晚的），库里粗筛后只读算日子要的几列。
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { 项目回收日, 算超时要的 } from "./db";
import { 字典of } from "./stage-dict";
import type { 组织规则 } from "./org-rules";
import { 首页卡条件, 即将逾期, 即将逾期粗筛, type 首页卡键, type 首页卡数 } from "./home-cards";

/** 粗筛出来的项目里，回收日真在 即将逾期天数 以内的 id（项目页 f=due-soon 也用它） */
export async function 即将逾期的项目(规则: 组织规则, 今: Date = new Date()): Promise<string[]> {
  const where = 即将逾期粗筛(规则, 字典of(企业版()), 今);
  if (!where) return [];
  const 们 = await prisma.project.findMany({ where, select: 算超时要的 });
  return 们.filter((p) => 即将逾期(项目回收日(规则, p), 今)).map((p) => p.id);
}

export async function 数首页卡(今: Date = new Date()): Promise<首页卡数> {
  const 规则 = await 生效组织规则();
  const 字典 = 字典of(企业版());
  const 数 = (键: 首页卡键) => prisma.project.count({ where: 首页卡条件(键, 规则, 字典, 今) });
  const [本月新增, 重点, 未跟进, 将逾期] = await Promise.all([数("month-new"), 数("key"), 数("no-follow"), 即将逾期的项目(规则, 今)]);
  return { "month-new": 本月新增, key: 重点, "no-follow": 未跟进, "due-soon": 将逾期.length };
}
