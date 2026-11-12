/**
 * 客户三态 · 提醒（三态落地计划 P5；M-公海-17、M-公海-24、M-公海-26、M-公海-27、M-公海-28、M-公海-33、M-公海-36）。
 *
 *   - 什么时候：状态在 00:05 那一遍改（tri-state-db.ts），提醒北京时间 08:00 起发，一天一遍（Setting 水位 三态提醒水位键）；
 *     这一遍只读钟、不按白天改过的规则对钟（用夜扫那份规则），当天夜扫没跑过的先补跑一遍。
 *     停机几天：开机那天只发当天这一条汇总，不逐天补（M-公海-26）；漏发的「进入沉睡」「待回收第 N 次」由 算三态() 今天补发
 *   - 发什么：一个人一天只收一条汇总（站内铃铛，notify() 后台自动推飞书；没绑飞书的只有站内，推失败不重试，feishu-push.ts）。
 *     唯一例外：自动进公海当天「已回公海」单独一条（已回公海通知，夜扫收完调）
 *   - 发给谁（算三态() 给的级别 → 人）：
 *       本人 = 客户负责人；停用了改发他停用前的直属上级（T12，再没有按直属上级那一级往上兜）
 *       直属上级 = 负责人的实线直属上级；没有 / 停用了往上一级（条线总管理），再没有发系统管理员（X-37）
 *       条线总管理 = 客户业务线那条线的条线总管理；客户没填业务线（或暂不分配）按负责人的线；都没有发系统管理员（M-公海-24）
 *       系统管理员 = 是系统管理员的那几位（P-判定-06）
 *     同一人在几位客户上收到不同级别，合成一条
 *   - 记什么：发成了（这位客户的收件人都记上了）才在钟上记 lastNoticeDay = 今天；待回收提醒另记 noticeCount = 第几次（算三态() 靠它排下一次、判能不能进公海）；被挡请裁决不记
 *   - 第 2 次被三态自动收回起，「已回公海」抄原负责人的直属上级（原负责人停用了按他停用前填的上级，M-公海-28）
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { getSetting, setSetting } from "@/lib/settings";
import { beijingDay, beijingWallIso } from "@/lib/business-clock";
import { 算三态, 解除后几天收, type 提醒级, type 今天提醒 } from "./tri-state";
import { 收三态客户, 候选客户, 分批, 三态开着, 三态夜扫, 三态扫过键, 钟状态of, 离职交接中的, 待交接理由, type 自动收了 } from "./tri-state-db";
import { 交接挂起超了, 交接兜底工作日, 交接兜底自然日 } from "./tri-state";
import { 待确认 } from "./handover-db";
import type { 组织规则 } from "@/lib/project/org-rules";
import { 读组织, type 组织 } from "./org";
import { 找条线总管理, 找直属上级, 本人在职, 原负责人上级, 系统管理员们 } from "./tri-state-people";
import { notify } from "./notify";

export const 三态提醒时刻 = { 时: 8, 分: 0 } as const;
/** Setting 里的水位：上一次发成的那天（上海日） */
export const 三态提醒水位键 = "entTriNoticeDay";

/** 北京时间过了 08:00 没 */
export function 过了三态提醒时刻(现在: Date): boolean {
  const 钟点 = beijingWallIso(现在).slice(11, 16);
  return 钟点 >= `${String(三态提醒时刻.时).padStart(2, "0")}:${String(三态提醒时刻.分).padStart(2, "0")}`;
}

export { 找条线总管理, 找直属上级 } from "./tri-state-people";

/** 一条提醒的级别 → 具体的人（主送、抄送合在一起，去重） */
export function 提醒发给(org: 组织, 提醒: 今天提醒, c: { salesOwnerId: string; bizLine: string | null }): string[] {
  // 负责人停用了不给他发，本人那一级改从他停用前的直属上级发起（T12）；直属上级那一级也按他停用前的上级找（tri-state-people.ts）
  const 级人 = (级: 提醒级): string[] =>
    级 === "本人" ? (本人在职(org, c.salesOwnerId) ? [c.salesOwnerId] : 找直属上级(org, c.bizLine, c.salesOwnerId)) : 级 === "直属上级" ? 找直属上级(org, c.bizLine, c.salesOwnerId) : 找条线总管理(org, c.bizLine, c.salesOwnerId);
  return [...new Set([...提醒.主送, ...提醒.抄送].flatMap(级人))];
}

