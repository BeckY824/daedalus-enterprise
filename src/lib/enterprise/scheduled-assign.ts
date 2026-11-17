/**
 * 企业版「指定分配时间」（11-17，两字段方案 PR3）：新建线索选指定分配 / 自动分配时可以选「指定时间」，到点由后台定时任务分出去。
 *
 * 到点前（方案第五节「定时分配到点前谁管」，按现行待分配推，交付时说明）：
 *   - 项目建在录入人名下、标待分配（awaitAssignAt，P-转-21）+ 定时两列（Project.scheduledAssignAt / scheduledAssignTo，迁移 149）；
 *     建的人只占负责人一格、不算持有，能看、改字段，不能初判、推进、删除。建的时候不发「有线索待分配」的催分提醒
 *   - 录入人和能分配的人（市场管理、销售管理、总管理员）能改时间、改接手人、改成现在分配（立刻执行）、取消定时（留在待分配等人分），
 *     见 app/(app)/leads/schedule-actions.ts；能分配的人直接手动分，定时随之作废
 *   - 作废按状态判（钟上每遍先扫一次）：凡清了待分配标记（转客户、改负责人、领取、进公海、离职交接、手动分）、有了结局、转了商机、
 *     进了回收站的，定时两列一起清掉，不再到点执行
 *
 * 到点（钟上每分钟一遍，lib/project/nightly.ts，多进程只一个进程跑）：按到点时的规则执行——指定分配给选的那位（照查持有上限、
 * 接手人在不在、有没有业务角色），自动分配那时再挑人（候选、参与状态照当时；按区域定事业部 P-转-26 上线后自动跟着走）；
 * 照常发「分给你」的提醒（站内 + 飞书），多一句「按定时分配，原定 HH:mm」；操作人记「系统」；市场分给销售客户随行（X-18）。
 * 分不出去：不分、留在待分配，提醒能分配的人和录入人，写明原定时间和原因（「线索分配」开关关着只提醒总管理员，X-79）；不自动改分给别人。
 * 停机补跑：开机那遍把「时刻已过、还没执行」的全部执行，通知里写「服务停过，晚了 N 分钟」；按状态判，不另记水位。
 * 计时：到点前不算持有；分配生效那刻起才算接手人的（超时回收从转让痕起算、持有上限按生效时查、分配数记在生效那个月）。
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 看已删 } from "./soft-delete-core";
import { 企业版 } from "./switch";
import { 视图中跳过 } from "./view-as";
import { 读组织 } from "./org";
import { 规则开着 } from "./rules";
import { 发待分配提醒 } from "./lead-full-notice";
import { notify } from "./notify";
import { 定时分配令牌 } from "./scheduled-assign-token";
import { 系统 } from "@/lib/project/timeout";
import { 短时刻 } from "@/lib/project/time-fields";
import { 定时分出去 } from "@/app/(app)/leads/assign-actions";
import type { SessionUser } from "@/lib/auth";
import type { 组织 } from "./org";
import { 能分配 } from "./lead-assign";
import { 只读角色 } from "./permissions";

/** 后台执行时的操作人：「系统」（同超时回收，QA #16）。不是真账号，留痕显示「系统」 */
export const 系统操作人: SessionUser = { id: 系统.id, name: 系统.name, email: "", role: "ADMIN", title: "" };

/** 谁能改 / 取消 / 改成现在分配一条定时：录入人（还占着负责人一格）或能分配的人；只读身份、切换视图不行（项目详情、schedule-actions.ts 同一份） */
export function 能动定时(me: SessionUser, p: { ownerId: string; creatorId: string }, org: 组织): boolean {
  if (me.视图由 || 只读角色(me, org)) return false;
  return (p.creatorId === me.id && p.ownerId === me.id) || 能分配(org, me);
}

/** 定时两列清空 */
export const 清定时 = { scheduledAssignAt: null, scheduledAssignTo: null } as const;

/** 晚了几分钟以上才说「服务停过」（钟一分钟一遍，正常也会晚几十秒） */
const 算晚了分钟 = 2;

/** 建好之后标成「待分配（定时）」：只认还在线索阶段、没结局、不在公海的 */
export async function 标定时分配(projectId: string, at: Date, 接手人: string | null, 今 = new Date()): Promise<boolean> {
  if (!企业版()) return false;
  const r = await prisma.project.updateMany({
    where: { id: projectId, phase: "线索", result: null, pooledAt: null },
    data: { awaitAssignAt: 今, scheduledAssignAt: at, scheduledAssignTo: 接手人 },
  });
  return r.count === 1;
}

