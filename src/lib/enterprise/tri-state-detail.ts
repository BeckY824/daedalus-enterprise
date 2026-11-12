/**
 * 客户三态 · 客户详情要的几样（P-界面-19 ③④⑤⑥，构想页 C10–C13）：只读、不写库。
 *
 *   - 状态条（C10）：客户钟上记着沉睡 / 待回收时才按最新事实现算一遍（活跃的客户不多算）；按钮给不给、用哪句话全在这里算好下发，
 *     页面不自己推权限。逐身份和按钮动作同一套判定：继续持有看 tri-state-hold.ts 继续持有身份（本人、直属上级、待回收轮的条线总管理 /
 *     系统管理员），暂缓回收、让同事结束项目看 permissions.ts 能裁决三态 + 暂缓回收不给——界面给的都能调，能调的界面都给（11-12 第二轮）
 *   - 冷项目（C11，M-公海-22）：只在客户活跃时标。线索 / 商机阶段、没结束、没进公海的项目，最近一次换节点、最近一条挂在它上面的
 *     有效沟通（同客户钟那个判定，含占位词表；沟通生效日 = 沟通日期和写入时间取早的，M-公海-54）、建档三者取最晚，再不早于系统起算日；没动静满「标冷」天数（默认 90）标冷。一句 SQL
 *   - 状态留痕（C13）：最近 100 条，并进项目区「进程变更」卡的「客户状态」一段（没有进程变更卡时放左栏）。理由原文（继续持有写的、
 *     裁决写的、「由某某代选」）只有负责人本人、他的上级链、本线条线总管理、系统管理员看得到，别人只看谁、什么时候、做了什么（B1）
 *   - 短沟通提示（C12）：保存成功后按库里存下的内容判无效，回原因给前端一句轻提示；判的时候出错当没有，不影响保存结果
 *
 * 同一请求里去重（客户详情页渲染）：客户行连钟、换负责人记录由页面递进来，占位人、占位词按请求缓存；按钮动作在事务里照旧现读
 */
import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { beijingDay } from "@/lib/business-clock";
import { getSetting } from "@/lib/settings";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import type { 组织规则 } from "@/lib/project/org-rules";
import type { Prisma } from "@/generated/prisma";
import { 无负责人占位Id只读 } from "@/lib/no-owner-db";
import { 换负责人原行of } from "@/lib/owner-log-db";
import { 算三态, 差天, 待回收提醒次数, 三态起算日 } from "./tri-state";
import { 收三态客户, 三态开着, 读占位词, 待交接理由, type 三态客户, type 痕原行 } from "./tri-state-db";
import { 继续持有身份, 暂缓回收不给, 能代选了, 代选起始, type 在计时 } from "./tri-state-hold";
import { 无效沟通原因of, 有内容的沟通, 沟通生效时刻, 沟通生效时刻SQL, 生效时刻余量, 规整占位词, 默认占位词, 占位词键, 暂缓回收, 让同事结束项目, type 无效沟通原因 } from "./tri-state-quota";
import { 能裁决三态, 能继续持有三态, 能代选三态, 是市场角色, 是销售角色, type 谁 } from "./permissions";
import { 条线的线 } from "./line-viewer";
import { 读组织, 是系统管理员of, 实线下属, type 组织 } from "./org";

/** 状态条上的一颗按钮：动作对应 customers/tri-state-actions.ts（客户转让走客户页头那个框） */
export type 三态条按钮 = {
  动作: "继续持有" | "暂缓回收" | "让同事结束项目" | "客户转让";
  字: string;
  /** 悬停和确认框里那段话 */
  说明: string;
  /** 确认框里理由必填（待回收轮的「写理由继续持有」） */
  要理由: boolean;
  /** 主按钮（一条里最多一颗） */
  主?: boolean;
};

export type 三态条 = {
  状态: "沉睡" | "待回收" | "暂缓回收中";
  /** 标签后面那一句（一行，放不下省略号） */
  文字: string;
  /** 悬停看到的（文字全文 + 说明） */
  悬停: string;
  按钮们: 三态条按钮[];
  /** 没按钮时的那句说明，或按钮旁边的一句指引：按查看的人能做什么来写 */
  旁注: string | null;
};

const 额度用完话 = "额度已用完，可以转让、退回公海，或记一条有效沟通";
const 动静说明 = "动静指有效沟通或项目推进";
const 指向 = "也可以用右上角的客户转让、客户退回公海";

