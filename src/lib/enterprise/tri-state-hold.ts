/**
 * 客户三态 · 按钮的服务端动作（三态落地计划 P6；M-公海-19、M-公海-23、M-公海-27、M-公海-38）。只做服务端，界面另做。
 * customers/tri-state-actions.ts 套一层登录后调这里；测试直接调这里。
 *
 *   - 继续持有：沉睡时叫「我还在跟」（理由可空），待回收时叫「写理由继续持有」（理由必填）。只把三个节点一起顺延规则里的每次天数，钟不拨零。
 *     每轮（沉睡轮、待回收轮）一次；累计次数、合计顺延天数两个上限都查，用满任一个就不给（以 算三态() 的 继续持有 为准）。
 *     额度挂在客户钟上：换负责人不动；记了有内容的沟通回满（读的时候判，见 tri-state-quota.ts）
 *   - 谁能点：负责人本人；直属上级从沉睡第 30 天（第 120 天）起代选，同样扣额度，留痕「由 XX 代选」并通知原负责人（M-公海-23）；
 *     待回收时收到提醒的条线总管理（tri-state-people.ts 找条线总管理）和系统管理员也能写理由继续持有（M-公海-17），同样扣额度、留痕、通知负责人
 *   - 被挡裁决（到期该进公海、被同事在推的项目挡住）：负责人所在条线的总管理 / 系统管理员。
 *     暂缓回收：不扣继续持有额度，裁决后 30 天内不再推、之后每月提醒（提醒节奏在 算三态()）；30 天内再点被拒。
 *     让同事结束项目：通知名下同事项目的负责人，留一行痕。移交走现有转让，这里不另做
 *   - 互斥：每个动作都在一笔写事务里按最新事实重算再写（SQLite 写事务独占，查完再写），两人同时点只有先到的那次算数
 */
import { prisma } from "@/lib/prisma";
import { 查完再写 } from "@/lib/check-then-write";
import { 看全部 } from "@/lib/team-scope";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { beijingDay } from "@/lib/business-clock";
import { 算三态, 加天, 差天, 沉睡抄上级第几天, 被挡提醒间隔, 暂缓回收上限次数, type 三态结果 } from "./tri-state";
import { 留痕方式, 暂缓回收, 让同事结束项目, 暂缓回收次数 } from "./tri-state-quota";
import { 收三态客户, 写钟, 三态开着, 存归零, type 三态客户 } from "./tri-state-db";
import { 读组织 } from "./org";
import { 能继续持有三态, 能代选三态, 能裁决三态, 能总管理继续持有三态, type 谁 } from "./permissions";
import { notify } from "./notify";

export type 三态动作结果 = { ok: true; 剩次数?: number; 剩天数?: number; 通知了?: number } | { ok: false; error: string };

type 我 = 谁 & { name: string };
export type 在计时 = Extract<三态结果, { 计时: true }>;

const 没开话 = "客户三态没开";
const 不在计时话 = (原因: string) => `这位客户现在不计三态（${原因}）`;
/** 上级代选从沉睡第几天起（M-公海-23「沉睡第 30 天（第 120 天）起」），从进沉睡那天数 */
export const 代选起始 = (r: 在计时) => r.节点天.沉睡 + 沉睡抄上级第几天;
export const 能代选了 = (r: 在计时) => r.状态 !== "活跃" && r.第几天 >= 代选起始(r);

/** 到期暂缓回收（被挡）的按待回收这一轮算（T11：暂缓用满后走继续持有） */
export const 是待回收轮 = (r: 在计时) => r.状态 === "待回收" || (r.状态 === "该进公海" && r.被挡);

/**
 * 我点「我还在跟 / 写理由继续持有」按什么身份算、能不能点（按钮动作和客户详情状态条共用，状态条只看不写）：
 * 负责人本人；直属上级（沉睡第 30 天起代选）；待回收轮收到提醒的条线总管理 / 系统管理员（同时是上级、上级还不能代选时按总管理）。额度不够也在这里回错话
 */
export function 继续持有身份(me: 谁, c: 三态客户, r: 在计时, org: Awaited<ReturnType<typeof 读组织>>): { 身份: "本人" | "上级" | "总管理"; 轮: "沉睡" | "待回收" } | { 错: string } {
  const 本人 = 能继续持有三态(me, c, org);
  const 待回收轮 = 是待回收轮(r);
  const 是上级 = !本人 && 能代选三态(me, c, org);
  const 是总管理 = !本人 && 待回收轮 && 能总管理继续持有三态(me, c, org);
  // 身份取并集：又是直属上级、又是这条线的总管理 / 系统管理员的，上级还没到代选日（待回收节点 − 沉睡节点 < 30 天的设置）时按总管理算（M-公海-17）；
  // 上级能代选时照旧按上级。沉睡轮总管理本来就不能持，不变
  const 上级 = 是上级 && (能代选了(r) || !是总管理);
  const 总管理 = 是总管理 && !上级;
  if (!本人 && !上级 && !总管理) return { 错: 待回收轮 ? "只有负责人本人、直属上级、这条线的总管理或系统管理员能继续持有" : "只有负责人本人或直属上级能继续持有" };
  if (上级 && !能代选了(r)) return { 错: `直属上级从沉睡待定第 ${沉睡抄上级第几天} 天（第 ${代选起始(r)} 天）起才能代选` };
  if (!r.继续持有.能推) return { 错: r.继续持有.不能原因 ?? "现在不能继续持有" };
  return { 身份: 本人 ? "本人" : 上级 ? "上级" : "总管理", 轮: 待回收轮 ? "待回收" : "沉睡" };
}

