"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Pagination, Segmented, Select, Tooltip } from "antd";
import { dayjs, fmtDateTime } from "@/lib/utils";
import { isCalendarDate } from "@/lib/schedule-date";
import { 有值 } from "@/lib/empty-value";
import EmptyState from "@/components/EmptyState";
import { 筛选方式名 } from "@/lib/follow-method";
import {
  沟通段们, 沟通段叫法, 沟通方式们, 复盘列表每页,
  type 沟通段, type 沟通方式, type 复盘沟通, type 复盘沟通行,
} from "@/lib/project/review-tabs";
import type { 缺沟通 } from "@/lib/project/review-extras";
import CustomRangePicker from "@/components/CustomRangePicker";
import { 读日期段, type 日期段 } from "@/lib/custom-date-range";
import { 沟通按天 } from "@/lib/project/talk-days";
import { TalkKindSwitch } from "./BoardTopics";

/**
 * 复盘页「沟通」页签（P7 U-复盘-01；11-01 参考复盘稿融合改成时间线）：项目负责人本人在项目上记的跟进（别人记的不算，11-02），时间倒序。
 * 按负责人筛 = 页签上面的人员选择（几个页签共用）；按时间筛 = 右上角分段（近 7 / 30 / 90 天、全部、自定义，t=；自定义再摆一个日期段，tf= tt=）；按方式筛 = 下拉（m=，八个大类）。
 * 每条：时间、项目 · 节点、客户、标题：内容（省略 + 悬停全文）、方式、发起主体 / 附件 / 编号（有才摆）、记录人。
 * 只读，点一条去项目页（这里不给删改，A-13；沟通只能挂在项目节点上记，这里没有「新增」）。
 * 旁边「还没沟通过的项目」= 首页「暂未跟进」卡同口径，这一圈人负责的，最近建的 5 个。
 */
