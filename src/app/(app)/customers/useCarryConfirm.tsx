"use client";

import { App } from "antd";
import { 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";

/**
 * 「会一起转走的 N 个项目」确认框：客户页转让（useTransferConfirm）、分配线索、自动分配（P-转-07）共用；留在同事名下的另列一段。
 * 取 = 现取预览。true = 接着转；false = 点了取消。转走的、留下的都没有才不弹；取不到不拦着——转本身照样会带走项目，这里只是提前说
 */
export function useCarryConfirm() {
  const { modal } = App.useApp();
  return async function 问一起转(取: () => Promise<转走项目预览 | null | undefined>): Promise<boolean> {
    let 说法: ReturnType<typeof 转走项目说法>;
    try {
      说法 = 转走项目说法(await 取());
    } catch {
      return true;
    }
    if (!说法) return true;
    return modal.confirm({
      title: 说法.标题,
      content: (
        <div>
          {说法.行.length > 0 && (
            <>
              <div style={{ marginBottom: 6 }}>这些项目的负责人会一起改成新负责人：</div>
              <ul style={列表}>{说法.行.map((l, i) => <li key={i} style={一行} title={l}>{l}</li>)}</ul>
              {说法.还有 && <div style={旁注}>{说法.还有}</div>}
            </>
          )}
          {说法.留下 && (
            <>
              <div style={{ margin: 说法.行.length ? "12px 0 6px" : "0 0 6px" }}>这些项目留在各自负责人名下，不跟着转：</div>
              <ul style={列表}>{说法.留下.行.map((l, i) => <li key={i} style={一行} title={l}>{l}</li>)}</ul>
              {说法.留下.还有 && <div style={旁注}>{说法.留下.还有}</div>}
            </>
          )}
        </div>
      ),
      okText: 说法.行.length ? "一起转" : "转",
      cancelText: "取消",
    });
  };
}

// 企业版全站一行：放不下「…」，悬停看全文
const 列表 = { margin: 0, paddingInlineStart: 18, maxHeight: 220, overflowY: "auto" } as const;
const 一行 = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } as const;
const 旁注 = { marginTop: 6, color: "var(--ant-color-text-secondary)" } as const;
