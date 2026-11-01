"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Segmented, Select, Switch, Tag } from "antd";
import { 卡点类型们, 影响等级们, type 卡点状态 } from "@/lib/project/blocker-rules";
import type { 看板筛选, 看板统计 } from "@/lib/project/blocker";
import { BlockerList, 状态色, type 卡点卡 } from "../projects/BlockerPanel";

/**
 * 复盘页「卡点」页签（11-01 定稿 B15）：三栏看板（待接受 / 处理中 / 已解决）+ 筛选 + 统计。
 * 谁看得到按卡点的角色开关（服务端 卡点看板）：「可看全部」的角色多一个「只看自己」开关。
 * 筛选全在地址栏（bm 我的认领 / bo 只看自己 / br 原因 / bt 类型 / bi 影响 / bp 项目），换了 replace、不进历史。
 * 卡片和项目详情同一个 BlockerList：认领、我已完成就在这里点。
 * 按原因统计里，没挂原因的老卡点放「未分类（老数据）」一格（B9），下拉也能筛。
 * 宽度不够（1024 + AI 栏常驻）三栏改成上下排，长项目名、长原因名在卡片里折行
 */
type 栏们 = Record<卡点状态, 卡点卡[]>;
type Props = {
  开: boolean;
  全部: boolean;
  栏: 栏们;
  已解决共: number;
  统计: 看板统计;
  项目们: { id: string; name: string }[];
  原因们: { id: string; name: string; status: string }[];
  筛: 看板筛选;
};

const 栏序: 卡点状态[] = ["待接受", "处理中", "已解决"];
const 键 = { 我的认领: "bm", 只看自己: "bo", 原因: "br", 类型: "bt", 影响: "bi", 项目: "bp" } as const;

