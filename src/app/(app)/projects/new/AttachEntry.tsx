"use client";

/**
 * 新建客户查重撞了的「申请挂靠」入口（P-挂靠-01，2026-11-10）：同名和撞号同一套。
 * 有人在跟的 → 给「申请挂靠」（记进撞号台账、通知负责人，负责人不变）；同组的 → 说在哪个项目组、不给申请；
 * 自己名下的 → 给「打开它」。第一期不做强录，这里没有「仍然新建」。
 */
import { useState } from "react";
import Link from "next/link";
import { App, Button, Space } from "antd";
import { 申请挂靠 } from "@/app/(app)/customers/number-actions";
import type { 撞号露出, 负责人露出 } from "@/lib/enterprise/dupe-ledger";

/** 姓名 · 级别 · 状态（和服务端 负责人一行 同一个写法；那个文件连着数据库，客户端不引） */
export const 负责人说法 = (r: 负责人露出) => [r.姓名, r.级别, r.状态].filter(Boolean).join(" · ") + (r.离职找 ? `（请联系 ${r.离职找}）` : "");

export function 我名下入口({ 客户id }: { 客户id: string }) {
  return <Link href={`/customers/${客户id}`}><Button size="small">打开它</Button></Link>;
}

/** 不给打开 = 外面已经摆了「打开它」（号码撞号面板） */
export default function AttachEntry({ 露出, 不给打开 = false }: { 露出: 撞号露出; 不给打开?: boolean }) {
  const { message } = App.useApp();
  const [已申请, set已申请] = useState(!!露出.已申请);
  const [忙, set忙] = useState(false);
  if (露出.同组) {
    return (
      <div data-testid="attach-same-group" style={{ marginTop: 8, color: "var(--text-muted)", overflowWrap: "anywhere" }}>
        你已在项目「{露出.同组.项目}」组里（组员：{露出.同组.成员.join("、")}），直接在项目里协作
      </div>
    );
  }
  if (!露出.撞号id) return null;
  const 点 = async () => {
    set忙(true);
    try {
      const r = await 申请挂靠(露出.撞号id!);
      if (!r.ok) return void message.error(r.error);
      set已申请(true);
      message.success(r.提示);
    } catch {
      message.error("没申请成，请稍后再试");
    } finally {
      set忙(false);
    }
  };
  return (
    <Space size={8} style={{ marginTop: 8 }} wrap>
      {露出.客户id && !不给打开 && <Link href={`/customers/${露出.客户id}`}><Button size="small">打开它</Button></Link>}
      <Button size="small" type="primary" data-testid="attach-request" disabled={已申请} loading={忙} onClick={() => void 点()}>
        {已申请 ? "已申请挂靠" : "申请挂靠"}
      </Button>
      <span style={{ color: "var(--text-muted)" }}>会通知负责人，负责人不变</span>
    </Space>
  );
}
