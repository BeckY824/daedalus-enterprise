"use client";

import { useEffect, useState, useTransition } from "react";
import StatePage from "@/components/StatePage";
import { 决定错误展示 } from "@/lib/error-display";
import { 存好再刷新 } from "@/lib/stale-deploy";
import { 报错 } from "@/lib/telemetry/report-client";

/**
 * 应用内错误页。判断逻辑在 @/lib/error-display 里，这里只负责渲染——
 * 那边是纯函数，能被测试直接 import，不必靠读源码来「验证」。
 *
 * 和 404、空状态用同一套外观（components/StatePage）：三种「没有正文」的状态
 * 长一个样，说的也是同样三件事——发生了什么、为什么、接下来做什么。
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const 展示 = 决定错误展示(error, process.env.NODE_ENV === "development");
  // 点「重试」原地转圈再换内容（原型 st.error），不先闪一下空白；重来还是错就停转、留在这页
  const [重试中, 开始] = useTransition();
  const [点过, set点过] = useState(false);
  // 企业版运行记录（28-⑤）：错误边界接住的报一条（没装上报时攒着、不发；同一个错一页只报一次，lib/telemetry/report-client.ts）
  useEffect(() => {
    if (展示.类型 !== "未登录") 报错("boundary", error);
  }, [error, 展示.类型]);

  if (展示.类型 === "未登录") {
    return (
      <StatePage
        标题="登录已过期"
        说明="这一页要登录才能看，而你这次的登录状态已经过期了——重新登录一次就能接着用，数据不受影响。"
        动作={{ label: "重新登录", href: "/login" }}
      />
    );
  }

  if (展示.类型 === "旧版本") {
    return (
      <StatePage
        标题="系统刚更新了"
        说明="这一页是更新前打开的，刚才那一下没交上去。刷新一下就能接着用；打了没交的字留在这台电脑上，重新打开同一个框会带回来。"
        动作={{ label: "刷新", onClick: 存好再刷新 }}
      />
    );
  }

  return (
    <StatePage
      标题="这一页没能打开"
      说明={
        展示.类型 === "原文"
          ? 展示.文本
          : "多半是一次偶发的失败（网络断了一下、或者服务端这次没答上来）。先重试；还不行就整页重新加载。"
      }
      动作={{ label: 点过 && !重试中 ? "再试一次" : "重试", loading: 重试中, onClick: () => { set点过(true); 开始(() => reset()); } }}
      次动作={{ label: "重新加载", onClick: () => window.location.reload() }}
      附注={
        展示.类型 === "编号" && 展示.digest ? (
          <>保留这个编号，反馈问题时一并提供：<code>{展示.digest}</code></>
        ) : null
      }
    />
  );
}
