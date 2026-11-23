"use client";
/**
 * 「放弃（豁免）」那个框（32H；11-21 从 GiveUpBanner 拆出来）：原因三选一（外出 / 忙不过来 / 其他，其他要补一句），确认调 放弃线索Action。
 * 三处同一个框：项目页提示条（GiveUpBanner）、首页置顶条（dashboard/GiveUpHomeTodo）、铃铛里那颗按钮（components/NoticeBell）。
 * 能不能放弃、挑人、扣次数都在服务端（lib/enterprise/lead-giveup.ts 放弃线索）；这里只交原因、把失败那句写在框里。
 * 「去判无效」：项目页上直接打开「线索验证」；首页、铃铛里没有那个框，去项目页（判无效去）
 */
import { useState } from "react";
import { useNavGo } from "@/lib/nav-pending";
import { Alert, Button, Input, Modal, Radio, Space } from "antd";
import { 放弃原因们, 其他原因, 放弃补充上限, 走判无效话, 每月放弃次数, type 放弃后客户 } from "@/lib/enterprise/lead-giveup-core";
import { 有效线索节点 } from "@/lib/project/stage-gates";
import { 放弃线索Action } from "./giveup-actions";

export default function GiveUpDialog({ projectId, 开, 关, 成, 打开判无效, 判无效去 }: {
  projectId: string;
  开: boolean;
  关: () => void;
  /** 放弃成了：接手人名字；客户 = 这条的客户、客户去向（铃铛判当前页要不要离开） */
  成: (接手人: string, 客户: 放弃后客户) => void;
  /** 项目页：打开「线索验证」弹框；这条没有线索验证（还没走到那一步）不传 */
  打开判无效?: () => void;
  /** 首页、铃铛：「去判无效」去哪（项目页） */
  判无效去?: string;
}) {
  /** 去判无效：跳去项目详情，等新页时顶上的条亮（lib/nav-pending.ts） */
  const 去页 = useNavGo();
  const [原因, set原因] = useState<string | null>(null);
  const [补充, set补充] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const 收 = () => { if (!忙) { 关(); set错(null); } };
  const 交 = async () => {
    if (!原因) { set错("先选放弃原因"); return; }
    set忙(true); set错(null);
    try {
      const r = await 放弃线索Action(projectId, 原因, 原因 === 其他原因 ? 补充 : "");
      if (!r.ok) { set错(r.error); return; }
      成(r.接手人, { customerId: r.customerId, 客户去向: r.客户去向 });
    } catch {
      set错("网络没连上，这次没放弃，稍后再点");
    } finally {
      set忙(false);
    }
  };
  return (
    <Modal
      open={开} title="放弃这条线索（豁免）" okText="确认放弃" cancelText="再想想"
      okButtonProps={{ danger: true, loading: 忙, disabled: !原因 || (原因 === 其他原因 && !补充.trim()), ...{ "data-testid": "proj-giveup-ok" } }}
      onCancel={收} onOk={() => void 交()} destroyOnHidden
    >
      <p className="giveup-lead">每人每月只能放弃 {每月放弃次数} 次。确认后这条线索立即转给本线内另一位同事（本月分得最少的先给，接手人照记一次分配），你原来这条照算、不退名额，另给你记 1 条待补。转不出去时不扣次数。</p>
      <div className="giveup-label"><b>放弃原因</b>（必选）</div>
      <Radio.Group value={原因} onChange={(e) => { set原因(e.target.value as string); set补充(""); set错(null); }} data-testid="proj-giveup-reason">
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
          if (打开判无效) { 关(); set错(null); 打开判无效(); }
          else if (判无效去) { 关(); set错(null); 去页.push(判无效去); }
          else set错(`这条还没走到「线索·${有效线索节点}」：先把进程推到那一步，再在「线索验证」里判无效`);
        }}>去判无效</Button>
      </div>
      {错 && <Alert type="error" showIcon className="giveup-error" title={错} data-testid="proj-giveup-error" />}
    </Modal>
  );
}
