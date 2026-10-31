"use client";

import { App } from "antd";
import DictSelect from "@/components/DictSelect";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { 退回原因选项 } from "./pool-actions";

export const 一起退说明 = "名下联系人、项目一起退回公海，谁领了客户就一起归谁；6 秒内可以撤销。";

/**
 * 客户放回公海前问一句（企业版 U-客户-04 + M-公海-09，流程同转让）：写明名下联系人、项目一起退，
 * 必选退回原因（字典「回收原因」）。详情页「放回公海」、客户列表批量放回共用。
 * 返回 { 原因 } = 接着放（原因 null = 没有可选的原因）；false = 点了取消。
 * 有没有原因可选以服务端为准（字典「回收原因」只有企业版有，和放进公海的校验同一个来源）：
 * 没得选又不是企业版 = 不弹，调用方照旧（列表照旧问一句、详情页直接放）
 */
export function usePoolReturnConfirm() {
  const { modal } = App.useApp();

  async function 问放回公海(标题: string, 企业版: boolean): Promise<{ 原因: string | null } | false> {
    let 选项: string[] = [];
    try {
      选项 = await 退回原因选项();
    } catch {
      选项 = [];
    }
    if (!企业版 && !选项.length) return { 原因: null };
    let 选: string | null = null;
    const 要选 = 选项.length > 0;
    const 框 = modal.confirm({
      title: 标题,
      content: (
        <div>
          <div style={{ marginBottom: 要选 ? 8 : 0 }}>{一起退说明}</div>
          {要选 && (
            <DictSelect placeholder="退回原因（必选）" style={{ width: "100%" }} aria-label="退回原因" options={选项}
              onChange={(v) => { 选 = v; 框.update({ okButtonProps: { disabled: !v || !!其他没写好(v) } }); }} />
          )}
        </div>
      ),
      okText: "放回公海",
      cancelText: "取消",
      okButtonProps: { disabled: 要选 },
    });
    const 放 = await 框;
    return 放 ? { 原因: 选 } : false;
  }

  return { 问放回公海 };
}