/** 汇总里一类的叫法 */
const 类叫法: Readonly<Record<今天提醒["事由"], string>> = {
  进入沉睡: "进入沉睡",
  沉睡周提醒: "还在沉睡",
  沉睡抄上级: "沉睡满 30 天",
  待回收提醒: "待回收",
  被挡请裁决: "到期暂缓回收、请裁决",
  暂缓解除: `暂缓回收已解除（${解除后几天收} 天内没人处理就回公海）`,
};
const 类顺序: 今天提醒["事由"][] = ["进入沉睡", "沉睡抄上级", "沉睡周提醒", "待回收提醒", "暂缓解除", "被挡请裁决"];

type 条 = { 客户: string; 名: string; 负责人: string; 事由: 今天提醒["事由"]; 第几次?: number };

/** 一个人这一天那条汇总：标题按类数家数，正文逐家列（最多列 30 家） */
export function 汇总文字(条们: readonly 条[], org名: (id: string) => string): { title: string; body: string } {
  const 数 = new Map<今天提醒["事由"], number>();
  for (const x of 条们) 数.set(x.事由, (数.get(x.事由) ?? 0) + 1);
  const title = `客户三态提醒：${类顺序.filter((k) => 数.get(k)).map((k) => `${数.get(k)} 家${类叫法[k]}`).join("、")}`;
  const 排 = [...条们].sort((a, b) => 类顺序.indexOf(a.事由) - 类顺序.indexOf(b.事由));
  const 行 = 排.slice(0, 30).map((x) => `「${x.名}」${类叫法[x.事由]}${x.第几次 ? `（第 ${x.第几次} 次提醒）` : ""}，负责人 ${org名(x.负责人)}`);
  if (排.length > 30) 行.push(`……另有 ${排.length - 30} 家，到客户列表按状态筛`);
  return { title, body: 行.join("\n") };
}

export type 三态提醒明细 = { 客户: number; 人: number };

/**
 * 钟上那一遍（nightly.ts 调）：北京 08:00 起、今天还没发过才发。三态没开 / 不是企业版 = null。
 * 先按最新事实把钟对一遍（00:05 以后有人记了沟通的，不再提醒），再按 算三态() 的提醒发
 */
export async function 钟上三态提醒(现在: Date = new Date()): Promise<三态提醒明细 | null> {
  if (!过了三态提醒时刻(现在)) return null;
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return null;
  const 今天 = beijingDay(现在);
  if ((await getSetting<string>(三态提醒水位键)) === 今天) return null;
  // 今天 00:05 那遍没跑过（停机补跑）：先补跑一遍状态。补跑用现在的规则——停机期间没有更早的、当晚生效的规则可用
  await 三态夜扫(现在);
  const 明细 = await 看全部(async () => {
    const 发了 = await 发三态提醒(await 夜扫时的规则(规则), 现在, 今天);
    await 交接挂起兜底(await 读组织(), 今天);
    return 发了;
  });
  await setSetting(三态提醒水位键, 今天);
  return 明细;
}

/**
 * 今天那遍夜扫用的三态规则（夜扫记号 = 上海日 + 那时的三态规则 JSON）：白天改了规则，提醒照夜扫那份算，
 * 状态等次日 00:05 才按新规则变（M-公海-37「当晚重算」）。读不出来退回现在的规则
 */
async function 夜扫时的规则(现在的: 组织规则): Promise<组织规则> {
  const 记号 = await getSetting<string>(三态扫过键);
  if (typeof 记号 !== "string" || 记号.length <= 11) return 现在的;
  try {
    const 三态 = JSON.parse(记号.slice(11)) as 组织规则["三态"];
    return 三态 && typeof 三态 === "object" && "内贸" in 三态 ? { ...现在的, 三态 } : 现在的;
  } catch {
    return 现在的;
  }
}

/**
 * 只读 00:05 算好的钟来发：按最新事实、夜扫那份规则算今天的提醒，不改钟的状态（只记提醒发过）。
 * 算出来的状态和钟上的不一样（00:05 以后有人记了沟通、点了继续持有）的不发，等下一遍夜扫对齐。
 * 先算、再按人发、发成了再记（中断重跑不把没送到的算进 3 次提醒）：每发完一个人，查他那条确实记上了（EntNotice 同 key 有了），
 * 一位客户的收件人都记上了才在钟上记 lastNoticeDay / noticeCount。重跑同一天：已经记上的人 notify 按 key 去重不重发，照样认成发过
 */
