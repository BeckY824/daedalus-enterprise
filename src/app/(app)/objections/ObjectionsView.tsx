"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, Empty, Input, Modal, Tabs, Tag } from "antd";
import { PageHead } from "@/components/ui";
import type { 异议行 } from "@/lib/enterprise/objection";
import type { 待裁定行, 特殊裁定行 } from "@/lib/enterprise/objection-judge";
import { 提异议, 裁定异议, 已手工退回 } from "./actions";

/**
 * 转让异议（12-22 第 2 阶段，原型 ④）：
 *   A 段 —— 「能提异议的通知」「我提的异议」（我的异议页签）；
 *   B 段 —— 「待我裁定」页签（裁定人看到：异议理由、转让原因、发起人、时间、客户 / 项目；维持 / 撤回两个按钮、无默认，说明必填）、
 *           「待手工退回」页签（只给系统管理员：撤回但不满足自动退回的，手工退回后点「已手工退回」留痕）。
 * 一行：对象名（项目 / 客户）、谁转给谁、还剩几天；名字都可能很长：一行省略号，悬停看全
 */
type 页签键 = "mine" | "judge" | "all" | "hand" | "special";
/** 页签数字：查到上限（200）就写「200+」，不假装只有这么多 */
const 数 = (n: number) => (n ? `（${n >= 200 ? "200+" : n}）` : "");
type 裁定框 = { 行: 待裁定行; 动作: "维持" | "撤回" | "手工" };

