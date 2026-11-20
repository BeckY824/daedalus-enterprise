/**
 * 企业版主动放弃（豁免）（2026-11-20，批次 32H；用户 11-20：「豁免按钮可以顺带着做」「豁免按钮机制上不打架就行」「而且是每月一次」）。
 *
 * 谁、什么时候能点（全满足才出按钮）：
 *   - 组织规则「销售主动放弃线索（豁免）」开着（rules-table.ts，默认关；关着按钮不出现）
 *   - 点的人是这条线索的负责人、是销售（业务角色有 sales），不是切换视图、不是只读身份
 *   - 线索阶段、没结局、不在公海（项目和客户都不在）、不在待分配、没删
 *   - 新分配给他的（lead-giveup-core.ts 新分配时刻：市场分配（自动 / 指定 / 定时）、超时转来的、别人主动放弃转来的），
 *     接手在往回 7 天里；超时转开着时到点就被转走了，所以实际就是「接手后、超时转到点前」
 *   - 这条占过他的名额：他在这条上最近一条分配记录算数（counted），或是补发给他的；管理从公海分、企划不计数的不给（M-线索-02 没占过的不补）
 *   - 本人还没记有效沟通：同超时转的「首次沟通」口径（reply-overdue.ts 负责人跟过的 + 分配后沟通过的，只认负责人本人，
 *     有效 = reply-notice.ts 是有效沟通）。记过的不出按钮
 * 出了按钮但点不了（灰着、写为什么）：验证中（X-77，等复核、等销售：不能改负责人）；本月已经用过（每人每月 1 次，北京自然月）。
 * 夜里也能点，立即转（超时转夜里不执行那条只管系统自己转）。
 *
 * 点了（原因必填，选项 外出 / 忙不过来 / 其他，不含「线索无效 / 质量不达标」，那种走判无效）：
 *   1. 先占这个月的次数（EntLeadGiveUp 一行，(userId, month) 唯一：同时点两条只成一条）
 *   2. 按超时转同一套挑人转给本线下一位（assign-actions.ts 超时转出：这条线索的流转线、参与状态、本月分得最少、配额照查），
 *      排除这条线索上放弃过的人（EntLeadGiveUp）和这一轮超时过的人，挑不到再开新一轮（仍不给放弃过的人；超时转同样不给回他们）。挑不到 / 没转成 = 删掉占的那一行（不扣次数）、什么都不改，
 *      明确回「这条转不出去」
 *   3. 接手人照记一次「本月已分」（超时转出 不用待补、算数，同 P-转-29 ②）；放弃人原来那条分配记录照算（不退名额、不改 counted）
 *   4. 客户随线索：照超时转（reply-overdue.ts 客户随线索：原负责人手上还有这位客户别的进行中项目就留给他）
 *   5. 给放弃人记 1 条待补（EntLeadMakeup kind = giveup，方向 = 他这条的分配方向）：下一条自动分配先补给他，补发那条不计本月已分，
 *      每次只补 1 条（同 M-线索-06）。之后接手人判无效 → 只补接手人（判无效记补位只给现负责人），放弃人不重复补
 *   6. 接手人开始新的超时计时（同超时转来的）：转让留痕原因带「主动放弃（豁免）」，timeout.ts 是超时自动转痕 认它——
 *      超时链不挪分配基准、接手人从转来那一刻起算 1.5 小时；项目超时回收日不归零、跟着走的客户三态钟不归零（同超时转）。
 *      超时链在走的，链上记成接手人、计时从现在起、放弃人记进「这一轮超时过的人」（轮转不再给回他）
 *   7. 留痕：项目节点记录一行转让（操作人 系统，原因写明谁主动放弃、原因）；操作日志一条（放弃人名下，action giveup）。
 *      市场管理、销售管理在项目节点记录（项目页「进程变更」）里看得到，和超时转的记录同一处，不另开页
 *   8. 通知（站内 + 飞书，notify 同超时转的通道）：接手人收「分给你」，正文写「同事 X 主动放弃（豁免）转给你」；放弃人收一条确认
 */
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 看全部 } from "@/lib/team-scope";
import { 查完再写 } from "@/lib/check-then-write";
import { 放弃转理由 } from "@/lib/project/timeout";
import { 验证中不能改派 } from "@/lib/project/lead-verify-guard";
import { 超时转出 } from "@/app/(app)/leads/assign-actions";
import { 企业版 } from "./switch";
import { 规则开着 } from "./rules";
import { 月份 } from "./lead-assign";
import { 读组织于 } from "./org";
import { 只读角色 } from "./permissions";
import { 是销售, 负责人跟过的, 分配后沟通过的, 读试过, 本轮排除, 客户随线索, 超时提醒分钟, 客户在谁名下话, 放弃过的人, 会按超时计时 } from "./reply-overdue";
import { 超时转令牌 } from "./scheduled-assign-token";
import { 系统操作人 } from "./scheduled-assign";
import { 放弃待补种类, 是补发来的 } from "./invalid-makeup";
import { notify } from "./notify";
import { 分配通知 } from "./notice-sources";
import { 新分配时刻, 在放弃窗口, 认放弃原因, 本月用过话, 每月放弃次数, type 放弃入口 } from "./lead-giveup-core";

