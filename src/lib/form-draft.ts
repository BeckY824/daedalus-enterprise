/**
 * 录入草稿的存取（全站一份，11-17）：人已经打进去的字，刷新、发版后重开、框被关掉都不丢。
 *
 * - 只存这台电脑（localStorage）、按人分（换个账号看不到上一个人的草稿），按「哪张表 + 哪条记录」分键
 * - 放 3 天，过了当没有；坏的、空的当没有
 * - 存成功 / 人明说不要（取消、清空、放弃）就删
 * - 密码、口令、密钥、令牌这类格子一律不存（按格子名认，见 去掉秘密）
 * - 附件、文件存不进来：只记「当时挂了几个」，带回时提示一句要重新选
 * - 每一下读写都包 try：隐私模式、配额满、被禁用时存不下就算了，表单照常用
 *
 * 用的地方：lib/form-guard.tsx（antd 表单弹窗）、components/FormDraft.tsx（useState 写的表单、就地改的格子、首页问答框）、
 * 项目建档向导（ProjectWizard 自己按格存）。纯函数、不带 "use client"，单测直接引（tests/form-draft.test.ts）
 */
import { dayjs } from "@/lib/utils";

const 前缀 = "daedalus:草稿:";
export const 草稿放几天 = 3;

type 存的 = { at: number; v: unknown; 附件?: number; 额外?: unknown };

/** 带回来的一份：表单值、当时挂了几个附件（带回时说一句要重选）、表单外头的几样（AI 速记框这类不在 antd 表单里的） */
export type 一份草稿 = { v: Record<string, unknown>; 附件: number; 额外?: unknown };

/** 格子名像密码 / 密钥的不存（含嵌套对象里的）。宁可多删：草稿里少一格无所谓，密码进了 localStorage 就是事故 */
const 像秘密 = /pass(word)?|passwd|pwd|secret|token|api_?key|apikey|密码|口令|密钥|令牌/i;

export function 去掉秘密(v: unknown): unknown {
  if (!v || typeof v !== "object" || Array.isArray(v) || dayjs.isDayjs(v)) return v;
  const 出: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (像秘密.test(k)) continue;
    出[k] = 去掉秘密(x);
  }
  return 出;
}

/** dayjs 存成 { $d: ISO }，读回来再变回 dayjs——日期格（预计签约、下次跟进）存进 JSON 会变成字符串，DatePicker 认不得 */
function 写成串(x: 存的): string {
  return JSON.stringify(x, function (this: Record<string, unknown>, k, y) {
    const 原 = this[k];
    return dayjs.isDayjs(原) ? { $d: 原.toISOString() } : y;
  });
}

function 读回来(raw: string): 存的 | null {
  try {
    const r = JSON.parse(raw, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) && Object.keys(x).length === 1 && typeof x.$d === "string" ? dayjs(x.$d) : x)) as 存的;
    return r && typeof r.at === "number" ? r : null;
  } catch {
    return null;
  }
}

export function 草稿全名(我: string | null | undefined, 键: string): string {
  return `${前缀}${我 ?? "-"}:${键}`;
}

/** 读一份（含附件数、表单外头那几样）；没有、过期、坏了 = null */
export function 读一份(全名: string): 一份草稿 | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(全名);
  } catch {
    return null;
  }
  const r = raw ? 读回来(raw) : null;
  if (!r || Date.now() - r.at > 草稿放几天 * 86400_000 || !r.v || typeof r.v !== "object") return null;
  return { v: r.v as Record<string, unknown>, 附件: typeof r.附件 === "number" ? r.附件 : 0, 额外: r.额外 };
}

/** 只要表单值（老用法） */
export function 读草稿(全名: string): Record<string, unknown> | null {
  return 读一份(全名)?.v ?? null;
}

export function 存草稿(全名: string, v: unknown, 另?: { 附件?: number; 额外?: unknown }): void {
  try {
    localStorage.setItem(全名, 写成串({ at: Date.now(), v: 去掉秘密(v), ...(另?.附件 ? { 附件: 另.附件 } : {}), ...(另?.额外 !== undefined ? { 额外: 去掉秘密(另.额外) } : {}) }));
  } catch {
    /* 隐私模式、配额满：存不下就算了 */
  }
}

export function 清草稿(全名: string): void {
  try {
    localStorage.removeItem(全名);
  } catch {
    /* 同上 */
  }
}

/** 有没有一格是人真填了东西的：空串、空数组、null 不算。只拿来判断要不要存草稿 */
export function 有内容(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(有内容);
  if (dayjs.isDayjs(v)) return true;
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some(有内容);
  return true;
}

/** 有没有打过字：只认字符串（含数组、对象里的）。光是下拉、日期变了不算「打了字」，不为它留草稿 */
export function 有字(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.some(有字);
  if (v && typeof v === "object" && !dayjs.isDayjs(v)) return Object.values(v as Record<string, unknown>).some(有字);
  return false;
}

function 同(a: unknown, b: unknown): boolean {
  if (dayjs.isDayjs(a) || dayjs.isDayjs(b)) return dayjs.isDayjs(a) && dayjs.isDayjs(b) && a.valueOf() === b.valueOf();
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return a === b;
  }
}

/**
 * 和打开那一刻比，人改了哪几格（只看第一层）。草稿只存这几格：
 * 改老记录时，没动的格子不进草稿，带回时不会拿三天前的旧值盖掉同事刚改的
 */
export function 改过的格(起: Record<string, unknown>, 现: Record<string, unknown>): Record<string, unknown> {
  const 出: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(起), ...Object.keys(现)])) if (!同(起[k], 现[k])) 出[k] = 现[k];
  return 出;
}

/** 带回时的那句：有附件就补一句要重选 */
export function 带回话(附件: number): string {
  return 附件 > 0 ? "已带回上次没提交的内容（附件没留住，要重新选）" : "已带回上次没提交的内容";
}
