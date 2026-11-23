"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { Skeleton, Card, Row, Col } from "antd";
import CustomerDetailSkeleton from "@/components/CustomerDetailSkeleton";
import { CustomerRosterSkeleton } from "@/components/CustomerRoster";

/**
 * (app)/loading.tsx 按槽位出骨架（跳转优化 PR-A，11-24）。
 *
 * Next 把同一个 loading.tsx 同时套在 (app) 下的三个槽位上：正文（children）、中栏（@pane）、浮层（@modal）
 * （node_modules/next/dist/client/components/layout-router.js 里 LoadingBoundary 的 loading: parentLoadingData）。
 * 原来三处画的是同一副「标题 + 四张卡 + 大卡」：左栏切到客户时，中栏那 312px 里也塞着一副正文骨架。
 * 现在壳给中栏、浮层各包一层 <槽位>，骨架看自己在哪个槽位、要去哪一页：
 *   - 正文：去客户详情摆同形的页头 + 三栏卡，别的页摆通用的那副
 *   - 中栏：去客户 / 项目详情摆名单骨架栏，别的页没有中栏，什么都不摆
 *   - 浮层：什么都不摆（设置浮层有自己的 loading）
 * 只在整页打开、左栏换页这类「本地还没有这一页内容」时出现；换客户、列表进详情不经过它（那时旧内容留着，见 lib/nav-pending.ts）
 */
type 槽位名 = "main" | "pane" | "modal";
const 槽位Context = createContext<槽位名>("main");

export function 槽位({ 名, children }: { 名: 槽位名; children: React.ReactNode }) {
  return <槽位Context.Provider value={名}>{children}</槽位Context.Provider>;
}

const 客户详情 = /^\/customers\/[^/]+$/;
const 项目详情 = /^\/projects\/(?!attach$|handover$|new$)[^/]+$/;

export default function SlotSkeleton() {
  const 槽 = useContext(槽位Context);
  const p = usePathname() ?? "";
  if (槽 === "modal") return null;
  if (槽 === "pane") return 客户详情.test(p) ? <CustomerRosterSkeleton /> : 项目详情.test(p) ? <CustomerRosterSkeleton 项目 /> : null;
  if (客户详情.test(p)) return <CustomerDetailSkeleton />;
  return <PageSkeleton />;
}

/**
 * 通用的正文骨架。**它自己晚 180ms 才出现**（.app-loading）——
 * 页面在这之前就好了的话，人一眼都看不见它；快的页面闪一下灰块，
 * 比多等那 180ms 更像是出了问题。
 */
function PageSkeleton() {
  return (
    <div className="app-loading slot-skel" data-testid="page-skeleton">
      <Skeleton active paragraph={{ rows: 1 }} className="slot-skel-title" />
      <Row gutter={[16, 16]}>
        {[0, 1, 2, 3].map((i) => (
          <Col xs={24} sm={12} xl={6} key={i}>
            <Card>
              <Skeleton active paragraph={{ rows: 1 }} />
            </Card>
          </Col>
        ))}
        <Col span={24}>
          <Card>
            <Skeleton active paragraph={{ rows: 8 }} />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
