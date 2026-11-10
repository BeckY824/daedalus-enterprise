/**
 * 企业版客户「归档档位」（M-导入-23，迁移 114 的 Customer.archiveTier）。纯算，服务端、客户端都能用。
 * 只有六档：A1 / A2 / B / C / D / E；只由归档导入写，详情页只读显示。空 = 不是归档导入来的客户。
 */
import { 全角转半角 } from "../fullwidth";


export const 归档档位们 = ["A1", "A2", "B", "C", "D", "E"] as const;
export type 归档档位 = (typeof 归档档位们)[number];

/**
 * 表里的一格认成档位：去空白、全角转半角、小写转大写后和六档之一一字不差才认（「ａ１」「 a1 」认作 A1）。
 * 空的、认不出的（「A3」「F」「A1档」）= null，由调用方决定原值去哪（导入是进备注 + 提醒）
 */
export function 认归档档位(v: string | null | undefined): 归档档位 | null {
  const s = 全角转半角(String(v ?? ""))
    .replace(/[\s　]/g, "")
    .toUpperCase();
  return (归档档位们 as readonly string[]).includes(s) ? (s as 归档档位) : null;
}
