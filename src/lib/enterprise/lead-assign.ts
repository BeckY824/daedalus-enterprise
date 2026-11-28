/**
 * 企业版线索分配（2026-10-24 会上定的，规则「线索分配和配额」，默认关）。
 *
 * - 营销线索可以分给内贸销售，也可以分给外贸销售：分的时候选走哪条线，接手人的业务线要对得上（没填业务线 = 两边都做）。
 * - 分配数按月算、每月清零：每分一次在 EntLeadAssign 记一行，带 month（YYYY-MM），配额只数本月那一格。
 *   销售自己拓的线索没有分配记录，自然不算。
 * - 直属上级、虚线上级（以及总管理员）能给个人设每月配额，不设固定复核周期。
 *   没设：手动分不限；自动分配不挑他（10-25 用户定「没填的不参与」），配额 0 也不挑。
 * - 10-30 定「开着，每人都不限额」：规则里多一个选项「不设配额」（不设配额key；11-01 起没存 = 开，存了 false 才按配额）。开着时配额整个不起作用：
 *   自动分配在规则范围内（在职、能接这条线、参与自动分配）的人里挑本月已分最少的，手动分也不查满额；关着和以前一样。
 * - 线索分出去以后，原来的负责人（市场人员）仍能看到转化情况：记录里留了 fromUserId，
 *   「我分出去的线索」按它查，不受「按组织架构看客户」限定。
 * - **还没定的留口子**：营销企划线索走哪边、算不算数——kind 记下来，算不算数走 计不计数()，
 *   现在先和营销线索一样算，定了以后改这一处（或拨 企划线索计数key 那个 Setting）。
 *
 * 纯函数在上半截（测试直接用），下半截读写库。权限、规则开关的检查在 leads/assign-actions.ts。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma, defaultClient } from "@/lib/prisma";
import { businessDayjs } from "@/lib/business-clock";
import { 随客户痕 } from "@/lib/project/carry-tasks";
import { 是补发来的 } from "./invalid-makeup";
import type { 组织 } from "./org-core";
import { 能分配线索, 能拨参与暂停, 是总管理 } from "./permissions";
import { 销售角色集 } from "./sales-roles";
import { 能改设置, type 改权限配置 } from "./edit-perm-table";

export const 线索种类 = ["营销", "营销企划"] as const;
export type 线索种类 = (typeof 线索种类)[number];
export type 线 = "内贸" | "外贸";

/** 营销企划线索算不算进当月分配数：Setting 里存 JSON true / false，没存 = 算（10-24 计数细节未定，先和营销线索一样） */
export const 企划线索计数key = "enterprise.lead_assign.plan_counted";

/**
 * 本月是哪一格：按业务钟（企业版固定北京时间，lib/business-clock），北京月初零点换格 = 每月清零。
 * 不看服务器 TZ：部署包里 TZ 没设成 Asia/Shanghai 时，月末那 8 小时会记到下个月
 */
export function 月份(d = new Date()): string {
  return businessDayjs(d).format("YYYY-MM");
}

/**
 * 能点「分配」（手动指派 / 自动分配）的人：总管理员、市场管理、销售管理（11-01 清单 A7 / A9）。
 * 只认业务角色（11-01 定，permissions.ts 能分配线索）：账号的 ADMIN / MANAGER 不放行，没设业务角色 = 不能分；管理员（admin）只读
 */
export function 能分配(org: 组织, 我: { id: string; role?: string | null }): boolean {
  return 能分配线索(我, org);
}

/**
 * 能给 目标 设配额的人：按「后台设置谁能改」的「线索分配配额」一行（edit-perm-table.ts），
 * 默认他的直属上级、虚线上级（B2 第 6 条默认建议，10-26），总管理员总能改。
 */
export function 能设配额(org: 组织, 我: { id: string; role: string }, 目标: string, 配置: 改权限配置 = {}): boolean {
  return 能改设置(org, 我, "线索配额", 配置, 目标);
}

