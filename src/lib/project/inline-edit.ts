/**
 * 项目详情卡片就地改（11-02）：一格的输入 → 交给 编辑项目 / 改项目沟通 的改动。纯逻辑，界面和测试共用。
 * 只交这一格（改项目 没传的不动）：不带打开页面时的旧值，别把别人刚改的盖回去。
 */
import { 对得上的方式 } from "@/lib/follow-method";
import { dayjs } from "@/lib/utils";
import { 沟通时间格式 } from "./project-fields";

/** 钱这一格：数 空 = 没填 */
export type 钱格值 = { 数: number | null; 币: string };

/** 项目卡上三格钱各自存到哪两列。金额 这列不能空（库里 0 = 没填），清掉存 0；定金、合同金额 空 = 清掉，币种服务端跟着清 */
export function 钱格改动(格: "金额" | "定金金额" | "合同金额", v: 钱格值) {
  if (格 === "金额") return { amount: v.数 ?? 0, currency: v.币 };
  if (格 === "定金金额") return { depositAmount: v.数, depositCurrency: v.币 };
  return { contractAmount: v.数, contractCurrency: v.币 };
}

/** 文字格：去首尾空白，空 = 清掉 */
export const 文字格改动 = (s: string | null | undefined): string | null => s?.trim() || null;

type 沟通底子 = { type: string; method?: string | null; initiator?: string | null; occurredAt: string; 版本?: string };

/**
 * 就地改沟通正文：只动正文，类型、方式、发起主体、时间原样交回去（改项目沟通 要整条），带上版本防盖掉别人刚改的。
 * 方式、时间要改走「… → 修改」弹窗。正文空和弹窗同一句话
 */
export function 沟通正文改动(f: 沟通底子, content: string) {
  if (!content.trim()) return { error: "请填写这次沟通的内容" } as const;
  return {
    改动: {
      type: f.type,
      method: 对得上的方式(f.type, f.method ?? null),
      initiator: f.initiator ?? null,
      content,
      occurredAt: dayjs(f.occurredAt).format(沟通时间格式),
      版本: f.版本,
    },
  } as const;
}
