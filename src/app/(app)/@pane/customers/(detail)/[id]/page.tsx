export const dynamic = "force-dynamic";

import { Suspense } from "react";
import RenderedVersion from "@/components/RenderedVersion";
import { 渲染版本 } from "@/lib/page-version";

/** 名单在上一层 layout 里（换客户不重挂，见 (detail)/layout.tsx）；这一页占住 /customers/[id] 这条路由，顺手下发这页渲染时的版本（O3 PR-D 审查修复 1） */
export default function 客户详情中栏页({ params }: { params: Promise<{ id: string }> }) {
  return <Suspense fallback={null}><RenderedVersion 版={Promise.resolve(params).then(({ id }) => 渲染版本("customer", id))} /></Suspense>;
}
