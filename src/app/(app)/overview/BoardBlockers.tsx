"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Segmented, Select } from "antd";
import { 卡点类型们, 影响等级们, type 卡点状态 } from "@/lib/project/blocker-rules";
import type { 看板筛选, 看板统计 } from "@/lib/project/blocker";
import { BlockerList, type 卡点卡 } from "../projects/BlockerPanel";

/**
 * 复盘页「卡点」页签（11-01 定稿 B15）：三栏看板（待接受 / 处理中 / 已解决）+ 筛选 + 统计。
 * 谁看得到按卡点的角色开关（服务端 卡点看板）：「可看全部」的角色多一个「只看自己」开关。
 * 筛选全在地址栏（bm 我的认领 / bo 只看自己 / br 原因 / bt 类型 / bi 影响 / bp 项目），换了 replace、不进历史。
 * 卡片和项目详情同一个 BlockerList：认领、我已完成就在这里点。
 * 按原因统计里，没挂原因的老卡点放「未分类（老数据）」一格（B9），下拉也能筛。
 * 宽度不够（1024 + AI 栏常驻）三栏改成上下排，长项目名、长原因名在卡片里折行
 *
 * 设计语言 R-A（11-22，落地计划-三页设计）：拆成四块，各做一件事——
 *   ① 筛选条（卡外）：范围「全部｜只看自己｜我认领的」一个分段（地址栏 bo / bm 照旧）+ 四个下拉（写选中值「全部原因」，不靠占位字）+ 有筛才出「重置」；
 *      1366 一行，1024 固定两行，390 同客户列表（L-A）：范围 + 重置一排、四个下拉两两一排摆在外面（不收进底部面板）。不用 CustomFilters（P-界面-12 只给四个列表）
 *   ② 概况卡：未解决 / 已解决、按影响、按阻碍原因三格，横条行「名称｜条｜数」对齐；原因行可点 = 筛；待审核挂小橙标，系统管理员多「去审核 ›」
 *   ③ 三栏：每栏一张卡，卡头圆点 + 「待接受（13）」；空栏收成窄栏，有内容的栏分剩下的宽、栏里卡片自动排多列
 *   ④ 卡片：BlockerList 在分栏（不重复状态）
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
  /** 能管卡点设置（系统管理员）：原因统计里有「待审核」时多一个「去审核 ›」 */
  能管?: boolean;
};

const 栏序: 卡点状态[] = ["待接受", "处理中", "已解决"];
const 键 = { 我的认领: "bm", 只看自己: "bo", 原因: "br", 类型: "bt", 影响: "bi", 项目: "bp" } as const;

type 范围 = "all" | "own" | "mine";
const 栏圆点: Record<卡点状态, string> = { 待接受: "rblk-dot-wait", 处理中: "rblk-dot-doing", 已解决: "rblk-dot-done" };
const 栏空话: Record<卡点状态, string> = { 待接受: "还没有待接受的卡点", 处理中: "还没有处理中的卡点", 已解决: "还没有解决的卡点" };
/** 按原因先列这么多行，其余收在「其余 N 个」 */
const 原因先列 = 5;

/** 横条行：名称｜条｜数。比例 = 数 / 底（底 0 时条为空），条宽用 rbk-w 档位类给（5% 一档），不写行内样式 */
function BarRow({ 名, 数, 底, 标, 选中, 点, 说 }: { 名: string; 数: number; 底: number; 标?: React.ReactNode; 选中?: boolean; 点?: () => void; 说?: string }) {
  const 比 = 底 > 0 ? Math.min(1, 数 / 底) : 0;
  const 里 = (
    <>
      <span className="rbk-bar-k"><span className="rbk-bar-name">{名}</span>{标}</span>
      <span className="rbk-bar-track" aria-hidden><i className={`rbk-w${Math.round(比 * 20) * 5}`} /></span>
      <b className="rbk-bar-v">{数}</b>
    </>
  );
  return 点 ? (
    <button type="button" className={`rbk-bar-row is-btn${选中 ? " is-on" : ""}`} aria-pressed={!!选中} title={说} onClick={点}>{里}</button>
  ) : (
    <div className="rbk-bar-row">{里}</div>
  );
}

