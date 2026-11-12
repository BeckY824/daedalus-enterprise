/**
 * 客户三态 · 客户详情要的几样（P-界面-19 ③④⑤⑥，构想页 C10–C13）：只读、不写库。
 *
 *   - 状态条（C10）：客户钟上记着沉睡 / 待回收时才按最新事实现算一遍（活跃的客户一条也不多查）；按钮给不给、用哪句话全在这里算好下发，
 *     页面不自己推权限。判定和按钮动作同一套（tri-state-hold.ts 继续持有身份 / 暂缓回收不给、permissions.ts 能裁决三态）。
 *     界面比服务端收得紧的两处（用户未定，保守）：待回收时「写理由继续持有」只给这条线的条线总管理；系统管理员服务端能点，状态条上不给按钮
 *   - 冷项目（C11，M-公海-22）：线索 / 商机阶段、没结束、没进公海的项目，最近一次换节点、最近一条挂在它上面的沟通、建档三者取最晚，
 *     再不早于系统起算日；没动静满「标冷」天数（组织规则 三态.冷项目.标冷，默认 90）标冷。一句 SQL 查完，不随项目数加查询
 *   - 状态留痕（C13）：EntCustomerStateLog 最近 100 条，并进项目区「进程变更」卡的「客户状态」一段
 *   - 短沟通提示（C12）：保存成功后这条按 有内容的沟通 判无效，回原因给前端一句轻提示；不拦保存
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { beijingDay } from "@/lib/business-clock";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import type { 组织规则 } from "@/lib/project/org-rules";
import { 算三态, 差天, 待回收提醒次数, 三态起算日 } from "./tri-state";
import { 收三态客户, 三态开着, 读占位词, 待交接理由, type 三态客户 } from "./tri-state-db";
import { 继续持有身份, 暂缓回收不给, 是待回收轮, 能代选了, 代选起始, type 在计时 } from "./tri-state-hold";
import { 无效沟通原因of, type 无效沟通原因 } from "./tri-state-quota";
import { 能裁决三态, 能继续持有三态, 能代选三态, 是市场角色, 是销售角色, type 谁 } from "./permissions";
import { 条线的线 } from "./line-viewer";
import { 读组织, type 组织 } from "./org";

/** 状态条上的一颗按钮：动作对应 customers/tri-state-actions.ts（客户转让走客户页头那个框） */
export type 三态条按钮 = {
  动作: "继续持有" | "暂缓回收" | "让同事结束项目" | "客户转让";
  字: string;
  /** 悬停和确认框里那段话 */
  说明: string;
  /** 确认框里理由必填（待回收的「写理由继续持有」） */
  要理由: boolean;
  /** 主按钮（一条里最多一颗） */
  主?: boolean;
};

export type 三态条 = {
  状态: "沉睡" | "待回收" | "暂缓回收中";
  /** 标签后面那一句（一行，放不下省略号，悬停看全） */
  文字: string;
  按钮们: 三态条按钮[];
  /** 没按钮时的那句说明，或按钮旁边的一句指引（指向右上角转让 / 退回公海） */
  旁注: string | null;
};

const 额度用完话 = "额度已用完，可以转让、退回公海，或记一条有效沟通";

/** 「我还在跟」/「写理由继续持有」共用额度那段话（悬停、确认框） */
export function 额度说明(规则: 组织规则, r: 在计时): string {
  const 持 = 规则.三态.继续持有;
  return `「我还在跟」和「写理由继续持有」共用一个额度：每次顺延 ${持.每次天数} 天、钟不归零；沉睡轮、待回收轮各限一次；累计最多 ${持.累计次数} 次、合计 ${持.累计天数} 天；已用 ${r.继续持有.已用次数} 次`;
}

/** 额度用满（次数或合计天数不够再推一次）：按钮不出，改一句话 */
const 额度用完 = (规则: 组织规则, r: 在计时) => r.继续持有.剩次数 <= 0 || r.继续持有.剩天数 < 规则.三态.继续持有.每次天数;

