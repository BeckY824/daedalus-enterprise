"use client";

import { 问后果 } from "@/components/dialog-host";
import { 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";

/** 「一起转走」那几行：项目名一行一个，放不下「…」悬停看全文；客户页转让框（TransferDialog）也用 */
export function 转走项目列表({ 说法 }: { 说法: NonNullable<ReturnType<typeof 转走项目说法>> }) {
  return (
    <>
      {说法.行.length > 0 && (
        <ul className="cu-carry-list">
          {说法.行.map((l, i) => (
            <li key={i} title={l}>
              {l}
            </li>
          ))}
        </ul>
      )}
      {说法.还有 && <div className="cu-carry-more">{说法.还有}</div>}
    </>
  );
}

/**
 * 「会一起转走的 N 个项目」确认框：客户页转让（useTransferConfirm）、分配线索、自动分配（P-转-07）共用；一起转走的同事在推项目只说个数（同事项目几个话）。
 * 取 = 现取预览。true = 接着转；false = 点了取消。没有要转走的项目才不弹；取不到不拦着——转本身照样会带走项目，这里只是提前说。
 * 11-15 换成后果框（P-界面-40「转让」= 后果确认框）：后果分条写，确认键「一起转」，不是危险色。
 */
export function useCarryConfirm() {
  return async function 问一起转(取: () => Promise<转走项目预览 | null | undefined>): Promise<boolean> {
    let 说法: ReturnType<typeof 转走项目说法>;
    try {
      说法 = 转走项目说法(await 取());
    } catch {
      return true;
    }
    if (!说法) return true;
    return 问后果({
      题: 说法.标题,
      后果: [
        ...(说法.行.length ? [{ 标: "一起转走", 级: "警" as const, 话: "这些项目的负责人会一起改成新负责人" }] : []),
        ...(说法.同事 ? [{ 标: "同事的", 级: "警" as const, 话: 说法.同事 }] : []),
      ],
      补充: 说法.行.length ? <转走项目列表 说法={说法} /> : undefined,
      是: "一起转",
      危: false,
      做: () => undefined,
    });
  };
}
