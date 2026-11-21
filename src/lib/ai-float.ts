/**
 * AI 浮窗（P-界面-39）和页面之间的登记口。纯模块，不引 react / next，测试直接调。
 * 原来还有一对「页里的按钮叫浮窗出来」（客户页页头「AI」按钮用）；教练点评改版 PR1（11-21）去掉了那颗按钮，那一对没人调，删了。
 */

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