/** 「我还在跟」/「写理由继续持有」共用额度那段话（悬停、确认框） */
export function 额度说明(规则: 组织规则, r: 在计时): string {
  const 持 = 规则.三态.继续持有;
  return `「我还在跟」和「写理由继续持有」共用一个额度：每次顺延 ${持.每次天数} 天、钟不归零；沉睡轮、待回收轮各限一次；累计最多 ${持.累计次数} 次、合计 ${持.累计天数} 天；已用 ${r.继续持有.已用次数} 次`;
}

/** 额度用满（次数或合计天数不够再推一次）：按钮不出，改一句话 */
const 额度用完 = (规则: 组织规则, r: 在计时) => r.继续持有.剩次数 <= 0 || r.继续持有.剩天数 < 规则.三态.继续持有.每次天数;

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
  const 本人 = 能继续持有三态(me, c, org);
  const 上级 = !本人 && 能代选三态(me, c, org);
  const 裁决 = 能裁决三态(me, c, org);
  /** 我本来能点继续持有、这回不给的那句（额度用完 / 本轮用过 / 规则里那句） */
  const 不能持话 = () => (额度用完(规则, r) ? 额度用完话 : !r.继续持有.能推 ? (r.继续持有.不能原因 ?? "现在不能继续持有") : "错" in 持 ? 持.错 : null);
  const 持钮 = (主: boolean): 三态条按钮 | null => {
    if (!能持) return null;
    const 待回收轮 = 持.轮 === "待回收";
    const 代 = 持.身份 !== "本人";
    return {
      动作: "继续持有", 字: 待回收轮 ? "写理由继续持有" : "我还在跟", 要理由: 待回收轮, 主,
      说明: `${待回收轮 ? "必须填理由。" : ""}${代 ? "代负责人选，留痕写「由你代选」并通知负责人。" : ""}${额}`,
    };
  };

  if (r.状态 === "沉睡") {
    const 没动静 = Math.max(0, 差天(r.归零日, 今天));
    const 还差 = Math.max(0, 差天(今天, r.节点.待回收));
    const 文字 = `已 ${没动静} 天没有动静 · 再 ${还差} 天进入待回收`;
    const 底 = { 状态: "沉睡" as const, 文字, 悬停: `${文字}（${动静说明}）` };
    const 钮 = 持钮(true);
    if (钮) return { ...底, 按钮们: [钮], 旁注: 上级 ? "代负责人选，留痕写「上级代选」" : 指向 };
    if (上级 && !能代选了(r)) return { ...底, 按钮们: [], 旁注: `沉睡满 30 天（第 ${代选起始(r)} 天）起你也能代选「我还在跟」` };
    if (本人 || 上级) return { ...底, 按钮们: [], 旁注: 不能持话() };
    return { ...底, 按钮们: [], 旁注: "沉睡阶段由负责人和直属上级处理" };
  }

  if (r.状态 === "该进公海" && r.被挡) {
    const 文字 = `到期该进公海，但名下有${c.同事们.length ? ` ${c.同事们.length} 位` : ""}同事在推的项目，收不了`;
    const 底 = { 状态: "暂缓回收中" as const, 文字, 悬停: 文字 };
    const 按钮们: 三态条按钮[] = [];
    const 不给暂缓 = 暂缓回收不给(c, 今天);
    if (裁决) {
      按钮们.push({ 动作: "客户转让", 字: "客户转让", 说明: "客户换负责人，名下项目一起走", 要理由: false });
      if (c.同事们.length) 按钮们.push({ 动作: "让同事结束项目", 字: "让同事结束项目", 说明: "通知在推项目的同事去结束项目", 要理由: false });
      if (!不给暂缓) 按钮们.push({ 动作: "暂缓回收", 字: "暂缓回收", 说明: "不占继续持有的额度；两次至少隔 30 天、累计最多 2 次；用满后这颗按钮不出现，要留只能写理由继续持有", 要理由: false, 主: true });
    }
    const 钮 = 持钮(!按钮们.some((b) => b.主));
    if (钮) 按钮们.push(钮);
    if (钮) return { ...底, 按钮们, 旁注: 裁决 ? null : "暂缓回收、让同事结束项目由条线总管理裁决" };
    if (裁决) return { ...底, 按钮们, 旁注: 不给暂缓 ? (额度用完(规则, r) ? 额度用完话 : 不给暂缓) : null };
    if (本人 || 上级) return { ...底, 按钮们, 旁注: `已推给条线总管理裁决 · ${指向}` };
    return { ...底, 按钮们, 旁注: "由条线总管理处理" };
  }

  // 待回收（到期没被挡、等夜里收的也算这一段）
  const 到期 = r.状态 === "该进公海";
  const 进公海日 = r.最早进公海日 ?? r.节点.进公海;
  const 还差 = Math.max(0, 差天(今天, 进公海日));
  const 文字 = `${还差 && !到期 ? `${还差} 天后自动进公海` : "今晚自动进公海"} · 已提醒 ${已提醒次数(c, r)}/${待回收提醒次数} 次`;
  const 底 = { 状态: "待回收" as const, 文字, 悬停: 文字 };
  const 钮 = 持钮(true);
  if (钮) return { ...底, 按钮们: [钮], 旁注: 裁决 ? null : "已推给条线总管理裁决" };
  if (本人 || 上级) return { ...底, 按钮们: [], 旁注: `${不能持话() ?? "已推给条线总管理裁决"} · ${指向}` };
  if (裁决) return { ...底, 按钮们: [], 旁注: 到期 ? "已到期、今晚自动进公海；要留下请负责人或直属上级继续持有，或用右上角的客户转让" : 不能持话() };
  return { ...底, 按钮们: [], 旁注: "已推给条线总管理裁决" };
}

