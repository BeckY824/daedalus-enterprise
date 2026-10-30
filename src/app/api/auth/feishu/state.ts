/** 飞书授权往返用的一次性 state：入口写、回调核对后删。只在这两条路由下发送 */
export const 状态Cookie = "crm_feishu_state";

export const 状态Cookie选项 = {
  httpOnly: true,
  sameSite: "lax" as const,
  // 同 lib/auth.ts 的 COOKIE_SECURE：IP + http 部署必须 false，否则浏览器丢掉它
  secure: process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE === undefined && process.env.NODE_ENV === "production"),
  path: "/api/auth/feishu",
  maxAge: 600,
};
