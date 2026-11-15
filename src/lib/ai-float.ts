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

/*
  「生成智能总结」（扣 1 次额度的付费入口，客户页 AiPanel 里那颗）：浮窗取代了客户页的 AI 抽屉，但这个入口不能丢。
  客户页挂着时登记「打开原抽屉」，浮窗在客户上下文的空屏里摆「总结这位客户」，点了就叫它——
  走的仍是 AiPanel 同一个按钮、同一次扣减和确认，浮窗不自己起总结。没登记（别的页、没登 AI）就不摆。
  可订阅：客户页挂上 / 卸掉时浮窗跟着摆 / 不摆。
*/
let 智能总结: (() => void) | null = null;
const 听的 = new Set<() => void>();
const 通知 = () => 听的.forEach((f) => f());

export function 登记智能总结(fn: () => void): () => void {
  智能总结 = fn;
  通知();
  return () => {
    if (智能总结 === fn) {
      智能总结 = null;
      通知();
    }
  };
}

export function 打开智能总结(): boolean {
  if (!智能总结) return false;
  智能总结();
  return true;
}

export function 订阅智能总结(f: () => void): () => void {
  听的.add(f);
  return () => {
    听的.delete(f);
  };
}

export function 有智能总结(): boolean {
  return 智能总结 !== null;
}
