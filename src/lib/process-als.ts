import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 全进程只有一份的异步上下文（2026-10-29 回收站空表查出来的）。
 *
 * Next 的服务端会把同一个文件按不同入口各载一份，模块里 `new AsyncLocalStorage()` 就成了好几个。
 * 平时各用各的没事，但企业版的只读通道（lib/read-pool.ts）挂在 globalThis 上全进程共用一个，
 * 它的 加上限定 是第一个建它的那份模块里的——别的入口在自己那份里 看已删() / 看全部()，
 * 只读通道那头读不到，照样补「没删」「只看自己」：回收站列表在设置页上永远是空的。
 * 挂在 globalThis 上按名字取，哪份模块拿到的都是同一个。
 */
export function 全进程上下文<T>(名字: string): AsyncLocalStorage<T> {
  const g = globalThis as unknown as Record<symbol, AsyncLocalStorage<T> | undefined>;
  const k = Symbol.for(`crm.als.${名字}`);
  return (g[k] ??= new AsyncLocalStorage<T>());
}
