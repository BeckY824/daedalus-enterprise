"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConsequence } from "@/components/ConsequenceDialog";
import { 删掉对话的屏, 新起一屏, 当前对话, 首页屏 } from "@/lib/home-thread";
import { clearJob } from "@/lib/ai-jobs";
import { 删除对话 } from "./threads";

/**
 * 删一条对话：后果框（回不来 + 不受影响两条），没删掉原因写在框里、框不关。
 * 中栏每行的 ⋯ 和对话框头部的 ⋯（设计语言 HC-1）用同一份，说法和清理一处改。
 * 条数不知道时（头部那颗）后果只说「连同里面的问答」。
 */
export function useDeleteChat() {
  const router = useRouter();
  const sp = useSearchParams();
  const [问后果, 后果框] = useConsequence();
  const [, startTransition] = useTransition();
  const 选中 = sp.get("c") ?? 当前对话(首页屏) ?? "";

  function 删(c: { id: string; title: string; 条数?: number }) {
    void 问后果({
      题: `删掉对话「${c.title}」`,
      后果: [
        { 标: "回不来", 话: c.条数 == null ? "连同里面的问答一起删掉，不能撤销" : `连同里面 ${c.条数} 条消息一起删掉，不能撤销`, 级: "危" },
        { 标: "不动", 话: "客户、跟进这些业务数据不受影响" },
      ],
      是: "删掉",
      做: async () => {
        const r = await 删除对话(c.id);
        if (!r.ok) return { ok: false, error: "删不掉这条对话" };
        /*
          库里删了还不算删完：**每一页的面板各自存着一屏**（见 lib/home-thread），
          那几屏里还挂着这条对话问过的话。2026-09-19 报上来的：在这条列表里把对话
          全删了，回到数据页、线索页，面板里那几句问过的话还在——人以为删干净了。
          所以按对话 id 把所有挂在它名下的屏一并空掉，对应的任务（答案存在那儿）也清掉。
        */
        for (const id of 删掉对话的屏(c.id)) clearJob(`home:${id}`);
        // 删的正好是开着的那条：回到一屏新对话
        if (c.id === 选中) {
          新起一屏(首页屏);
          router.push("/dashboard");
        }
        startTransition(() => router.refresh());
        return { ok: true };
      },
    });
  }

  return [删, 后果框] as const;
}