export * from "./lead-giveup-core";

/** 主动放弃开关：组织规则（rules-table.ts），默认关 */
export const 主动放弃开着 = (): Promise<boolean> => 规则开着("主动放弃");
/** 通知种类（铃铛里的来源） */
export const 放弃通知种类 = "主动放弃";

/** 这个月放弃过没有（北京自然月） */
export async function 本月放弃过(userId: string, 现在: Date = new Date()): Promise<boolean> {
  return !!(await prisma.entLeadGiveUp.findFirst({ where: { userId, month: 月份(现在) }, select: { id: true } }));
}

type 看的项目 = { id: string; name: string; ownerId: string; creatorId: string; customerId: string; createdAt: Date };

/**
 * 这条线索给不给我放弃（项目页按钮、点的时候都问它）：不给 = null（按钮不出现）；给但点不了 = 可 false + 为什么。
 * 只读，看全部（判定和谁在看无关，进门的权限由调用方保证：只有负责人本人会拿到非 null）
 */
export async function 放弃资格(me: Pick<SessionUser, "id" | "视图由">, projectId: string, 现在: Date = new Date()): Promise<(放弃入口 & { p: 看的项目; 接手于: Date }) | null> {
  if (!企业版() || !me?.id || me.视图由 || !(await 主动放弃开着())) return null;
  return 看全部(async () => {
    const org = await 读组织于(prisma);
    if (只读角色({ id: me.id }, org) || !是销售(org, me.id)) return null;
    const p = await prisma.project.findFirst({
      where: { id: projectId, deletedAt: null, ownerId: me.id, phase: "线索", result: null, pooledAt: null, awaitAssignAt: null, customer: { pool: null } },
      select: { id: true, name: true, ownerId: true, creatorId: true, customerId: true, createdAt: true },
    });
    if (!p) return null;
    const [痕们, 分配们] = await Promise.all([
      prisma.projectNodeLog.findMany({ where: { projectId, kind: { in: ["transfer", "pool-claim"] } }, select: { kind: true, userId: true, reason: true, toOwnerId: true, at: true } }),
      prisma.entLeadAssign.findMany({ where: { projectId }, select: { toUserId: true, byUserId: true, createdAt: true } }),
    ]);
    const 接手 = 新分配时刻(me.id, p, 痕们, 分配们);
    if (!接手 || !在放弃窗口(接手, 现在)) return null;
    // 占过名额的才给放弃、才补（M-线索-02「没占过额度的不补」）：他在这条上最近一条分配记录算数（自动 / 指定 / 定时分配、超时转来、放弃转来），
    // 或这条是补发给他的（补发 counted=false，但用掉过他的待补）。管理从公海分（P-转-29 ③）、企划不计数的 counted=false：不出按钮
    const 最近分 = await prisma.entLeadAssign.findFirst({ where: { projectId, toUserId: me.id }, orderBy: { createdAt: "desc" }, select: { counted: true } });
    if (!最近分 || (!最近分.counted && !(await 是补发来的(prisma, projectId, me.id)))) return null;
    // 本人还没记有效沟通（同超时转「首次沟通」：这位客户上他记过的、或接手以后挂这条记的，只认本人）
    const [跟过, 分配后] = await Promise.all([负责人跟过的([p]), 分配后沟通过的([{ ...p, 基: 接手 }])]);
    if (跟过.has(p.id) || 分配后.has(p.id)) return null;
    const 本月已用 = await 本月放弃过(me.id, 现在);
    const 验证中 = await 验证中不能改派(prisma, projectId);
    if (验证中) return { p, 接手于: 接手, 可: false, 为什么: `这条线索在验证中，不能放弃（不能改负责人）；验证走完或先撤回验证`, 本月已用 };
    if (本月已用) return { p, 接手于: 接手, 可: false, 为什么: 本月用过话, 本月已用 };
    return { p, 接手于: 接手, 可: true, 本月已用 };
  });
}

