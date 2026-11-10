"use client";

/**
 * 建档向导查重撞了（有负责人在跟）的出口：填来源和这次的情况，写进现有项目并收到组员邀请，不用再建一份。
 * 写哪、发不发邀请都是服务端定的（customers/same-number-actions.ts）；这里只收两格、显示反馈。
 * 那段话按 情况 说（11-03 B6-8 / B7-4）：没项目写进客户沟通、不提邀请；自己负责、已在组也不提邀请；待分配（X-87）说通知能分配的人。
 */
import { useState } from "react";
import { Alert, App, Button, Input, Space } from "antd";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import { 同号协同录入 } from "@/app/(app)/customers/same-number-actions";
import type { 协同情况 } from "@/lib/enterprise/same-number-collab";

function 说法(情况: 协同情况 | undefined): { 话: string; 按钮: string } {
  // 待分配的线索（X-87）：还没有负责人，不提负责人、不提邀请
  if (情况?.待分配) return { 话: "这个号码在一条待分配的线索里（还没有负责人）。把这次的来源和情况写进客户沟通记录，会通知能分配的人：", 按钮: "写进客户沟通" };
  if (情况?.自己负责) return 情况.有项目 ? { 话: "这个号码已在你自己的项目里。把这次的来源和情况写进去：", 按钮: "写进现有项目" } : { 话: "这个号码已在你自己的客户里。把这次的来源和情况写进客户沟通记录：", 按钮: "写进客户沟通" };
  if (情况 && !情况.有项目) return { 话: "这个号码有人在跟（还没有项目）。把这次的来源和情况写进客户沟通记录，负责人不变，会通知负责人：", 按钮: "写进客户沟通" };
  if (情况?.已在组) return { 话: "这个号码有人在跟，你已在项目组。把这次的来源和情况写进现有项目，负责人不变：", 按钮: "写进现有项目" };
  return { 话: "这个号码有人在跟。把这次的来源和情况写进现有项目，负责人不变，你会收到组员邀请：", 按钮: "写进现有项目" };
}

export default function SameNumberEntry({ 类型, 值, 渠道们, 默认渠道, 情况 }: { 类型: string | undefined; 值: string; 渠道们: 可选渠道[]; 默认渠道: string | null; 情况?: 协同情况 }) {
  const { message } = App.useApp();
  const [渠道, set渠道] = useState<string | null>(默认渠道);
  const [内容, set内容] = useState("");
  const [忙, set忙] = useState(false);
  const [反馈, set反馈] = useState("");

  async function 交() {
    set忙(true);
    try {
      const r = await 同号协同录入(类型 ?? "", 值, { 渠道id: 渠道, 内容 });
      if (r.ok) set反馈(r.反馈);
      else message.error(r.error);
    } catch {
      message.error("没写进去，请稍后再试");
    } finally {
      set忙(false);
    }
  }

  const 说 = 说法(情况);
  if (反馈) return <Alert style={{ marginTop: 8 }} type="success" showIcon title={反馈} />;
  return (
    <Space direction="vertical" size={6} style={{ marginTop: 8, width: "100%" }}>
      <div>{说.话}</div>
      <ChannelPicker aria-label="这次的来源" 层级="两级" channels={渠道们} value={渠道} allowClear={false} placeholder="这次的来源（渠道）" onChange={(v) => set渠道(v ?? null)} />
      <Input.TextArea aria-label="这次的情况" rows={2} maxLength={2000} value={内容} onChange={(e) => set内容(e.target.value)} placeholder="这次沟通了什么（选填）" />
      <Button size="small" type="primary" loading={忙} onClick={交}>{说.按钮}</Button>
    </Space>
  );
}