/** 这条线索能不能分给 接手人：返回出错原因，null = 可以 */
export function 接手问题(org: 组织, 接手人: string, line: 线 | null): string | null {
  const m = org.成员.get(接手人);
  if (!m) return "接手人不在组织里，或者已经停用";
  if (!m.角色们.some((r) => 销售角色集.has(r))) return "线索只能分给销售或销售管理";
  if (line && m.line && m.line !== line) return `他是${m.line}销售，这条线索走${line}`;
  return null;
}

/** 这一条分配算不算进接手人当月的数。营销企划怎么算还没定：先看 Setting，没设 = 算 */
export function 计不计数(kind: 线索种类, 企划算数: boolean | null): boolean {
  if (kind === "营销企划") return 企划算数 ?? true;
  return true;
}

/** 配额满了没：配额 null = 没设，手动分不限（自动分配另看 有配额） */
export const 满了 = (已分: number, 配额: number | null) => 配额 !== null && 已分 >= 配额;

/** 自动分配只挑填了配额、而且不是 0 的人（10-25：没填的不参与；配额 0 也不分） */
export const 有配额 = (配额: number | null): 配额 is number => 配额 !== null && 配额 > 0;

/**
 * 每人参不参与自动分配（10-26 改三态）：允许 / 暂停 / 禁止。暂停 = 暂时不参与、可随时恢复；禁止 = 不参与。
 * 两种都不进轮转，手动分配都照常。存 Setting：{ userId: "暂停" | "禁止" }，允许的不存，没存 = 人人允许。
 * 老格式（10-24 起的开关）是 string[] = 关掉的人，读成 禁止；对象里存 true / false 的读成 允许 / 禁止。下一次改就写成新格式
 */
export const 自动分配不参与key = "enterprise.lead_assign.auto_excluded";

export const 参与状态们 = ["允许", "暂停", "禁止"] as const;
export type 参与状态 = (typeof 参与状态们)[number];
export const 是参与状态 = (x: unknown): x is 参与状态 => (参与状态们 as readonly unknown[]).includes(x);

/** 存着的值规整成 userId → 暂停 / 禁止（允许不放进来）。存坏了的当没设 */
export function 认参与状态(v: unknown): Record<string, Exclude<参与状态, "允许">> {
  const out: Record<string, Exclude<参与状态, "允许">> = {};
  if (Array.isArray(v)) {
    for (const id of v) if (typeof id === "string" && id) out[id] = "禁止";
    return out;
  }
  if (!v || typeof v !== "object") return out;
  for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
    if (!id) continue;
    if (x === "暂停" || x === "禁止") out[id] = x;
    else if (x === false) out[id] = "禁止";
  }
  return out;
}

/** 这个人现在的状态 */
export const 参与状态of = (表: Record<string, 参与状态>, userId: string): 参与状态 => 表[userId] ?? "允许";

/**
 * 规则「线索分配和配额」里的选项「不设配额（人人参与、不限额）」（10-30 客户定「开着，每人都不限额」）：
 * Setting 里存 JSON true / false；11-01 起没存 = 开（清单 A10 / A11：目前没有配额限制），存了 false 才按配额。开着时自动分配不看配额、手动分配不查满额
 */
export const 不设配额key = "enterprise.lead_assign.no_quota";

export type 候选人 = {
  userId: string; 已分: number; 配额: number | null; 进池: Date;
  /** 中途回来 / 加入时按几条起算（起算补 补过的才有；已分 已经含补的那几条），给 挑的理由 说明用 */
  起算?: number;
  /** 起算补 补了几条（只影响排序；按配额分时满没满按实数 = 已分 − 补） */
  补?: number;
  /**
   * 判无效待补（invalid-makeup.ts，M-线索-02 补「优先」）：方向对得上这次分配的待用补位，各自判无效的时刻，从早到晚。
   * 有的人在合格候选里优先，多人按最早那个先；挑中就用掉最早一个，这条是补发、不算本月已分（前面几条 模拟时也一样）
   */
  待补?: Date[];
};

