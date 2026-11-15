"use client";
/**
 * 弹框宿主（dialog-host-root.tsx）的懒入口：`await 挂框(画, 默认值)`、`await 问后果(参数)`，用法和原来一样。
 *
 * 为什么懒：宿主连同后果框（ConsequenceDialog）、antd 中文配置只在点了「删除 / 退回公海 / 转让…」之后才用，
 * 静态 import 会全压进客户列表首屏 JS（速度闸门 11-15 红过：870 KB，线 850）。这里点下去才 import，
 * 勾选 / 鼠标移上时调 预取弹框() 先拿起来，点的时候多半已经到了。
 * 代码没取到（断网）：按「默认值」（= 取消）结束，不确认不生效。
 */
import type { ReactNode } from "react";
import type { 后果框参数 } from "@/components/ConsequenceDialog";

const 载 = () => import("@/components/dialog-host-root");

/** 先把弹框代码拿起来（勾选、hover 时调），失败不吭声：点的时候会再取 */
export function 预取弹框() {
  void 载().catch(() => {});
}

/** 宿主没取到（断网）时按默认值（= 取消）结束 */
async function 用宿主<R>(做: (宿主: Awaited<ReturnType<typeof 载>>) => Promise<R>, 默认: R): Promise<R> {
  let 宿主: Awaited<ReturnType<typeof 载>>;
  try {
    宿主 = await 载();
  } catch (e) {
    console.error("弹框没加载出来", e);
    return 默认;
  }
  return 做(宿主);
}

/** 开一个框，等它结束：关(v) 的 v 就是结果；被下一个框顶掉 = 默认 */
export function 挂框<T>(画: (开: boolean, 关: (v: T) => void) => ReactNode, 默认: T): Promise<T> {
  return 用宿主((h) => h.挂框(画, 默认), 默认);
}

/** 后果框（ConsequenceDialog）的命令式版：成了 true，取消 false。做 没成时原因写在框里、框不关 */
export function 问后果(p: 后果框参数): Promise<boolean> {
  return 用宿主((h) => h.问后果(p), false);
}