export default function BoardBlockers({ 开, 全部, 栏, 已解决共, 统计, 项目们, 原因们, 筛 }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [换着, start] = useTransition();

  const 改 = (k: keyof typeof 键, v: string | boolean | undefined) => {
    const q = new URLSearchParams(sp.toString());
    const n = 键[k];
    if (v === true) q.set(n, "1");
    else if (typeof v === "string" && v) q.set(n, v);
    else q.delete(n);
    q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };

  if (!开) {
    return (
      <div className="btodo-wrap">
        <section className="btodo-list" aria-label="卡点">
          <b className="section-title">项目卡点</b>
          <div style={{ color: "var(--text-muted)", marginTop: 8 }}>你的业务角色没开卡点，找总管理员在「设置 → 项目模式 → 卡点」里打开。</div>
        </section>
      </div>
    );
  }

  const 有筛 = !!(筛.我的认领 || 筛.只看自己 || 筛.原因 || 筛.类型 || 筛.影响 || 筛.项目);
  const 按影响多 = Math.max(1, ...统计.按影响.map((x) => x.数));

  return (
    <div className={`btodo-wrap rblk${换着 ? " data-shell-pending" : ""}`}>
      <section className="btodo-list rblk-bar" aria-label="卡点筛选">
        <div className="btodo-head">
          <b className="section-title">项目卡点</b>
          <div className="rblk-filters">
            <Segmented
              size="small"
              aria-label="全部或我的认领"
              value={筛.我的认领 ? "mine" : "all"}
              onChange={(v) => 改("我的认领", v === "mine")}
              options={[{ value: "all", label: "全部" }, { value: "mine", label: "我的认领" }]}
            />
            {全部 && (
              <label className="rblk-switch">
                <Switch size="small" checked={!!筛.只看自己} onChange={(v) => 改("只看自己", v)} aria-label="只看自己" />
                只看自己
              </label>
            )}
            <Select
              size="small" allowClear showSearch optionFilterProp="label" placeholder="阻碍原因" aria-label="阻碍原因"
              className="rblk-sel" popupMatchSelectWidth={false}
              value={筛.原因 || undefined}
              onChange={(v) => 改("原因", v)}
              options={原因们.map((r) => ({ value: r.id, label: r.status === "启用" || r.status === "未分类" ? r.name : `${r.name}（${r.status}）` }))}
            />
            <Select
              size="small" allowClear placeholder="类型" aria-label="卡点类型" className="rblk-sel-s"
              value={筛.类型 || undefined}
              onChange={(v) => 改("类型", v)}
              options={卡点类型们.filter((t) => t !== "暂无卡点").map((t) => ({ value: t, label: t }))}
            />
            <Select
              size="small" allowClear placeholder="影响" aria-label="卡点影响" className="rblk-sel-s"
              value={筛.影响 || undefined}
              onChange={(v) => 改("影响", v)}
              options={影响等级们.map((t) => ({ value: t, label: t }))}
            />
            <Select
              size="small" allowClear showSearch optionFilterProp="label" placeholder="项目" aria-label="项目"
              className="rblk-sel" popupMatchSelectWidth={false}
              value={筛.项目 || undefined}
              onChange={(v) => 改("项目", v)}
              options={项目们.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>
        </div>

        {/* 统计（只统计、不授权）：未解决 / 已解决、按影响、按阻碍原因；跟着上面的筛选走 */}
        <div className="rblk-stats" aria-label="卡点统计">
          <div className="rblk-stat">
            <span className="rblk-stat-k">未解决</span><b className="rblk-stat-v">{统计.未解决}</b>
            <span className="rblk-stat-k">已解决</span><b className="rblk-stat-v">{统计.已解决}</b>
          </div>
          <div className="rblk-stat rblk-stat-grow" aria-label="按影响">
            {统计.按影响.map((x) => (
              <span key={x.名} className="rblk-impact" title={`${x.名} ${x.数} 条`}>
                <span className="rblk-impact-k">{x.名}</span>
                <span className="rblk-impact-bar"><i style={{ width: `${Math.round((x.数 / 按影响多) * 100)}%` }} /></span>
                <b>{x.数}</b>
              </span>
            ))}
          </div>
          <div className="rblk-stat rblk-stat-grow rblk-reasons" aria-label="按阻碍原因">
            {统计.按原因.length ? (
              统计.按原因.map((r) => (
                <Tag
                  key={r.id}
                  color={r.状态 === "待审核" ? "warning" : 筛.原因 === r.id ? "processing" : undefined}
                  className="rblk-reason"
                  onClick={() => 改("原因", 筛.原因 === r.id ? undefined : r.id)}
                  title={r.状态 === "待审核" ? "前台新加的原因，等总管理员在设置里审核" : r.状态 === "未分类" ? "改版前的老卡点，没归到阻碍原因；点一下筛出来" : "点一下按这个原因筛"}
                >
                  {r.名}{r.状态 === "待审核" ? "（待审核）" : r.状态 === "停用" ? "（停用）" : ""} {r.数}
                </Tag>
              ))
            ) : (
              <span className="rblk-stat-k">还没有按原因的数</span>
            )}
          </div>
        </div>
      </section>

      <div className="rblk-cols">
        {栏序.map((s) => (
          <section key={s} className="btodo-list rblk-col" aria-label={`${s}的卡点`}>
            <div className="rblk-col-head">
              <Tag color={状态色[s]}>{s}</Tag>
              <span className="rblk-stat-k">
                {s === "已解决" ? (已解决共 > 栏.已解决.length ? `最近 ${栏.已解决.length} / 共 ${已解决共} 条` : `${已解决共} 条`) : `${栏[s].length} 条`}
              </span>
            </div>
            <BlockerList
              们={栏[s]}
              带项目
              空={s === "待接受" ? (有筛 ? "没有符合筛选的待接受卡点" : "没有等人认领的卡点") : s === "处理中" ? "没有在处理的卡点" : "还没有解决的卡点"}
            />
          </section>
        ))}
      </div>
    </div>
  );
}