/**
 * 把待用的补位挂到候选上（读挑人底子 排位 调）：只挂方向对得上这次分配的（线对得上），按退名额时刻从早到晚。
 * 行们 已经按时刻排好（待用补位行）
 */
export function 挂补位(候选: readonly 候选人[], 行们: readonly { userId: string; at: Date; line: string | null }[], 线: 线 | null): 候选人[] {
  const 表 = new Map<string, Date[]>();
  for (const r of 行们) {
    if (r.line && 线 && r.line !== 线) continue;
    const 们 = 表.get(r.userId) ?? [];
    们.push(r.at);
    表.set(r.userId, 们);
  }
  return 候选.map((c) => {
    const 们 = 表.get(c.userId);
    if (!们?.length) {
      const { 待补: _, ...别的 } = c;
      return 别的;
    }
    return { ...c, 待补: [...们].sort((a, b) => a.getTime() - b.getTime()) };
  });
}

/** 有待补的先（最早退名额的先）；都没有 = 0，交给原来的比法 */
const 待补差 = (a: 候选人, b: 候选人): number => {
  const x = a.待补?.[0]?.getTime(), y = b.待补?.[0]?.getTime();
  if (x === undefined && y === undefined) return 0;
  if (x === undefined) return 1;
  if (y === undefined) return -1;
  return x - y;
};

/**
 * 自动分配的候选人：组织里在职的（读组织时已去掉停用 / 离职的）、能接这条线的，去掉线索现在的负责人。
 * 参不参与、配额由 挑接手人 再筛
 */
export function 自动候选人们(org: 组织, 现负责人: string | null, line: 线 | null): string[] {
  return [...org.成员.keys()].filter((id) => id !== 现负责人 && 接手问题(org, id, line) === null);
}

/**
 * 挑接手人、挑的理由 同一套筛法：去掉不参与的、没填配额 / 配额 0 的、（这一条算数时）分满的。
 * 不限额（不设配额开着）时只去掉不参与的，配额不起作用
 */
function 可挑(候选: 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 不限额: boolean): 候选人[] {
  if (不限额) return 候选.filter((c) => !不参与.has(c.userId));
  // 有待补的这条是补发（不算本月已分、不占配额），分满了也照挑
  return 候选.filter((c) => !不参与.has(c.userId) && 有配额(c.配额) && !(查满 && !c.待补?.length && 满了(c.已分 - (c.补 ?? 0), c.配额)));
}

/** 本月已分 / 配额 谁的比例低：交叉相乘比，不做除法，3/9 和 1/3 判成一样。可挑的人配额都 > 0 */
const 比例差 = (a: 候选人, b: 候选人) => a.已分 * b.配额! - b.已分 * a.配额!;
/**
 * 起算时刻（11-18 客户定第 3 题 B：休假回来、月中加入的人按池里当前最少的数起算，不从 0 追）：Setting 里存 { userId: ISO 时刻 }。
 * 参与状态从暂停 / 禁止拨回正常时记（assign-actions 设自动分配参与），纯销售管理第一次进自动分配池时记（assign-eta 补记销售管理起算，内贸 11-18 第 9 题 B、外贸 11-23）；
 * 月中新建的账号不用记，按建号时间（= 进池）算。时刻不在本月的不起作用（每月 1 号人人从 0 起）
 */
export const 起算时刻key = "enterprise.lead_assign.start_at";

/** 存着的值规整成 userId → 时刻；存坏了的当没设 */
export function 认起算时刻(v: unknown): Map<string, Date> {
  const out = new Map<string, Date>();
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
    const t = typeof x === "string" ? new Date(x) : null;
    if (id && t && !Number.isNaN(t.getTime())) out.set(id, t);
  }
  return out;
}

/** 本月一条算数的分配：给谁、什么时候（起算补 数「那一刻之前」用） */
export type 分配行 = { toUserId: string; at: Date };

/** 按本月算数的分配行重数每人的本月已分（事务里重读计数也走这一句） */
export function 按行数已分(候选: readonly 候选人[], 行们: readonly 分配行[]): 候选人[] {
  const 数 = new Map<string, number>();
  for (const r of 行们) 数.set(r.toUserId, (数.get(r.toUserId) ?? 0) + 1);
  return 候选.map((c) => ({ ...c, 已分: 数.get(c.userId) ?? 0 }));
}

