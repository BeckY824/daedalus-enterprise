/**
 * 项目画像（企业版 P11，迁移 087）的纯规矩：产品需求多选怎么存、所在地怎么规整。不碰库，界面和 profile.ts 共用。
 * 五项选项见 enterprise/dict-kinds.ts 项目画像项（设置 → 项目模式 里改字典）；所在地是自由文字
 */

/** 所在地最多几个字：国内写城市、国外写国家，30 个字够了 */
export const 所在地上限 = 30;
export const 所在地提示 = "国内填城市名，国外填国家";

/** 库里 productNeeds 存 JSON 数组字符串；读出来认不出（手改坏了、旧数据）就当没选，不报错 */
export function 读产品需求(存的: string | null | undefined): string[] {
  if (!存的) return [];
  try {
    const v: unknown = JSON.parse(存的);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
  } catch {
    return [];
  }
}

/** 存之前：去空白、去重、保留勾选顺序；一项都没有存 null（和没填一样） */
export function 存产品需求(选的: readonly string[]): string | null {
  const 留 = [...new Set(选的.map((x) => x.trim()).filter(Boolean))];
  return 留.length ? JSON.stringify(留) : null;
}

/** 所在地：去首尾空白、中间连着的空白并成一个；空 = null；超长报错（不悄悄截断） */
export function 规整所在地(v: unknown): { ok: true; 值: string | null } | { ok: false; error: string } {
  if (v === null || v === undefined) return { ok: true, 值: null };
  if (typeof v !== "string") return { ok: false, error: "所在地要写文字" };
  const t = v.trim().replace(/\s+/g, " ");
  if (!t) return { ok: true, 值: null };
  if ([...t].length > 所在地上限) return { ok: false, error: `所在地最多 ${所在地上限} 个字（${所在地提示}）` };
  return { ok: true, 值: t };
}
