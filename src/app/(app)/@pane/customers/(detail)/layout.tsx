export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { CustomerRosterSkeleton } from "@/components/RosterSkeleton";
import { 学员名单 } from "../../panes";

/**
 * 客户详情的中栏名单（跳转优化 PR-A，11-24）：名单放在 layout 里，不放在 [id] 的 page 里。
 *
 * - 换一位客户（/customers/A → /customers/B）只换 [id] 这一段，layout 不重算：名单不重挂、不出骨架、
 *   服务端也不把名单那几句查询（50 位 + 我的 50 位 + 计数）再跑一遍；搜的字、页签、滚到哪都还在。
 * - 名单自带 Suspense（原来 @pane/customers/[id]/loading.tsx 那一层，11-22）：列表进详情时这个 layout 是新挂的，
 *   名单查询不挡着整次切页——详情就绪就提交，名单晚到时先摆同宽的骨架栏。
 * - 用路由组 (detail) 而不是 @pane/customers/layout：/customers 列表页是无中栏的 @pane/customers/page.tsx，
 *   名单只该挂在详情上。
 * 保存后各处 router.refresh() 会连 layout 一起重算，名单上的「最近一句」照样跟着变
 */
export default function 客户详情中栏({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<CustomerRosterSkeleton />}>
        <学员名单 />
      </Suspense>
      {children}
    </>
  );
}
