"use client";

import { createContext, Suspense, useContext } from "react";
import { usePathname } from "next/navigation";
import { Skeleton, Card, Row, Col } from "antd";
import CustomerDetailSkeleton from "@/components/CustomerDetailSkeleton";
import { CustomerRosterSkeleton, ChatPaneSkeleton } from "@/components/RosterSkeleton";

/**
 * 三个槽位各自的首屏骨架（跳转优化 PR-A，11-24；11-24 审查后不再是 (app)/loading.tsx）。
 *
 * **只在整页打开（服务端流式首屏）时出，站内跳转一律不出**：
 * - 原来是 (app)/loading.tsx。Next 把它做成 (app) 下每个槽位里、按子段 key 挂的 Suspense
 *   （node_modules/next/dist/client/components/layout-router.js：LoadingBoundary 包在
 *   `<TemplateContext.Provider key={stateKey}>` 里）。换顶层段（/projects → /customers/[id]、/overview → …）时 key 变，
 *   这个 Suspense 是**新挂的**；React 在 transition 里只替「已经露出内容」的边界留住旧内容，新挂的边界照样立刻出 fallback——
 *   于是旧内容 40ms 就没了、先出 ~400ms 骨架。
 * - 现在 Suspense 挂在 <槽位> 里，在槽位的 LayoutRouter 外面、壳里，站内跳转时它一直挂着、露着上一页：
 *   Next 的每次跳转都在 startTransition 里（client/components/app-router-instance.js dispatch：setState(deferredPromise)），
 *   新一页的 RSC 没到时 InnerLayoutRouter 的 use(rsc) 挂起，冒到这个已露出内容的边界，React 就不提交、旧内容留着，
 *   直到新内容全到了一帧换上；<Link> 的 useLinkStatus / useNavGo 的 isPending 一直是 true，顶上等待条照常出。
 * - 整页打开时服务端从头渲染，这个边界是第一次挂，页面数据没到就先流出这里的骨架（不白屏），数据到了流式换上。
 * - 浏览器后退前进（ACTION_RESTORE 不走 transition）走路由缓存，缓存没了才可能在这里出骨架，和原来一样。
 *
 * 壳给正文、中栏、浮层各包一层 <槽位>，骨架看自己在哪个槽位、要去哪一页：
 *   - 正文：去客户详情摆同形的页头 + 三栏卡，别的页摆通用的那副
 *   - 中栏：去客户 / 项目详情摆名单骨架栏；去首页且开着 AI 摆对话列表那一栏（同宽、空的，正文不横跳）；别的页没有中栏，什么都不摆
 *   - 浮层：什么都不摆（设置浮层有自己的 loading）
 */
type 槽位名 = "main" | "pane" | "modal";
const 槽位Context = createContext<{ 名: 槽位名; 有AI: boolean }>({ 名: "main", 有AI: false });

/**
 * 有AI：首页的中栏只在配了 AI 时才有对话列表（@pane/panes.tsx 对话列表），骨架跟着判。
 * 槽位里这层 Suspense 是首屏骨架的唯一来源：别在 (app) 下再加 loading.tsx（tests/nav-smooth-routes.test.ts 守着）
 */
export function 槽位({ 名, 有AI = false, children }: { 名: 槽位名; 有AI?: boolean; children: React.ReactNode }) {
  return (
    <槽位Context.Provider value={{ 名, 有AI }}>
      <Suspense fallback={<SlotSkeleton />}>{children}</Suspense>
    </槽位Context.Provider>
  );
}

const 客户详情 = /^\/customers\/[^/]+$/;
const 项目详情 = /^\/projects\/(?!attach$|handover$|new$)[^/]+$/;

export default function SlotSkeleton() {
  const { 名: 槽, 有AI } = useContext(槽位Context);
  const p = usePathname() ?? "";
  if (槽 === "modal") return null;
  if (槽 === "pane") return 客户详情.test(p) ? <CustomerRosterSkeleton /> : 项目详情.test(p) ? <CustomerRosterSkeleton 项目 /> : p === "/dashboard" && 有AI ? <ChatPaneSkeleton /> : null;
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
