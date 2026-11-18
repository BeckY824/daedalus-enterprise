"use client";

/**
 * 企业版运行记录（批次 28-⑤）：浏览器里没人接住的错报给服务器（lib/telemetry/report-client.ts → /api/client-report）。
 * 只在企业版的应用内页面挂（(app)/layout.tsx 判过企业版和开关），不画任何东西。
 *
 * - window error：脚本没接住的错（资源加载失败那种 error 事件没有 error 对象、target 不是 window，不报）
 * - unhandledrejection：lib/action-error.ts 认得出的（旧版本 / 网络 / 超时 / 服务端）记「动作失败」，别的记「未捕获Promise」。
 *   不 preventDefault：给人看那句由 components/UpdateBanner.tsx 管，这里只记
 * - 错误边界在 (app)/error.tsx 自己报；catch 里换中文的在 给人看的错 里报
 */
import { useEffect } from "react";
import { 认动作错 } from "@/lib/action-error";
import { 报错, 开上报 } from "@/lib/telemetry/report-client";

export default function ErrorReporter() {
  useEffect(() => {
    开上报();
    const 接错 = (ev: ErrorEvent) => {
      if (!ev.error && !ev.message) return;
      报错("error", ev.error ?? ev.message);
    };
    const 接拒 = (ev: PromiseRejectionEvent) => {
      const 类 = 认动作错(ev.reason);
      if (类) 报错("action", ev.reason, 类);
      else 报错("rejection", ev.reason);
    };
    window.addEventListener("error", 接错);
    window.addEventListener("unhandledrejection", 接拒);
    return () => {
      window.removeEventListener("error", 接错);
      window.removeEventListener("unhandledrejection", 接拒);
    };
  }, []);
  return null;
}