/** 页面渲染一次只读一遍：占位账号 id（只读，不建）、占位词表（走设置缓存） */
const 页面占位Id = cache(() => 无负责人占位Id只读(prisma));
export const 页面占位词 = cache(async (): Promise<readonly string[]> => 规整占位词(await getSetting(占位词键)) ?? 默认占位词);

/** 页面已经读过的那位客户（客户行带上钟；三态关着时页面不带钟） */
export type 页面客户 = {
  id: string; name: string; salesOwnerId: string; bizLine: string | null; poolInvalidAt: Date | null; pool: unknown;
  entClock?: Prisma.EntCustomerClockGetPayload<object> | null;
};

export type 客户三态 = {
  条: 三态条 | null;
  留痕: 三态留痕行[];
  /** 这位客户现在活跃（冷项目只在活跃时标，M-公海-22「客户还活跃」） */
  活跃: boolean;
};

/**
 * 客户详情的状态条 + 状态留痕：三态关着回 null、不查库。钟上是沉睡 / 待回收才收齐事实现算，留痕用收出来的那份；
 * 别的情况只读一句留痕
 */
export async function 读客户三态(me: 谁, 客户: 页面客户, 人名: ReadonlyMap<string, string>, 现在: Date = new Date()): Promise<客户三态 | null> {
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return null;
  const org = await 读组织();
  const 钟 = 客户.entClock ?? null;
  let 条: 三态条 | null = null, 活跃 = 钟?.state === "活跃", 痕: 痕原行[] | null = null;
  if (钟 && (钟.state === "沉睡" || 钟.state === "待回收")) {
    const [换人, 占位Id, 占位词] = await Promise.all([换负责人原行of(客户.id), 页面占位Id(), 页面占位词()]);
    const c = (await 看全部(() => 收三态客户(prisma, [客户.id], 规则, org, 现在, { 客户们: [{ ...客户, entClock: 钟 }], 换人, 占位词, 占位Id }))).get(客户.id);
    if (c) {
      const 今天 = beijingDay(现在);
      const r = 算三态(c.事实, 规则.三态, 今天);
      条 = r.计时 ? 拼三态条(me, c, r, org, 规则, 今天) : null;
      活跃 = r.计时 && r.状态 === "活跃";
      痕 = [...c.痕行们].reverse().slice(0, 100);
    }
  }
  痕 ??= await 看全部(() => prisma.entCustomerStateLog.findMany({
    where: { customerId: 客户.id }, orderBy: [{ at: "desc" }, { id: "desc" }], take: 100,
    select: { id: true, customerId: true, at: true, userId: true, fromState: true, toState: true, via: true, reason: true, holdDays: true, fromOwnerId: true },
  }));
  return { 条, 留痕: await 留痕行们(痕, 人名, 能看理由(me, org, 客户)), 活跃 };
}

/** 状态条单读（测试、别的页面用）：同 读客户三态，客户行现读 */
export async function 读三态条(me: 谁, customerId: string, 现在: Date = new Date()): Promise<三态条 | null> {
  if (!(await 三态开着())) return null;
  const 客户 = await 看全部(() => prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, salesOwnerId: true, bizLine: true, poolInvalidAt: true, pool: { select: { customerId: true } }, entClock: true },
  }));
  return 客户 ? (await 读客户三态(me, 客户, new Map(), 现在))?.条 ?? null : null;
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

