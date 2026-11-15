"use client";
/**
 * ls.ct.orphan「改后」：未归属联系人的编辑做成右侧浮起的面板（离窗口边 8px、四角圆、从右边滑进来），不是屏幕中间的弹框。
 * 不改编辑框本身（customers/[id]/ContactForm，客户页也在用）：只给包在里面的那个弹框挂一个类名，样子在 globals.css 的 .ct-side。
 * 框里叫出来的问句（「放弃填的内容？」走 App.useApp 的 modal，挂在最外层）不吃这个类名，照旧在中间。
 */
import { ConfigProvider } from "antd";

export const 侧面板类名 = "ct-side";

export default function OrphanSidePanel({ children }: { children: React.ReactNode }) {
  return <ConfigProvider modal={{ classNames: { root: 侧面板类名 } }}>{children}</ConfigProvider>;
}