/**
 * 起算补（第 3 题 B）：本月中途回来 / 加入的人，排序时按「那一刻同池里正常参与的其他人最少的本月已分」起算。
 * - 起算点 = 起算时刻（回到正常 / 销售管理进池）和进池（建号）里晚的那个，只认落在本月（≥ 月初）的；没有 = 不补
 * - 基数 = 同池（这次的候选）里、现在正常参与、那一刻已经在池里（自己的起算点不晚于他）的其他人，在那一刻之前本月已分最少的条数
 * - 补 = max(0, 基数 − 他那一刻之前自己的本月已分)；排序用的本月已分 = 实际 + 补（补的那几条固定，之后照常一条条加）
 * 例：池 7 人，6 人本月各 20 条，第 7 人休假回来是 0 条 → 补 20，按 20 条起算，之后和大家轮流，不会连收 20 条。
 * 只影响排序（挑接手人 / 前面几条 / 挑的理由），分配记录、本月分配情况那一列照旧是实数
 */
export function 起算补(候选: readonly 候选人[], 起算: ReadonlyMap<string, Date>, 行们: readonly 分配行[], 不参与: ReadonlySet<string>, 月初: Date): 候选人[] {
  const 起点 = (c: 候选人): Date | null => {
    const 们 = [起算.get(c.userId), c.进池].filter((t): t is Date => !!t && t.getTime() >= 月初.getTime());
    return 们.length ? new Date(Math.max(...们.map((t) => t.getTime()))) : null;
  };
  const 点 = new Map(候选.map((c) => [c.userId, 起点(c)]));
  if (![...点.values()].some(Boolean)) return 候选.map((c) => ({ ...c }));
  const 之前 = (userId: string, t: Date) => 行们.filter((r) => r.toUserId === userId && r.at.getTime() < t.getTime()).length;
  return 候选.map((c) => {
    const t = 点.get(c.userId);
    if (!t) return { ...c };
    const 别人 = 候选.filter((o) => o.userId !== c.userId && !不参与.has(o.userId) && (点.get(o.userId)?.getTime() ?? -Infinity) <= t.getTime());
    if (!别人.length) return { ...c };
    const 基数 = Math.min(...别人.map((o) => 之前(o.userId, t)));
    const 补 = Math.max(0, 基数 - 之前(c.userId, t));
    return 补 > 0 ? { ...c, 已分: c.已分 + 补, 起算: 基数, 补 } : { ...c };
  });
}

/** 本月月初（北京零点）那一刻：起算补 只认本月的起算点 */
export function 月初of(d = new Date()): Date {
  return businessDayjs(d).startOf("month").toDate();
}

/** 不限额时比本月已分谁少 */
const 已分差 = (a: 候选人, b: 候选人) => a.已分 - b.已分;

/**
 * 自动分配挑谁（D-38，10-26 定成 A7 默认）：去掉不参与的、没填配额的、（这一条算数时）分满的，
 * 挑「本月已分 / 配额」比例最低的；比例一样给最早进分配池的。EntMember 没记进池时间，先按建号时间算；
 * 再一样按 id，结果不随查询顺序变。
 * 不限额（10-30）：参与的人都能挑，比本月已分条数（最少优先），并列的同样给最早进分配池的。
 * 判无效待补（11-20，invalid-makeup.ts）：上面筛完的合格的人里，有待补的先挑，多人按判无效时间最早的先；没人待补照上面比。
 * 有待补的那条是补发、不算本月已分，按配额分时分满了也照挑
 */
