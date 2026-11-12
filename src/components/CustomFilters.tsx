"use client";

import { cloneElement, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { Button, Checkbox, Popover, Space } from "antd";
import { FilterOutlined, LeftOutlined, SettingOutlined } from "@ant-design/icons";
import { useLocalPref } from "@/lib/local-pref";
import { 切换外露, 拆筛选项, 筛选偏好键, type 筛选项元 } from "@/lib/custom-filters";

export type 筛选项 = 筛选项元 & {
  /** 勾选清单里写的名字 */
  名: string;
  /** 摆在外面时的宽度；收进「更多筛选」时占满 */
  宽: number;
  渲染: (style: CSSProperties) => ReactElement;
};

function MoreFiltersButton({
  收着,
  全部,
  可见,
  筛了几个,
  能恢复,
  切换,
  恢复默认,
}: {
  收着: 筛选项[];
  全部: 筛选项[];
  可见: string[];
  筛了几个: number;
  能恢复: boolean;
  切换: (键: string, 外露: boolean) => void;
  恢复默认: () => void;
}) {
  const 名字 = 筛了几个 > 0 ? `更多筛选，已筛 ${筛了几个} 项` : "更多筛选";
  const [开着, 设开着] = useState(false);
  const [看清单, 设看清单] = useState(false);
  // 全摆出去了就没有第一屏，直接给清单：不然这个按钮点开是空的
  const 显示清单 = 看清单 || 收着.length === 0;
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={开着}
      onOpenChange={设开着}
      afterOpenChange={(o) => {
        if (!o) 设看清单(false);
      }}
      content={
        显示清单 ? (
          <Space orientation="vertical" size={8} style={{ width: 220 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              勾上的摆在外面，只在这台电脑生效
            </div>
            {全部.map((x) => (
              <Checkbox key={x.键} checked={可见.includes(x.键)} onChange={(e) => 切换(x.键, e.target.checked)}>
                {x.名}
              </Checkbox>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", minHeight: 24 }}>
              {收着.length > 0 ? (
                <Button type="text" size="small" icon={<LeftOutlined />} onClick={() => 设看清单(false)}>
                  返回
                </Button>
              ) : (
                <span />
              )}
              {能恢复 && (
                <Button type="text" size="small" onClick={恢复默认}>
                  恢复默认
                </Button>
              )}
            </div>
          </Space>
        ) : (
          <Space orientation="vertical" size={10} style={{ width: 220 }}>
            {收着.map((x) => cloneElement(x.渲染({ width: "100%" }), { key: x.键 }))}
            <Button type="text" size="small" icon={<SettingOutlined />} onClick={() => 设看清单(true)}>
              自定义筛选项
            </Button>
          </Space>
        )
      }
    >
      {/* 窄窗口只留图标和数字（globals.css .cf-more-t），文字藏了靠 aria-label / title 说清 */}
      <Button icon={<FilterOutlined />} aria-label={名字} title={名字}>
        {筛了几个 > 0 ? (
          <span>
            <span className="cf-more-t">更多筛选 · </span>
            {筛了几个}
          </span>
        ) : (
          <span className="cf-more-t">更多筛选</span>
        )}
      </Button>
    </Popover>
  );
}

/**
 * 把一页的下拉分成摆外面的和收在「更多筛选」里的。返回的 `外露` 是带 key 的数组，直接放进筛选栏的 Space：
 * 每个下拉仍是 `.ant-space-item` 的直接子元素，窄屏收缩规则（globals.css .list-bar）照常命中。
 * `停用`：这一页不给自定义（共用视图的线索页），只摆默认项、不要按钮。
 */
export function useCustomFilters(页: string, 项: 筛选项[], { 停用 = false }: { 停用?: boolean } = {}): { 外露: ReactNode[]; 更多按钮: ReactNode } {
  const [存的, 存] = useLocalPref<string[] | null>(筛选偏好键(页), null);
  const 能挤 = 项.some((x) => x.挤);
  const [挤掉, 探针] = useSqueezeRow(能挤);
  const { 可见, 外露, 收着, 筛了几个 } = 拆筛选项(项, 停用 ? null : 存的, 挤掉);
  return {
    外露: [
      ...外露.map((x) => cloneElement(x.渲染({ width: x.宽 }), { key: x.键 })),
      // 量「筛选行折没折」用的探针：不占位（globals.css .cf-probe 那一格不显示），只为从它找到所在的筛选组
      ...(能挤 ? [<span key="cf-probe" ref={探针} className="cf-probe" aria-hidden />] : []),
    ],
    更多按钮:
      停用 || 项.length === 0 ? null : (
        // key 要固定：Space 没 key 时按位置认子节点，钉一项位置就变，按钮会重建、弹层跟着关掉
        <MoreFiltersButton
          key="cf-more"
          收着={收着}
          全部={项}
          可见={可见}
          筛了几个={筛了几个}
          能恢复={存的 !== null}
          切换={(键, 外露中) => 存(切换外露(可见, 存的, 键, 外露中))}
          恢复默认={() => 存(null)}
        />
      ),
  };
}

/** 一行的高度上限：筛选控件 32 高，超过就是在组里折成两行了 */
const 一行高 = 40;

/**
 * 筛选组（.list-bar 里的 Space）折成两行了没有：折了就把带「挤」的项收进「更多筛选」，记下那一刻的宽；
 * 再宽过那个宽就放回来试一次（还放不下再收，记新的宽）。在画之前量（layout effect），人看不到跳一下。
 * 手机宽（< 768）筛选行本来就折，不挤
 */
function useSqueezeRow(能挤: boolean): [boolean, (el: HTMLSpanElement | null) => void] {
  const [挤掉, set挤掉] = useState(false);
  const [探针, set探针] = useState<HTMLSpanElement | null>(null);
  const 挤时宽 = useRef(0);
  useLayoutEffect(() => {
    if (!能挤 || !探针) return;
    const 组 = 探针.closest(".ant-space") as HTMLElement | null;
    const 行 = (探针.closest(".list-bar") as HTMLElement | null) ?? 组?.parentElement ?? null;
    if (!组 || !行) return;
    const 量 = () => {
      if (!window.matchMedia("(min-width: 768px)").matches) return set挤掉(false);
      const 宽 = 行.clientWidth;
      if (!挤掉) {
        if (组.getBoundingClientRect().height > 一行高) { 挤时宽.current = 宽; set挤掉(true); }
      } else if (宽 > 挤时宽.current) set挤掉(false);
    };
    // 接管之前（服务端出的 HTML）组是不折、放不下藏在行尾的（globals.css .cf-probe:not([data-cf-ready])），
    // 不然量之前筛选行先折成两行（PR #273 CI 1024 宽）。量之前打上标记放开折行，同一帧里量完收好，人看不到跳一下
    探针.setAttribute("data-cf-ready", "");
    量();
    const ro = new ResizeObserver(量);
    ro.observe(行);
    // 组自己也看：行宽没变、行里别的格后来才有东西（客户页看板往筛选行右端那一格放「分配」「我分出去的」，11-12 审查）时，组被挤折了也要收
    ro.observe(组);
    return () => ro.disconnect();
  }, [能挤, 探针, 挤掉]);
  return [挤掉, set探针];
}
