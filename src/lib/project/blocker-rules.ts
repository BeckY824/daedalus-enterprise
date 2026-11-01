/**
 * 企业版卡点的取值规矩（2026-10-26 起，11-01 按定稿改版）：类型、影响、阻碍原因、状态、编号、认领会签、角色开关、
 * 老数据怎么改过来、沟通记录的时限提醒。只管规整，界面也引（不能碰 prisma）；读写库、谁能动在 lib/project/blocker.ts。
 *
 * 11-01 定稿：
 * - 状态三值：待接受 → 处理中 → 已解决。没有指认 / 转让 / 退回，也不设解决时限（库里的 dueDays / dueAt 照写，界面不显示）
 * - 多人认领：每人一行，各自点「我已完成」；x/y 全齐才整体变已解决并锁定，锁定后不能再认领
 * - 阻碍原因多选，字典在后台可增删改、停用、合并；用过的只能停用；前台新加的进「待审核」
 * - 卡点类型「暂无卡点」不生成记录
 * 管理员的默认（默认类型 / 影响）存 Setting 的 entBlockerDefaults；角色开关存 entBlockerRoles
 */
import { dayjs } from "../utils";
import { 业务角色 as 业务角色们, type 业务角色 } from "../sync/dept-policy";

export const 卡点类型们 = ["暂无卡点", "轻度卡点", "中度卡点", "重要卡点"] as const;
export const 影响等级们 = ["短期不影响", "项目暂停", "项目终止", "可能丢单"] as const;
/** 待接受 = 还没人认领；处理中 = 有人认领、没全部完成；已解决 = 认领的人全点了「我已完成」，锁定 */
export const 卡点状态们 = ["待接受", "处理中", "已解决"] as const;
export type 卡点类型 = (typeof 卡点类型们)[number];
export type 影响等级 = (typeof 影响等级们)[number];
export type 卡点状态 = (typeof 卡点状态们)[number];

export const 描述上限 = 500;
export const 标题上限 = 50;
/** 老数据没有标题时取描述前几个字 */
export const 老标题字数 = 20;
export const 原因名上限 = 20;
/** 一个卡点最多挂几个阻碍原因 */
export const 原因最多 = 11;

/** 写库用的解决时限（天）：11-01 起界面和设置里都没有时限了，dueDays / dueAt 两列照旧写，按类型给个固定值 */
export const 写库时限天数: Record<卡点类型, number> = { 暂无卡点: 7, 轻度卡点: 7, 中度卡点: 3, 重要卡点: 1 };

export type 卡点默认 = { 默认类型: 卡点类型; 默认影响: 影响等级 };
export const 默认卡点默认: 卡点默认 = { 默认类型: "中度卡点", 默认影响: "短期不影响" };

const 是类型 = (v: unknown): v is 卡点类型 => (卡点类型们 as readonly unknown[]).includes(v);
const 是影响 = (v: unknown): v is 影响等级 => (影响等级们 as readonly unknown[]).includes(v);
const 文字 = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** 存着的规整成完整的一份：缺的、坏的退回默认（老的 时限天数 / 阻碍主体们 键直接不认） */
export function 规整卡点默认(raw: unknown): 卡点默认 {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    默认类型: 是类型(r.默认类型) ? r.默认类型 : 默认卡点默认.默认类型,
    默认影响: 是影响(r.默认影响) ? r.默认影响 : 默认卡点默认.默认影响,
  };
}

/** 管理员改默认：坏的报错（不悄悄退回默认），好的合上旧的 */
export function 合上卡点默认(旧: 卡点默认, patch: unknown): 卡点默认 | { error: string } {
  if (!patch || typeof patch !== "object") return { error: "要改什么？" };
  const p = patch as Record<string, unknown>;
  const 新 = { ...旧 };
  if (p.时限天数 !== undefined) return { error: "卡点不设解决时限了" };
  if (p.默认类型 !== undefined) {
    if (!是类型(p.默认类型)) return { error: "默认卡点类型不对" };
    新.默认类型 = p.默认类型;
  }
  if (p.默认影响 !== undefined) {
    if (!是影响(p.默认影响)) return { error: "默认影响等级不对" };
    新.默认影响 = p.默认影响;
  }
  return 新;
}

/* ───────────── 阻碍原因字典 ───────────── */

/** 11 个种子值（11-01 定稿），id 固定，第一次读字典时补上（迁移不许 INSERT） */
export const 原因种子们 = [
  "决策链未打通", "客户内部推进慢", "对接人无决策权不配合", "价格预算分歧", "采购时机周期不对",
  "技术方案不匹配", "需求变更", "内部交付资源不足", "合同条款争议", "竞品介入占优", "其他",
] as const;
export const 种子原因id = (i: number) => `blkr-${i}`;
export const 原因状态们 = ["启用", "停用", "待审核"] as const;
export type 原因状态 = (typeof 原因状态们)[number];
export const 兜底原因 = "其他";