/** 暂缓回收现在给不给点（按钮动作和状态条共用）：30 天内暂缓过、或累计用满 2 次回错话；给点回 null */
export function 暂缓回收不给(c: 三态客户, 今天: string): string | null {
  const 上次 = c.事实.暂缓回收日;
  if (上次 && 差天(上次, 今天) < 被挡提醒间隔) return `${上次} 已经暂缓回收过，${被挡提醒间隔} 天内不用再裁决`;
  // T11：累计最多 2 次（60 天），从额度上次重置（有效沟通、公海领走）起数；用满了要走继续持有、占额度
  if (暂缓回收次数(c.留痕, c.事实.额度重置日 ?? null) >= 暂缓回收上限次数) {
    return `暂缓回收已用满 ${暂缓回收上限次数} 次（${暂缓回收上限次数 * 被挡提醒间隔} 天），要继续留着请写理由继续持有（占继续持有的次数和天数）`;
  }
  return null;
}

/** 读规则、组织，在事务里按最新事实算这一位；不在计时的回错话 */
type 备好 = { 规则: Awaited<ReturnType<typeof 生效组织规则>>; org: Awaited<ReturnType<typeof 读组织>>; 今天: string };
async function 事务里算(现在: Date): Promise<备好 | { 错: string }> {
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return { 错: 没开话 };
  const org = await 读组织();
  return { 规则, org, 今天: beijingDay(现在) };
}

/**
 * 继续持有（「我还在跟」/「写理由继续持有」，上级代选同一个入口：点的人不是负责人、是直属上级时按代选记）。
 * 成功回剩下的次数和合计天数
 */
export async function 继续持有(me: 我, customerId: string, 理由?: string | null, 现在: Date = new Date()): Promise<三态动作结果> {
  const 备 = await 事务里算(现在);
  if ("错" in 备) return { ok: false, error: 备.错 };
  const { 规则, org, 今天 } = 备;
  const 话 = (理由 ?? "").trim().slice(0, 500);
  const 结果 = await 看全部(() => 查完再写(async (tx) => {
    const c = (await 收三态客户(tx, [customerId], 规则, org, 现在)).get(customerId);
    if (!c) return { ok: false as const, error: "找不到这位客户" };
    const r = 算三态(c.事实, 规则.三态, 今天);
    if (!r.计时) return { ok: false as const, error: 不在计时话(r.原因) };
    await 存归零(tx, [c]);
    const 身份 = 继续持有身份(me, c, r, org);
    if ("错" in 身份) return { ok: false as const, error: 身份.错 };
    const 上级 = 身份.身份 === "上级", 总管理 = 身份.身份 === "总管理";
    const 代选 = 上级 || 总管理;
    const 轮 = 身份.轮;
    if (轮 === "待回收" && !话) return { ok: false as const, error: "即将回收时要写理由才能继续持有" };
    const 天数 = 规则.三态.继续持有.每次天数;
    const 说 = 话 || "我还在跟";
    const 留 = await tx.entCustomerStateLog.create({
      data: { customerId, fromState: 轮, toState: 轮, userId: me.id, via: 总管理 ? 留痕方式.总管理代选 : 上级 ? 留痕方式.上级代选 : 留痕方式.本人, reason: 代选 ? `由 ${me.name} 代选：${说}` : 说, holdDays: 天数, at: 现在 },
      select: { id: true },
    });
    // 按写进去的这一行重算，钟（状态、进入日、额度缓存）跟着挪
    const 新 = (await 收三态客户(tx, [customerId], 规则, org, 现在)).get(customerId)!;
    const 新r = 算三态(新.事实, 规则.三态, 今天);
    if (新r.计时) await 写钟(tx, 新, 新r, 今天, 现在, `继续持有顺延 ${天数} 天，三个节点一起往后挪`);
    await tx.entCustomerClock.update({ where: { customerId }, data: { holdUntil: 加天(今天, 天数), holdReason: 说 } });
    const 额 = 新r.计时 ? 新r.继续持有 : r.继续持有;
    return { ok: true as const, 剩次数: 额.剩次数, 剩天数: 额.剩天数, 代选, 负责人: c.salesOwnerId, 名: c.name, 留痕Id: 留.id, 说 };
  }));
  if (!结果.ok) return 结果;
  if (结果.代选) {
    await notify([结果.负责人], {
      kind: "三态", title: `「${结果.名}」由 ${me.name} 代选了继续持有`, body: `${结果.说}（钟没拨零，提醒推后 ${规则.三态.继续持有.每次天数} 天）`,
      link: `/customers/${customerId}`, key: `tri-proxy:${结果.留痕Id}`,
    });
  }
  return { ok: true, 剩次数: 结果.剩次数, 剩天数: 结果.剩天数 };
}

