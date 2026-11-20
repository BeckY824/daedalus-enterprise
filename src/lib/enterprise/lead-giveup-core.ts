/**
 * 企业版主动放弃（豁免）（2026-11-20，32H）的纯规则：原因选项、原因怎么认、「新分配给我」怎么认。不碰库，界面也引。
 * 整套说明见 lead-giveup.ts 文件头。
 */

/** 每人每月（北京自然月）几次 */
export const 每月放弃次数 = 1;

/**
 * 放弃原因选项（用户 11-20：原因必填，不含「线索无效 / 质量不达标」——那种走判无效）。
 * 选「其他」要补一句
 */
export const 放弃原因们 = ["外出", "忙不过来", "其他"] as const;
export type 放弃原因 = (typeof 放弃原因们)[number];
export const 其他原因 = "其他" satisfies 放弃原因;
/** 补充那句最长几个字 */
export const 放弃补充上限 = 100;

/** 框里那句：线索本身有问题不该走放弃 */
export const 走判无效话 = "线索无效请走判无效（项目里「线索验证」判无效，复核通过后记 1 条判无效待补）";
/**
 * 「其他」里写的像是在说线索无效 / 质量不达标：不收，引去判无效。
 * 只挡说线索本身坏的几种说法，「客户没空」这类照收
 */
const 无效说法 = /无效|质量|不达标|空号|假号|假线索|错号|停机|不是客户|没需求|无需求/;
export const 像判无效 = (s: string): boolean => 无效说法.test(s);

/**
 * 认框里交来的原因：只认选项里的；选「其他」要补一句（不超过 放弃补充上限 字、不能是在说线索无效）。
 * 回 文字 = 记进留痕、通知的那句（「外出」「其他：xxx」）
 */
export function 认放弃原因(原因: unknown, 补充: unknown): { ok: true; 原因: 放弃原因; 补充: string | null; 文字: string } | { ok: false; error: string } {
  if (typeof 原因 !== "string" || !(放弃原因们 as readonly string[]).includes(原因)) {
    if (typeof 原因 === "string" && 像判无效(原因)) return { ok: false, error: 走判无效话 };
    return { ok: false, error: "先选放弃原因" };
  }
  const 话 = typeof 补充 === "string" ? 补充.trim() : "";
  if (话.length > 放弃补充上限) return { ok: false, error: `补充说明最多 ${放弃补充上限} 个字` };
  if (像判无效(话)) return { ok: false, error: 走判无效话 };
  if (原因 === 其他原因 && !话) return { ok: false, error: "选「其他」要写一句为什么" };
  const 选 = 原因 as 放弃原因;
  return { ok: true, 原因: 选, 补充: 话 || null, 文字: 话 ? `${选}：${话}` : 选 };
}

/** 新分配多久以内能放弃（同超时转没填回复时间往回看的 7 天；超时转开着时 1.5 小时就转走了，这条只在开关关着时兜底） */
export const 放弃窗口天 = 7;

/** 认「新分配给我」要看的留痕（ProjectNodeLog kind transfer / pool-claim） */
export type 放弃看的痕 = { kind: string; userId: string; reason: string | null; toOwnerId: string | null; at: Date };
/** 认「新分配给我」要看的分配记录（EntLeadAssign） */
export type 放弃看的分配 = { toUserId: string; byUserId: string; createdAt: Date };

/** 分配入口（assign-actions.ts 分项目给）写的转让留痕原因开头，同 reply-overdue.ts 分配方式痕头 */
const 分配方式头 = "分配方式：";

/**
 * 这条线索是不是「新分配给我」的、哪一刻到我手上（用户 11-20：市场分配（自动 / 指定）或超时转来的）；不是 = null。
 *   - 最近一行换人留痕（转让 / 公海领取分配）是把它给我的、操作人不是我、原因以「分配方式：」开头
 *     （自动分配、指定分配、定时分配到点、超时自动转、别人主动放弃转来的都写这一行）= 那一刻
 *   - 一行换人留痕都没有、不是我建的：市场新建时直接给了我（只有分配记录）= 给我的那条分配记录的时刻
 *   - 别的（手动转让、管理从公海分、跟着客户转来、自己领的、自己建的）= 不是新分配
 */
export function 新分配时刻(我: string, p: { ownerId: string; creatorId: string }, 痕们: readonly 放弃看的痕[], 分配们: readonly 放弃看的分配[]): Date | null {
  if (!我 || p.ownerId !== 我) return null;
  const 痕 = 痕们.filter((l) => l.kind === "transfer" || l.kind === "pool-claim").sort((a, b) => b.at.getTime() - a.at.getTime());
  if (痕.length) {
    const l = 痕[0];
    return l.kind === "transfer" && l.toOwnerId === 我 && l.userId !== 我 && (l.reason ?? "").startsWith(分配方式头) ? l.at : null;
  }
  if (p.creatorId === 我) return null;
  const 分 = 分配们.filter((a) => a.toUserId === 我 && a.byUserId !== 我).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return 分?.createdAt ?? null;
}

/** 新分配时刻还在能放弃的窗口里（往回 放弃窗口天 天） */
export const 在放弃窗口 = (接手: Date, 现在: Date): boolean => 接手.getTime() >= 现在.getTime() - 放弃窗口天 * 86_400_000 && 接手.getTime() <= 现在.getTime() + 60_000;

/** 本月用过了的那句 */
/**
 * 「待补 N 条」按来源说（快轮到提醒、首页那一行）：总 = 待补几条，放弃 = 其中主动放弃（豁免）记的几条，余下是判无效记的。
 * 没有待补回空串
 */
export function 待补来源话(总: number, 放弃 = 0): string {
  const 放 = Math.min(Math.max(放弃, 0), 总);
  const 判 = 总 - 放;
  return [判 > 0 ? `判无效待补 ${判} 条` : "", 放 > 0 ? `放弃记的待补 ${放} 条` : ""].filter(Boolean).join("、");
}

export const 本月用过话 = `每人每月只能放弃 ${每月放弃次数} 次，本月已经用过了，下月 1 日起可再用`;

/**
 * 项目页给的放弃入口状态：不给（开关关、不是新分配给我的、记过有效沟通……）就不带这一格；
 * 可 = false 时按钮灰着、旁边写 为什么（验证中、本月用过）
 */
export type 放弃入口 = { 可: boolean; 为什么?: string; 本月已用: boolean };