async function 发三态提醒(规则: Awaited<ReturnType<typeof 生效组织规则>>, 现在: Date, 今天: string): Promise<三态提醒明细> {
  const org = await 读组织();
  const 给 = new Map<string, 条[]>();
  const 要记 = new Map<string, { 收件人: Set<string>; data: { noticeCount?: number; lastNoticeDay: string } | null }>();
  for (const 批 of 分批(await 候选客户(prisma))) {
    // T6：离职交接等接手人确认的，挂起期间不推提醒（也不收，见 tri-state-db.ts 交接挡住的）
    const 挂起 = await 离职交接中的(prisma, 批);
    for (const c of (await 收三态客户(prisma, 批, 规则, org, 现在)).values()) {
      if (挂起.has(c.id)) continue;
      const r = 算三态(c.事实, 规则.三态, 今天);
      if (!r.计时 || !r.提醒 || !c.钟 || c.钟.state !== 钟状态of(r)) continue;
      const 人们 = 提醒发给(org, r.提醒, c);
      // 被挡请裁决不记：它按日子每 30 天推一次（算三态() 自己排），记了 lastNoticeDay 会被当成待回收提醒、把最早进公海日往后推
      const data = r.提醒.事由 === "待回收提醒" ? { noticeCount: r.提醒.第几次 ?? 1, lastNoticeDay: 今天 } : r.提醒.事由 === "被挡请裁决" ? null : { lastNoticeDay: 今天 };
      // 没人可发（只发本人、本人停用了）：照样算这一级发过，不然第二天又当没发补一遍
      if (!人们.length) {
        if (data) await prisma.entCustomerClock.update({ where: { customerId: c.id }, data });
        continue;
      }
      const 条: 条 = { 客户: c.id, 名: c.name, 负责人: c.salesOwnerId, 事由: r.提醒.事由, ...(r.提醒.第几次 ? { 第几次: r.提醒.第几次 } : {}) };
      for (const u of 人们) 给.set(u, [...(给.get(u) ?? []), 条]);
      要记.set(c.id, { 收件人: new Set(人们), data });
    }
  }
  const key = `tri-daily:${今天}`;
  const 名 = 给.size ? await 人名([...new Set([...给.values()].flat().map((x) => x.负责人))]) : new Map<string, string>();
  let 记了 = 0;
  for (const [u, 条们] of 给) {
    const { title, body } = 汇总文字(条们, (id) => 名.get(id) ?? "（已停用）");
    await notify([u], { kind: "三态", title, body, link: "/customers", key });
    if (!(await prisma.entNotice.findFirst({ where: { userId: u, dedupeKey: key }, select: { id: true } }))) continue; // 没记上：这些客户今天不算提醒过
    for (const x of 条们) {
      const 记 = 要记.get(x.客户);
      if (!记) continue;
      记.收件人.delete(u);
      if (!记.收件人.size) {
        if (记.data) await prisma.entCustomerClock.update({ where: { customerId: x.客户 }, data: 记.data });
        要记.delete(x.客户);
        记了++;
      }
    }
  }
  return { 客户: 记了, 人: 给.size };
}