export default function ObjectionsView({ 能提, 已提, 打开, 天数, 上限, 待裁, 全部, 待手工, 台账, 月, 管理员, 裁定上限, 首个页签, 打开裁定 }: {
  能提: 异议行[]; 已提: 异议行[]; 打开: string | null; 天数: number; 上限: number;
  待裁: 待裁定行[]; 全部: 待裁定行[]; 待手工: 待裁定行[]; 台账: 特殊裁定行[]; 月: string | null; 管理员: boolean; 裁定上限: number; 首个页签: 页签键; 打开裁定: string | null;
}) {
  const router = useRouter();
  const [页签, set页签] = useState<页签键>(首个页签);
  const [选, set选] = useState<异议行 | null>(能提.find((r) => r.id === 打开 && !r.过期) ?? null);
  const [理由, set理由] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const [裁, set裁] = useState<裁定框 | null>(null);
  const [说明, set说明] = useState("");
  const [裁错, set裁错] = useState<string | null>(null);
  const [裁忙, set裁忙] = useState(false);
  const 关 = () => { set选(null); set理由(""); set错(null); };
  const 关裁 = () => { set裁(null); set说明(""); set裁错(null); };
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
  async function 交裁() {
    if (!裁 || 裁忙) return;
    if (!说明.trim()) { set裁错("请写说明（会记进变更历史）"); return; }
    set裁忙(true);
    try {
      const r = 裁.动作 === "手工" ? await 已手工退回(裁.行.id, 说明) : await 裁定异议(裁.行.id, 裁.动作, 说明);
      if (!r.ok) { set裁错(r.error); return; }
      关裁();
      router.refresh();
    } catch {
      set裁错("没提交成功，请刷新后再试");
    } finally {
      set裁忙(false);
    }
  }
  const 裁定行 = (r: 待裁定行, 手工: boolean, 全 = false) => {
    const 名 = `${r.对象}${r.类别 === "项目" && r.客户名 ? `（${r.客户名}）` : ""}`;
    return (
      <div key={r.id} className="obj-row" data-testid={手工 ? "obj-hand-row" : 全 ? "obj-all-row" : "obj-judge-row"} data-hit={r.id === 打开裁定 ? "1" : undefined}>
        <div className="obj-main">
          <span className="obj-ell" title={`${r.类别}：${名}`}><Tag>{r.类别}</Tag>{名}</span>
          <span className="obj-ell obj-mut" title={`${r.异议人} 的理由：${r.理由}`}>{r.异议人} 的理由：{r.理由}</span>
          <span className="obj-ell obj-mut" title={r.转让原因}>转让原因：{r.转让原因 || "（没写）"} · {r.发起人} 转给 {r.接手人} · {r.转让于.slice(0, 10)}</span>
          {全 && <span className="obj-ell obj-mut" title={`现在由 ${r.现裁定人 ?? ""} 裁定`}>{r.本人发起 ? "本人发起、本人裁定（无人回避），由发起人自己裁定：" : r.本人接手 ? "本人接手、无人回避，由接手人自己裁定：" : "裁定人："}{r.现裁定人}</span>}
          {!手工 && !全 && r.本人发起 && <span className="obj-ell obj-mut" data-testid="obj-self-note">本人发起、本人裁定（只有你一位系统管理员，会记进特殊裁定台账）</span>}
          {!手工 && !全 && r.本人接手 && <span className="obj-ell obj-mut" data-testid="obj-self-note">本人接手、无人回避（只有你一位系统管理员）</span>}
          {!手工 && r.能裁 === false && <span className="obj-ell obj-mut" data-testid="obj-recuse" title={`你是这次的发起人 / 接手人 / 异议人，需回避；现由 ${r.现裁定人 ?? ""} 裁定`}>你是这次的发起人 / 接手人 / 异议人，需回避；现由 {r.现裁定人} 裁定</span>}
          {手工 && <span className="obj-ell obj-mut" title={`${r.裁定人} 裁定撤回：${r.裁定说明}`}>{r.裁定人} 裁定撤回：{r.裁定说明}</span>}
          {手工 && r.退回说明 && <span className="obj-ell obj-mut" title={r.退回说明}>{r.退回说明}</span>}
        </div>
        {手工
          ? <Button onClick={() => set裁({ 行: r, 动作: "手工" })}>已手工退回</Button>
          : r.能裁 === false ? null
          : (
            <div className="obj-btns">
              <Button onClick={() => set裁({ 行: r, 动作: "维持" })}>维持</Button>
              <Button danger onClick={() => set裁({ 行: r, 动作: "撤回" })}>撤回</Button>
            </div>
          )}
      </div>
    );
  };
  const 我的页 = (
    <>
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
    </>
  );
  const 有裁定页 = 待裁.length > 0 || 管理员 || 首个页签 === "judge";
  return (
    <div>
      <PageHead title="转让异议" subtitle={`客户转让后，被换掉的客户负责人、被随客户转走项目的同事，${天数} 天内可以提异议；由让这次转让生效的那位的上一级裁定`} />
      <Tabs
        activeKey={页签} onChange={(k) => set页签(k as 页签键)}
        items={[
          { key: "mine", label: "我的异议", children: 我的页 },
          ...(有裁定页 ? [{
            key: "judge", label: `待我裁定${数(待裁.length)}`,
            children: <Card title="待我裁定（你是这条异议的裁定人）" className="obj-card" data-testid="obj-judge">{待裁.length ? 待裁.map((r) => 裁定行(r, false)) : <Empty description="没有等你裁定的异议" />}</Card>,
          }] : []),
          ...(管理员 ? [{
            key: "all", label: `全部待裁定${数(全部.length)}`,
            children: <Card title="全部待裁定（系统管理员兜底，谁的都能裁）" className="obj-card" data-testid="obj-all">{全部.length ? 全部.map((r) => 裁定行(r, false, true)) : <Empty description="没有待裁定的异议" />}</Card>,
          }] : []),
          ...(管理员 ? [{
            key: "hand", label: `待手工退回${数(待手工.length)}`,
            children: <Card title="待手工退回（裁定撤回、但不满足自动退回的条件）" className="obj-card" data-testid="obj-hand">{待手工.length ? 待手工.map((r) => 裁定行(r, true)) : <Empty description="没有等手工退回的" />}</Card>,
          }] : []),
          ...(管理员 ? [{
            key: "special", label: `特殊裁定${数(台账.length)}`,
            children: (
              <Card title="特殊裁定台账（本人发起、本人裁定，每月看一次）" className="obj-card" data-testid="obj-special"
                extra={<input type="month" aria-label="按月筛选" value={月 ?? ""} onChange={(e) => router.push(`/objections?tab=special${e.target.value ? `&month=${e.target.value}` : ""}`)} />}>
                {台账.length ? 台账.map((r) => (
                  <div key={r.id} className="obj-row" data-testid="obj-special-row">
                    <div className="obj-main">
                      <span className="obj-ell" title={`${r.客户编号} · ${r.项目}`}>{r.客户编号} · {r.项目}</span>
                      <span className="obj-ell obj-mut" title={`发起人 = 裁定人：${r.发起人}`}>{r.裁定于.slice(0, 16).replace("T", " ")} · 发起人 = 裁定人：{r.发起人}</span>
                      <span className="obj-ell obj-mut" title={r.理由}>理由：{r.理由}</span>
                    </div>
                    <Tag>{r.结果}</Tag>
                  </div>
                )) : <Empty description="没有本人发起、本人裁定的记录" />}
              </Card>
            ),
          }] : []),
        ]}
      />
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
      <Modal
        open={!!裁} title={裁?.动作 === "手工" ? "已手工退回" : `裁定：${裁?.动作 ?? ""}`} onCancel={关裁} onOk={交裁} okText={裁?.动作 === "手工" ? "确认已退回" : 裁?.动作} cancelText="取消"
        okButtonProps={{ danger: 裁?.动作 === "撤回", disabled: !说明.trim() }} confirmLoading={裁忙} destroyOnHidden>
        {裁 && (
          <div className="obj-form" data-testid="obj-judge-form">
            <div className="obj-ell" title={裁.行.对象}><Tag>{裁.行.类别}</Tag>{裁.行.对象}</div>
            <div className="obj-full"><b>{裁.行.异议人}</b> 的理由：{裁.行.理由}</div>
            <div className="obj-full obj-mut">转让原因：{裁.行.转让原因 || "（没写）"}；{裁.行.发起人} 转给 {裁.行.接手人}，{裁.行.转让于.slice(0, 10)}</div>
            {裁.动作 !== "手工" && 裁.行.本人发起 && <Alert type="warning" showIcon data-testid="obj-self-banner" message="本人发起、本人裁定" description="只剩你一位系统管理员，这条由你自己裁；会留痕并记进「特殊裁定」台账。" />}
            {裁.动作 === "维持" && <div className="obj-mut">维持：原转让不动，通知 {裁.行.异议人}、{裁.行.发起人}。</div>}
            {裁.动作 === "撤回" && (
              <div className="obj-mut" data-testid="obj-judge-hint">
                {裁.行.能自动退
                  ? `撤回：退回 ${裁.行.异议人}，期间 ${裁.行.接手人} 记的跟进留在项目上；已计提的提成不动，未计提的随项目回；待办跟项目走，新线索验证钟从头计时。会通知 ${裁.行.异议人}、${裁.行.接手人}、客户负责人、${裁.行.发起人}。`
                  : `${裁.行.退回说明}。会通知 ${裁.行.异议人}、${裁.行.发起人} 和系统管理员。`}
              </div>
            )}
            <label htmlFor="obj-judge-note">{裁.动作 === "手工" ? "手工退回说明（必填，写进变更历史）" : "裁定说明（必填，写进变更历史）"}</label>
            <Input.TextArea id="obj-judge-note" aria-label="裁定说明" value={说明} maxLength={裁定上限} showCount autoSize={{ minRows: 3, maxRows: 6 }} disabled={裁忙}
              onChange={(e) => set说明(e.target.value)} />
            {裁错 && <div className="obj-err" role="alert">{裁错}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
