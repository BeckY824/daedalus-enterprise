"use client";

import type { LoginResult } from "./actions";

/** 跳转发起后仍停在本页的等待上限，超过就说明会话没真正建立。 */
const 跳转超时毫秒 = 15000;

/**
 * 登录成功之后怎么进去。
 *
 * 报错就回一句话（调用方显示出来、停止转圈）；回 null 表示已经在跳了，保持转圈别闪。
 */
export async function 登录之后(res: Extract<LoginResult, { ok: true }>, 报错: (msg: string) => void): Promise<void> {
  /**
   * 用整页跳转，不用 router.push。
   * 软导航只拉 RSC 数据，会话 cookie 万一没生效（HTTP 下的 secure cookie、
   * 客户端拒收等），proxy.ts 会把请求弹回 /login——但当前组件不会重新挂载，
   * loading 永远停在 true，同样表现为无限转圈且零报错。
   * 整页跳转让浏览器重新走一遍完整请求，成败都看得见。
   * 这正是 @next/next/no-location-assign-relative-destination 要拦的写法，
   * 但登录是会话状态的变更点，此处硬跳转是有意的，故就地豁免。
   */
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  // 先到选模版那一页：新用户在进主界面之前选；不该选的它当场 307 去首页（app/start/page.tsx）
  window.location.assign(res.选工作区 ? "/workspaces" : "/start");

  // 跳转没能真正离开本页时的兜底提示（页面一旦卸载，这个定时器随之消失）
  setTimeout(() => 报错("登录成功但页面未能跳转，请刷新重试；若反复出现请联系管理员"), 跳转超时毫秒);
}
