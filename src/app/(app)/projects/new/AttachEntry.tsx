"use client";

/**
 * 新建客户查重撞了的「申请挂靠」入口（P-挂靠-01，2026-11-10）：同名和撞号同一套。
 * 有人在跟的 → 给「申请挂靠」（记进撞号台账、通知负责人，负责人不变）；同组的 → 说在哪个项目组、不给申请；
 * 自己名下的 → 给「打开它」；建档弹窗里另给「记到这位客户上」（12-15 第三批 E 件：项目和首条沟通挂到这位已有客户，不新建客户，
 * 走老客户新增项目同一个服务端动作 给客户建项目，权限都在那里判）。第一期不做强录，这里没有「仍然新建」。
 */
import { useState } from "react";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Button, Space } from "antd";
import { 申请挂靠 } from "@/app/(app)/customers/number-actions";
import type { 撞号露出, 负责人露出 } from "@/lib/enterprise/dupe-ledger";
import { 动作出错话 } from "@/lib/stale-deploy";

/** 姓名 · 级别 · 状态（和服务端 负责人一行 同一个写法；那个文件连着数据库，客户端不引） */
export const 负责人说法 = (r: 负责人露出) => [r.姓名, r.级别, r.状态].filter(Boolean).join(" · ") + (r.离职找 ? `（请联系 ${r.离职找}）` : "");

/** 记到 = 建档弹窗里能挑老客户时才给（整页向导没有老客户那一段，只给「打开它」） */
export function 我名下入口({ 客户id, 记到 }: { 客户id: string; 记到?: () => void }) {
  return (
    <Space size={8} wrap>
      {记到 && <Button size="small" type="primary" data-testid="attach-to-mine" onClick={记到}>记到这位客户上</Button>}
      <Link href={`/customers/${客户id}`}><Button size="small">打开它</Button><LinkPending /></Link>
      {记到 && <span className="cr-hint">项目和这次沟通记到这位客户上，不新建客户；联系人和号码不带过去</span>}
    </Space>
  );
}

/** 不给打开 = 外面已经摆了「打开它」（号码撞号面板） */
export default function AttachEntry({ 露出, 不给打开 = false }: { 露出: 撞号露出; 不给打开?: boolean }) {
  const [已申请, set已申请] = useState(!!露出.已申请);
  const [忙, set忙] = useState(false);
  // 申请的结果写在按钮旁边（原型 g.save：按钮变「已申请挂靠」+ 一句回执；没成的原因 role=alert），不弹顶部提示
  const [话, set话] = useState<{ 错: boolean; 字: string } | null>(null);
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
    set话(null);
    try {
      const r = await 申请挂靠(露出.撞号id!);
      if (!r.ok) return void set话({ 错: true, 字: r.error });
      set已申请(true);
      set话({ 错: false, 字: r.提示 });
    } catch (出错) {
      set话({ 错: true, 字: 动作出错话(出错, "没申请成，请稍后再试") });
    } finally {
      set忙(false);
    }
  };
  return (
    <Space size={8} style={{ marginTop: 8 }} wrap>
      {露出.客户id && !不给打开 && <Link href={`/customers/${露出.客户id}`}><Button size="small">打开它</Button><LinkPending /></Link>}
      <Button size="small" type="primary" data-testid="attach-request" disabled={已申请} loading={忙} onClick={() => void 点()}>
        {已申请 ? "已申请挂靠" : "申请挂靠"}
      </Button>
      <span style={{ color: "var(--text-muted)" }}>会通知负责人，负责人不变</span>
      {话 && (话.错 ? <span role="alert" className="cd-task-err">{话.字}</span> : <span role="status" className="cd-transfer-sent">{话.字}</span>)}
    </Space>
  );
}