/** 我是不是这位客户那条线的条线总管理（找条线总管理同一条线；兜底到系统管理员的不算） */
function 是本线条线总管理(org: 组织, c: 三态客户, meId: string): boolean {
  const 线 = c.bizLine === "内贸" || c.bizLine === "外贸" ? c.bizLine : org.成员.get(c.salesOwnerId)?.line ?? null;
  return !!线 && 条线的线(org, meId) === 线;
}

/** 本轮已发几次待回收提醒（早于当前待回收节点日的算旧一轮，同 算三态） */
function 已提醒次数(c: 三态客户, r: 在计时): number {
  const 日 = c.事实.本轮最近待回收提醒日;
  if (!日 || 日 < r.节点.待回收) return 0;
  return Math.min(c.事实.本轮待回收提醒次数, 待回收提醒次数);
}

/** 按算好的三态和我是谁，拼状态条（纯函数，测试直接调） */
export function 拼三态条(me: 谁, c: 三态客户, r: 在计时, org: 组织, 规则: 组织规则, 今天: string): 三态条 | null {
  if (r.状态 === "活跃") return null;
  const 额 = 额度说明(规则, r);
  const 持 = 继续持有身份(me, c, r, org);
  const 能持 = !("错" in 持);
  const 用完 = 额度用完(规则, r);
  const 指向 = "也可以用右上角的客户转让、客户退回公海";

  if (r.状态 === "沉睡") {
    const 没沟通 = Math.max(0, 差天(r.归零日, 今天));
    const 还差 = Math.max(0, 差天(今天, r.节点.待回收));
    const 文字 = `已 ${没沟通} 天没有有效沟通 · 再 ${还差} 天进入待回收`;
    const 本人 = 能继续持有三态(me, c, org);
    const 上级 = !本人 && 能代选三态(me, c, org);
    if (!本人 && !上级) return { 状态: "沉睡", 文字, 按钮们: [], 旁注: "沉睡阶段由负责人和直属上级处理" };
    if (上级 && !能代选了(r)) return { 状态: "沉睡", 文字, 按钮们: [], 旁注: `沉睡满 30 天（第 ${代选起始(r)} 天）起你也能代选「我还在跟」` };
    if (能持) {
      return {
        状态: "沉睡", 文字,
        按钮们: [{ 动作: "继续持有", 字: "我还在跟", 说明: 上级 ? `代负责人选，留痕写「由你代选」并通知负责人。${额}` : 额, 要理由: false, 主: true }],
        旁注: 上级 ? "代负责人选，留痕写「上级代选」" : 指向,
      };
    }
    return { 状态: "沉睡", 文字, 按钮们: [], 旁注: 用完 ? 额度用完话 : 持.错 };
  }

  const 线总 = 能裁决三态(me, c, org) && 是本线条线总管理(org, c, me.id);
  if (r.状态 === "该进公海" && r.被挡) {
    const 文字 = `到期该进公海，但名下有${c.同事们.length ? ` ${c.同事们.length} 位` : ""}同事在推的项目，收不了`;
    if (!线总) return { 状态: "暂缓回收中", 文字, 按钮们: [], 旁注: "由条线总管理处理" };
    const 按钮们: 三态条按钮[] = [{ 动作: "客户转让", 字: "客户转让", 说明: "客户换负责人，名下项目一起走", 要理由: false }];
    if (c.同事们.length) 按钮们.push({ 动作: "让同事结束项目", 字: "让同事结束项目", 说明: "通知在推项目的同事去结束项目", 要理由: false });
    const 不给暂缓 = 暂缓回收不给(c, 今天);
    if (!不给暂缓) {
      按钮们.push({ 动作: "暂缓回收", 字: "暂缓回收", 说明: "不占继续持有的额度；两次至少隔 30 天、累计最多 2 次；用满后这颗按钮不出现，要留只能写理由继续持有", 要理由: false, 主: true });
      return { 状态: "暂缓回收中", 文字, 按钮们, 旁注: null };
    }
    if (能持) {
      按钮们.push({ 动作: "继续持有", 字: "写理由继续持有", 说明: `${不给暂缓}。${额}`, 要理由: true, 主: true });
      return { 状态: "暂缓回收中", 文字, 按钮们, 旁注: null };
    }
    return { 状态: "暂缓回收中", 文字, 按钮们, 旁注: 用完 ? 额度用完话 : 不给暂缓 };
  }

  // 待回收（到期没被挡、等夜里收的也算这一段）
  const 进公海日 = r.最早进公海日 ?? r.节点.进公海;
  const 还差 = Math.max(0, 差天(今天, 进公海日));
  const 文字 = `${还差 ? `${还差} 天后自动进公海` : "今晚自动进公海"} · 已提醒 ${已提醒次数(c, r)}/${待回收提醒次数} 次`;
  if (!线总) {
    const 相关 = 能继续持有三态(me, c, org) || 能代选三态(me, c, org);
    return { 状态: "待回收", 文字, 按钮们: [], 旁注: 相关 ? `已推给条线总管理裁决 · ${指向}` : "已推给条线总管理裁决" };
  }
  if (能持 && 是待回收轮(r)) return { 状态: "待回收", 文字, 按钮们: [{ 动作: "继续持有", 字: "写理由继续持有", 说明: `必须填理由。${额}`, 要理由: true, 主: true }], 旁注: null };
  return { 状态: "待回收", 文字, 按钮们: [], 旁注: 用完 ? 额度用完话 : ("错" in 持 ? 持.错 : null) };
}