/** 每个项目最多看最近几条挂在它上面的沟通找有效的；都无效时拿最老那条的日子兜底（偏保守：少标冷，不多标） */
export const 冷项目看沟通条数 = 50;

/**
 * 这几个项目里冷了的：项目 id → 没动静的天数（C11）。三态关着回空、不查库；调用方只在客户活跃时调。
 * 只认线索 / 商机阶段、没结局、没进公海、没删的。一句 SQL：项目行（建档、最近换节点）和每个项目最近几条沟通并在一起读回来
 */
export async function 读冷项目(projectIds: readonly string[], 现在: Date = new Date(), 占位词?: readonly string[]): Promise<Record<string, number>> {
  if (!projectIds.length) return {};
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return {};
  const 问 = projectIds.map(() => "?").join(", ");
  const 合格 = `p.id IN (${问}) AND p."phase" IN ('线索', '商机') AND p."result" IS NULL AND p."pooledAt" IS NULL AND p."deletedAt" IS NULL`;
  const 行们 = await prisma.$queryRawUnsafe<{ t: string; id: string; a: unknown; b: unknown; content: string | null; src: unknown }[]>(
    `SELECT 'p' AS t, p.id AS id, p."createdAt" AS a,
  (SELECT MAX(l."at") FROM "ProjectNodeLog" l WHERE l."projectId" = p.id AND l."kind" = 'node') AS b, NULL AS content, NULL AS src
FROM "Project" p WHERE ${合格}
UNION ALL
SELECT 'f' AS t, x.pid AS id, x.at AS a, x.cat AS b, x.content AS content, x.src AS src FROM (
  SELECT fp."projectId" AS pid, f."occurredAt" AS at, f."createdAt" AS cat, f.content AS content,
    EXISTS (SELECT 1 FROM "FollowUpSource" s WHERE s."followUpId" = f.id) AS src,
    ROW_NUMBER() OVER (PARTITION BY fp."projectId" ORDER BY ${沟通生效时刻SQL("f")} DESC) AS rn
  FROM "FollowUpProject" fp JOIN "FollowUp" f ON f.id = fp."followUpId" JOIN "Project" p ON p.id = fp."projectId"
  WHERE ${合格} AND f."deletedAt" IS NULL
) x WHERE x.rn <= ${冷项目看沟通条数}`,
    ...projectIds, ...projectIds,
  );
  const 词们 = 占位词 ?? await 页面占位词();
  const 今 = 现在.getTime();
  const 项目 = new Map<string, number[]>();
  const 沟通 = new Map<string, { t: number; 有效: boolean }[]>();
  for (const x of 行们) {
    if (x.t === "p") 项目.set(x.id, [x.a, x.b].map(转时刻).filter((t): t is number => t !== null && t <= 今));
    else {
      const 写入 = 转时刻(x.b);
      if (写入 === null) continue;
      const 日期 = 转时刻(x.a);
      const t = 沟通生效时刻(日期 === null ? null : new Date(日期), new Date(写入)).getTime();
      if (t > 今 + 生效时刻余量) continue;
      沟通.set(x.id, [...(沟通.get(x.id) ?? []), { t, 有效: 有内容的沟通(x.content, { 占位词: 词们, AI生成: Number(x.src) === 1 || x.src === true }) }]);
    }
  }
  const 今天 = beijingDay(现在);
  const 起算日 = 规则.超时回收.起算日 || 三态起算日;
  const 标冷 = 规则.三态.冷项目.标冷;
  const 出: Record<string, number> = {};
  for (const [id, 时刻们] of 项目) {
    const 条们 = 沟通.get(id) ?? [];
    const 有效 = 条们.filter((f) => f.有效).map((f) => f.t);
    // 看满了还没找到有效的：拿看到的最老那条兜底（不往更早翻，偏少标冷）
    const 兜底 = !有效.length && 条们.length >= 冷项目看沟通条数 ? [Math.min(...条们.map((f) => f.t))] : [];
    const 全 = [...时刻们, ...有效, ...兜底];
    if (!全.length) continue;
    const 日 = beijingDay(new Date(Math.max(...全)));
    const 天 = 差天(日 > 起算日 ? 日 : 起算日, 今天);
    if (天 >= 标冷) 出[id] = 天;
  }
  return 出;
}

