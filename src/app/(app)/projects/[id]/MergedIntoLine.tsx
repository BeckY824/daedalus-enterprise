"use client";

/**
 * 项目详情顶上「已并入 → 留下的项目」一行（合并客户第二批 2a，规划「被并掉的项目详情显示已并入」）。
 *
 * 被并掉的项目（合并单没撤回）打开时：并进了哪个项目（点得过去）、谁、何时并的；能撤的人（load.ts 已并入of，和历史变更同一个预判）旁边带「撤回」，
 * 没权的不摆按钮；过了撤回期限（单.过期话，load.ts 带，谁看都一样、系统管理员也不能代撤）在按钮的位置写「合并已超过 N 天，不能撤回」。留下的项目上不摆。电脑和手机（≤767）同一个组件：一行放不下省略号，悬停看全，手机点一下展开看全。
 *
 * 页面（客户页 page.tsx 的项目区、项目详情页 page.tsx）当槽递给 ProjectDetail，不让 ProjectDetail 直接引服务端动作
 * （项目详情那十几个界面测试打包 ProjectDetail 时不用各自再桩一份 merge-actions）。
 * 当前项目都摆这一只（没并入时画空）：撤回后页面刷新、单子没了，这一只还在原处，撤回结果写在这里（同第一批写法）
 */
import "../../customers/merge.css";
import { useState } from "react";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { useRouter } from "next/navigation";
import { Button } from "antd";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useConsequence } from "@/components/ConsequenceDialog";
import { fmtDateTime } from "@/lib/utils";
import { 撤回项目合并单, 撤回跨并申请单 } from "../../customers/merge-actions";
import { 合并申请页 } from "../../customers/merge-request-words";
import { 项目合并撤回后果, 撤回结果话, type 撤回结果 } from "../../customers/[id]/project-merge-undo";
import type { 项目详情 } from "./ProjectDetail";

type Props = {
  单: 项目详情["已并入"];
  /** 这个项目（被并掉的）的名字：后果框里用 */
  项目名: string;
  /** 点留下的项目去哪：客户页里切页签（客户页项目地址），项目详情页去 /projects/<id> */
  去: string | null;
  /** 嵌在客户页项目区：外面套一层 .cd-notice（项目区那张网格的告示格，横跨两栏） */
  嵌入?: boolean;
  /** 这个项目有一张等确认的跨负责人合并申请（load.ts 跨并待确认of）：写等谁确认；被并走那条加「验证计时已暂停」；发起人带「撤回申请」、确认人带「去确认」 */
  待确认?: 项目详情["跨并待确认"];
};

const 天话 = (到期: string) => `${new Date(到期).toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai" })} 前没人确认就失效`;

export default function MergedIntoLine({ 单, 项目名, 去, 嵌入, 待确认 = null }: Props) {
  const router = useRouter();
  const [问后果, 后果框] = useConsequence();
  const [全, set全] = useState(false);
  const [撤了, set撤了] = useState<撤回结果 | null>(null);
  const [申请撤了, set申请撤了] = useState(false);
  const [申请错, set申请错] = useState<string | null>(null);
  const 包 = (x: React.ReactNode) => (嵌入 ? <div className="cd-notice">{x}</div> : x);
  const 待 = 待确认 && !申请撤了 ? (
    <div className={`mrg-into${嵌入 ? "" : " is-solo"}`} role="status" data-testid="project-xmerge-pending">
      <div className="mrg-into-r">
        <InfoCircleOutlined className="mrg-into-i" aria-hidden />
        <span className="mrg-into-t" title={`跨负责人合并申请待确认：${待确认.角色 === "并走" ? "这个项目要并进" : "要把"}「${待确认.另一个}」${待确认.角色 === "并走" ? "" : "并进来"}，等 ${待确认.等} 确认；${天话(待确认.到期)}`}>
          跨负责人合并申请待确认：{待确认.角色 === "并走" ? `这个项目要并进「${待确认.另一个}」` : `要把「${待确认.另一个}」并进来`}，等 {待确认.等} 确认
          <span className="mrg-into-s">（{天话(待确认.到期)}；这个项目的验证计时已暂停）</span>
        </span>
        {待确认.我确认 && <Link href={合并申请页 + "#xmerge"} className="mrg-into-a" data-testid="project-xmerge-go">去确认<LinkPending /></Link>}
        {待确认.我发起 && (
          <Button size="small" data-testid="project-xmerge-withdraw" onClick={async () => {
            set申请错(null);
            const r = await 撤回跨并申请单(待确认.requestId).catch(() => ({ ok: false as const, error: "没办成，网络可能断了，再点一次" }));
            if (r.ok) { set申请撤了(true); router.refresh(); } else set申请错(r.error);
          }}>撤回申请</Button>
        )}
      </div>
      {申请错 && <div className="mrg-into-b" role="alert" title={申请错}>{申请错}</div>}
    </div>
  ) : null;
  if (!单 && !撤了) return 待 ? 包(<>{待}{后果框}</>) : 后果框;
  if (撤了) {
    return 包(
      <div className="mrg-into is-done" data-testid="project-merged-into-done">
        <div className="mrg-into-r">
          <div className="mrg-into-b">{撤回结果话({ r: 撤了 })}</div>
          <Button size="small" type="text" onClick={() => set撤了(null)}>知道了</Button>
        </div>
        {后果框}
      </div>,
    );
  }
  const m = 单!;
  const A = m.到 || "另一个项目";
  const 谁时 = `${m.谁 ? `${m.谁} ` : ""}${fmtDateTime(m.at)} 并入`;
  const 全话 = `已并入 → 「${A}」（${谁时}）${m.过期话 ? `；${m.过期话}` : ""}`;
  const 撤 = () => void 问后果(项目合并撤回后果(项目名 || "这个项目", A, async () => {
    const r = await 撤回项目合并单(m.mergeId);
    if (!r.ok) return r;
    set撤了({ 没还原: r.没还原.map((x) => ({ 类: x.类, 原因: x.原因 })) });
    router.refresh();
  }));
  return 包(
    <>
      <div className={`mrg-into${嵌入 ? "" : " is-solo"}`} role="status" data-testid="project-merged-into">
        <div className="mrg-into-r">
          <InfoCircleOutlined className="mrg-into-i" aria-hidden />
          {/* 一行省略、悬停看全；手机没有悬停，点一下这句展开 / 收起（点项目名照常跳过去） */}
          <span className={`mrg-into-t${全 ? " is-full" : ""}`} title={全话} data-testid="project-merged-into-text" onClick={() => set全((x) => !x)}>
            已并入 → {去 ? <Link href={去} className="mrg-into-a" onClick={(e) => e.stopPropagation()} data-testid="project-merged-into-link">「{A}」<LinkPending /></Link> : `「${A}」`}
            <span className="mrg-into-s">（{谁时}）</span>
          </span>
          {m.能撤 && <Button size="small" onClick={撤} data-testid="project-merged-undo">撤回</Button>}
          {!m.能撤 && m.过期话 && <span className="mrg-into-x" data-testid="project-merged-expired">{m.过期话}</span>}
        </div>
      </div>
      {后果框}
    </>,
  );
}