export function 挑接手人(候选: 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 不限额 = false): string | null {
  const 可 = 可挑(候选, 不参与, 查满, 不限额);
  const 差 = 不限额 ? 已分差 : 比例差;
  // 判无效待补（M-线索-02 补「优先」）：合格的人里有待补的先，多人按退名额时间最早的先；都没有照原来比
  可.sort((a, b) => 待补差(a, b) || 差(a, b) || a.进池.getTime() - b.进池.getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return 可[0]?.userId ?? null;
}

/**
 * 「前面约几条轮到我」（11-18 客户定，自动分配快轮到我）：按现在的数，用 挑接手人 一条条往下挑（挑中的人本月已分 +1），
 * 数轮到 我 之前分给别人几条。和真分配同一套挑法，不另写规则；只是估算——指定分配、有人暂停 / 恢复、新同事加入都会让它变。
 * 我不在候选里、不参与、按配额分时我已分满（永远挑不到我）= null；最多 数到 条还没轮到也 null（防止转圈）
 */
export function 前面几条(候选: readonly 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 不限额: boolean, 我: string, 数到 = 5000): number | null {
  if (不参与.has(我) || !候选.some((c) => c.userId === 我)) return null;
  const 们 = 候选.map((c) => ({ ...c }));
  for (let n = 0; n <= 数到; n++) {
    const 谁 = 挑接手人(们, 不参与, 查满, 不限额);
    if (!谁) return null;
    if (谁 === 我) return n;
    const 中 = 们.find((c) => c.userId === 谁)!;
    // 挑中有待补的人 = 补发：用掉他最早一个待补，不算本月已分（同真分配）；没待补的照常 +1
    if (中.待补?.length) 中.待补 = 中.待补.slice(1);
    else 中.已分++;
  }
  return null;
}

/**
 * 挑中 谁 的理由，给界面上的结果提示用（「为什么是他」）。和 挑接手人 用同一套筛法：
 * 这一条不算数时不看满没满（没填配额的照样不挑）；比例并列时说明是按进池先后给的
 */
export function 挑的理由(候选: 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 谁: string, 不限额 = false): string {
  const 可 = 可挑(候选, 不参与, 查满, 不限额);
  const 他 = 可.find((c) => c.userId === 谁);
  if (!他) return "";
  if (他.待补?.length) {
    const 别的待补 = 可.filter((c) => c.userId !== 谁 && c.待补?.length).length;
    return `判无效补发：他有 ${他.待补.length} 条线索最终判了无效、待补，优先补给他${别的待补 ? `（还有 ${别的待补} 人待补，按判无效先后）` : ""}；补发不算本月已分（现在 ${他.已分} 条），本轮正常轮到他照常给`;
  }
  const 起算话 = 他.起算 !== undefined ? `，中途回来按 ${他.起算} 条起算` : "";
  if (不限额) {
    const 并列 = 可.filter((c) => c.已分 === 他.已分).length;
    return 并列 > 1
      ? `本月已分最少（${他.已分} 条${起算话}，和 ${并列 - 1} 人并列，先给最早进分配池的）；不设配额，不限额`
      : `本月已分最少（${他.已分} 条${起算话}）；不设配额，不限额`;
  }
  const 并列 = 可.filter((c) => 比例差(c, 他) === 0).length;
  const 比 = `${他.已分}/${他.配额}`;
  const 理由 = 并列 > 1 ? `本月已分 / 配额比例最低（${比}，和 ${并列 - 1} 人并列，先给最早进分配池的）` : `本月已分 / 配额比例最低（${比}）`;
  return 查满 ? 理由 : `${理由}；这条不算数，不占配额`;
}

/**
 * 能把销售「参与状态」改成任何一态（正常 / 暂停 / 禁止）的人：只有系统管理员（11-01 16:1x 拍板，A9；permissions.ts 是总管理）。
 * 市场管理只能在「允许 / 暂停」之间拨（客户 11-21 选 A，见 参与改动挡）；销售管理只能手动指派、不能改参与状态；直属上级只能看；
 * 管理员（admin）只读。只认业务角色，账号 ADMIN 不放行
 */
export function 能改参与(org: 组织, 我: { id: string; role?: string | null }): boolean {
  return 是总管理(我, org);
}

/** 市场管理碰到「禁止」时那一句 */
export const 禁止只管理员话 = "「禁止」只有系统管理员能设、能改；市场管理只能暂停 / 允许";

/**
 * 我把某人的参与状态从 原 改成 新，挡不挡：null = 能改，否则是挡住的那句（客户 11-21 选 A）。
 * 系统管理员三态随便改；市场管理只在允许 ↔ 暂停之间拨：不能设禁止，也不能把已经禁止的人改回来；别人都不能改
 */
export function 参与改动挡(org: 组织, 我: { id: string; role?: string | null }, 原: 参与状态, 新: 参与状态): string | null {
  if (能改参与(org, 我)) return null;
  if (!能拨参与暂停(我, org)) return "只有系统管理员、市场管理能改销售的参与状态（销售管理可以手动指派）";
  if (新 === "禁止" || 原 === "禁止") return 禁止只管理员话;
  return null;
}

/** 这一行我能选哪几态（设置页「参与自动分配」那一格）：空 = 不能改 */
export function 参与可选(org: 组织, 我: { id: string; role?: string | null }, 原: 参与状态): 参与状态[] {
  return 参与状态们.filter((新) => 参与改动挡(org, 我, 原, 新) === null);
}

// —— 读库 ——

/** 查完再写 的事务里传 tx 进来，查的和写的落在同一个事务 */
type 库 = Pick<Prisma.TransactionClient, "entLeadAssign" | "entLeadQuota" | "entLeadQuotaBonus">;

/** 本月已经算进数的分配条数 */
export async function 本月已分(userId: string, 月 = 月份(), db: 库 = prisma): Promise<number> {
  return db.entLeadAssign.count({ where: { toUserId: userId, month: 月, counted: true } });
}

/**
 * 生效配额 = 设的每月配额 + 本月加的额（线索验证：最终判无效、负责人占过额度的线索给他本月 +1，lib/project/lead-verify.ts）。
 * 没设配额 = null，加额不起作用：手动分本来不限、自动分配本来不挑他
 */
export const 生效配额 = (基: number | null, 加: number): number | null => (基 === null ? null : 基 + 加);

/** 本月加了几条额：按 月份() 那一格存，下个月是新的一格 = 每月清零 */
export async function 本月加额(userId: string, 月 = 月份(), db: Pick<库, "entLeadQuotaBonus"> = prisma): Promise<number> {
  return (await db.entLeadQuotaBonus.findUnique({ where: { userId_month: { userId, month: 月 } } }))?.count ?? 0;
}

/** 一批人本月各加了几条额，没加的不在表里 */
export async function 本月加额们(ids: string[], 月 = 月份(), db: Pick<库, "entLeadQuotaBonus"> = prisma): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const 行 = await db.entLeadQuotaBonus.findMany({ where: { userId: { in: ids }, month: 月 } });
  return new Map(行.map((r) => [r.userId, r.count]));
}

