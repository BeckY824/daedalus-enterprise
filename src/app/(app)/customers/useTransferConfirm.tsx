"use client";

import { App } from "antd";
import DictSelect from "@/components/DictSelect";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { 转走项目预览of } from "./actions";
import { useCarryConfirm } from "./useCarryConfirm";
import { 移交作废天数 } from "@/lib/enterprise/handover-expire-days";

/**
 * 换客户负责人之前先问一句（企业版 D-36，2026-10-24）：客户名下的项目会跟着走，
 * 转之前把「会一起转走的 N 个项目」列出来。批量分配、公海领取 / 分配、详情页改负责人、编辑客户共用。
 * 企业版 P-转-07（Even 口径，用户 11-10 定）：名下全部项目一起转——原负责人自己的、线索公海里的、同事待分配的（行尾写线索公海 / 待分配）、
 * 同事在推的（只说个数，Even C4）。
 * 没有项目 = 不弹框直接转（和原来一样）；数不出来不拦着——转本身照样会带走项目，这里只是提前说
 */
export function useTransferConfirm(转让原因?: { 选项: string[]; 自己: string }) {
  const { modal } = App.useApp();
  const 问一起转 = useCarryConfirm();

  /**
   * 企业版批量转给别人：问一句转让原因（字典「转让原因」，10-27，可不选）。
   * 返回选的原因 / null = 不选或不用问；false = 点了取消。转给自己、没有选项（别的版本）不弹
   */
  /** 申请 = 负责人本人转自己的（申请移交，X4）：界面 11-12 起统一叫「客户转让」，写明要接手人确认、几天不确认作废 */
  async function 问转让原因(给谁: string, 新负责人: string, 申请 = false): Promise<string | null | false> {
    if (!转让原因?.选项.length || 新负责人 === 转让原因.自己) return null;
    let 选: string | null = null;
    // 选了「其他」没写具体内容时「转让」点不了
    const 框 = modal.confirm({
      title: 申请 ? `把客户转让给「${给谁}」` : `转给「${给谁}」`,
      icon: null,
      content: (
        <>{申请 && <div style={{ marginBottom: 8 }}>接手人确认后生效，确认前仍在你名下；{移交作废天数} 天内不确认自动作废，归属不变。</div>}<DictSelect placeholder="转让原因（可不选）" style={{ width: "100%" }} aria-label="转让原因" options={转让原因.选项}
          onChange={(v) => { 选 = v; 框.update({ okButtonProps: { disabled: !!其他没写好(v) } }); }} /></>
      ),
      okText: 申请 ? "确认转让" : "转让",
      cancelText: "取消",
    });
    const 转 = await 框;
    return 转 ? 选 : false;
  }

  /** true = 接着转；false = 点了取消。新负责人不传 = 转给自己（领取） */
  async function 先问转走的项目(ids: string[], 新负责人?: string): Promise<boolean> {
    if (!ids.length) return true;
    return 问一起转(() => 转走项目预览of(ids, 新负责人));
  }

  return { 先问转走的项目, 问转让原因 };
}