/**
 * 老的「阻碍主体」→ 新的阻碍原因（集中一张表，改版任务和测试都用这张）。
 * 表里没有的老值原样当原因名，进待审核，等管理员合并或停用
 */
export const 老主体映射: Readonly<Record<string, string>> = {
  价格: "价格预算分歧",
  竞品: "竞品介入占优",
  技术: "技术方案不匹配",
  内部资源: "内部交付资源不足",
  其他: "其他",
  客户: "客户内部推进慢",
};
export function 老主体to原因(obstacle: string | null | undefined): string {
  const o = 文字(obstacle);
  if (!o) return 兜底原因;
  return 老主体映射[o] ?? o.slice(0, 原因名上限);
}

/** 原因名：去空格、限长；空 = null */
export function 规整原因名(v: unknown): string | null {
  const s = 文字(v);
  return s && s.length <= 原因名上限 ? s : null;
}

/** 发布时选的原因（名字）：去重、去空、限个数；坏的报错 */
export function 规整原因们(v: unknown): string[] | { error: string } {
  if (v === undefined || v === null || v === "") return [];
  const 原 = Array.isArray(v) ? v : [v];
  const 们: string[] = [];
  for (const x of 原) {
    const s = 文字(x);
    if (!s) continue;
    if (s.length > 原因名上限) return { error: `阻碍原因每个不超过 ${原因名上限} 个字` };
    if (!们.includes(s)) 们.push(s);
  }
  if (们.length > 原因最多) return { error: `阻碍原因最多选 ${原因最多} 个` };
  return 们;
}

/* ───────────── 发布 ───────────── */

export type 发布输入 = {
  type?: unknown; impact?: unknown; title?: unknown; reasons?: unknown; description?: unknown; resourceRequest?: unknown;
  /** 老调用方（AI 建议卡、老界面）传的单个阻碍主体，按 老主体映射 换成原因 */
  obstacle?: unknown;
};
export type 好的发布 = {
  type: Exclude<卡点类型, "暂无卡点">; impact: 影响等级; title: string; reasons: string[]; description: string; resourceRequest: string | null;
};

/** 标题：填了用填的；没填取描述前 20 字 */
export function 标题of(title: string | null | undefined, description: string | null | undefined): string {
  const t = 文字(title);
  return t || 文字(description).slice(0, 老标题字数);
}

/**
 * 发布卡点填的：类型、影响没填按默认；「暂无卡点」不生成（返回 null）；描述必填；标题没填取描述前 20 字；
 * 阻碍原因多选，一个没选落「其他」。原因在不在字典里、新名字进待审核，读写库那边管
 */
export function 规整发布(input: 发布输入, 默认: 卡点默认): 好的发布 | null | { error: string } {
  if (!input || typeof input !== "object") return { error: "要发布什么卡点？" };
  const type = input.type === undefined || input.type === "" ? 默认.默认类型 : input.type;
  if (!是类型(type)) return { error: "卡点类型不对" };
  if (type === "暂无卡点") return null;
  const impact = input.impact === undefined || input.impact === "" ? 默认.默认影响 : input.impact;
  if (!是影响(impact)) return { error: "影响等级不对" };
  const description = 文字(input.description);
  if (!description) return { error: "写一句卡在哪" };
  if (description.length > 描述上限) return { error: `描述不超过 ${描述上限} 个字` };
  const 标 = 文字(input.title);
  if (标.length > 标题上限) return { error: `标题不超过 ${标题上限} 个字` };
  let reasons = 规整原因们(input.reasons);
  if ("error" in reasons) return reasons;
  if (!reasons.length && 文字(input.obstacle)) reasons = [老主体to原因(文字(input.obstacle))];
  if (!reasons.length) reasons = [兜底原因];
  const 资源 = 文字(input.resourceRequest);
  if (资源.length > 描述上限) return { error: `资源申请不超过 ${描述上限} 个字` };
  return { type, impact, title: 标题of(标, description), reasons, description, resourceRequest: 资源 || null };
}

/**
 * 记沟通时顺手标的卡点（2026-10-31 F-跟进-08）：卡点类型、影响、描述、原因都选填。
 * - 类型没选或选「暂无卡点」→ null，不生成卡点（11-01：「暂无卡点」不生成记录）
 * - 选了别的类型才生成一个：影响没选按默认；原因没选落「其他」；描述空写一句占位
 * 返回的直接喂给 发布卡点；先过一遍 规整发布，坏的在建沟通之前就报
 */
