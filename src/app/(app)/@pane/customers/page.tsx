export const dynamic = "force-dynamic";

import { Suspense } from "react";
import RenderedVersion from "@/components/RenderedVersion";
import { 渲染版本 } from "@/lib/page-version";

/**
 * /customers 列表无中栏；这一页顺手下发「这页渲染时的版本」（O3 PR-D 审查修复 1）：
 * 槽位页每次导航都重算、同一份缓存里，和列表页同进同出；版本号只回哈希，可见范围走限定层。
 */
export default function 客户列表中栏页({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <Suspense fallback={null}><RenderedVersion 版={Promise.resolve(searchParams).then((sp) => 渲染版本("customer-list", "", sp))} /></Suspense>;
}
