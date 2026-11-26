import { expect, type Locator } from "@playwright/test";

/**
 * 整页打开（page.goto / reload）后，等流式出页落定，再按严格模式数这块东西。
 *
 * 生产构建下 React 19.2 流式出页时，同一块内容会短暂在 DOM 里有两份：
 * - 骨架（同 class、aria-busy）先到，真内容到了先放在 body 下的 `<div hidden id="S:…">`；
 *   19.2 的 $RC 不立刻换上，攒进 $RB 等下一帧或上次换完 300ms 后再换（$RV）。
 * - 这段时间里壳上有更新（context / props 变了）传到这个还没水合、还在等换上的边界，React 就不水合它、
 *   改在客户端重画一份看得见的；body 下那份藏着的要等 $RV 跑了才删掉。
 * 两份同在最多约 300ms，然后只剩一份。用户看不见第二份，但严格模式会报「resolved to 2 elements」，
 * 而 expect 遇到严格模式违规不再重试，直接红——这就是 CI 上偶发、重试也红的那几条。
 *
 * 所以：先等看得见的那份出来，再等数到正好一份（骨架和藏着的副本都走了）。之后的断言照旧用严格模式，含义不变。
 */
export async function 等流式出页落定(块: Locator) {
  await expect(块.filter({ visible: true })).toBeVisible();
  await expect(块).toHaveCount(1);
}
