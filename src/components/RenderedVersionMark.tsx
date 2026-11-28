"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { 认页面, 页面键, 记渲染版, 撤渲染版 } from "@/lib/page-fresh";

/** 把这页渲染时的版本登记到 lib/page-fresh（键按浏览器当前地址认，和 PageFreshness 同一个口径）；页面卸载 / 换新时撤旧的 */
export default function RenderedVersionMark({ v }: { v: string }) {
  const 路径 = usePathname();
  const 查询 = useSearchParams().toString();
  useEffect(() => {
    const 页 = 认页面(路径, 查询);
    if (!页) return;
    const 键 = 页面键(页);
    记渲染版(键, v);
    return () => 撤渲染版(键, v);
  }, [路径, 查询, v]);
  return null;
}