/**
 * 这条线索占过 userId 的额度没有：有他算数的分配记录才算（不限哪个月，有几行都只是占过）。
 * 批量分配时随客户走的、老数据、手工建的、转给他的都没有这一行；不算数的（counted=false）本来就没占。
 * 例外：判无效补发来的（counted=false，用掉了他的待补，invalid-makeup.ts）也算——补来的又判无效，再补 1 条
 */
export async function 占过名额(db: Pick<Prisma.TransactionClient, "entLeadAssign" | "entLeadMakeup">, projectId: string, userId: string): Promise<boolean> {
  if (await db.entLeadAssign.findFirst({ where: { projectId, toUserId: userId, counted: true }, select: { id: true } })) return true;
  return 是补发来的(db, projectId, userId);
}

/**
 * 给 userId 本月配额 +1。11-20 起判无效不再调（改成判无效待补 + 补发不算本月已分，invalid-makeup.ts；用户 11-20 定：判无效那条的名额不退）；
 * 留着读老数据（本月加额 / 生效配额 照旧把已加过的算进去）。原说明：线索最终判无效、占过他额度时调。没设配额的人不加，返回 false：
 * 他不参与自动分配、手动分也不限，加了没意义，还会让以后设配额的那个月凭空多出来
 */
export async function 加一条配额(db: Pick<库, "entLeadQuota" | "entLeadQuotaBonus">, userId: string, 月 = 月份()): Promise<boolean> {
  if (!(await db.entLeadQuota.findUnique({ where: { userId } }))) return false;
  await db.entLeadQuotaBonus.upsert({
    where: { userId_month: { userId, month: 月 } },
    create: { userId, month: 月, count: 1 },
    update: { count: { increment: 1 } },
  });
  return true;
}

