"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Pagination, Segmented, Select, Tag } from "antd";
import { fmtDateTime } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import {
  主题范围们, 主题范围叫法, 主题状态们, 复盘列表每页,
  type 沟通档, type 主题范围, type 主题状态筛, type 复盘主题, type 复盘主题行,
} from "@/lib/project/review-tabs";

/** 这几个键只属于某一档：换档时丢掉，页码也回第一页 */
const 沟通键 = ["t", "tf", "tt", "m"];
const 主题键 = ["tw", "ts"];

/**
 * 复盘「沟通」页签头上的「沟通 | 主题」（销售教练角色 PR3b，11-17）：不加第五个页签，在原有「沟通」页签里加一档（tv=topic）
 */
export function TalkKindSwitch({ 当前 }: { 当前: 沟通档 }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [, start] = useTransition();
  return (
    <Segmented
      size="small"
      aria-label="看沟通还是主题"
      value={当前}
      data-testid="talk-kind"
      onChange={(v) => {
        const q = new URLSearchParams(sp.toString());
        for (const k of [...沟通键, ...主题键, "p"]) q.delete(k);
        if (v === "topic") q.set("tv", "topic");
        else q.delete("tv");
        const t = q.toString();
        start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
      }}
      options={[{ value: "talk", label: "沟通" }, { value: "topic", label: "主题" }]}
    />
  );
}

const 状态色: Record<string, string> = { 待回复: "orange", 已回复: "blue", 已关闭: "default" };

/**
 * 复盘「沟通」页签的「主题」一档：我发起的 / 待我回复 / 全部 + 状态筛选，时间倒序，点一条去项目（主题钉在沟通卡最上面）。
 * 只读：回复、关闭在项目里做。数据在 lib/enterprise/coach-topic-db.ts 复盘主题of，每条都过了 能看主题
 */
export default function BoardTopics({ 数, 范围, 状态 = "" }: { 数: 复盘主题; 范围: 主题范围; 状态?: 主题状态筛 | "" }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [换着, start] = useTransition();
  const 改 = (k: { tw?: 主题范围; ts?: 主题状态筛 | ""; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    if ("tw" in k) {
      if (k.tw && k.tw !== "all") q.set("tw", k.tw);
      else q.delete("tw");
    }
    if ("ts" in k) {
      if (k.ts) q.set("ts", k.ts);
      else q.delete("ts");
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };
  const 去 = (x: 复盘主题行) => router.push(`/projects/${encodeURIComponent(x.projectId)}`);
  return (
    <div className="btodo-wrap rtalk-wrap">
      <section className={`btodo-list${换着 ? " is-pending" : ""}`} aria-label="教练主题列表" aria-busy={换着}>
        <div className="btodo-head">
          <span className="rtopic-head-l">
            <b className="section-title">项目沟通</b>
            <TalkKindSwitch 当前="topic" />
          </span>
          <div className="btodo-head-r">
            <Select<主题状态筛 | "">
              size="small"
              className="rtalk-m"
              aria-label="主题状态"
              value={范围 === "wait" ? "待回复" : 状态}
              disabled={范围 === "wait"}
              onChange={(v) => 改({ ts: v ?? "" })}
              options={[{ value: "", label: "全部状态" }, ...主题状态们.map((k) => ({ value: k, label: k }))]}
              popupMatchSelectWidth={false}
            />
            <Segmented
              size="small"
              aria-label="谁的主题"
              value={范围}
              onChange={(v) => 改({ tw: v as 主题范围 })}
              options={主题范围们.map((k) => ({ value: k, label: 主题范围叫法[k] }))}
            />
          </div>
        </div>
        {数.行.length === 0 ? (
          <EmptyState
            title="没有主题"
            hint={范围 === "wait" ? "你负责的项目上没有等你回复的主题。" : 范围 === "mine" ? "你还没发起过点评，在客户页右上角「发起点评」发。" : 状态 ? "状态选「全部状态」看看。" : "还没有人发起主题。"}
            demo={false}
          />
        ) : (
          <ol className="rtopic-list">
            {数.行.map((x) => (
              <li key={x.id} className="rtopic-i">
                <article
                  className="rtalk-k rtopic-k"
                  tabIndex={0}
                  role="link"
                  aria-label={`${x.项目}，${x.标题}`}
                  data-testid="review-topic"
                  onClick={() => 去(x)}
                  onKeyDown={(e) => { if (e.key === "Enter") 去(x); }}
                >
                  <div className="rtalk-k-top">
                    <time className="btodo-time nowrap" dateTime={x.时间}>{fmtDateTime(x.时间)}</time>
                    <span className="rtalk-proj" title={`${x.项目} · ${x.节点}`}>
                      {x.项目}
                      <span className="btodo-proj"> · {x.节点}</span>
                    </span>
                  </div>
                  <div className="rtalk-t" title={x.标题}><b>{x.标题}</b></div>
                  <div className="rblk-k-meta">
                    <Tag color={状态色[x.状态]} bordered={false}>{x.状态}</Tag>
                    <span className="rtalk-meta nowrap">回复 {x.回复数}</span>
                    <span className="rtalk-meta rtalk-who" title="发起人">{x.发起人}（{x.身份}）</span>
                  </div>
                </article>
              </li>
            ))}
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
    </div>
  );
}
