"use client";

/**
 * 详情页页头上面那一行「← 回到客户列表（第 N 页）」（员工反馈 1A，规矩见 lib/list-return.ts）：
 * 回最近看的那张列表的原地址（筛选、排序、页码、页签），滚动由外壳上的 ListMemory 滚回去（components/ListReturn.tsx）
 */
import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useBusiness } from "@/lib/business-client";
import { 回列表文字, 地址快照, 解析地址们, 订阅地址, 列表路径, type 列表种 } from "@/lib/list-return";

const 服务端快照 = () => "";

/** 记住的地址表（服务端和第一次渲染是空的，挂上之后才读 sessionStorage，不会对不上水合） */
export function useRememberedLists() {
  const raw = useSyncExternalStore(订阅地址, 地址快照, 服务端快照);
  return useMemo(() => 解析地址们(raw), [raw]);
}

/**
 * 详情页页头「← 回到客户列表（第 N 页）」：回最近看的那张列表、原来的筛选和页码（滚动由 ListMemory 滚回去）。
 * 没记过（从通知、收藏、别人发的链接进来）就回 默认 那张列表的第 1 页
 */
export default function BackToList({ 默认 = "客户" }: { 默认?: 列表种 }) {
  const 地址们 = useRememberedLists();
  const b = useBusiness();
  const 种 = 地址们.最近 ?? 默认;
  const href = 地址们[种] ?? 列表路径[种];
  // 线索页在项目模式下叫「新线索」（leads/page.tsx 企业版项目 = 企业版 + projectMode；本仓只有企业版），和页名对齐
  const 文字 = 回列表文字(种, href, b.customer, b.projectMode ? "新线索" : "线索");
  return (
    <Link href={href} className="back-to-list" title={文字} aria-label={文字} data-testid="back-to-list">
      <ArrowLeftOutlined aria-hidden />
      <span className="back-to-list-t">{文字}</span>
    </Link>
  );
}