export type 放弃结果 = { ok: true; 接手人: string } | { ok: false; error: string };

/** Prisma 唯一键冲突（P2002）或 SQLite 的 UNIQUE constraint failed */
const 是唯一键冲突 = (e: unknown): boolean =>
  (e as { code?: string } | null)?.code === "P2002" || /UNIQUE constraint failed/i.test(String((e as Error | null)?.message ?? e));

/** 转不出去时那句（明确告诉不扣次数、线索还在手上） */
const 转不出去话 = (为什么: string, 挑不到: boolean) =>
  `${挑不到 ? "这条转不出去" : "这条没转成"}：${为什么.replace(/。?(已留在新线索待分配|这条新线索留在原处)，可以手动指派$/, "")}。没扣本月放弃次数，线索还在你手上`;

/**
 * 点「放弃」：见文件头。成了回接手人名字；不成回原因，什么都不改（占的次数退掉）。从不抛
 */
export async function 放弃线索(me: SessionUser, projectId: string, 原因: unknown, 补充: unknown, 现在: Date = new Date()): Promise<放弃结果> {
  try {
    const 认 = 认放弃原因(原因, 补充);
    const 资格 = await 放弃资格(me, projectId, 现在);
    if (!资格) return { ok: false, error: "这条线索现在不能放弃：只有新分配给你、你还没记有效沟通的线索能放弃（刷新看看）" };
    if (!资格.可) return { ok: false, error: 资格.为什么 ?? "这条线索现在不能放弃" };
    if (!认.ok) return 认;
    // 挑人要数全组本月已分、读同事的参与状态：同超时转在钟上那样看全部，不按点的人的可见范围
    return await 看全部(() => 放出去(me, 资格, 认, 现在));
  } catch (e) {
    console.error(`[主动放弃] ${projectId} 出错`, e);
    return { ok: false, error: "这次没放弃成，刷新看看再点" };
  }
}

