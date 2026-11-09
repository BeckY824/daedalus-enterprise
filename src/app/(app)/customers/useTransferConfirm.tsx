"use client";

import { App } from "antd";
import DictSelect from "@/components/DictSelect";
import { 其他没写好 } from "@/lib/enterprise/dict-kinds";
import { 转走项目预览of } from "./actions";
import { useCarryConfirm } from "./useCarryConfirm";

/**
 * 换客户负责人之前先问一句（企业版 D-36，2026-10-24）：客户名下的项目会整体跟着走，
 * 转之前把「会一起转走的 N 个项目」列出来。批量分配、公海领取 / 分配、详情页改负责人、编辑客户共用。
 * 企业版 P-转-07（11-09）：名下全部项目都转，同事在推的、线索公海里的一起列出来（行尾写同事名 / 线索公海）。
 * 没有项目 = 不弹框直接转（和原来一样）；数不出来不拦着——转本身照样会带走项目，这里只是提前说
 */
export function useTransferConfirm(转让原因?: { 选项: string[]; 自己: string }) {
  const { modal } = App.useApp();
  const 问一起转 = useCarryConfirm();

  /**
   * 企业版批量转给别人：问一句转让原因（字典「转让原因」，10-27，可不选）。
   * 返回选的原因 / null = 不选或不用问；false = 点了取消。转给自己、没有选项（别的版本）不弹
   */
  async function 问转让原因(给谁: string, 新负责人: string): Promise<string | null | false> {
    if (!转让原因?.选项.length || 新负责人 === 转让原因.自己) return null;
    let 选: string | null = null;
    // 选了「其他」没写具体内容时「转让」点不了
    const 框 = modal.confirm({
      title: `转给「${给谁}」`,
      icon: null,
      content: (
        <DictSelect placeholder="转让原因（可不选）" style={{ width: "100%" }} aria-label="转让原因" options={转让原因.选项}
          onChange={(v) => { 选 = v; 框.update({ okButtonProps: { disabled: !!其他没写好(v) } }); }} />
      ),
      okText: "转让",
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