/** 状态留痕的一行（并进「进程变更」卡的「客户状态」一段） */
export type 三态留痕行 = { at: string; 谁: string; 事: string };

/**
 * 留痕的 via / reason 换成一句话。带理由 = false 时去掉人写的理由（继续持有、裁决写的、「由某某代选」），只留做了什么；
 * 自动的那几行理由是系统写的（满几天、待交接），照留
 */
export function 留痕说法(x: { fromState: string | null; toState: string; via: string; reason: string | null; holdDays: number | null }, 带理由 = true): string {
  const 理由 = x.reason?.trim() || "";
  if (x.via.startsWith("撤销转让")) return x.via === "撤销转让" ? "撤销转让（钟不动）" : "撤销转让（计入 7 天内撤销次数）";
  if (x.holdDays != null) return `继续持有，顺延 ${x.holdDays} 天${带理由 && 理由 ? `：${理由}` : ""}`;
  if (x.via === "总管理裁决") {
    if (带理由) return 理由 || "条线总管理裁决";
    return 理由.startsWith(暂缓回收) ? 暂缓回收 : 理由.startsWith(让同事结束项目) ? 让同事结束项目 : "条线总管理裁决";
  }
  if (理由 === 待交接理由) return 理由;
  const 换 = !x.fromState ? `开始计时：${x.toState}` : x.fromState !== x.toState ? `${x.fromState} → ${x.toState}` : x.toState;
  if (x.via !== "自动" && !带理由) return 换;
  return 理由 ? `${换}（${理由}）` : 换;
}

/** 理由原文谁看得到（B1）：负责人本人、他的实线上级链（停用了按停用前的上级往上数）、本线条线总管理、系统管理员 */
export function 能看理由(me: 谁, org: 组织, c: { salesOwnerId: string; bizLine: string | null }): boolean {
  if (me.id === c.salesOwnerId || 是系统管理员of(org, me.id)) return true;
  const 下属 = 实线下属(org, me.id);
  const 离职上 = org.离职上级?.get(c.salesOwnerId);
  if (下属.has(c.salesOwnerId) || (离职上 && (离职上 === me.id || 下属.has(离职上)))) return true;
  const 线 = c.bizLine === "内贸" || c.bizLine === "外贸" ? c.bizLine : org.成员.get(c.salesOwnerId)?.line ?? null;
  return !!线 && 条线的线(org, me.id) === 线;
}

/** 留痕原行 → 一行一句；名字先从人名表找，找不到的一次补查 */
async function 留痕行们(行们: readonly 痕原行[], 人名: ReadonlyMap<string, string>, 带理由: boolean): Promise<三态留痕行[]> {
  const 缺 = [...new Set(行们.map((x) => x.userId).filter((id): id is string => !!id && !人名.has(id)))];
  const 补 = 缺.length ? new Map((await prisma.user.findMany({ where: { id: { in: 缺 } }, select: { id: true, name: true } })).map((u) => [u.id, u.name])) : new Map<string, string>();
  return 行们.map((x) => ({
    at: x.at.toISOString(),
    谁: x.userId ? (人名.get(x.userId) ?? 补.get(x.userId) ?? "已删除的成员") : "系统",
    事: 留痕说法(x, 带理由),
  }));
}

/**
 * 保存成功后这条算不算有效沟通（C12）：按库里存下的内容判。三态关着、客户不计三态（没钟 / 已进公海 / 负责人是市场成员）、
 * AI 起草的（有速记原文）回 null；判的过程出任何错也回 null（沟通已经存了，不能让提示把保存说成失败）
 */
export async function 短沟通提示(followUpId: string | null | undefined): Promise<无效沟通原因 | null> {
  try {
    if (!followUpId || !(await 三态开着())) return null;
    const f = await 看全部(() => prisma.followUp.findUnique({
      where: { id: followUpId },
      select: { content: true, source: { select: { followUpId: true } }, customer: { select: { salesOwnerId: true, entClock: { select: { state: true } } } } },
    }));
    if (!f || f.source) return null;
    const 原因 = 无效沟通原因of(f.content, { 占位词: await 读占位词() });
    if (!原因) return null;
    const 钟 = f.customer?.entClock;
    if (!钟 || 钟.state === "公海") return null;
    const org = await 读组织();
    const 主 = f.customer!.salesOwnerId;
    if (是市场角色(org, 主) && !是销售角色(org, 主)) return null;
    return 原因;
  } catch {
    return null;
  }
}
