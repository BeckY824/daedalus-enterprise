"use client";
/**
 * 项目页「放弃（豁免）」（32H，lib/enterprise/lead-giveup.ts）：新分配给我、我还没记有效沟通的线索，页头提示条里一颗按钮。
 * 点开框：原因必选（外出 / 忙不过来 / 其他，其他要写一句；补充只在选「其他」时带上，换原因就清掉），
 * 框里写明线索无效走判无效、能一键打开「线索验证」弹框（面板在 ProjectDetail 的弹框里，页上平时没有，由 打开判无效 开）。
 * 点不了（验证中、本月用过）按钮灰着，提示条里写为什么。按钮在提示条正文里（不放 Alert 的 action 位），手机 390 宽也不横向撑出。
 * 放弃成了不刷新本页：线索已经转走，本页（项目页、客户详情项目区）他多半已经看不到了，刷新会落到「找不到」。
 * 提示条换成「已转给 X」，点「知道了」回项目列表
 *
 * 从通知直达（11-21，用户「通知里面直接加上这个按钮」）：飞书 / 铃铛里点「放弃（豁免）」= 带 ?giveup=1 打开本页
 * （项目页，或跳到客户详情 ?project=<id>&giveup=1）。打开那一下：此刻还能放弃 → 自动弹放弃框；入口在但点不了（验证中、本月用过）
 * 或不给放弃（已记有效沟通、已转走、开关关了…）→ 弹一句为什么（不给的那句问服务器，放弃说明Action）；页上不是那一条 → 说已不在你名下。
 * 弹过就把参数从地址里去掉（replaceState），刷新不再弹。没有入口时本组件只管这一下，平时什么都不画
 */
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Alert, Button, Modal, Result } from "antd";
import { 每月放弃次数, 放弃参数, 不在手上话, 去放弃参数, 放弃落地of, 落地对得上, type 放弃入口 } from "@/lib/enterprise/lead-giveup-core";
import { 放弃说明Action } from "./giveup-actions";
import GiveUpDialog from "./GiveUpDialog";

/** 页面现拿的答复：页面是旧的、其实能放弃了 */
const 刷新再点话 = "这条线索现在可以放弃：刷新页面后点「放弃（豁免）」";
const 没问到话 = "没问到这条能不能放弃，刷新页面看看";

/**
 * 带 ?giveup=1 打开这一页时做什么（进页面那一下定，之后不变）；弹框 / 说明 / 去参数在 effect 里做。
 * 回：要不要弹框、要说的那句（问服务器的晚一点到）
 */
function useGiveUpLanding(projectId: string, 入口: 放弃入口 | undefined): { 弹框: boolean; 说明: string | null; 关说明: () => void } {
  const 参数 = useSearchParams();
  const 路径 = usePathname();
  const [落地] = useState(() => 放弃落地of(参数?.get(放弃参数) === "1", 落地对得上(projectId, 路径 ?? "", 参数?.get("project") ?? null), 入口));
  const [弹框, set弹框] = useState(false);
  const [说明, set说明] = useState<string | null>(null);
  useEffect(() => {
    if (落地.做 === "无") return;
    let 在 = true;
    // 参数只用这一次：从地址里去掉，刷新、回退不再弹。
    // 第一个参数必须是 null：Next 的 replaceState 补丁见到带 __NA 的 state（= 原样传 history.state）就不同步路由，
    // useSearchParams 还带着 giveup=1——之后换挂载点（p.放弃 有→无）会再落地一次，refresh 还会把参数写回地址栏。
    // 传 null 时 Next 自己补回内部 state、按新地址同步路由，不重新取页面（同 RecordView 的写法）
    const 现 = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const 新 = 去放弃参数(现);
    if (新 !== 现) window.history.replaceState(null, "", 新);
    if (落地.做 === "问服务器") {
      放弃说明Action(projectId).then((r) => 在 && set说明(r.可 ? 刷新再点话 : r.话)).catch(() => 在 && set说明(没问到话));
    } else {
      // 等挂上再开（服务端渲染时不画开着的框）
      const t = window.setTimeout(() => (落地.做 === "弹框" ? set弹框(true) : set说明(落地.话)), 0);
      return () => { 在 = false; window.clearTimeout(t); };
    }
    return () => { 在 = false; };
  }, [落地, projectId]);
  return { 弹框, 说明, 关说明: () => set说明(null) };
}