export default function BoardBlockers({ 开, 全部, 栏, 已解决共, 统计, 项目们, 原因们, 筛, 能管 }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [换着, start] = useTransition();
  const [原因全开, set原因全开] = useState(false);

  /** 一次改几个键（换范围要同时清掉另一个） */
  const 改多 = (kv: Partial<Record<keyof typeof 键, string | boolean | undefined>>) => {
    const q = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(kv)) {
      const n = 键[k as keyof typeof 键];
      if (v === true) q.set(n, "1");
      else if (typeof v === "string" && v) q.set(n, v);
      else q.delete(n);
    }
    q.delete("p");
    const t = q.toString();
    start(() => router.replace(`/overview${t ? `?${t}` : ""}`, { scroll: false }));
  };

  if (!开) {
    return (
      <section className="rbk-card rbk-empty" aria-label="卡点">
        <b className="rbk-empty-t">还没有开卡点</b>
        <span className="rbk-empty-s">你的业务角色没开卡点，找总管理员在 设置 → 项目模式 → 卡点 打开</span>
      </section>
    );
  }

  // 两个都带（老链接）落「我认领的」：认领人本来就在「只看自己」的范围里（blocker.ts 文件头），不丢组合
  const 范围值: 范围 = 筛.我的认领 ? "mine" : 筛.只看自己 && 全部 ? "own" : "all";
  const 范围项 = [
    { value: "all", label: "全部" },
    ...(全部 ? [{ value: "own", label: "只看自己" }] : []),
    { value: "mine", label: "我认领的" },
  ];
  const 下拉数 = [筛.原因, 筛.类型, 筛.影响, 筛.项目].filter(Boolean).length;
  const 有筛 = !!(下拉数 || 范围值 !== "all");
  const 重置 = () => 改多({ 我的认领: undefined, 只看自己: undefined, 原因: undefined, 类型: undefined, 影响: undefined, 项目: undefined });
  const 共 = 统计.未解决 + 统计.已解决;
  const 一条没有 = 共 === 0 && 栏.待接受.length + 栏.处理中.length + 栏.已解决.length === 0;
  const 有待审核 = 统计.按原因.some((r) => r.状态 === "待审核");
  const 原因行们 = 原因全开 ? 统计.按原因 : 统计.按原因.slice(0, 原因先列);
  const 其余 = 统计.按原因.length - 原因先列;

  const 下拉们 = (
    <>
      <Select
        showSearch optionFilterProp="label" aria-label="阻碍原因" className="rbk-sel" popupMatchSelectWidth={false}
        value={筛.原因 ?? ""}
        onChange={(v: string) => 改多({ 原因: v || undefined })}
        options={[{ value: "", label: "全部原因" }, ...原因们.map((r) => ({ value: r.id, label: r.status === "启用" || r.status === "未分类" ? r.name : `${r.name}（${r.status}）` }))]}
      />
      <Select
        aria-label="卡点类型" className="rbk-sel"
        value={筛.类型 ?? ""}
        onChange={(v: string) => 改多({ 类型: v || undefined })}
        options={[{ value: "", label: "全部类型" }, ...卡点类型们.filter((t) => t !== "暂无卡点").map((t) => ({ value: t, label: t }))]}
      />
      <Select
        aria-label="卡点影响" className="rbk-sel"
        value={筛.影响 ?? ""}
        onChange={(v: string) => 改多({ 影响: v || undefined })}
        options={[{ value: "", label: "全部影响" }, ...影响等级们.map((t) => ({ value: t, label: t }))]}
      />
      <Select
        showSearch optionFilterProp="label" aria-label="项目" className="rbk-sel" popupMatchSelectWidth={false}
        value={筛.项目 ?? ""}
        onChange={(v: string) => 改多({ 项目: v || undefined })}
        options={[{ value: "", label: "全部项目" }, ...项目们.map((p) => ({ value: p.id, label: p.name }))]}
      />
    </>
  );

  return (
    <div className={`rbk${换着 ? " is-pending" : ""}`} aria-busy={换着 || undefined}>
      <div className="rbk-filter" role="group" aria-label="卡点筛选">
        <Segmented
          className="rbk-scope"
          aria-label="看哪些卡点"
          value={范围值}
          onChange={(v) => 改多({ 只看自己: v === "own" || undefined, 我的认领: v === "mine" || undefined })}
          options={范围项}
        />
        <div className="rbk-sels">{下拉们}</div>
        {有筛 && <Button type="text" className="rbk-reset" onClick={重置}>重置</Button>}
      </div>

      {一条没有 && !有筛 ? (
        <section className="rbk-card rbk-empty" aria-label="卡点">
          <b className="rbk-empty-t">还没有卡点</b>
          <span className="rbk-empty-s">项目上记沟通时标了卡点，会出现在这里</span>
        </section>
      ) : (
        <>
          <section className="rbk-card rbk-sum" aria-label="卡点概况">
            <div className="rbk-card-h">
              <h3 className="rbk-card-t">卡点概况</h3>
              <span className="rbk-card-note">按当前筛选</span>
            </div>
            <div className="rbk-sum-body">
              <div className="rbk-cell rbk-cell-n">
                <div className="rbk-num"><b>{统计.未解决}</b><span>未解决</span></div>
                <div className="rbk-num"><b>{统计.已解决}</b><span>已解决</span></div>
              </div>
              <div className="rbk-cell" aria-label="按影响">
                <div className="rbk-cell-h">按影响</div>
                {统计.按影响.map((x) => <BarRow key={x.名} 名={x.名} 数={x.数} 底={共} />)}
              </div>
              <div className="rbk-cell" aria-label="按阻碍原因">
                <div className="rbk-cell-h">
                  按阻碍原因
                  {能管 && 有待审核 && <Link href="/settings?tab=project" className="rbk-audit">去审核 ›</Link>}
                </div>
                {统计.按原因.length ? (
                  <>
                    {原因行们.map((r) => (
                      <BarRow
                        key={r.id}
                        名={r.名}
                        数={r.数}
                        底={共}
                        选中={筛.原因 === r.id}
                        点={() => 改多({ 原因: 筛.原因 === r.id ? undefined : r.id })}
                        说={r.状态 === "待审核" ? "前台新加的原因，等总管理员在设置里审核；点一下筛出来" : r.状态 === "未分类" ? "改版前的老卡点，没归到阻碍原因；点一下筛出来" : "点一下只看这个原因，再点取消"}
                        标={r.状态 === "待审核" ? <span className="rbk-flag is-warn">待审核</span> : r.状态 === "停用" ? <span className="rbk-flag">停用</span> : undefined}
                      />
                    ))}
                    {其余 > 0 && (
                      <button type="button" className="rbk-more-rows" onClick={() => set原因全开((v) => !v)}>
                        {原因全开 ? "收起" : `其余 ${其余} 个`}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="rbk-cell-none">还没有按原因的数</span>
                )}
              </div>
            </div>
          </section>

          {有筛 && 栏序.every((s) => !栏[s].length) ? (
            // 有筛选、三栏都空：整体收成一句 + 重置（不三栏各写一遍）
            <section className="rbk-card rbk-empty rbk-filter-none" aria-label="卡点">
              <span className="rbk-empty-s">没有对得上筛选的卡点</span>
              <Button className="rbk-none-reset" onClick={重置}>重置</Button>
            </section>
          ) : (
          <div className="rbk-cols">
            {栏序.map((s) => {
              const 们 = 栏[s];
              const n = s === "已解决" ? 已解决共 : 们.length;
              const 计 = s === "已解决" && 已解决共 > 们.length ? `最近 ${们.length} / 共 ${已解决共}` : String(n);
              return (
                <section key={s} className={`rbk-card rbk-col${们.length ? "" : " is-empty"}`} aria-label={`${s}的卡点`}>
                  <div className="rbk-card-h">
                    <h3 className="rbk-card-t"><i className={`rblk-dot ${栏圆点[s]}`} aria-hidden />{s}<span className="rbk-count">（{计}）</span></h3>
                  </div>
                  {们.length ? (
                    <div className="rbk-col-list">
                      <BlockerList 们={们} 带项目 在分栏 />
                    </div>
                  ) : (
                    <p className="rbk-col-none">{有筛 ? "没有对得上筛选的卡点" : 栏空话[s]}</p>
                  )}
                </section>
              );
            })}
          </div>
          )}
        </>
      )}
    </div>
  );
}
