"use client";

import { useEffect, useState } from "react";
import { 格律键 } from "@/lib/appearance";

/**
 * 「格律」样板的小开关（P1，只在 feat/b33-gelv-p1 分支上，不合并）：同一页、同一份数据，点一下来回比「现在 / 格律」。
 * 只在用过 ?gelv=1 / ?gelv=0 的浏览器里出现（存过 ui-gelv 这个键）；没存过就什么都不画，页面和现在一个像素都不差。
 * <html data-gelv> 由外观预设脚本在首次绘制前挂好（lib/appearance.ts 的 格律段），这里只管运行中切换。
 */
export default function GelvToggle() {
  const [开, set开] = useState<boolean | null>(null);

  useEffect(() => {
    let 存的: string | null = null;
    try {
      存的 = localStorage.getItem(格律键);
    } catch {
      存的 = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 只在客户端读本地存的键，服务端没有 localStorage
    if (存的 !== null) set开(document.documentElement.dataset.gelv !== undefined);
  }, []);

  if (开 === null) return null;

  const 切 = () => {
    const 新 = !开;
    try {
      localStorage.setItem(格律键, 新 ? "1" : "0");
    } catch {
      /* 存不下也照样切这一页 */
    }
    if (新) document.documentElement.dataset.gelv = "";
    else delete document.documentElement.dataset.gelv;
    set开(新);
  };

  return (
    <button type="button" className="gelv-toggle" role="switch" aria-checked={开} onClick={切} title="设计语言样板：同一页切换「现在 / 格律」">
      <span className="gelv-toggle-k">格律</span>
      <span className={开 ? "gelv-toggle-v is-on" : "gelv-toggle-v"}>{开 ? "开" : "关"}</span>
    </button>
  );
}
