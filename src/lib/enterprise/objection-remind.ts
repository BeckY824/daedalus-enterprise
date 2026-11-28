/**
 * E-436 二 / E-444 ⑦：转让异议的两类提醒（客户 11-28 E-444 第 7 条）。都挂在每分钟的钟上（lib/project/nightly.ts），北京 08:00 后才发、一天最多算一遍；
 * 多进程只在拿到 jobs 锁的那个进程里跑（钟本身就只在那个进程里起，instrumentation.ts）。只提醒，不改任何异议的结果。
 * 工作日 = 扣法定节假日、认调休上班（cn-workday.ts，和超时自动转同一张表）。
 *
 *  1. 待裁定满 5 个整工作日没人裁（到点 = 提异议日之后第 5K+1 个工作日 08:00，K = 第几次）：提醒当前裁定人（按组织重算，停用的自然不在）+ 全部在职系统管理员；之后每再满 5 个整工作日提醒一次，直到裁定
 *     （裁定 / 撤销后状态不再是「待裁定」，自然不再发）。标题带「第 N 次提醒」。起算 = 提异议那天（北京日）之后第 1 个工作日算第 1 天。
 *     去重键 objection-remind:<id>:<N>，同一条同一次只记一行；钟停了几天再起，只补当下该发的那一次（不一口气补发 1..N）。
 *  2. 待手工退回到点没处理：提醒全部在职系统管理员。起算 = 裁定那天之后。口径（我方回执）：每条到点（裁定日之后满 3 个整工作日，即第 4 个工作日 08:00）时提醒一次，
 *     同一天到点的几条合成一条发，一天最多一条（key objection-manual-return:YYYY-MM-DD）。
 *     客户可能改成「没处理就每天提醒」：「每条只提醒一次」只是 手工退回要提醒 这一处判断，改成每天提醒只动它（见该函数注释）。
 */
import type { EntTransferObjection } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/settings";
import { beijingWallIso } from "@/lib/business-clock";
import { 企业版 } from "./switch";
import { notify } from "./notify";
import { 读组织 } from "./org";
import { 系统管理员们 } from "./tri-state-people";
import { 重算裁定人们 } from "./objection";
import { 是工作日, 北京日, 下一天 } from "./cn-workday";
import { 异议待裁定, 异议待手工退回 } from "./objection-core";

/** 待裁定每满几个工作日提醒一次 */
export const 待裁提醒工作日 = 5;
/** 待手工退回满几个工作日没处理就提醒 */
export const 手工退回提醒工作日 = 3;
export const 待裁提醒水位键 = "entObjRemindJudgeDay";
export const 手工退回提醒水位键 = "entObjRemindManualDay";

/** 从起日（不含）到止日（含）有几个工作日（扣法定节假日、认调休上班） */
export function 工作日数含节假日(起日: string, 止日: string): number {
  let n = 0;
  for (let d = 下一天(起日); d <= 止日; d = 下一天(d)) if (是工作日(d)) n++;
  return n;
}

/** 起日（不含）往后数第 n 个工作日是哪天 */
export function 第几个工作日(起日: string, n: number): string {
  let d = 起日;
  for (let k = 0; k < n; ) {
    d = 下一天(d);
    if (是工作日(d)) k++;
  }
  return d;
}

/** 到今天是第几次提醒（0 = 还没满 5 个整工作日）。第 K 次到点日 = 提异议日之后第 5K+1 个工作日（今天之前已过完几个整工作日，所以数到今天要减 1） */
export const 待裁第几次 = (提于: Date, 今天: string): number => Math.floor(Math.max(0, 工作日数含节假日(北京日(提于), 今天) - 1) / 待裁提醒工作日);

/**
 * 这条待手工退回今天要不要提醒（唯一的一处判断）。现在 = 「每条只提醒一次」：到点那天（裁定日之后第 4 个工作日 08:00，即满 3 个整工作日）起、
 * 还没提醒过（到点日在水位之后）。客户改成「没处理就每天提醒」时，把这一行改成 `工作日数含节假日(裁定日, 今天) > 手工退回提醒工作日` 即可，不用动别处。
 */
export function 手工退回要提醒(裁定于: Date, 今天: string, 水位: string | null): boolean {
  const 到点日 = 第几个工作日(北京日(裁定于), 手工退回提醒工作日 + 1);
  return 到点日 <= 今天 && (!水位 || 到点日 > 水位);
}

