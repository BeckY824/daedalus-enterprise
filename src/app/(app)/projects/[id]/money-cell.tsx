"use client";

/**
 * 项目卡上就地改的钱格（金额、定金金额、合同金额）：编辑器 + 存之前那道关。
 * 从 ProjectDetail 拆出来（11-20 审查）：UI 测试要拿真的 .proj-inline-money 配 ProjectInlineField 测「空格子敲『约5万』要有提示」。
 */
import { Select } from "antd";
import AmountInput, { 金额框认不出提示, 金额认不出 } from "@/components/AmountInput";
import { 币种选项 } from "@/lib/currency";
import { 钱格改动, type 钱格值 } from "@/lib/project/inline-edit";
import type { 编辑器参数 } from "./ProjectInlineField";

/** 就地改：一格钱（数 + 币种），窄卡上折成两行不溢出。金额框按旁边选的币种核字里写的记号（「5000元」配美元说对不上） */
export function 钱编辑器(名: string) {
  return function 编辑钱({ 草稿, set草稿, 忙 }: 编辑器参数<钱格值>) {
    return (
      <div className="proj-inline-money">
        <AmountInput aria-label={名} autoFocus min={0} max={1e12} precision={2} disabled={忙} currency={草稿.币} value={草稿.数} onChange={(v) => set草稿({ ...草稿, 数: v })} />
        <Select aria-label={`${名}币种`} showSearch disabled={忙} value={草稿.币} options={币种选项()} onChange={(v: string) => set草稿({ ...草稿, 币: v })} />
      </div>
    );
  };
}

/** 钱格就地改的 存：框里敲了认不出的字（AmountInput 交 NaN）不交，框不收、就地说为什么；认得出的交给 存项目项（编辑项目） */
export function 钱格存法(存项目项: (patch: ReturnType<typeof 钱格改动>) => Promise<string | null>) {
  return async (格: "金额" | "定金金额" | "合同金额", v: 钱格值): Promise<string | null> =>
    金额认不出(v.数) ? 金额框认不出提示 : 存项目项(钱格改动(格, v));
}