export default function BoardTalks({ 数, 段, 区间, 方式 = "", 只看自己, 缺, 有主题 = false }: {
  /** 区间：段 = custom 时服务端读好的那一段（缺 / 错已落到本月 1 号到今天） */
  数: 复盘沟通; 段: 沟通段; 区间?: 日期段; 方式?: 沟通方式 | ""; 只看自己: boolean; 缺?: 缺沟通;
  /** 企业版：标题旁摆「沟通 | 主题」（教练主题，11-17） */
  有主题?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // 设计语言 R-B（R3）：「沟通 / 主题」和时间段挪到卡外筛选条（最左是沟通 / 主题，R-新9），卡头「项目沟通（N）」+ 方式下拉；
  // 每条末行灰字「方式 · 发起 · 附件 · 记录人」，编号悬停看
  const [换着, start] = useTransition();
  // 点了「自定义」先亮、日期段先摆出来，不等服务端那一屏
  const [显段, set显段] = useOptimistic(段);

  const 改 = (k: { t?: 沟通段; 区间?: 日期段; m?: 沟通方式 | ""; p?: number }) => {
    const q = new URLSearchParams(sp.toString());
    if ("t" in k) {
      if (k.t && k.t !== "all") q.set("t", k.t);
      else q.delete("t");
      // 换了别的段，自定义的两头不留；选「自定义」没挑日子 = 服务端落到本月
      if (k.t === "custom" && k.区间) {
        q.set("tf", k.区间.from);
        q.set("tt", k.区间.to);
      } else {
        q.delete("tf");
        q.delete("tt");
      }
    }
    if ("m" in k) {
      if (k.m) q.set("m", k.m);
      else q.delete("m");
    }
    if (k.p && k.p > 1) q.set("p", String(k.p));
    else q.delete("p");
    const t = q.toString();
    start(() => {
      if (k.t) set显段(k.t);
      router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false });
    });
  };
  const 去 = (x: 复盘沟通行) => router.push(`/projects/${encodeURIComponent(x.projectId)}`);

  const 方式下拉 = (
      <Select<沟通方式 | "">
              size="small"
              className="rtalk-m"
              aria-label="沟通方式"
              value={方式}
              onChange={(v) => 改({ m: v ?? "" })}
              options={[{ value: "", label: "全部方式" }, ...沟通方式们.map((k) => ({ value: k, label: 筛选方式名(k) }))]}
              popupMatchSelectWidth={false}
            />
  );
  const 时段钮 = (
    <>
            <Segmented
              size="small"
              aria-label="时间范围"
              value={显段}
              onChange={(v) => 改({ t: v as 沟通段 })}
              options={沟通段们.map((k) => ({ value: k, label: 沟通段叫法[k] }))}
            />
            {显段 === "custom" && (
              <CustomRangePicker size="small" 段={区间 ?? 读日期段()} 改={(d) => 改({ t: "custom", 区间: d })} />
            )}
    </>
  );
  return (
    <>
    <div className="rtalk-bar" role="group" aria-label="沟通筛选">
      {有主题 && <TalkKindSwitch 当前="talk" />}
      {时段钮}
    </div>
    <div className={`btodo-wrap rtalk-wrap${缺 ? " rtalk-has-side" : ""}`}>
      <section className={`btodo-list${换着 ? " is-pending" : ""}`} aria-label="沟通记录列表" aria-busy={换着}>
        <div className="btodo-head">
          <b className="section-title">项目沟通<span className="card-count">（{数.总数.toLocaleString("zh-CN")}）</span></b>
          <div className="btodo-head-r">{方式下拉}</div>
        </div>
        {数.行.length === 0 ? (
          <EmptyState
            title="还没有沟通记录"
            hint={段 !== "all" || 方式 ? "时间、方式都选「全部」看看。" : 只看自己 ? "你还没在项目上记过沟通，沟通在项目页的节点上记。" : "项目上还没有沟通记录，沟通在项目页的节点上记。"}
            demo={false}
          />
        ) : (
          // 按天分组（ov.talk）：今天 / 昨天 / M-D 一个小标题，下面照旧一条时间线；换时间段新进来的条目从上往下滑入（globals.css .rtalk-i）
          沟通按天(数.行).map((g) => (
            <section key={g.键} className="rtalk-day" aria-label={g.叫法}>
              <h3 className="rtalk-day-h">{g.叫法}</h3>
              <ol className="rtalk-tl">
                {g.行.map((x) => <沟通条 key={x.id} x={x} 去={() => 去(x)} />)}
              </ol>
            </section>
          ))
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
    </>
  );
}

function 沟通条({ x, 去 }: { x: 复盘沟通行; 去: () => void }) {
  // 页面记的沟通没有标题，只显示内容，别留个「：」打头（11-03 测试 C6-1）
  const 全 = 有值(x.内容) && x.内容 !== x.标题 ? (有值(x.标题) ? `${x.标题}：${x.内容}` : x.内容) : x.标题;
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
          {/* 日子在分组标题上，这里只写钟点；只记了日子的（没有钟点）写「—」不写 00:00。悬停看全 */}
          <time className="btodo-time nowrap" dateTime={x.时间} title={fmtDateTime(x.时间)}>{isCalendarDate(x.时间) ? "—" : dayjs(x.时间).format("HH:mm")}</time>
          <Tooltip title={`${x.项目} · ${x.节点} · ${x.客户}`} placement="topLeft" mouseEnterDelay={0.4}>
            <span className="rtalk-proj">
              {x.项目}
              <span className="btodo-proj"> · {x.节点} · {x.客户}</span>
            </span>
          </Tooltip>
        </div>
        <Tooltip title={<span className="rtalk-tip">{全}</span>} placement="topLeft" mouseEnterDelay={0.4}>
          <div className="rtalk-t">
            {有值(x.标题) && <b>{x.标题}</b>}
            {全 !== x.标题 && <span>{有值(x.标题) ? "：" : ""}{x.内容}</span>}
          </div>
        </Tooltip>
        {/* 末行 13 muted 一行字（不用胶囊）；编号悬停看，不常显 */}
        <div className="rtalk-foot" title={x.编号 ? `编号 ${x.编号}` : undefined}>
          {[x.方式, x.发起 ? `${x.发起}` : null, x.附件 > 0 ? `附件 ${x.附件} 个` : null, x.负责人].filter(Boolean).join(" · ")}
        </div>
      </article>
    </li>
  );
}

/** 还没沟通过的项目：同首页「暂未跟进」卡，最多 5 个 + 总数，看全部去项目页 */
function 缺沟通块({ 缺 }: { 缺: 缺沟通 }) {
  return (
    <aside className="btodo-list rtalk-side is-now" aria-label="还没沟通过的项目">
      {/* 390：整块收成一行「还有 N 个项目没沟通过 ›」（R-新10） */}
      {缺.总数 > 0 && (
        <Link href="/projects?f=no-follow" className="rtalk-side-line">还有 {缺.总数.toLocaleString("zh-CN")} 个项目没沟通过 ›</Link>
      )}
      <div className="btodo-head">
        <b className="section-title">还没沟通过的项目<span className="card-count">（{缺.总数.toLocaleString("zh-CN")}）</span></b>
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
