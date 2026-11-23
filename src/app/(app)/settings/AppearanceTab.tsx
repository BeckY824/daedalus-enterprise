"use client";

import { flushSync } from "react-dom";
import { useEffect } from "react";
import { useLocalPref } from "@/lib/local-pref";
import { 少动 } from "@/lib/reduced-motion";
import { 外观键, 底色表, 明暗表, 默认外观, 读外观, 挂外观, 存外观值, type 外观, type 存的外观 } from "@/lib/appearance";

/**
 * 外观：这台电脑上的样子。只换值，不动数据，也不影响同事（规则见 lib/appearance.ts）。
 *
 * 明暗（浅色 / 深色 / 跟随系统）、底色（白底 / 原底；D-2 起默认白底），互不影响、可以任意组合。
 * 跟随系统时系统一换就跟着换，那个监听挂在根布局上（components/ModeFollow.tsx），不只在这一页。
 * 每个选项带一张小样：看得见选了以后长什么样，比一句说明管用。
 */
export default function AppearanceTab() {
  const [存的, 存] = useLocalPref<存的外观>(外观键, 默认外观);
  const 当前 = 读外观(JSON.stringify(存的));
  // 选完当场生效：<html> 上的属性一换，整页的 token 跟着换，不用刷新
  useEffect(() => 挂外观(当前), [当前.paper, 当前.mode]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * 点了就当场挂上，不只靠上面那个 effect：页面上亮的和 <html> 上挂的对不上时（D6-1：刷新后亮着「原底」、实际是白底），
   * 点亮着的那一项值没变、effect 不重跑，点了像没反应、换不回去
   */
  const 选 = (a: 外观) => {
    /*
      换明暗、底色时整屏交叉淡化 0.2 秒（原型 st.theme）：浏览器有 View Transitions 就让新旧两屏淡过去（时长在 settings.css
      ::view-transition-*(root)，用 --t 令牌）；没有、或开了减弱动态，照旧直接换
    */
    const 换 = () => {
      存(存外观值(a)); // 带上底色版：这之后选的「原底」才认（lib/appearance.ts 认底色）
      挂外观(a);
    };
    const 文档 = document as Document & { startViewTransition?: (f: () => void) => unknown };
    if (文档.startViewTransition && !少动()) 文档.startViewTransition(() => flushSync(换));
    else 换();
  };

  return (
    <div className="appr">
      <p className="appr-note">只改这台电脑上的样子，不动数据，也不影响同事。</p>
      <section className="appr-row" aria-labelledby="appr-mode">
        <div className="appr-h" id="appr-mode">明暗</div>
        <div className="appr-opts" role="radiogroup" aria-labelledby="appr-mode">
          {明暗表.map((x) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={当前.mode === x.key}
              className={`appr-opt${当前.mode === x.key ? " on" : ""}`}
              onClick={() => 选({ ...当前, mode: x.key })}
            >
              {/* 小样读的是那一档自己的值（dark.css 的 [data-mode-preview]）；跟随系统左明右暗各半 */}
              {x.key === "system" ? (
                <span className="appr-mini appr-mini-split" aria-hidden="true">
                  {(["light", "dark"] as const).map((半) => (
                    <span key={半} className="appr-mini-half" data-mode-preview={半}>
                      <i className="appr-mini-rail" />
                      <i className="appr-mini-card" />
                    </span>
                  ))}
                </span>
              ) : (
                <span className="appr-mini appr-mini-mode" data-mode-preview={x.key} aria-hidden="true">
                  <i className="appr-mini-rail" />
                  <i className="appr-mini-card" />
                </span>
              )}
              <b>{x.名}</b>
              <span>{x.说明}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="appr-row" aria-labelledby="appr-paper">
        <div className="appr-h" id="appr-paper">底色</div>
        <div className="appr-opts" role="radiogroup" aria-labelledby="appr-paper">
          {底色表.map((x) => (
            <button
              key={x.key}
              type="button"
              role="radio"
              aria-checked={当前.paper === x.key}
              className={`appr-opt${当前.paper === x.key ? " on" : ""}`}
              onClick={() => 选({ ...当前, paper: x.key })}
            >
              <span className={`appr-mini appr-mini-${x.key}`} aria-hidden="true">
                <i className="appr-mini-rail" />
                <i className="appr-mini-card" />
              </span>
              <b>{x.名}</b>
              <span>{x.说明}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