/** 被挡裁决的公共前置：开着、在计时、到期被挡、我能裁决 */
async function 裁决前查(me: 我, customerId: string, 现在: Date, tx: Parameters<Parameters<typeof 查完再写>[0]>[0], 备: 备好): Promise<{ 错: string } | { c: 三态客户; r: 在计时 }> {
  const c = (await 收三态客户(tx, [customerId], 备.规则, 备.org, 现在)).get(customerId);
  if (!c) return { 错: "找不到这位客户" };
  await 存归零(tx, [c]);
  const r = 算三态(c.事实, 备.规则.三态, 备.今天);
  if (!r.计时) return { 错: 不在计时话(r.原因) };
  if (!能裁决三态(me, c, 备.org)) return { 错: "只有这条线的总管理或系统管理员能裁决" };
  if (r.状态 !== "该进公海" || !r.被挡) return { 错: "只有到期该进公海、因同事在推的项目进入暂缓待收的客户才要裁决" };
  return { c, r };
}

/**
 * 暂缓回收（M-公海-27）：不扣继续持有额度；裁决后 30 天内不再推，30 天后还挡着按月提醒。30 天内已经暂缓过的不能再点
 */
export async function 暂缓回收动作(me: 我, customerId: string, 理由?: string | null, 现在: Date = new Date()): Promise<三态动作结果> {
  const 备 = await 事务里算(现在);
  if ("错" in 备) return { ok: false, error: 备.错 };
  const 话 = (理由 ?? "").trim().slice(0, 500);
  return 看全部(() => 查完再写(async (tx) => {
    const 查 = await 裁决前查(me, customerId, 现在, tx, 备);
    if ("错" in 查) return { ok: false as const, error: 查.错 };
    const 不给 = 暂缓回收不给(查.c, 备.今天);
    if (不给) return { ok: false as const, error: 不给 };
    await tx.entCustomerStateLog.create({
      data: { customerId, fromState: "待回收", toState: "待回收", userId: me.id, via: 留痕方式.总管理裁决, reason: 话 ? `${暂缓回收}：${话}` : 暂缓回收, at: 现在 },
    });
    return { ok: true as const };
  }));
}

/** 让同事结束项目（M-公海-27）：通知名下同事在推项目的负责人一声，留一行痕。同一天再点不重发 */
export async function 让同事结束项目动作(me: 我, customerId: string, 现在: Date = new Date()): Promise<三态动作结果> {
  const 备 = await 事务里算(现在);
  if ("错" in 备) return { ok: false, error: 备.错 };
  const 结果 = await 看全部(() => 查完再写(async (tx) => {
    const 查 = await 裁决前查(me, customerId, 现在, tx, 备);
    if ("错" in 查) return { ok: false as const, error: 查.错 };
    if (!查.c.同事们.length) return { ok: false as const, error: "名下没有同事在推的项目" };
    await tx.entCustomerStateLog.create({
      data: { customerId, fromState: "待回收", toState: "待回收", userId: me.id, via: 留痕方式.总管理裁决, reason: `${让同事结束项目}（${查.c.同事们.length} 位同事）`, at: 现在 },
    });
    return { ok: true as const, 同事们: 查.c.同事们, 名: 查.c.name };
  }));
  if (!结果.ok) return 结果;
  // M-公海-33 飞书只推三级提醒链和系统管理员：同事不在链上，只记站内
  const n = await notify(结果.同事们, {
    不推飞书: true,
    kind: "三态", title: `「${结果.名}」到期该回公海，因你负责的项目进入暂缓待收`, body: `${me.name} 请你结束这位客户名下你负责、还没结束的项目`,
    link: `/customers/${customerId}`, key: `tri-end-colleague:${customerId}:${备.今天}`,
  });
  return { ok: true, 通知了: n };
}

/** 给界面 / 测试读：这位客户现在的三态和继续持有额度（不写库）。不在计时、没开回 null */
export async function 读一位三态(customerId: string, 现在: Date = new Date()): Promise<在计时 | null> {
  const 规则 = await 生效组织规则();
  if (!(await 三态开着(规则))) return null;
  const org = await 读组织();
  const c = (await 看全部(() => 收三态客户(prisma, [customerId], 规则, org, 现在))).get(customerId);
  if (!c) return null;
  const r = 算三态(c.事实, 规则.三态, beijingDay(现在));
  return r.计时 ? r : null;
}