/** 状态不对了的定时一律作废（见文件头）；回作废了几条 */
export async function 作废失效定时(): Promise<number> {
  const 失效 = await prisma.project.updateMany({
    where: { scheduledAssignAt: { not: null }, OR: [{ awaitAssignAt: null }, { pooledAt: { not: null } }, { result: { not: null } }, { phase: { not: "线索" } }] },
    data: 清定时,
  });
  // 进了回收站的：限定层平时滤掉已删的，这里专门看已删的那些
  const 删了 = await 看已删(() => prisma.project.updateMany({ where: { scheduledAssignAt: { not: null }, deletedAt: { not: null } }, data: 清定时 }));
  return 失效.count + 删了.count;
}

/** 通知里那一句：原定时间，停过机再说晚了多久 */
export function 定时附言(原定: Date, 现在: Date): string {
  const 晚 = Math.floor((现在.getTime() - 原定.getTime()) / 60_000);
  return `按定时分配，原定 ${短时刻(原定, 现在)}${晚 >= 算晚了分钟 ? `，服务停过，晚了 ${晚} 分钟` : ""}`;
}

export type 定时执行结果 = { ok: true; 接手人: string } | { ok: false; error: string };

/**
 * 执行一条：先把定时两列清掉占住（同一条只执行一次），再按指定 / 自动分。谁 = 操作人（钟上是系统，「改成现在分配」是点的人）。
 * 分不出去：留在待分配，提醒能分配的人和录入人
 */
export async function 执行一条定时(p: { id: string; name: string; creatorId: string; scheduledAssignAt: Date; scheduledAssignTo: string | null }, 谁: SessionUser, 现在: Date): Promise<定时执行结果> {
  const 占 = await prisma.project.updateMany({ where: { id: p.id, scheduledAssignAt: p.scheduledAssignAt, awaitAssignAt: { not: null } }, data: 清定时 });
  if (占.count !== 1) return { ok: false, error: "这条定时已经执行过、改过或取消了" };
  const 附 = 谁.id === 系统操作人.id ? 定时附言(p.scheduledAssignAt, 现在) : `原定 ${短时刻(p.scheduledAssignAt, 现在)} 定时分配，${谁.name} 改成现在分配`;
  const r: 定时执行结果 = (await 规则开着("线索分配"))
    ? await 定时分出去(定时分配令牌, 谁, p.id, p.scheduledAssignTo, 附)
    : { ok: false, error: "规则「线索分配」关着，没人能分" };
  if (!r.ok) await 分不出去提醒(p, r.error, 附, 现在);
  return r;
}

async function 分不出去提醒(p: { id: string; name: string; creatorId: string; scheduledAssignAt: Date }, 为什么: string, 附: string, 现在: Date) {
  try {
    const org = await 读组织();
    const 建的人 = await prisma.user.findUnique({ where: { id: p.creatorId }, select: { name: true } });
    const 话 = `定时分配没分出去（${附}）：${为什么}`;
    await 发待分配提醒(org, [p.name], 建的人?.name ?? "录入人", 话, 现在);
    // 录入人另收一条（他多半不在能分配的人里）：说清还留在待分配
    await notify([p.creatorId], {
      kind: "待分配",
      title: `定时分配没分出去：${p.name}`,
      body: `${话}。线索留在新线索待分配，等市场管理、销售管理或总管理员手动分。`,
      link: `/projects/${encodeURIComponent(p.id)}`,
      key: `sched-fail:${p.id}:${p.scheduledAssignAt.toISOString()}`,
    });
  } catch (e) {
    console.error("[定时分配] 分不出去的提醒没发出去", e);
  }
}

export type 定时分配明细 = { 执行: number; 没分出去: number; 作废: number };

/** 钟上一遍：先作废失效的，再执行到点的（最早的先）。从不抛 */
export async function 定时分配扫一遍(现在: Date = new Date()): Promise<定时分配明细> {
  const 明细: 定时分配明细 = { 执行: 0, 没分出去: 0, 作废: 0 };
  if (!企业版()) return 明细;
  try {
    if (await 视图中跳过()) return 明细;
    await 看全部(async () => {
      明细.作废 = await 作废失效定时();
      const 到点 = await prisma.project.findMany({
        where: { scheduledAssignAt: { lte: 现在 }, awaitAssignAt: { not: null } },
        orderBy: [{ scheduledAssignAt: "asc" }, { id: "asc" }],
        select: { id: true, name: true, creatorId: true, scheduledAssignAt: true, scheduledAssignTo: true },
      });
      for (const p of 到点) {
        try {
          const r = await 执行一条定时({ ...p, scheduledAssignAt: p.scheduledAssignAt! }, 系统操作人, 现在);
          if (r.ok) 明细.执行++;
          else 明细.没分出去++;
        } catch (e) {
          明细.没分出去++;
          console.error(`[定时分配] ${p.id} 执行出错`, e);
        }
      }
    });
  } catch (e) {
    console.error("[定时分配] 这一遍没扫成，下一遍再试", e);
  }
  return 明细;
}

export const 钟上定时分配 = 定时分配扫一遍;
