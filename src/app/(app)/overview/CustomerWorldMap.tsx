"use client";

import { useEffect, useRef, useState } from "react";
import { palette } from "@/lib/palette";
import type { 分布条 } from "@/lib/project/review-extras";
import { 地图数据, 地图提示, 色档们, type 地图区, type 地图要素 } from "@/lib/project/customer-map";

/**
 * 复盘页「客户分布 · 按国家」的世界地图（11-03 客户反馈：「要是像地图那种的呈现」）。
 * 用到时才拉：echarts 的地图件（customer-map-echarts.ts）走动态 import，国家边界 public/geo/world-chn.json 走 fetch，
 * 都不进首屏、不挡服务端渲染。拉的时候是一块同样大小的底色占位，拉好了不跳高度；拉不下来就叫 出错，父级只留榜单。
 * 颜色在浏览器里从主题变量现算（同一色相由浅到深，档位见 色档们），换主题 / 明暗时重新上色。
 */
const 图名 = "world-chn";
let 边界: Promise<地图要素[]> | null = null;

/** 边界和 echarts 地图件一页只拉一次；注册过的地图 echarts 自己记着 */
function 拉地图() {
  边界 ??= Promise.all([
    import("./customer-map-echarts"),
    fetch("/geo/world-chn.json").then((r) => {
      if (!r.ok) throw new Error(`world-chn.json ${r.status}`);
      return r.json() as Promise<{ features: { properties: 地图要素 }[] }>;
    }),
  ]).then(([{ echarts }, geo]) => {
    if (!echarts.getMap(图名)) echarts.registerMap(图名, geo as never);
    return geo.features.map((f) => f.properties);
  });
  边界.catch(() => (边界 = null)); // 失败了下次进来再试
  return 边界;
}

/** 任意 CSS 颜色（hex、rgb、color-mix…）→ [r, g, b]：交给 canvas 规范化 */
function 读色(画: CanvasRenderingContext2D, css: string, 兜底: string): [number, number, number] {
  画.fillStyle = 兜底;
  画.fillStyle = css.trim() || 兜底;
  画.fillRect(0, 0, 1, 1);
  const [r, g, b] = 画.getImageData(0, 0, 1, 1).data;
  画.clearRect(0, 0, 1, 1);
  return [r, g, b];
}
const 混 = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const hex = (c: number[]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

type 配色 = { 档: string[]; 零: string; 边: string; 字: string; 弱字: string; 底: string; 线: string; 重: string };

/** 主题变量 → 地图配色：面板底 → 主色 → 深主色这条线上取 n 档（暗黑下 --brand-deep 是浅的，照样是越多越醒目） */
function 现配色(n: number): 配色 {
  const s = getComputedStyle(document.documentElement);
  const v = (k: string) => s.getPropertyValue(k);
  const 画 = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const 底 = 读色(画, v("--panel"), palette.panel);
  const 主 = 读色(画, v("--brand"), palette.brand);
  const 深 = 读色(画, v("--brand-deep"), palette.brandDeep);
  const 站 = [混(底, 主, 0.2), 混(底, 主, 0.5), 主, 混(主, 深, 0.7)];
  const 档 = Array.from({ length: n }, (_, i) => {
    const p = n === 1 ? 2 / 3 : (i / (n - 1)) * (站.length - 1);
    const k = Math.min(站.length - 2, Math.floor(p));
    return hex(混(站[k], 站[k + 1], p - k));
  });
  return {
    档,
    零: hex(读色(画, v("--line"), palette.line)),
    边: hex(底),
    底: hex(底),
    字: hex(读色(画, v("--ink-soft"), palette.inkSoft)),
    弱字: hex(读色(画, v("--text-muted"), palette.textMuted)),
    线: hex(读色(画, v("--line-soft"), palette.lineSoft)),
    重: hex(读色(画, v("--ink"), palette.ink)),
  };
}

function 选项(区: 地图区[], 色: 配色, 档们: ReturnType<typeof 色档们>, 动: boolean) {
  return {
    animation: 动,
    tooltip: {
      trigger: "item",
      confine: true, // 提示框不伸出图外：窄屏右侧的国家不会把页面撑出横向滚动
      backgroundColor: 色.底,
      borderColor: 色.线,
      textStyle: { color: 色.字, fontSize: 12 },
      extraCssText: "box-shadow:var(--shadow-pop);border-radius:8px;",
      formatter: (p: { data?: 地图区; name: string }) => 地图提示(p.data ?? { name: p.name, value: 0, 含: [] }),
    },
    visualMap: {
      type: "piecewise",
      pieces: [{ min: 0, max: 0, label: "0", color: 色.零 }, ...档们.map((d, i) => ({ ...d, color: 色.档[i] }))],
      orient: "horizontal",
      left: 0,
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 8,
      itemSymbol: "rect",
      selectedMode: false,
      textStyle: { color: 色.弱字, fontSize: 11 },
    },
    series: [
      {
        type: "map",
        map: 图名,
        roam: false,
        selectedMode: false,
        // 南极洲去掉了，北到格陵兰；上下留出图例那一行
        top: 4,
        bottom: 26,
        left: 0,
        right: 0,
        itemStyle: { borderColor: 色.边, borderWidth: 0.5 },
        // 移上去不换底色（areaColor、color 都给 null 才不换），只描一圈边
        emphasis: { label: { show: false }, itemStyle: { areaColor: null, color: null, borderColor: 色.重, borderWidth: 1 } },
        label: { show: false },
        data: 区,
      },
    ],
  };
}

export default function CustomerWorldMap({ 全部国家, 出错 }: { 全部国家: readonly 分布条[]; 出错: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [好了, set好了] = useState(false);
  const 出错回调 = useRef(出错);
  useEffect(() => {
    出错回调.current = 出错;
  });

  useEffect(() => {
    let 停 = false;
    let 清 = () => {};
    拉地图()
      .then(async (要素们) => {
        const { echarts } = await import("./customer-map-echarts");
        if (停 || !ref.current) return;
        const { 区 } = 地图数据(全部国家, 要素们);
        const 档们 = 色档们(Math.max(0, ...区.map((x) => x.value)));
        const 动 = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const c = echarts.init(ref.current);
        const 画 = (reset: boolean) => c.setOption(选项(区, 现配色(档们.length), 档们, 动), reset);
        画(true);
        set好了(true);
        const ro = new ResizeObserver(() => c.resize());
        ro.observe(ref.current);
        const mo = new MutationObserver(() => 画(false));
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-skin", "data-paper", "data-mode"] });
        清 = () => {
          ro.disconnect();
          mo.disconnect();
          c.dispose();
        };
      })
      .catch(() => {
        if (!停) 出错回调.current();
      });
    return () => {
      停 = true;
      清();
    };
  }, [全部国家]);

  return (
    <div className="cmap-map" aria-busy={!好了} role="img" aria-label="客户分布世界地图：颜色越深客户越多，具体数字见榜单">
      <div ref={ref} className={`cmap-canvas${好了 ? "" : " is-loading"}`} />
    </div>
  );
}