async function 放出去(
  me: SessionUser, 资格: { p: 看的项目 }, 认: { 原因: string; 补充: string | null; 文字: string }, 现在: Date,
): Promise<放弃结果> {
  const { p } = 资格;
  const projectId = p.id;
  const 月 = 月份(现在);
  // 1. 先占次数：(userId, month) 唯一，同时点两条只成一条
  let 占: string;
  try {
    占 = (await prisma.entLeadGiveUp.create({ data: { userId: me.id, month: 月, projectId, reason: 认.原因, note: 认.补充 } })).id;
  } catch (e) {
    // 只有 (userId, month) 唯一键冲突才是「本月用过了」（同时点两条）；别的错（库锁、磁盘）照实说没放弃成
    if (是唯一键冲突(e)) return { ok: false, error: 本月用过话 };
    console.error(`[主动放弃] ${projectId} 占次数出错`, e);
    return { ok: false, error: "这次没放弃成，刷新看看再点" };
  }
  const 退次数 = () => prisma.entLeadGiveUp.deleteMany({ where: { id: 占 } }).catch((e) => console.error("[主动放弃] 退次数没退成", e));
  // 2. 挑人转出：同超时转（排除放弃人和这一轮超时过的人，挑不到开新一轮、仍不给放弃人）
  const 链 = await prisma.entReplyOverdue.findUnique({ where: { projectId }, select: { tried: true, transfers: true, stoppedAt: true } });
  const 试过 = 链 && !链.stoppedAt ? 读试过(链.tried) : [];
  const 附 = `同事 ${me.name} ${放弃转理由}转给你，原因：${认.文字}`;
  // 这条线索上放弃过的人（含刚占的这一行 = 放弃人自己）都不给，开新一轮也不给（没起链就放弃的，链里没有他们）
  const 放弃过 = await 放弃过的人(projectId);
  let 排除 = [...new Set([...本轮排除(试过, me.id), ...放弃过])];
  const 新轮排除 = [...new Set([me.id, ...放弃过])];
  let r = await 超时转出(超时转令牌, 系统操作人, projectId, me.id, 排除, 附);
  if (!r.ok && r.挑不到 && 新轮排除.length < 排除.length) {
    排除 = 新轮排除;
    r = await 超时转出(超时转令牌, 系统操作人, projectId, me.id, 排除, 附);
  }
  if (!r.ok) {
    await 退次数();
    return { ok: false, error: 转不出去话(r.error, !!r.挑不到) };
  }
  const 新 = r.接手人Id;
  // 3. 次数记上接手人、给放弃人记 1 条待补（方向 = 他这条的分配方向）
  // 线索已经转走、次数已经占上：这一步出错只记日志、照常回成功（不能让人以为没放弃成再点一次）
  try {
    await 查完再写(async (tx) => {
      const 分 = await tx.entLeadAssign.findFirst({ where: { projectId, toUserId: me.id }, orderBy: { createdAt: "desc" }, select: { line: true } });
      const 补 = await tx.entLeadMakeup.create({ data: { userId: me.id, projectId, line: 分?.line ?? null, kind: 放弃待补种类, createdAt: 现在 } });
      await tx.entLeadGiveUp.update({ where: { id: 占 }, data: { toUserId: 新, makeupId: 补.id } });
    });
  } catch (e) {
    console.error(`[主动放弃] ${projectId} 待补 / 接手人没记上（线索已转给 ${新}）`, e);
  }
  // 4. 超时链在走的：链上记成接手人、从现在起算，放弃人记进这一轮（轮转不再给回他）
  if (链 && !链.stoppedAt) {
    await prisma.entReplyOverdue.update({
      where: { projectId },
      data: { holderId: 新, since: 现在, overdueAt: null, tried: JSON.stringify([...new Set([...本轮排除(试过, me.id), me.id])]), transfers: 链.transfers + 1 },
    }).catch((e) => console.error(`[主动放弃] ${projectId} 超时链没跟上`, e));
  }
  // 5. 客户随线索（同超时转）
  const 客户 = await 客户随线索(projectId, p.customerId, me.id, 新).catch((e) => {
    console.error(`[主动放弃] ${projectId} 客户没跟过去`, e);
    return { 去向: "不动" as const, 在谁名下: null };
  });
  const 客户名下 = 客户.在谁名下 && 客户.在谁名下 !== 新
    ? (await prisma.user.findUnique({ where: { id: 客户.在谁名下 }, select: { name: true } }))?.name ?? null
    : null;
  // 6. 留痕：操作日志（项目节点记录那行 超时转出 已记，操作人 系统、原因带 附）
  await recordAudit({
    user: { id: me.id, name: me.name }, action: "giveup", entity: "Project", entityId: projectId,
    summary: `主动放弃（豁免）：「${p.name}」转给「${r.接手人}」，原因：${认.文字}`,
    detail: { 原负责人: me.id, 接手人: 新, 原因: 认.原因, ...(认.补充 ? { 补充: 认.补充 } : {}), 月: 月, 客户: 客户.去向 },
  });
  // 7. 通知：接手人收「分给你」+ 同事主动放弃那句；放弃人收确认
  // 接手人这条会按超时计时（开关开着、分配基准不早于生效时刻）才写那句；生效以前分的线索不计时，不吓人
  const 计时话 = (await 会按超时计时(projectId, 现在).catch(() => false)) ? `；请在 ${超时提醒分钟 / 60} 小时内记一条有效沟通，没记会按超时规则再转走` : "";
  await 分配通知(系统操作人, [{ projectId, toUserId: 新, ...(r.留下 ? { 留下: r.留下 } : {}) }], true, `${附}${客户名下 ? `；${客户在谁名下话(客户名下)}` : ""}${计时话}`);
  const 客户话 = 客户.去向 === "留给原负责人" ? "你手上还有这位客户别的项目，客户还在你名下；" : 客户.去向 === "跟着走" ? "客户一起给了接手人；" : "";
  await notify([me.id], {
    kind: 放弃通知种类,
    title: `已放弃：${p.name}`,
    body: `已转给 ${r.接手人}（原因：${认.文字}）。${客户话}本月放弃次数已用（每人每月 ${每月放弃次数} 次）；已给你记 1 条待补，下一条自动分配先补给你，补的那条不计入本月已分`,
    key: `giveup:${projectId}:${me.id}:${月}`,
  });
  return { ok: true, 接手人: r.接手人 };
}