export const 沟通卡点占位描述 = "记沟通时标了卡点，未写描述";
export type 沟通卡点输入 = { type?: unknown; impact?: unknown; description?: unknown; obstacle?: unknown; reasons?: unknown; title?: unknown } | null | undefined;
export function 沟通卡点(input: 沟通卡点输入, 默认: 卡点默认): 发布输入 | null | { error: string } {
  if (input == null) return null;
  if (typeof input !== "object") return { error: "卡点信息格式不正确" };
  const 类 = 文字(input.type);
  if (!类 || 类 === "暂无卡点") return null;
  const 发: 发布输入 = {
    type: 类, impact: 文字(input.impact) || 默认.默认影响, title: input.title, reasons: input.reasons, obstacle: input.obstacle,
    description: 文字(input.description) || 沟通卡点占位描述,
  };
  const 好 = 规整发布(发, 默认);
  return 好 && "error" in 好 ? 好 : 发;
}

/** 一段可选的文字（处理说明、解决方案…）：空 = null，超长报错 */
export function 规整文字(v: unknown, 叫法: string, 必填 = false): string | null | { error: string } {
  const s = 文字(v);
  if (!s) return 必填 ? { error: `${叫法}要填` } : null;
  if (s.length > 描述上限) return { error: `${叫法}不超过 ${描述上限} 个字` };
  return s;
}

/* ───────────── 编号 ───────────── */

/** 沟通记录编号：FUL + yyyyMMdd + 6 位流水（不变） */
export const 卡点编号前缀 = "BLK";
export const 沟通编号前缀 = "FUL";
export function 编号日(now: Date): string {
  return dayjs(now).format("YYYYMMDD");
}
export function 拼编号(前缀: string, now: Date, 流水: number, 位数: number): string {
  return `${前缀}${编号日(now)}${String(流水).padStart(位数, "0")}`;
}
/** 当天最大的编号 → 下一个流水；没有 = 1 */
export function 下一个流水(当天最大: string | null | undefined, 前缀: string, now: Date): number {
  const 头 = `${前缀}${编号日(now)}`;
  if (!当天最大 || !当天最大.startsWith(头)) return 1;
  const n = Number(当天最大.slice(头.length));
  return Number.isInteger(n) ? n + 1 : 1;
}

/** 卡点编号（11-01 定稿）：BLK-yyyyMMdd-3 位流水，北京日。老卡点的 BLKyyyyMMdd### 不改 */
export const 卡点编号头 = (now: Date) => `${卡点编号前缀}-${编号日(now)}-`;
export function 拼卡点编号(now: Date, 流水: number): string {
  return `${卡点编号头(now)}${String(流水).padStart(3, "0")}`;
}
export function 下一个卡点流水(当天最大: string | null | undefined, now: Date): number {
  const 头 = 卡点编号头(now);
  if (!当天最大 || !当天最大.startsWith(头)) return 1;
  const n = Number(当天最大.slice(头.length));
  return Number.isInteger(n) ? n + 1 : 1;
}

/* ───────────── 认领会签 ───────────── */

/** x/y：完成了几个 / 认领了几个 */
export function 会签进度(claims: readonly { done: boolean }[]): { 完成: number; 共: number; 齐了: boolean } {
  const 共 = claims.length;
  const 完成 = claims.filter((c) => c.done).length;
  return { 完成, 共, 齐了: 共 > 0 && 完成 === 共 };
}

/**
 * 老数据改过来（11-01 改版一次性任务用）：
 * 看板 → 待接受；待接受（指认了等接受）→ 待接受、清掉指认；处理中 → 处理中、原经手人记成第一位认领人（没经手人退回待接受）；
 * 已解决 → 已解决、原经手人记成一位已完成的认领人
 */
export function 改版后(status: string, assigneeId: string | null | undefined): { status: 卡点状态; 认领: { userId: string; done: boolean } | null } {
  const 人 = assigneeId || null;
  if (status === "已解决") return { status: "已解决", 认领: 人 ? { userId: 人, done: true } : null };
  if (status === "处理中") return 人 ? { status: "处理中", 认领: { userId: 人, done: false } } : { status: "待接受", 认领: null };
  return { status: "待接受", 认领: null };
}

/* ───────────── 角色开关（B6 / B7） ───────────── */

export type 卡点范围 = "自己" | "全部";
export type 卡点角色开关 = { 启用: Record<业务角色, boolean>; 范围: Record<业务角色, 卡点范围> };
export const 卡点角色键 = "entBlockerRoles";
const 全部默认角色 = new Set<业务角色>(["director", "admin"]);
export const 默认卡点角色开关: 卡点角色开关 = {
  启用: Object.fromEntries(业务角色们.map((r) => [r, true])) as Record<业务角色, boolean>,
  范围: Object.fromEntries(业务角色们.map((r) => [r, 全部默认角色.has(r) ? "全部" : "自己"])) as Record<业务角色, 卡点范围>,
};