/** 生效配额：设的配额 + 本月加的额；没设 = null */
export async function 配额of(userId: string, db: 库 = prisma, 月 = 月份()): Promise<number | null> {
  const 基 = (await db.entLeadQuota.findUnique({ where: { userId } }))?.quota ?? null;
  return 基 === null ? null : 生效配额(基, await 本月加额(userId, 月, db));
}

export type 分出去的线索 = {
  /** 老的线索表；企业版只用项目以后分的是项目，这里为空、看 projectId */
  leadId: string | null;
  /** 企业版「新线索」= 项目的线索阶段：分的是哪个项目 */
  projectId: string | null;
  name: string;
  status: string;
  convertedAt: string | null;
  /** 转成了哪个客户；线索删了或没转 = null */
  customerId: string | null;
  接手人: string;
  当前负责人: string | null;
  line: string | null;
  /** 营销 / 营销企划；随客户走的没有分配种类，写「随客户」 */
  kind: string;
  分配时间: string;
  /** 不是单独分的：市场首次分给销售时跟着客户走的项目（X-18），没有分配记录、不占额度。分配时间 = 跟着走的时刻 */
  随客户?: true;
};

/**
 * 我分出去的线索和它们现在的转化情况（10-24：「线索分出去以后，原来的市场人员仍能看到转化情况」）。
 * 我 = 分之前的负责人（fromUserId）或者点分配的人（byUserId）。同一条线索分了几次只留最近一次。
 * 跟着客户走的项目（X-18）没有分配记录，从转让痕里读（转客户给销售 记的 随客户痕），我 同样是原项目负责人或操作人；
 * 普通改客户负责人带走的没这句，不算分配、不列。这里只读，不补分配记录（要占额度）。
 *
 * 线索走不限定的那个连接：分出去以后线索在别人名下，「按组织架构看客户」开着时我按负责人是看不到它的；
 * 这里只取名称、状态、转化时间这几列，不带电话、邮箱。
 */
