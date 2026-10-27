/** 企业版选项字典有哪几类、默认选项（纯数据，设置页客户端组件也 import）。读写库在 dict.ts */
export const 字典种类们 = ["assign", "recycle", "invalid", "transfer", "verify", "custStatus", "projTag"] as const;
export type 字典种类 = (typeof 字典种类们)[number];

/** 每一类的叫法、说明和默认选项（顺序 = 默认排序） */
export const 字典定义: Record<字典种类, { 名: string; 说明: string; 默认: readonly string[] }> = {
  assign: { 名: "分配方式", 说明: "线索落到谁手上的方式。", 默认: ["指定分配", "自动分配", "公海捞取", "暂不分配", "自拓自持"] },
  recycle: { 名: "回收原因", 说明: "线索、客户收回公海或收回重分时选的原因。", 默认: ["超时未跟进", "销售离职", "线索质量不达标", "客户主动终止", "主管收回重分配", "项目丢单", "其他"] },
  invalid: { 名: "无效原因", 说明: "判线索无效时选的原因。", 默认: ["需求不存在", "预算不足", "竞品中标", "客户终止", "联系方式无效", "重复线索", "其他"] },
  transfer: { 名: "转让原因", 说明: "把客户、项目转给别人时选的原因。", 默认: ["工作量调整", "离职交接", "区域调整", "客户要求", "主管调配", "其他"] },
  verify: { 名: "验证结果", 说明: "新线索核实之后的结论。", 默认: ["有效线索", "无效线索"] },
  custStatus: { 名: "客户状态", 说明: "客户当前所处的状态。", 默认: ["正常", "休眠中", "休眠预警", "跟进超时", "流失预警", "已流失", "公海待捞", "正在转让", "确认无效"] },
  projTag: { 名: "项目标签", 说明: "给项目分优先级。", 默认: ["A 重点推进", "B 潜力跟进", "C 正常培育"] },
};

export const 选项名上限 = 20;

/**
 * 选「其他」要写一句（10-27 批注）：存成「其他：xxx」。只认字面叫「其他」的那一项，改了名就当普通选项。
 * 下拉（components/DictSelect.tsx）和服务端（dict.ts 选的原因）都用这几个
 */
export const 其他项 = "其他";
export const 其他前缀 = "其他：";
export const 其他补充上限 = 30;

/** 下拉选的 + 补充的字 → 提交上去的值；没选 = null；选了其他没写 = "其他"（提交会被拦） */
export function 合其他(选: string | null | undefined, 写: string): string | null {
  if (!选) return null;
  if (选 !== 其他项) return 选;
  const t = 写.trim();
  return t ? `${其他前缀}${t}` : 其他项;
}

/** 反过来：提交值 → 下拉选的 + 补充的字 */
export function 拆其他(v: string | null | undefined): { 选: string | null; 写: string } {
  if (!v) return { 选: null, 写: "" };
  if (v.startsWith(其他前缀)) return { 选: 其他项, 写: v.slice(其他前缀.length) };
  return { 选: v, 写: "" };
}

/** 选了其他但没写 / 写太长：给一句提示；没问题 = null */
export function 其他没写好(v: string | null | undefined): string | null {
  const { 选, 写 } = 拆其他(v);
  if (选 !== 其他项) return null;
  const t = 写.trim();
  if (!t) return "选了「其他」，请写一下具体是什么";
  if (t.length > 其他补充上限) return `「其他」后面最多写 ${其他补充上限} 个字`;
  return null;
}
