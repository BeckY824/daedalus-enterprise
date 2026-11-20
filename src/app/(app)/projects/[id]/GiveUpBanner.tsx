"use client";
/**
 * 项目页「放弃（豁免）」（32H，lib/enterprise/lead-giveup.ts）：新分配给我、我还没记有效沟通的线索，页头提示条里一颗按钮。
 * 点开框：原因必选（外出 / 忙不过来 / 其他，其他要写一句），框里写明线索无效走判无效、能一键跳到「线索验证」。
 * 点不了（验证中、本月用过）按钮灰着，提示条里写为什么。按钮在提示条正文里（不放 Alert 的 action 位），手机 390 宽也不横向撑出。
 * 放弃成了不刷新本页：线索已经转走，本页（项目页、客户详情项目区）他多半已经看不到了，刷新会落到「找不到」。
 * 提示条换成「已转给 X」，点「知道了」回项目列表
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Modal, Radio, Space } from "antd";
import { 放弃原因们, 其他原因, 放弃补充上限, 走判无效话, 每月放弃次数, type 放弃入口 } from "@/lib/enterprise/lead-giveup-core";
import { 有效线索节点 } from "@/lib/project/stage-gates";
import { 放弃线索Action } from "./giveup-actions";

/** 跳到项目页「线索验证」那块（LeadVerifyPanel data-testid=lead-verify）；没有（还没走到线索验证节点）回 false */
function 去判无效(): boolean {
  const el = document.querySelector<HTMLElement>('[data-testid="lead-verify"]');
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  return true;
}

/** 放弃成了点「知道了」去哪：项目列表（销售都能进） */
const 放弃后去 = "/projects";

export default function GiveUpBanner({ projectId, 入口 }: { projectId: string; 入口: 放弃入口 }) {
  const router = useRouter();
  const [开, set开] = useState(false);
  const [原因, set原因] = useState<string | null>(null);
  const [补充, set补充] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const [成, set成] = useState<string | null>(null);
  const 关 = () => { if (!忙) { set开(false); set错(null); } };
  const 交 = async () => {
    if (!原因) { set错("先选放弃原因"); return; }
    set忙(true); set错(null);
    try {
      const r = await 放弃线索Action(projectId, 原因, 补充);
      if (!r.ok) { set错(r.error); return; }
      set开(false);
      set成(`已放弃，转给了 ${r.接手人}；已给你记 1 条待补`);
    } catch {
      set错("网络没连上，这次没放弃，稍后再点");
    } finally {
      set忙(false);
    }
  };
  if (成) {
    return (
      <Alert
        type="success" showIcon className="giveup-bar" data-testid="proj-giveup-done" title={成}
        description={(
          <div className="giveup-body">
            <div>这条线索已不在你名下，回项目列表继续跟别的。</div>
            <Button size="small" type="primary" className="giveup-open" onClick={() => router.push(放弃后去)} data-testid="proj-giveup-back">知道了</Button>
          </div>
        )}
      />
    );
  }
  return (
    <>
      <Alert
        type="info" showIcon className="giveup-bar" data-testid="proj-giveup"
        title="这条是新分配给你的线索，实在跟不了可以放弃（豁免）"
        description={(
          <div className="giveup-body">
            <div>每人每月 {每月放弃次数} 次。放弃后立即转给本线下一位同事，给你记 1 条待补（下一条自动分配先补给你）。线索无效请走判无效，不用放弃。</div>
            {!入口.可 && 入口.为什么 && <div className="giveup-why" data-testid="proj-giveup-why">{入口.为什么}</div>}
            <Button size="small" className="giveup-open" disabled={!入口.可} onClick={() => set开(true)} data-testid="proj-giveup-open">放弃（豁免）</Button>
          </div>
        )}
      />
      <Modal
        open={开} title="放弃这条线索（豁免）" okText="确认放弃" cancelText="再想想"
        okButtonProps={{ danger: true, loading: 忙, disabled: !原因 || (原因 === 其他原因 && !补充.trim()), ...{ "data-testid": "proj-giveup-ok" } }}
        onCancel={关} onOk={() => void 交()} destroyOnHidden
      >
        <p className="giveup-lead">每人每月只能放弃 {每月放弃次数} 次。确认后这条线索立即转给本线下一位同事（接手人照记一次分配），你原来这条照算、不退名额，另给你记 1 条待补。转不出去时不扣次数。</p>
        <div className="giveup-label"><b>放弃原因</b>（必选）</div>
        <Radio.Group value={原因} onChange={(e) => { set原因(e.target.value as string); set错(null); }} data-testid="proj-giveup-reason">
          <Space orientation="vertical">
            {放弃原因们.map((r) => <Radio key={r} value={r}>{r}</Radio>)}
          </Space>
        </Radio.Group>
        {原因 === 其他原因 && (
          <Input.TextArea
            className="giveup-note" rows={2} maxLength={放弃补充上限} showCount placeholder="写一句为什么放弃" aria-label="放弃补充说明"
            value={补充} onChange={(e) => { set补充(e.target.value); set错(null); }} data-testid="proj-giveup-note"
          />
        )}
        <div className="giveup-hint" data-testid="proj-giveup-invalid-hint">
          {走判无效话}
          <Button type="link" size="small" data-testid="proj-giveup-to-invalid" onClick={() => {
            if (document.querySelector('[data-testid="lead-verify"]')) { set开(false); set错(null); 去判无效(); }
            else set错(`这条还没走到「线索·${有效线索节点}」：先把进程推到那一步，再在「线索验证」里判无效`);
          }}>去判无效</Button>
        </div>
        {错 && <Alert type="error" showIcon className="giveup-error" title={错} data-testid="proj-giveup-error" />}
      </Modal>
    </>
  );
}
