/**
 * 「数据」页的几个视图。
 *
 * 单独一个不 import 任何东西的小文件，服务端和客户端都要用它：
 *   放在 DataShell（"use client"）里 → 服务端 import 到的是客户端引用的占位对象，
 *     `.includes` 之类根本不存在，页面白屏报「不是函数」
 *   放在 data.ts 里 → 那个文件 import 了 prisma，会把整条服务端依赖拖进浏览器包，
 *     构建时就会在 next/headers 上炸
 */
/** 「自定义」（V3.5.1 P-界面-10）：地址栏再带 from= to=（YYYY-MM-DD，两头都算），读法在 lib/custom-date-range.ts */
export const 视图们 = ["现在", "本月", "本年", "自定义"] as const;
export type 视图 = (typeof 视图们)[number];
