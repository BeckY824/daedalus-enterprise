export const dynamic = "force-dynamic";

import { Suspense } from "react";
import { CustomerRosterSkeleton } from "@/components/RosterSkeleton";
import { 项目名单 } from "../../roster-panes";

/**
 * 项目详情的中栏名单（跳转优化 PR-A）：同 @pane/customers/(detail)/layout.tsx——换项目只换 [id]，名单不重挂不重查；
 * 自带 Suspense，进详情不等名单查询。/projects、/projects/attach、/projects/handover 各有自己的槽位页，不经过这里
 */
export default function 项目详情中栏({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={<CustomerRosterSkeleton 项目 />}>
        <项目名单 />
      </Suspense>
      {children}
    </>
  );
}
