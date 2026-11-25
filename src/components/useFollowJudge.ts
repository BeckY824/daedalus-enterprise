"use client";

import { useEffect } from "react";
import { 沟通判定须知 } from "@/app/(app)/follow-method-actions";
import { 记下判定, useKnownJudge, type 判定须知 } from "@/components/FollowMeaningLine";

// 一页只取一次（同 useFollowMethods）：管理员拨了开关刷新页面就是新的；取失败下次再取
let 取着: Promise<unknown> | null = null;

/**
 * 记沟通的框用（F-052）：取组织开关「无意义沟通不能保存」和占位词表，交给 FollowMeaningLine。
 * 没取到时按默认（开着、默认占位词）；服务端照样再判
 */
export function useFollowJudge(要: boolean = true): 判定须知 {
  const 判定 = useKnownJudge();
  useEffect(() => {
    if (!要) return;
    取着 ??= 沟通判定须知().catch(() => { 取着 = null; return null; });
    void 取着.then(记下判定);
  }, [要]);
  return 判定;
}
