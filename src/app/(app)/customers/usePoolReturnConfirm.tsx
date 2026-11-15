"use client";

import { 问后果 } from "@/components/dialog-host";
import type { 后果条 } from "@/components/ConsequenceDialog";
import type { 做的结果 } from "@/lib/confirm-result";
import { 退回原因选项 } from "./pool-actions";

// 原负责人领不回、也看不到（企业版口径，pool-rules.ts）；这个框只有企业版弹（11-03 B1-2）
export const 一起退说明 = "名下联系人、项目一起退回公海，同事领了客户就一起归他；原负责人不能再领回来，也看不到它了；6 秒内可以撤销。";

/** 后果分条写（原型 cu.return「改后」）：和 一起退说明 同一个意思，拆成三条 */
export const 退回后果: 后果条[] = [
  { 标: "领不回", 级: "危", 话: "你不能再领回，也看不到它们" },
  { 标: "一起退", 级: "警", 话: "名下联系人、项目一起退回；同事领了客户就一起归他" },
  { 标: "可撤", 话: "6 秒内可以撤销" },
];

/**
 * 客户放回公海前问一句（企业版 U-客户-04 + M-公海-09，流程同转让）：后果框（ConsequenceDialog）分条写清，
 * 退回原因必选（字典「回收原因」，P-界面-42：常用项点一下就选，「其他」原地变输入框、必填）。详情页「放回公海」、客户列表批量放回共用。
 * 确认字：详情页页头按钮叫「客户退回公海」，框里的确认钮跟着叫（11-12）；列表批量的框叫「退回公海」（11-12 D3）。
 * 返回 { 原因 } = 接着放（原因 null = 没有可选的原因）；false = 点了取消。
 * 给了 做：放这件事在框里做——没成原因写在框里、框不关（列表批量用）；不给 = 框只问，调用方自己放。
 * 有没有原因可选以服务端为准（字典「回收原因」只有企业版有，和放进公海的校验同一个来源）：
 * 没得选又不是企业版 = 不弹，调用方照旧（列表照旧问一句、详情页直接放）
 */
export function usePoolReturnConfirm() {
  async function 问放回公海(
    标题: string,
    企业版: boolean,
    确认字 = "放回公海",
    做?: (原因: string | null) => 做的结果 | Promise<做的结果>,
  ): Promise<{ 原因: string | null } | false> {
    let 选项: string[] = [];
    try {
      选项 = await 退回原因选项();
    } catch {
      选项 = [];
    }
    if (!企业版 && !选项.length) return { 原因: null };
    let 选: string | null = null;
    const 成了 = await 问后果({
      // 标题写「动作 + 那条东西」，不写问号（后果框的口径）
      题: 标题.replace(/[？?]\s*$/, ""),
      后果: 退回后果,
      是: 确认字,
      原因: 选项.length ? { 选项, 叫: "退回原因" } : undefined,
      做: (因) => {
        选 = 因 ?? null;
        return 做?.(选);
      },
    });
    return 成了 ? { 原因: 选 } : false;
  }

  return { 问放回公海 };
}
