"use server";

import { 风格要求, 话术上限, type 起草风格 } from "@/lib/draft-style";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { consumeUserAiQuota } from "@/lib/ai-quota";
import { recordAiUse } from "@/lib/ai-usage";
import { chatJSON } from "@/lib/llm";
import { getBusiness } from "@/lib/business";
import { statusLabel } from "@/lib/business-config";
import { formatTimeline } from "@/lib/ai-context";
import { 带额度 } from "@/lib/tenant/ai-allowance";
import { AI客户输入错误, AI文本输入错误 } from "@/lib/ai-input";

/**
 * 盯盘清单的「起草跟进」：给一条唤醒话术草稿。
 * AI 只起草——消息由销售自己复制到微信发出，系统不做任何触达。
 * 托管版要占一次 AI 次数（带额度，见 lib/tenant/ai-allowance.ts）。
 */
export async function draftWakeup(input: { customerId: string; reason: string; 风格?: 起草风格 }): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const error = AI客户输入错误(input) ?? AI文本输入错误(input?.reason, 1, 1000, "请填写本次跟进原因");
  if (error) return { ok: false, error };
  return 带额度("wakeup", () => 起草唤醒话术(input));
}

async function 起草唤醒话术(input: {
  customerId: string;
  reason: string;
  风格?: 起草风格;
}): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const b = await getBusiness();
  const wait = consumeUserAiQuota(user);
  if (wait !== null) return { ok: false, error: `AI 调用太频繁，请 ${wait} 秒后再试` };

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: {
      name: true,
      grade: true,
      followStatus: true,
      decisionStatus: true,
      remark: true,
      followUps: {
        orderBy: { occurredAt: "desc" },
        take: 8,
        select: { type: true, content: true, occurredAt: true, source: { select: { text: true } } },
      },
    },
  });
  if (!customer) return { ok: false, error: `${b.customer}不存在` };

  // 有原文就带上：唤醒话术要"从上次聊到的具体话题切入"，原话比整理后的要点准得多
  const timeline = customer.followUps.length
    ? formatTimeline(customer.followUps, { eachMax: 600, budget: 2000 })
    : "（从未跟进过）";

  const prompt = `你替销售「${user.name}」起草一条发给${b.customer}的消息（会从微信、WhatsApp 或邮件发出），用来重新接上中断的沟通。落款或自称一律用「${user.name}」，不要编别的名字或机构名。

${b.customer}：${customer.name}${customer.grade ? `（${customer.grade}）` : ""}，跟进状态「${statusLabel(b, customer.followStatus)}」，决策状态「${statusLabel(b, customer.decisionStatus)}」
唤醒原因：${input.reason.slice(0, 100)}
备注：${(customer.remark || "无").slice(0, 100)}
最近的跟进记录（新→旧；带「原文」的是当时的聊天记录原话）：
${timeline}

要求：${风格要求(input.风格)}；自然、像人写的，不像群发；从上次聊到的具体话题切入（有记录就必须用）；给一个轻量的由头（发资料、问近况、约个时间），不硬推销、不催单；禁止编造没聊过的内容。
输出严格 JSON：{"message": "..."}`;

  try {
    const raw = (await chatJSON(prompt, { feature: "wakeup" })) as { message?: unknown };
    const message = typeof raw.message === "string" ? raw.message.trim().slice(0, 话术上限) : "";
    if (!message) return { ok: false, error: "AI 未能生成话术，请重试" };
    await recordAiUse(user, "wakeup", `AI 起草唤醒话术（${b.customer}「${customer.name}」：${input.reason.slice(0, 50)}）`, input.customerId);
    return { ok: true, message };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "生成失败，请稍后重试" };
  }
}