export async function 我分出去的(我: string, 最多 = 200): Promise<分出去的线索[]> {
  const 记录 = await prisma.entLeadAssign.findMany({
    where: { OR: [{ fromUserId: 我 }, { byUserId: 我 }] },
    orderBy: { createdAt: "desc" },
    take: 最多 * 2,
  });
  // 同一条（线索或项目）分了几次只留最近一次
  const 最近 = new Map<string, (typeof 记录)[number]>();
  for (const r of 记录) {
    const k = r.projectId ? `p:${r.projectId}` : r.leadId ? `l:${r.leadId}` : null;
    if (k && !最近.has(k)) 最近.set(k, r);
  }
  // 留痕走不限定的连接：客户转走以后这些项目我多半看不到了
  const 痕们 = await defaultClient.projectNodeLog.findMany({
    where: { kind: { in: ["transfer", "pool-claim"] }, reason: { startsWith: 随客户痕 }, OR: [{ fromOwnerId: 我 }, { userId: 我 }] },
    orderBy: { at: "desc" },
    take: 最多 * 2,
    select: { projectId: true, toOwnerId: true, at: true },
  });
  const 随走 = new Map<string, (typeof 痕们)[number]>();
  for (const l of 痕们) if (!随走.has(l.projectId)) 随走.set(l.projectId, l);
  // 同一个项目分配记录和随客户都有的（跟走以后又被单独分过，或者反过来）：哪次晚算哪次，一样晚算分配
  const 这次随走 = (r: (typeof 记录)[number]) => {
    const l = r.projectId ? 随走.get(r.projectId) : undefined;
    return !!l && l.at > r.createdAt;
  };
  const 分的 = [...最近.values()].filter((r) => !这次随走(r));
  const 占了 = new Set(分的.flatMap((r) => (r.projectId ? [r.projectId] : [])));
  const 随的 = [...随走.values()].filter((l) => !占了.has(l.projectId));
  const 留 = [
    ...分的.map((r) => ({ 时: r.createdAt, 分: r, 随: null })),
    ...随的.map((l) => ({ 时: l.at, 分: null, 随: l })),
  ].sort((a, b) => b.时.getTime() - a.时.getTime()).slice(0, 最多);
  const 留分 = 留.flatMap((x) => (x.分 ? [x.分] : []));
  const 留随 = 留.flatMap((x) => (x.随 ? [x.随] : []));
  const leadIds = 留分.flatMap((r) => (r.projectId || !r.leadId ? [] : [r.leadId]));
  const projectIds = [...留分.flatMap((r) => (r.projectId ? [r.projectId] : [])), ...留随.map((l) => l.projectId)];
  const [leads, projects] = await Promise.all([
    leadIds.length
      ? defaultClient.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, name: true, status: true, convertedAt: true, customerId: true, owner: { select: { name: true } } },
        })
      : [],
    projectIds.length
      ? defaultClient.project.findMany({
          // 不限定的连接不过软删扩展：回收站里的项目（P9）当删了，自己带上
          where: { id: { in: projectIds }, deletedAt: null, customer: { deletedAt: null } },
          select: { id: true, name: true, phase: true, node: true, result: true, customerId: true, ownerId: true, pooledAt: true, bizLine: true },
        })
      : [],
  ]);
  const 线索 = new Map(leads.map((l) => [l.id, l]));
  const 项目 = new Map(projects.map((p) => [p.id, p]));
  const 人名 = new Map(
    (await defaultClient.user.findMany({
      where: { id: { in: [...new Set([...留分.map((r) => r.toUserId), ...留随.flatMap((l) => (l.toOwnerId ? [l.toOwnerId] : [])), ...projects.map((p) => p.ownerId)])] } },
      select: { id: true, name: true },
    })).map((u) => [u.id, u.name]),
  );
  return 留.flatMap(({ 分: r, 随: l0 }): 分出去的线索[] => {
    if (l0) {
      const p = 项目.get(l0.projectId);
      if (!p) return [];
      return [{
        leadId: null,
        projectId: p.id,
        name: p.name,
        status: p.result ?? `${p.phase} · ${p.node}`,
        convertedAt: null,
        customerId: p.customerId,
        当前负责人: p.pooledAt ? "公海" : (人名.get(p.ownerId) ?? null),
        接手人: (l0.toOwnerId && 人名.get(l0.toOwnerId)) || "—",
        line: p.bizLine,
        kind: "随客户",
        分配时间: l0.at.toISOString(),
        随客户: true,
      }];
    }
    if (!r) return [];
    const 共 = { 接手人: 人名.get(r.toUserId) ?? "—", line: r.line, kind: r.kind, 分配时间: r.createdAt.toISOString() };
    if (r.projectId) {
      const p = 项目.get(r.projectId);
      if (!p) return []; // 项目被删了
      // 项目不单独记转商机的时间：转没转看状态那一栏（阶段 · 节点，或结局）
      return [{
        leadId: null,
        projectId: p.id,
        name: p.name,
        status: p.result ?? `${p.phase} · ${p.node}`,
        convertedAt: null,
        customerId: p.customerId,
        当前负责人: p.pooledAt ? "公海" : (人名.get(p.ownerId) ?? null),
        ...共,
      }];
    }
    const l = r.leadId ? 线索.get(r.leadId) : undefined;
    if (!l) return []; // 线索被删了
    return [{
      leadId: l.id,
      projectId: null,
      name: l.name,
      status: l.status,
      convertedAt: l.convertedAt?.toISOString() ?? null,
      customerId: l.customerId,
      当前负责人: l.owner?.name ?? null,
      ...共,
    }];
  });
}