/**
 * 客户详情状态条：三态关着回 null 且不查库；开着先查一条客户钟，钟上是活跃 / 没有钟就不再往下查。
 * 钟上记着沉睡 / 待回收的才收齐事实现算（活跃了、市场成员名下、订单在推的照样不出条）
 */
export async function 读三态条(me: 谁, customerId: string, 现在: Date = new Date()): Promise<三态条 | null> {
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return null;
  const 钟 = await 看全部(() => prisma.entCustomerClock.findUnique({ where: { customerId }, select: { state: true } }));
  if (!钟 || (钟.state !== "沉睡" && 钟.state !== "待回收")) return null;
  const org = await 读组织();
  const c = (await 看全部(() => 收三态客户(prisma, [customerId], 规则, org, 现在))).get(customerId);
  if (!c) return null;
  const 今天 = beijingDay(现在);
  const r = 算三态(c.事实, 规则.三态, 今天);
  return r.计时 ? 拼三态条(me, c, r, org, 规则, 今天) : null;
}

const 转时刻 = (v: unknown): number | null => {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "bigint") return Number(v);
  if (v instanceof Date) return v.getTime();
  const s = String(v);
  if (/^\d+$/.test(s)) return Number(s);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

/**
 * 这几个项目里冷了的：项目 id → 没推进的天数（C11）。三态关着回空、不查库。只认线索 / 商机阶段、没结局、没进公海、没删的
 */
export async function 读冷项目(projectIds: readonly string[], 现在: Date = new Date()): Promise<Record<string, number>> {
  if (!projectIds.length) return {};
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return {};
  const 问 = projectIds.map(() => "?").join(", ");
  const 行们 = await prisma.$queryRawUnsafe<{ id: string; createdAt: unknown; n: unknown; f: unknown }[]>(
    `SELECT p.id AS id, p."createdAt" AS createdAt,
  (SELECT MAX(l."at") FROM "ProjectNodeLog" l WHERE l."projectId" = p.id AND l."kind" = 'node') AS n,
  (SELECT MAX(f."occurredAt") FROM "FollowUpProject" fp JOIN "FollowUp" f ON f.id = fp."followUpId"
     WHERE fp."projectId" = p.id AND f."deletedAt" IS NULL) AS f
FROM "Project" p
WHERE p.id IN (${问}) AND p."phase" IN ('线索', '商机') AND p."result" IS NULL AND p."pooledAt" IS NULL AND p."deletedAt" IS NULL`,
    ...projectIds,
  );
  const 今天 = beijingDay(现在);
  const 起算日 = 规则.超时回收.起算日 || 三态起算日;
  const 标冷 = 规则.三态.冷项目.标冷;
  const 出: Record<string, number> = {};
  for (const x of 行们) {
    const 时刻们 = [x.createdAt, x.n, x.f].map(转时刻).filter((t): t is number => t !== null && t <= 现在.getTime());
    if (!时刻们.length) continue;
    const 日 = beijingDay(new Date(Math.max(...时刻们)));
    const 底 = 日 > 起算日 ? 日 : 起算日;
    const 天 = 差天(底, 今天);
    if (天 >= 标冷) 出[x.id] = 天;
  }
  return 出;
}

