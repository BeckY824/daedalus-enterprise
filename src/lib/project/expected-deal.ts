/**
 * 企业版预计成交日期从客户挪到项目（2026-10-27）：项目上的 expectedDealAt（migrations/061）。
 * 节点必填「预计成交日期」读项目这一格（required.ts）；客户上的 expectedSignAt 不动，不是企业版照旧只有客户那格。
 *
 * 老数据回填只做一次：客户填了预计签约、名下只有一个进行中（没结局）的项目，就搬到这个项目上；
 * 有好几个进行中项目的不猜是哪一个，留空等销售在项目上填。项目上已经填了的不盖。
 * 跟着服务启动（instrumentation.ts）和打开项目列表跑；做完记一个记号，之后只读一次设置就回
 */
import { prisma } from "../prisma";
import { getSetting, setSetting } from "../settings";
import { 企业版 } from "@/lib/enterprise/switch";

export const 回填记号键 = "projectExpectedDealBackfilled";

const g = globalThis as unknown as { __entExpectedDealBackfill?: Promise<number> };

/** 回填一遍，返回搬了几个项目。不是企业版、或已经做过：什么都不做 */
export async function 回填预计成交(): Promise<number> {
  if (!企业版()) return 0;
  if (await getSetting<boolean>(回填记号键)) return 0;
  const 客户们 = await prisma.customer.findMany({
    where: { expectedSignAt: { not: null }, projects: { some: { result: null } } },
    select: { id: true, expectedSignAt: true, projects: { where: { result: null }, select: { id: true, expectedDealAt: true }, take: 2 } },
  });
  let 搬了 = 0;
  for (const c of 客户们) {
    if (c.projects.length !== 1 || c.projects[0].expectedDealAt) continue;
    // 只在还空着的时候写：读完到写之间有人在项目上填了，不盖
    const r = await prisma.project.updateMany({ where: { id: c.projects[0].id, expectedDealAt: null }, data: { expectedDealAt: c.expectedSignAt } });
    搬了 += r.count;
  }
  await setSetting(回填记号键, true);
  return 搬了;
}

/** 同一个进程里只跑一遍（项目列表每次打开都调，别每次都查）；出错下次再试 */
export function 回填一次(): Promise<number> {
  g.__entExpectedDealBackfill ??= 回填预计成交().catch((e) => {
    g.__entExpectedDealBackfill = undefined;
    console.error("[预计成交] 回填出错，下次再试", e);
    return 0;
  });
  return g.__entExpectedDealBackfill;
}

/** 测试用：忘掉这个进程跑过 */
export function 忘掉回填(): void {
  g.__entExpectedDealBackfill = undefined;
}