export function 规整卡点角色开关(raw: unknown): 卡点角色开关 {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const 启 = (r.启用 && typeof r.启用 === "object" ? r.启用 : {}) as Record<string, unknown>;
  const 范 = (r.范围 && typeof r.范围 === "object" ? r.范围 : {}) as Record<string, unknown>;
  const 出: 卡点角色开关 = { 启用: { ...默认卡点角色开关.启用 }, 范围: { ...默认卡点角色开关.范围 } };
  for (const k of 业务角色们) {
    if (typeof 启[k] === "boolean") 出.启用[k] = 启[k] as boolean;
    if (范[k] === "自己" || 范[k] === "全部") 出.范围[k] = 范[k] as 卡点范围;
  }
  return 出;
}

export function 合上卡点角色开关(旧: 卡点角色开关, patch: unknown): 卡点角色开关 | { error: string } {
  if (!patch || typeof patch !== "object") return { error: "要改什么？" };
  const p = patch as Record<string, unknown>;
  const 新: 卡点角色开关 = { 启用: { ...旧.启用 }, 范围: { ...旧.范围 } };
  const 是角色 = (k: string): k is 业务角色 => (业务角色们 as readonly string[]).includes(k);
  if (p.启用 !== undefined) {
    if (!p.启用 || typeof p.启用 !== "object") return { error: "启用要按业务角色填" };
    for (const [k, v] of Object.entries(p.启用 as Record<string, unknown>)) {
      if (!是角色(k)) return { error: `没有「${k}」这个业务角色` };
      if (typeof v !== "boolean") return { error: "启用只能是开或关" };
      新.启用[k] = v;
    }
  }
  if (p.范围 !== undefined) {
    if (!p.范围 || typeof p.范围 !== "object") return { error: "数据范围要按业务角色填" };
    for (const [k, v] of Object.entries(p.范围 as Record<string, unknown>)) {
      if (!是角色(k)) return { error: `没有「${k}」这个业务角色` };
      if (v !== "自己" && v !== "全部") return { error: "数据范围只能是「只看自己」或「可看全部」" };
      新.范围[k] = v;
    }
  }
  return 新;
}

/**
 * 我（按业务角色，可多选）在卡点上的权限：任一角色启用 = 开；启用的角色里任一是「可看全部」= 全部。
 * 没有业务角色 = 什么都没有（不兜底，账号角色不算数）
 */
export function 卡点权限of(角色们: readonly 业务角色[], 开关: 卡点角色开关): { 开: boolean; 全部: boolean } {
  const 启用的 = 角色们.filter((r) => 开关.启用[r]);
  return { 开: 启用的.length > 0, 全部: 启用的.some((r) => 开关.范围[r] === "全部") };
}

/** 一条卡点「只看自己」时谁看得到：创建人、创建人的直属上级、项目负责人（项目不在公海）、点了同意的组员、认领人 */
export type 卡点相关人 = {
  creatorId: string; 创建人上级: string | null; ownerId: string; 在公海: boolean; 组员们: readonly string[]; 认领人们: readonly string[];
};
export function 看得到卡点(我: string, 权: { 开: boolean; 全部: boolean }, b: 卡点相关人): boolean {
  if (!权.开) return false;
  if (权.全部) return true;
  if (b.creatorId === 我 || b.创建人上级 === 我) return true;
  if (!b.在公海 && b.ownerId === 我) return true;
  return b.组员们.includes(我) || b.认领人们.includes(我);
}

/* ───────────── 沟通记录时限提醒（沟通的下一步时间，和卡点时限无关） ───────────── */

/**
 * 沟通记录的时限提醒（按下一步时间）：没填、或还没到 → 步步为营；过了 3 天以内 → 卡点大师；再久 → 超出时限
 */
export type 时限提醒 = { 级别: "稳" | "拿捏" | "超时"; 文字: string };
export function 时限提醒of(nextAt: Date | null | undefined, now: Date = new Date()): 时限提醒 {
  if (!nextAt || now.getTime() <= nextAt.getTime()) return { 级别: "稳", 文字: "步步为营 指定能赢" };
  if (now.getTime() - nextAt.getTime() <= 3 * 24 * 3600_000) return { 级别: "拿捏", 文字: "卡点大师 节奏拿捏" };
  return { 级别: "超时", 文字: "超出时限 必须调整" };
}

/** 卡点流转那一行给人看的叫法（老动作留着，老卡点的流转照样看得懂） */
export const 动作叫法: Record<string, string> = {
  publish: "发布", claim: "认领", done: "我已完成", resolve: "已解决", handover: "离职交接", takeover: "项目换人接手", migrate: "改版迁移",
  assign: "指认", accept: "接受", transfer: "转让", return: "返回看板", progress: "改进度",
};
