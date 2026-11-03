"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pagination, Segmented, Select, Tooltip } from "antd";
import { fmtDateTime } from "@/lib/utils";
import { 有值 } from "@/lib/empty-value";
import EmptyState from "@/components/EmptyState";
import { 筛选方式名 } from "@/lib/follow-method";
import {
  沟通段们, 沟通段叫法, 沟通方式们, 复盘列表每页,
  type 沟通段, type 沟通方式, type 复盘沟通, type 复盘沟通行,
} from "@/lib/project/review-tabs";
import type { 缺沟通 } from "@/lib/project/review-extras";

/**
 * 复盘页「沟通」页签（P7 U-复盘-01；11-01 参考复盘稿融合改成时间线）：项目负责人本人在项目上记的跟进（别人记的不算，11-02），时间倒序。
 * 按负责人筛 = 页签上面的人员选择（几个页签共用）；按时间筛 = 右上角分段（近 7 / 30 / 90 天、全部，t=）；按方式筛 = 下拉（m=，八个大类）。
 * 每条：时间、项目 · 节点、客户、标题：内容（省略 + 悬停全文）、方式、发起主体 / 附件 / 编号（有才摆）、记录人。
 * 只读，点一条去项目页（这里不给删改，A-13；沟通只能挂在项目节点上记，这里没有「新增」）。
 * 旁边「还没沟通过的项目」= 首页「暂未跟进」卡同口径，这一圈人负责的，最近建的 5 个。
 */
export default function BoardTalks({ 数, 段, 方式 = "", 只看自己, 缺 }: {
  数: 复盘沟通; 段: 沟通段; 方式?: 沟通方式 | ""; 只看自己: boolean; 缺?: 缺沟通;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  const [换着, start] = useTransition();

  const 改 = (k: { t?: 沟通段; m?: 沟通方式 | ""; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    if ("t" in k) {
      if (k.t && k.t !== "all") q.set("t", k.t);
      else q.delete("t");
    }
    if ("m" in k) {
      if (k.m) q.set("m", k.m);
      else q.delete("m");
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };
  const 去 = (x: 复盘沟通行) => router.push(`/projects/${encodeURIComponent(x.projectId)}`);

  return (
    <div className={`btodo-wrap rtalk-wrap${缺 ? " rtalk-has-side" : ""}`}>
      <section className={`btodo-list${换着 ? " is-pending" : ""}`} aria-label="沟通记录列表" aria-busy={换着}>
        <div className="btodo-head">
          <b className="section-title">项目沟通</b>
          <div className="btodo-head-r">
            <Select<沟通方式 | "">
              size="small"
              className="rtalk-m"
              aria-label="沟通方式"
              value={方式}
              onChange={(v) => 改({ m: v ?? "" })}
              options={[{ value: "", label: "全部方式" }, ...沟通方式们.map((k) => ({ value: k, label: 筛选方式名(k) }))]}
              popupMatchSelectWidth={false}
            />
            <Segmented
              size="small"
              aria-label="时间范围"
              value={段}
              onChange={(v) => 改({ t: v as 沟通段 })}
              options={沟通段们.map((k) => ({ value: k, label: 沟通段叫法[k] }))}
            />
          </div>
        </div>
        {数.行.length === 0 ? (
          <EmptyState
            title="没有沟通记录"
            hint={段 !== "all" || 方式 ? "时间、方式都选「全部」看看。" : 只看自己 ? "你还没在项目上记过沟通，沟通在项目页的节点上记。" : "项目上还没有沟通记录，沟通在项目页的节点上记。"}
            demo={false}
          />
        ) : (
          <ol className="rtalk-tl">
            {数.行.map((x) => <沟通条 key={x.id} x={x} 去={() => 去(x)} />)}
          </ol>
        )}
        {数.总数 > 复盘列表每页 && (
          <Pagination
            className="rblk-pager"
            size="small"
            current={数.页}
            pageSize={复盘列表每页}
            total={数.总数}
            showSizeChanger={false}
            showTotal={(n) => `共 ${n} 条`}
            onChange={(p) => 改({ p })}
          />
        )}
      </section>
      {缺 && <缺沟通块 缺={缺} />}
    </div>
  );
}

function 沟通条({ x, 去 }: { x: 复盘沟通行; 去: () => void }) {
  const 全 = 有值(x.内容) && x.内容 !== x.标题 ? `${x.标题}：${x.内容}` : x.标题;
  return (
    <li className="rtalk-i">
      <span className="rtalk-pt" aria-hidden />
      <article
        className="rtalk-k"
        tabIndex={0}
        role="link"
        aria-label={`${x.项目}，${x.标题}`}
        onClick={去}
        onKeyDown={(e) => { if (e.key === "Enter") 去(); }}
      >
        <div className="rtalk-k-top">
          <time className="btodo-time nowrap" dateTime={x.时间}>{fmtDateTime(x.时间)}</time>
          <Tooltip title={`${x.项目} · ${x.节点} · ${x.客户}`} placement="topLeft" mouseEnterDelay={0.4}>
            <span className="rtalk-proj">
              {x.项目}
              <span className="btodo-proj"> · {x.节点} · {x.客户}</span>
            </span>
          </Tooltip>
        </div>
        <Tooltip title={<span className="rtalk-tip">{全}</span>} placement="topLeft" mouseEnterDelay={0.4}>
          <div className="rtalk-t">
            <b>{x.标题}</b>
            {全 !== x.标题 && <span>：{x.内容}</span>}
          </div>
        </Tooltip>
        <div className="rblk-k-meta">
          <span className="rblk-tag">{x.方式}</span>
          {x.发起 && <span className="rtalk-meta" title="发起主体">发起 {x.发起}</span>}
          {x.附件 > 0 && <span className="rtalk-meta nowrap">附件 {x.附件} 个</span>}
          {x.编号 && <span className="rblk-code">{x.编号}</span>}
          <span className="rtalk-meta rtalk-who" title="记录人">{x.负责人}</span>
        </div>
      </article>
    </li>
  );
}

/** 还没沟通过的项目：同首页「暂未跟进」卡，最多 5 个 + 总数，看全部去项目页 */
function 缺沟通块({ 缺 }: { 缺: 缺沟通 }) {
  return (
    <aside className="btodo-list rtalk-side" aria-label="还没沟通过的项目">
      <div className="btodo-head">
        <b className="section-title">还没沟通过的项目</b>
        <span className={`btodo-col-n${缺.总数 ? " rtalk-side-n" : ""}`}>{缺.总数}</span>
      </div>
      {缺.行.length === 0 ? (
        <p className="btodo-recycle-off">在推的项目都记过沟通了。</p>
      ) : (
        <ul className="rtalk-miss">
          {缺.行.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${encodeURIComponent(p.id)}`} className="rtalk-miss-a">
                <Tooltip title={`${p.名} · ${p.客户}`} placement="topLeft" mouseEnterDelay={0.4}>
                  <span className="rtalk-miss-n">{p.名}</span>
                </Tooltip>
                <span className="rtalk-miss-s">{p.节点} · {p.负责人}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {缺.总数 > 0 && <Link href="/projects?f=no-follow" className="link-strong rtalk-side-more">看全部 {缺.总数} 个 ›</Link>}
    </aside>
  );
}
