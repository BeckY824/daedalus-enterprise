/**
 * AI 浮窗（P-界面-39）的「从别处叫它出来」：客户页页头的「AI」按钮不再开右侧抽屉，叫的是壳上那块中下方的浮窗。
 *
 * 浮窗挂在壳上（AiDock 浮窗模式），页里的按钮够不着它的 state，所以在这儿登记一个开关：
 *   - 浮窗挂上时 登记打开AI浮窗(开)，卸掉时取消
 *   - 按钮调 打开AI浮窗()：有人登记就打开并返回 true；没有（不是企业版项目模式、没登 AI）返回 false，按钮照旧开抽屉
 * 纯模块，不引 react / next，测试直接调。
 */
let 开: (() => void) | null = null;

export function 登记打开AI浮窗(fn: () => void): () => void {
  开 = fn;
  return () => {
    if (开 === fn) 开 = null;
  };
}

export function 打开AI浮窗(): boolean {
  if (!开) return false;
  开();
  return true;
}