/** 状态留痕的一行（并进「进程变更」卡的「客户状态」一段） */
export type 三态留痕行 = { at: string; 谁: string; 事: string };

/** 留痕的 via / reason 换成一句话 */
export function 留痕说法(x: { fromState: string | null; toState: string; via: string; reason: string | null; holdDays: number | null }): string {
  const 理由 = x.reason?.trim() || "";
  if (x.via.startsWith("撤销转让")) return x.via === "撤销转让" ? "撤销转让（钟不动）" : "撤销转让（计入 7 天内撤销次数）";
  if (x.holdDays != null) return `继续持有，顺延 ${x.holdDays} 天${理由 ? `：${理由}` : ""}`;
  if (x.via === "总管理裁决") return 理由 || "条线总管理裁决";
  if (理由 === 待交接理由) return 理由;
  const 换 = !x.fromState ? `开始计时：${x.toState}` : x.fromState !== x.toState ? `${x.fromState} → ${x.toState}` : x.toState;
  return 理由 ? `${换}（${理由}）` : 换;
}

/**
 * 这位客户的状态留痕（最近 100 条，新的在前）。三态关着回 null、不查库。名字先从传进来的人名表找（页面已经读过负责人候选），
 * 找不到的（停用了、不在候选里）再一次补查
 */
export async function 读三态留痕(customerId: string, 人名: ReadonlyMap<string, string>): Promise<三态留痕行[] | null> {
  if (!(await 三态开着())) return null;
  const 行们 = await prisma.entCustomerStateLog.findMany({
    where: { customerId }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 100,
    select: { at: true, userId: true, fromState: true, toState: true, via: true, reason: true, holdDays: true },
  });
  const 缺 = [...new Set(行们.map((x) => x.userId).filter((id): id is string => !!id && !人名.has(id)))];
  const 补 = 缺.length ? new Map((await prisma.user.findMany({ where: { id: { in: 缺 } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();
  return 行们.map((x) => ({
    at: x.at.toISOString(),
    谁: x.userId ? (人名.get(x.userId) ?? 补.get(x.userId) ?? "已删除的成员") : "系统",
    事: 留痕说法(x),
  }));
}

/**
 * 保存成功后这条算不算有效沟通（C12）：三态关着、客户不计三态（没钟 / 已进公海 / 负责人是市场成员）回 null；
 * 算无效回原因。AI 起草成功的（有速记原文）照算有效
 */
export async function 短沟通提示(followUpId: string | null | undefined, 内容: string | null | undefined): Promise<无效沟通原因 | null> {
  if (!(await 三态开着())) return null;
  const 词们 = await 读占位词();
  const 原因 = 无效沟通原因of(内容, { 占位词: 词们 });
  if (!原因 || !followUpId) return null;
  const f = await 看全部(() => prisma.followUp.findUnique({
    where: { id: followUpId },
    select: { source: { select: { followUpId: true } }, customer: { select: { salesOwnerId: true, entClock: { select: { state: true } } } } },
  }));
  if (!f || f.source) return null;
  const 钟 = f.customer?.entClock;
  if (!钟 || 钟.state === "公海") return null;
  const org = await 读组织();
  const 主 = f.customer!.salesOwnerId;
  if (是市场角色(org, 主) && !是销售角色(org, 主)) return null;
  return 原因;
}