/** 弹一句为什么不能放弃（从通知带参数来、又放弃不了） */
function CantGiveUpModal({ 话, 关 }: { 话: string | null; 关: () => void }) {
  return (
    <Modal
      open={!!话} title="这条线索现在不能放弃" onCancel={关} destroyOnHidden width={400}
      footer={<Button type="primary" onClick={关} data-testid="proj-giveup-cant-ok">知道了</Button>}
    >
      <p className="giveup-lead" data-testid="proj-giveup-cant">{话}</p>
    </Modal>
  );
}

/** 从通知点「放弃（豁免）」来、这条已经进不去了（已转走、已收回、已删）：项目页不落 404，说一句为什么 */
export function GiveUpGone() {
  const router = useRouter();
  return (
    <Result
      status="info" title="这条线索现在不能放弃" subTitle={不在手上话} data-testid="proj-giveup-gone"
      extra={<Button type="primary" onClick={() => router.push(放弃后去)}>回项目列表</Button>}
    />
  );
}

/** 放弃成了点「知道了」去哪：项目列表（销售都能进） */
const 放弃后去 = "/projects";

export default function GiveUpBanner({ projectId, 入口, 打开判无效 }: {
  /** 不给放弃时不传：只管从通知带参数来的那一下（弹一句为什么），不画提示条 */
  projectId: string; 入口?: 放弃入口;
  /** 打开项目页「线索验证」弹框（ProjectDetail 验证开着）；这条没有线索验证（还没走到那一步）不传 */
  打开判无效?: () => void;
}) {
  const 落地 = useGiveUpLanding(projectId, 入口);
  if (!入口) return <CantGiveUpModal 话={落地.说明} 关={落地.关说明} />;
  return <GiveUpBar projectId={projectId} 入口={入口} 打开判无效={打开判无效} 落地={落地} />;
}

function GiveUpBar({ projectId, 入口, 打开判无效, 落地 }: {
  projectId: string; 入口: 放弃入口; 打开判无效?: () => void; 落地: ReturnType<typeof useGiveUpLanding>;
}) {
  const router = useRouter();
  const [开, set开] = useState(false);
  // 从通知带参数来、此刻能放弃：进页面就弹框（只这一下；按渲染时比上一次，不用 effect）
  const [弹过, set弹过] = useState(false);
  if (落地.弹框 && !弹过) {
    set弹过(true);
    set开(true);
  }
  const [成, set成] = useState<string | null>(null);
  if (成) {
    return (
      <Alert
        type="success" showIcon className="giveup-bar" data-testid="proj-giveup-done" title={成}
        description={(
          <div className="giveup-body">
            <div>这条线索已不在你名下，回项目列表继续跟别的。</div>
            <Button size="small" type="primary" className="giveup-open" onClick={() => router.push(放弃后去)} data-testid="proj-giveup-back">知道了</Button>
          </div>
        )}
      />
    );
  }
  return (
    <>
      <Alert
        type="info" showIcon className="giveup-bar" data-testid="proj-giveup"
        title="这条是新分配给你的线索，实在跟不了可以放弃（豁免）"
        description={(
          <div className="giveup-body">
            <div>每人每月 {每月放弃次数} 次。放弃后立即转给本线下一位同事，给你记 1 条待补（下一条自动分配先补给你）。线索无效请走判无效，不用放弃。</div>
            {!入口.可 && 入口.为什么 && <div className="giveup-why" data-testid="proj-giveup-why">{入口.为什么}</div>}
            <Button size="small" className="giveup-open" disabled={!入口.可} onClick={() => set开(true)} data-testid="proj-giveup-open">放弃（豁免）</Button>
          </div>
        )}
      />
      <CantGiveUpModal 话={落地.说明} 关={落地.关说明} />
      <GiveUpDialog
        projectId={projectId} 开={开} 关={() => set开(false)} 打开判无效={打开判无效}
        成={(接手人) => { set开(false); set成(`已放弃，转给了 ${接手人}；已给你记 1 条待补`); }}
      />
    </>
  );
}
