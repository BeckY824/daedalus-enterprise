"use client";

import { useSyncExternalStore } from "react";
import { 沟通意义提示, 默认占位词 } from "@/lib/enterprise/tri-state-quota";

/**
 * 记沟通的内容框下面那一行（F-052）：边写边判，判为无意义（一期：不足 4 个字）时说「这样写会被判为无意义，不能保存：不足 4 个字，还差 N 个字」；
 * 组织开关「无意义沟通不能保存」关着时说「……，不算有效沟通」；只有占位词、只贴链接的不拦，只说不算有效沟通。
 * 判据只在 tri-state-quota.ts 判沟通无意义（**第二期换成按意义判**），服务端 沟通无意义挡 再判一遍、以它为准。
 * 空内容、算有效、跟进任务 / 提醒、同号留痕不出。一行，放不下「…」，悬停全站 TruncTip 浮出全文。
 *
 * 不 import 服务端动作：首页 AI 卡（ProposalCard）从 沟通可选项目 带回判定后 记下判定；别的框用 useFollowJudge 取。
 */
export type 判定须知 = { 拦: boolean; 占位词: readonly string[] };

/** 还没取到时的样子：开关默认开、默认占位词（服务端照样会判） */
export const 默认判定: 判定须知 = { 拦: true, 占位词: 默认占位词 };

let 已知: 判定须知 | null = null;
const 听的 = new Set<() => void>();

/** 规整服务端回来的（UI 测试桩回 {ok:true} 这类也接得住）：不像样的当没取到 */
export function 规整判定(v: unknown): 判定须知 | null {
  if (!v || typeof v !== "object") return null;
  const o = v as { 拦?: unknown; 占位词?: unknown };
  if (typeof o.拦 !== "boolean") return null;
  return { 拦: o.拦, 占位词: Array.isArray(o.占位词) ? o.占位词.filter((x): x is string => typeof x === "string") : 默认占位词 };
}

/** 一页共用一份：哪张框先取到就记下，别的框跟着用 */
export function 记下判定(v: unknown) {
  const x = 规整判定(v);
  if (!x) return;
  已知 = x;
  for (const f of 听的) f();
}

export function useKnownJudge(): 判定须知 {
  return useSyncExternalStore(
    (f) => { 听的.add(f); return () => { 听的.delete(f); }; },
    () => 已知 ?? 默认判定,
    () => 默认判定,
  );
}

type 行参数 = {
  内容: string | null | undefined;
  类型: string | null | undefined;
  标题?: string | null;
  AI生成?: boolean;
};

/** 那一行的字（空内容、算有效、不是沟通 = null）：要放进 antd Form.Item extra 的先算字，null 就不给 extra（不留空行） */
export function 意义话of(p: 行参数, 判定: 判定须知): string | null {
  return 沟通意义提示(p.内容, p.类型, { 标题: p.标题, AI生成: p.AI生成, 占位词: 判定.占位词, 拦: 判定.拦 });
}

export function MeaningNote({ 话 }: { 话: string }) {
  return <div className="follow-meaning" role="note" data-testid="follow-meaning">{话}</div>;
}

export default function FollowMeaningLine({ 判定, ...p }: 行参数 & {
  /** 不传用一页共用的那份 */
  判定?: 判定须知;
}) {
  const 共用 = useKnownJudge();
  const 话 = 意义话of(p, 判定 ?? 共用);
  return 话 ? <MeaningNote 话={话} /> : null;
}
