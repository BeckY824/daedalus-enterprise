/**
 * 表格横滚还原（29R 的横滚那一半，#381 实操修）：从客户详情回列表时左栏从图标窄栏展开（lib/rail-mini.ts，宽窄过渡 --t），
 * 表格框跟着在几帧里变窄（1366 宽 1258 → 1094）。原来第一帧就设 scrollLeft，那时框还宽、能滚的最大值小，被夹成小值（120 → 0、300 → 0），
 * 随后的 scroll 事件又把夹过的错值记回 sessionStorage，之后刷新也丢。
 *
 * 这里每帧把框滚到目标，直到「滚到了、而且框的宽度和内容宽度连着几帧不变、过了最短时长」才算完；
 * 人自己动了（滚轮、触摸、按键、按下鼠标）立刻停，不跟人抢；最长时长到了也停（目标本来就够不着，比如列少了）。
 * 调用方在完之前别把 scroll 事件记回去（DataList 的 横滚还原中）。和 components/ListReturn.tsx 的 滚回（竖向）同一个做法
 */
export type 横滚回选项 = {
  /** 至少滚这么久（毫秒）才算完：盖过左栏宽窄过渡（globals.css --t 180ms），过渡开头那几帧宽度变得慢 */
  最短?: number;
  /** 最多滚这么久（毫秒），到了就停（够不着的目标不一直滚） */
  最长?: number;
  /** 滚到了、尺寸不变要连着几帧 */
  稳帧?: number;
};

export function 横滚回(取框: () => HTMLElement | null | undefined, x: number, 完了: () => void, 选项: 横滚回选项 = {}): () => void {
  const { 最短 = 300, 最长 = 1500, 稳帧 = 3 } = 选项;
  let 停 = false;
  let 收过 = false;
  let 稳 = 0;
  let 上尺: string | null = null;
  let 帧 = 0;
  const 开始 = performance.now();
  const 人动了 = () => {
    停 = true;
  };
  const 事件 = ["wheel", "touchstart", "keydown", "mousedown", "pointerdown"] as const;
  for (const e of 事件) window.addEventListener(e, 人动了, { passive: true, capture: true });
  const 收 = () => {
    if (收过) return;
    收过 = true;
    for (const e of 事件) window.removeEventListener(e, 人动了, { capture: true });
    完了();
  };
  const 一步 = () => {
    if (停) return 收();
    const 过了 = performance.now() - 开始;
    const 框 = 取框();
    if (框) {
      // 差半像素以上就再设（过渡中被夹到 619 时目标 620 也要补上）；缩放屏上 scrollLeft 对齐设备像素会有零点几的差，差不到 1 算到了
      if (Math.abs(框.scrollLeft - x) >= 0.5) 框.scrollLeft = x;
      const 尺 = `${框.clientWidth}/${框.scrollWidth}`;
      稳 = Math.abs(框.scrollLeft - x) < 1 && 尺 === 上尺 ? 稳 + 1 : 0;
      上尺 = 尺;
      if (稳 >= 稳帧 && 过了 >= 最短) return 收();
    }
    if (过了 >= 最长) return 收();
    帧 = requestAnimationFrame(一步);
  };
  帧 = requestAnimationFrame(一步);
  return () => {
    停 = true;
    cancelAnimationFrame(帧);
    收();
  };
}
