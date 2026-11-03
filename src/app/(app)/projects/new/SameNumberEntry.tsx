"use client";

/**
 * 建档向导查重撞了（有负责人在跟）的出口：填来源和这次的情况，写进现有项目并收到组员邀请，不用再建一份。
 * 写哪、发不发邀请都是服务端定的（customers/same-number-actions.ts）；这里只收两格、显示反馈。
 */
import { useState } from "react";
import { Alert, App, Button, Input, Space } from "antd";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import { 同号协同录入 } from "@/app/(app)/customers/same-number-actions";

export default function SameNumberEntry({ 类型, 值, 渠道们, 默认渠道 }: { 类型: string | undefined; 值: string; 渠道们: 可选渠道[]; 默认渠道: string | null }) {
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

  if (反馈) return <Alert style={{ marginTop: 8 }} type="success" showIcon title={反馈} />;
  return (
    <Space direction="vertical" size={6} style={{ marginTop: 8, width: "100%" }}>
      <div>这个号码有人在跟。把这次的来源和情况写进现有项目，负责人不变，你会收到组员邀请：</div>
      <ChannelPicker aria-label="这次的来源" 层级="两级" channels={渠道们} value={渠道} allowClear={false} placeholder="这次的来源（渠道）" onChange={(v) => set渠道(v ?? null)} />
      <Input.TextArea aria-label="这次的情况" rows={2} maxLength={2000} value={内容} onChange={(e) => set内容(e.target.value)} placeholder="这次沟通了什么（选填）" />
      <Button size="small" type="primary" loading={忙} onClick={交}>写进现有项目</Button>
    </Space>
  );
}