async function 人名(ids: string[]): Promise<Map<string, string>> {
  return new Map((await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

/**
 * 「已回公海」单独一条（M-公海-26）：给原负责人（停用了改发他停用前的直属上级，T12 同一套找人）；第 2 次被三态自动收回起抄原负责人的直属上级（停用了按他停用前填的上级，再没有不抄，M-公海-28）
 */
export async function 已回公海通知(们: readonly 自动收了[], org: 组织, 今天: string): Promise<void> {
  for (const x of 们) {
    // 上级要在职（停用了按原负责人停用前的上级，那位也要在职）；原负责人自己停用了不发给他
    const 上 = x.第几次 >= 2 ? 原负责人上级(org, x.原负责人) : null;
    const key = `tri-pooled:${x.id}:${今天}`;
    const 正文 = x.第几次 >= 2 ? `这位客户第 ${x.第几次} 次被自动收回` : "";
    if (本人在职(org, x.原负责人)) {
      await notify([x.原负责人], { kind: "回收", title: `「${x.name}」待回收期满没人处理，已回客户公海`, body: 正文, link: "/pool", key });
    } else {
      // 原负责人停用了：改发他停用前的直属上级（同 T12 提醒，找直属上级：找不到往条线总管理、系统管理员兜）；抄送那条不再重复发
      const 代收 = 找直属上级(org, x.bizLine ?? null, x.原负责人);
      await notify(代收, { kind: "回收", title: `停用账号名下的客户「${x.name}」待回收期满没人处理，已回客户公海`, body: 正文, link: "/pool", key });
      if (上 && 代收.includes(上)) continue;
    }
    if (上 && 上 !== x.原负责人) {
      await notify([上], { kind: "回收", title: `下属的客户「${x.name}」第 ${x.第几次} 次被自动收回，已回客户公海`, body: "要不要标无效由条线总管理在公海回收站里定", link: "/pool", key });
    }
  }
}

/**
 * 交接挂起兜底（T6 / T12）：超过 15 个工作日（周一到周五，不扣节假日、不认调休）或超过 30 个自然日（S1，先到者）没人接手的，推系统管理员裁决，每笔只推一次。
 *   - T6：离职交接待接手人确认，从发起那天数；
 *   - T12：负责人停用、客户标了「待交接」（tri-state-db.ts 待交接理由）还挂在他名下，按人合成一条，从他名下最早那位标的那天数。
 * 返回推了几条
 */
export async function 交接挂起兜底(org: 组织, 今天: string): Promise<number> {
  const 管 = 系统管理员们(org);
  if (!管.length) return 0;
  const 超了 = (起: Date) => 交接挂起超了(beijingDay(起), 今天);
  let n = 0;
  const 挂 = (await prisma.entHandover.findMany({ where: { kind: "离职", status: 待确认 }, select: { id: true, fromUserId: true, toUserId: true, createdAt: true } })).filter((h) => 超了(h.createdAt));
  const 标们 = await prisma.entCustomerStateLog.findMany({ where: { reason: 待交接理由 }, select: { customerId: true, fromOwnerId: true, at: true }, orderBy: { at: "asc" } });
  // 还挂在那位停用的人名下、不在公海里的才算（交出去了、进了公海的不再催）
  const 还在 = new Set((await prisma.customer.findMany({
    where: { id: { in: [...new Set(标们.map((x) => x.customerId))] }, pool: { is: null }, salesOwner: { active: false } },
    select: { id: true, salesOwnerId: true },
  })).filter((c) => 标们.some((x) => x.customerId === c.id && x.fromOwnerId === c.salesOwnerId)).map((c) => c.id));
  const 按人 = new Map<string, { 起: Date; 数: Set<string> }>();
  for (const x of 标们) {
    if (!x.fromOwnerId || !还在.has(x.customerId)) continue;
    const 有 = 按人.get(x.fromOwnerId) ?? { 起: x.at, 数: new Set<string>() };
    有.数.add(x.customerId);
    按人.set(x.fromOwnerId, 有);
  }
  const 超的人 = [...按人].filter(([, v]) => 超了(v.起));
  const 名 = await 人名([...new Set([...挂.flatMap((h) => [h.fromUserId, h.toUserId]), ...超的人.map(([id]) => id)])]);
  for (const h of 挂) {
    await notify(管, {
      kind: "三态", title: `离职交接挂起超过 ${交接兜底工作日} 个工作日（或 ${交接兜底自然日} 天）没人确认`,
      body: `${名.get(h.fromUserId) ?? "（已停用）"} 的离职交接 ${beijingDay(h.createdAt)} 发起，接手人 ${名.get(h.toUserId) ?? "（已停用）"} 还没确认，请裁决`,
      link: "/projects/handover", key: `tri-handover-stuck:${h.id}`,
    });
    n++;
  }
  for (const [id, v] of 超的人) {
    await notify(管, {
      kind: "三态", title: `停用账号名下 ${v.数.size} 位客户待交接超过 ${交接兜底工作日} 个工作日（或 ${交接兜底自然日} 天）`,
      body: `${名.get(id) ?? "（已停用）"} 停用后名下客户 ${beijingDay(v.起)} 起标了待交接，还没交给接手人，请到离职交接处理`,
      link: "/projects/handover", key: `tri-offboard-stuck:${id}`,
    });
    n++;
  }
  return n;
}
