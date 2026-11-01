/**
 * 单个字段「没填」怎么认、怎么显示（11-01 用户定）：
 * 「客户属性目前由于导入的时候没有相关值都填 -」「其余地方没有填写的信息都用 — 表示」。
 *
 * - 没填 = null / undefined / 空串 / 只有空白 / 只有横线（导入时拿 "-" 占位的，含全角「－」、长短横「—」「–」、「--」）
 * - 没填的统一显示成「—」（U+2014）；0、false 这类是填了的
 * - 只管显示和分组，库里的 "-" 不改（数据修正另议）
 * - 整段的空态提示（「暂无跟进」这类）、引导去填的提示（「待填写X」「点击写备注」）不归这里
 *
 * 纯函数、不碰 React，服务端客户端都能用。
 */
export const 空值符 = "—";

/** 只由横线组成的占位：- － — – ― ‐ ‑ ‒ ⁃，一个或几个 */
const 横线占位 = /^[-－—–―‐‑‒⁃]+$/;

/** 这个值算不算没填 */
export function 是空值(v: unknown): v is null | undefined | "" {
  if (v === null || v === undefined) return true;
  if (typeof v !== "string") return false;
  const t = v.trim();
  return t === "" || 横线占位.test(t);
}

/** 填了（类型收窄成 string，JSX 里 `有值(x) ? <span>{x}</span> : 空` 直接用） */
export function 有值(v: string | null | undefined): v is string {
  return !是空值(v);
}

/** 没填的归成 null，填了的去掉首尾空白：分组、比对用 */
export function 去空(v: string | null | undefined): string | null {
  return 是空值(v) ? null : v.trim();
}

/** 显示用：没填写「—」，填了的原样（数字转字符串，0 照写 0） */
export function 空显(v: string | number | null | undefined): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : 空值符;
  return 是空值(v) ? 空值符 : v;
}