const 话of = (r: EntTransferObjection) => `${r.kind}「${r.targetName}」`;
const 北京八点后 = (现在: Date) => beijingWallIso(现在).slice(11, 16) >= "08:00";

async function 在职系统管理员们(): Promise<string[]> {
  const org = await 读组织();
  return org ? 系统管理员们(org) : [];
}

/** 一：待裁定满 5 个工作日 */
export async function 钟上待裁提醒(现在: Date = new Date()): Promise<number> {
  if (!企业版() || !北京八点后(现在)) return 0;
  const 今天 = 北京日(现在);
  if ((await getSetting<string>(待裁提醒水位键)) === 今天) return 0;
  const 行们 = await prisma.entTransferObjection.findMany({ where: { status: 异议待裁定 }, orderBy: [{ submittedAt: "asc" }, { id: "asc" }], take: 500 });
  if (行们.length >= 500) console.warn("[objection-remind] 待裁定超过 500 条，只算前 500 条，后面的这次不提醒");
  const 到点 = 行们.map((r) => ({ r, 第: 待裁第几次(r.submittedAt ?? r.createdAt, 今天) })).filter((x) => x.第 >= 1);
  let 发了 = 0;
  if (到点.length) {
    const 管理员们 = await 在职系统管理员们();
    const 管理员集 = new Set(管理员们);
    const 现裁 = await 重算裁定人们(到点.map((x) => x.r));
    const 人名 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(到点.map((x) => x.r.objectorUserId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    for (const { r, 第 } of 到点) {
      const 裁定人 = [...new Set(现裁.get(r.id)?.ids ?? [])];
      const 只管理员 = [...管理员集].filter((id) => !裁定人.includes(id));
      const 内容 = {
        kind: "异议", title: `转让异议已 ${第 * 待裁提醒工作日} 个工作日没人裁定（第 ${第} 次提醒）：${话of(r)}`,
        body: `${人名.get(r.objectorUserId) ?? "同事"}对${话of(r)}的转让异议自提出起已满 ${第 * 待裁提醒工作日} 个工作日还没裁定，请尽快裁定；这是第 ${第} 次提醒，裁定前每满 ${待裁提醒工作日} 个工作日再提醒一次`,
        key: `objection-remind:${r.id}:${第}`,
      };
      // 裁定人落「待我裁定」并高亮这一条；只是系统管理员的落「全部待裁定」并高亮
      if (裁定人.length) 发了 += await notify(裁定人, { ...内容, link: `/objections?j=${r.id}` });
      if (只管理员.length) 发了 += await notify(只管理员, { ...内容, link: `/objections?tab=all&j=${r.id}` });
    }
  }
  await setSetting(待裁提醒水位键, 今天);
  return 发了;
}

/** 二：待手工退回到点没处理，合成一条发给全部在职系统管理员 */
export async function 钟上手工退回提醒(现在: Date = new Date()): Promise<number> {
  if (!企业版() || !北京八点后(现在)) return 0;
  const 今天 = 北京日(现在);
  const 水位 = (await getSetting<string>(手工退回提醒水位键)) || null;
  if (水位 === 今天) return 0;
  const 行们 = await prisma.entTransferObjection.findMany({ where: { status: 异议待手工退回, judgedAt: { not: null } }, orderBy: [{ judgedAt: "asc" }, { id: "asc" }], take: 500 });
  if (行们.length >= 500) console.warn("[objection-remind] 待手工退回超过 500 条，只算前 500 条，后面的这次不提醒");
  const 到点 = 行们.filter((r) => 手工退回要提醒(r.judgedAt as Date, 今天, 水位));
  let 发了 = 0;
  if (到点.length) {
    const 管理员们 = await 在职系统管理员们();
    if (管理员们.length) {
      const 列 = 到点.slice(0, 5).map((r) => `${话of(r)}`).join("、") + (到点.length > 5 ? ` 等 ${到点.length} 条` : "");
      发了 = await notify(管理员们, {
        kind: "异议", title: `${到点.length} 条待手工退回超过 ${手工退回提醒工作日} 个工作日没处理`,
        body: `${列}。裁定撤回后需要系统管理员手工退回并点「已手工退回」`,
        link: "/objections?tab=hand", key: `objection-manual-return:${今天}`,
      });
    } else {
      // 当天没有在职系统管理员：不写水位，等有人以后这几条还能提醒
      return 0;
    }
  }
  await setSetting(手工退回提醒水位键, 今天);
  return 发了;
}
