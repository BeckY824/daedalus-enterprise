"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Input, Modal, Tag } from "antd";
import { PageHead } from "@/components/ui";
import type { 异议行 } from "@/lib/enterprise/objection";
import { 提异议 } from "./actions";

/**
 * 转让异议（12-22 第 2 阶段 A 段，原型 ④ 的「能提异议的通知」「我提的异议」两块；「待我裁定」属 B 段）。
 * 一行：对象名（项目 / 客户）、谁转给谁、还剩几天；点「提异议」弹框写理由（必填 ≤上限 字）。名字都可能很长：一行省略号，悬停看全
 */
export default function ObjectionsView({ 能提, 已提, 打开, 天数, 上限 }: { 能提: 异议行[]; 已提: 异议行[]; 打开: string | null; 天数: number; 上限: number }) {
  const router = useRouter();
  const [选, set选] = useState<异议行 | null>(能提.find((r) => r.id === 打开 && !r.过期) ?? null);
  const [理由, set理由] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const 关 = () => { set选(null); set理由(""); set错(null); };
  async function 交() {
    if (!选 || 忙) return;
    if (!理由.trim()) { set错("请写异议理由"); return; }
    set忙(true);
    try {
      const r = await 提异议(选.id, 理由);
      if (!r.ok) { set错(r.error); return; }
      关();
      router.refresh();
    } catch {
      set错("没提交成功，请刷新后再试");
    } finally {
      set忙(false);
    }
  }
  return (
    <div>
      <PageHead title="转让异议" subtitle={`客户转让后，被换掉的客户负责人、被随客户转走项目的同事，${天数} 天内可以提异议；由让这次转让生效的那位的上一级裁定`} />
      <Card title={`能提异议的通知（${天数} 天内）`} className="obj-card" data-testid="obj-open">
        {能提.length ? 能提.map((r) => (
          <div key={r.id} className="obj-row" data-testid="obj-open-row">
            <div className="obj-main">
              <span className="obj-ell" title={`${r.类别}：${r.对象}`}><Tag>{r.类别}</Tag>{r.对象}</span>
              <span className="obj-ell obj-mut" title={`${r.操作人} 转给 ${r.新负责人}`}>{r.操作人} 转给 {r.新负责人} · {r.过期 ? "已过期" : `还剩 ${r.剩几天} 天`}</span>
            </div>
            <Button disabled={r.过期} onClick={() => set选(r)}>提异议</Button>
          </div>
        )) : <Empty description="没有能提异议的转让" />}
      </Card>
      {已提.length > 0 && (
        <Card title="我提的异议" className="obj-card" data-testid="obj-sent">
          {已提.map((r) => (
            <div key={r.id} className="obj-row" data-testid="obj-sent-row">
              <div className="obj-main">
                <span className="obj-ell" title={`${r.类别}：${r.对象}`}><Tag>{r.类别}</Tag>{r.对象}</span>
                <span className="obj-ell obj-mut" title={r.理由}>理由：{r.理由}</span>
                <span className="obj-ell obj-mut">{r.状态 === "待裁定" ? `等 ${r.裁定人 ?? ""}（${r.裁定角色 ?? ""}）裁定` : `${r.状态}${r.裁定说明 ? `：${r.裁定说明}` : ""}`}</span>
              </div>
              <Tag>{r.状态}</Tag>
            </div>
          ))}
        </Card>
      )}
      <Modal open={!!选} title="提异议" onCancel={关} onOk={交} okText="提交" cancelText="取消" confirmLoading={忙} destroyOnHidden>
        {选 && (
          <div className="obj-form">
            <div className="obj-ell" title={选.对象}><Tag>{选.类别}</Tag>{选.对象}</div>
            <div className="obj-mut">{选.操作人} 转给 {选.新负责人}；裁定前照常归新负责人。</div>
            <label htmlFor="obj-reason">理由（必填）</label>
            <Input.TextArea id="obj-reason" aria-label="异议理由" value={理由} maxLength={上限} showCount autoSize={{ minRows: 3, maxRows: 6 }} disabled={忙}
              placeholder="例如：这单下周签，客户只认我" onChange={(e) => set理由(e.target.value)} />
            {错 && <div className="obj-err" role="alert">{错}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
