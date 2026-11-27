"use client";
/**
 * 客户转让一个框（dt.transfer，P-转-16、P-界面-40）：选接手人、会一起转走的项目、转让原因放进同一个框，不再三个框接力。
 *   - 负责人本人发起（转让要申请）：写明接手人确认后生效、确认前仍在你名下、几天不确认自动作废；发出后框里原地说一句，没有撤销
 *   - 直接转（实线上级、条线总管理、系统管理员）：成了关框，底部撤销条由调用方给
 *   - 原因可不选；点「其他」原地变输入框，要写一句（P-界面-42）
 *   - 服务端挡了：原因写在框里，框不关、不报成功
 *   - 市场成员转「暂不分配」的客户（客户 11-17，给了 自动）：先选「指定分配 / 自动分配」。指定 = 上面这套；
 *     自动 = 不选人，服务端按新线索的自动分配挑销售（按客户区域定内贸 / 外贸、本月分得最少的优先），成了框里原地说分给了谁，没挑到人原因写在框里
 *   - 同一种客户（给了 定向，P-转-26 11-18）：「指定」也先定方向——摆方向格（默认同自动那份顺序、可改），下拉只列这个方向能接的人
 */
import { 指定选项 } from "@/lib/enterprise/designate-options";
import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select } from "antd";
import { 其他项, 其他补充上限, 合其他 } from "@/lib/enterprise/dict-kinds";
import { 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";
import { 逐项选块, 说明框, 默认选, 随转的, type 逐项选择 } from "../TransferItemized";
import { 动作出错话 } from "@/lib/stale-deploy";
import { 自动分配说明, 自动分配生效话 } from "@/lib/enterprise/cust-auto-assign-words";
import { 方向来源说明, 区域未填提示, type 分配方向 } from "@/lib/enterprise/customer-region";
import type { 线 } from "@/lib/enterprise/lead-assign";
import { 按方向挑, 指定方向话, type 指定候选表 } from "@/lib/enterprise/assign-direction-pick-core";

export type 转让结果 = { ok: false; error: string } | { ok: true; 话?: string };
type 方式 = "指定" | "自动";
/** 「转给」那一格的说明、生效那句：和客户列表批量转让框同一套话 */
export { 自动分配说明 } from "@/lib/enterprise/cust-auto-assign-words";

export default function TransferBox({
  open,
  客户名,
  候选,
  定向,
  要申请,
  作废天数,
  原因选项,
  取预览,
  做,
  自动,
  onClose,
}: {
  open: boolean;
  客户名: string;
  候选: { value: string; label: string }[];
  /** 市场成员转暂不分配的客户（P-转-26）：指定分配也按方向挑人。候选表 = 每个方向能接的人（已叠参与正常），默认方向同自动那份 */
  定向?: { 候选表: 指定候选表; 默认方向: 分配方向 };
  要申请: boolean;
  作废天数: number;
  /** 字典「转让原因」；空 = 不问原因 */
  原因选项: readonly string[];
  取预览: (接手人: string) => Promise<转走项目预览 | null | undefined>;
  做: (o: { value: string; label: string }, 原因: string | null, 方向?: 线, 逐项?: { 说明?: string; 随转?: string[] }) => Promise<转让结果>;
  /** 市场成员转暂不分配的客户才给：摆「指定分配 / 自动分配」。取预览 = 还没挑人时会一起转走的项目 */
  自动?: {
    做: (原因: string | null, 方向?: 线) => Promise<转让结果>; 取预览: () => Promise<转走项目预览 | null | undefined>;
    /** 分配方向的默认值和来源（11-18）：框里摆成可改的「内贸 / 外贸」，改了才交；没有 = 不摆这一格 */
    默认方向?: 分配方向 | null;
    /** 选「指定分配」时接手人下拉只列这些人（参与状态正常，审核 11-18 追加；服务端 市场分配指定挡 同口径）；没给 = 不筛 */
    可指定?: string[];
  };
  onClose: () => void;
}) {
  const [谁, set谁] = useState<string | undefined>();
  const [预览, set预览] = useState<{ 谁: string; 说: ReturnType<typeof 转走项目说法>; 原?: 转走项目预览 | null } | null>(null);
  /** 12-22 逐项选：同事在推的项目各选保留 / 随转，默认全保留；上级直接转必填的原因 */
  const [逐项, set逐项] = useState<逐项选择>({});
  const [说明, set说明] = useState("");
  const [选, set选] = useState<string | null>(null);
  const [写, set写] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState("");
  const [发出, set发出] = useState<string | null>(null);
  const [法, set法] = useState<方式>("指定");
  /** 分配方向（11-18）：人改了才有；没改 = 按默认（不交，服务端同顺序算） */
  const [向, set向] = useState<线 | null>(null);
  /** 自动分配那份「一起转」：还没挑人，打开选了自动才取一次 */
  const [自动预览, set自动预览] = useState<{ 说: ReturnType<typeof 转走项目说法> } | null>(null);
  const 写框 = useRef<HTMLInputElement>(null);

  // 每次打开从头来
  const [上次开, set上次开] = useState(open);
  if (open !== 上次开) {
    set上次开(open);
    if (open) { set谁(undefined); set预览(null); set逐项({}); set说明(""); set选(null); set写(""); set忙(false); set错(""); set发出(null); set法("指定"); set自动预览(null); set向(null); }
  }
  const 自动中 = !!自动 && 法 === "自动";
  /** 市场分配（摆了「指定 / 自动」）选指定：只列能被指定的；普通转让照旧 */
  const 列的人 = 自动 ? 指定选项(候选, 自动.可指定, null, 谁) : 候选;
  /** 指定分配也定方向（P-转-26）：这次按哪条线挑人；判不出 = null（两条线都列） */
  const 定向中 = !自动中 && !!定向;
  const 指定线 = 定向中 ? 向 ?? 定向!.默认方向.线 : null;
  const 可挑 = 定向中 ? new Set(按方向挑(定向!.候选表, 指定线)) : null;
  const 列的候选 = 可挑 ? 列的人.filter((o) => 可挑.has(o.value)) : 列的人;

  useEffect(() => {
    if (!谁) return;
    let 作废 = false;
    取预览(谁).then((x) => { if (!作废) { set预览({ 谁, 说: 转走项目说法(x), 原: x }); set逐项(默认选(x)); } }, () => { if (!作废) set预览({ 谁, 说: null }); });
    return () => { 作废 = true; };
  }, [谁, 取预览]);

  useEffect(() => {
    if (!open || !自动中 || 自动预览 || !自动) return;
    let 作废 = false;
    自动.取预览().then((x) => { if (!作废) set自动预览({ 说: 转走项目说法(x) }); }, () => { if (!作废) set自动预览({ 说: null }); });
    return () => { 作废 = true; };
  }, [open, 自动中, 自动预览, 自动]);

  const 原因齐 = !选 || 选 !== 其他项 || !!写.trim();
  const 要说明 = !自动中 && !!谁 && !!预览 && 预览.谁 === 谁 && !!预览.原?.要说明;
  const 能发 = (自动中 || !!谁) && 原因齐 && !忙 && (!要说明 || !!说明.trim());
  const 说 = 自动中 ? 自动预览?.说 ?? null : 预览 && 预览.谁 === 谁 ? 预览.说 : null;
  /** 「一起转」那格：还在取 / 取到了 */
  const 取到了 = 自动中 ? !!自动预览 : !!预览 && 预览.谁 === 谁;

  async function 发() {
    const o = 列的候选.find((x) => x.value === 谁);
    if (!能发 || (!自动中 && !o)) return;
    set忙(true);
    set错("");
    let r: 转让结果;
    const 因 = 原因选项.length && !要说明 ? 合其他(选, 写) : null;
    try {
      r = 自动中 && 自动 ? await 自动.做(因, 向 ?? undefined) : await 做(o!, 因, 定向中 ? 向 ?? undefined : undefined, 要说明 ? { 说明: 说明.trim(), 随转: 随转的(逐项) } : undefined);
    } catch (出错) {
      r = { ok: false, error: 动作出错话(出错, "没转成，请稍后再试") };
    }
    set忙(false);
    if (!r.ok) return void set错(r.error);
    if (r.话) return void set发出(r.话);
    onClose();
  }

  return (
    <Modal
      open={open}
      title={`客户转让 · ${客户名}`}
      width={480}
      onCancel={() => { if (!忙) onClose(); }}
      maskClosable={!忙}
      destroyOnHidden
      className="csq cd-transfer"
      footer={
        <div className="csq-foot">
          {发出 ? (
            <Button type="primary" onClick={onClose}>知道了</Button>
          ) : (
            <>
              <Button onClick={onClose} disabled={忙}>取消</Button>
              <Button type="primary" loading={忙} disabled={!能发 && !忙} onClick={() => void 发()}>{自动中 ? "自动分配" : 要申请 ? "发起转让" : "转让"}</Button>
            </>
          )}
        </div>
      }
    >
      {发出 ? (
        <div role="status" className="cd-transfer-sent">{发出}</div>
      ) : (
        <div className="cd-transfer-body">
          {自动 && (
            <div className="cd-transfer-row">
              <span className="cd-transfer-k">方式</span>
              <div className="cd-transfer-v csq-chips" role="radiogroup" aria-label="分配方式">
                {(["指定", "自动"] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={法 === m} className="csq-chip" disabled={忙}
                    onClick={() => { set法(m); set错(""); }}>
                    {m}分配
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="cd-transfer-row">
            <span className="cd-transfer-k">转给</span>
            {自动中 ? (
              <div className="cd-transfer-v" data-testid="transfer-auto-note"><span className="cd-transfer-mut">{自动分配说明}</span></div>
            ) : (
            <Select
              autoFocus
              showSearch
              optionFilterProp="label"
              placeholder="选接手人"
              options={列的候选}
              value={谁}
              onChange={(v: string) => set谁(v)}
              aria-label="转给谁"
              disabled={忙}
              className="cd-transfer-v"
            />
            )}
          </div>
          {/* 指定分配的方向（P-转-26，11-18）：同下面自动那格，默认同一顺序、可改；换了方向，挑的人不在新方向里就清掉 */}
          {定向中 && (() => {
            const 默认 = 定向!.默认方向;
            return (
              <div className="cd-transfer-row">
                <span className="cd-transfer-k">分配方向</span>
                <div className="cd-transfer-v">
                  <Select className="dir-select-w120" placeholder="内贸 / 外贸" aria-label="分配方向" data-testid="transfer-direction" disabled={忙}
                    value={指定线 ?? undefined} options={(["内贸", "外贸"] as const).map((v) => ({ value: v, label: v }))}
                    onChange={(v: 线) => { set向(v); if (谁 && !按方向挑(定向!.候选表, v).includes(谁)) set谁(undefined); }} />
                  <div className={指定线 ? "cd-transfer-mut" : "cd-transfer-mut cd-transfer-warn"} data-testid="transfer-direction-why">
                    {向 && 向 !== 默认.线 ? `你改成了${向}（默认${默认.线 ? 方向来源说明(默认) : "不限"}）` : 默认.线 ? 方向来源说明(默认) : 区域未填提示}；{指定方向话(指定线)}
                  </div>
                </div>
              </div>
            );
          })()}
          {/* 分配方向（11-18）：默认按客户区域 → 电话 → 我的事业部，可以改；改了才交，没改服务端按同一顺序算 */}
          {自动中 && 自动?.默认方向 !== undefined && (() => {
            const 默认 = 自动.默认方向 ?? { 线: null, 来源: "不限" as const };
            return (
              <div className="cd-transfer-row">
                <span className="cd-transfer-k">分配方向</span>
                <div className="cd-transfer-v">
                  <Select className="dir-select-w120" placeholder="内贸 / 外贸" aria-label="分配方向" data-testid="transfer-direction" disabled={忙}
                    value={向 ?? 默认.线 ?? undefined} options={(["内贸", "外贸"] as const).map((v) => ({ value: v, label: v }))} onChange={(v: 线) => set向(v)} />
                  <div className={向 || 默认.线 ? "cd-transfer-mut" : "cd-transfer-mut cd-transfer-warn"} data-testid="transfer-direction-why">
                    {向 && 向 !== 默认.线 ? `你改成了${向}（默认${默认.线 ? 方向来源说明(默认) : "不限"}）` : 默认.线 ? 方向来源说明(默认) : 区域未填提示}
                  </div>
                </div>
              </div>
            );
          })()}
          <div className="cd-transfer-row">
            <span className="cd-transfer-k">一起转</span>
            <div className="cd-transfer-v" data-testid="transfer-carry">
              {!自动中 && !谁 ? <span className="cd-transfer-mut">选了接手人再看</span> : !取到了 ? <span className="cd-transfer-mut">在看名下项目</span> : !说 ? (
                <span className="cd-transfer-mut">名下没有要一起转的项目</span>
              ) : (
                <>
                  <div className="cd-transfer-t">{说.标题}</div>
                  <ul className="cd-transfer-list">{说.行.map((l, i) => <li key={i} title={l}>{l}</li>)}</ul>
                  {说.还有 && <div className="cd-transfer-mut">{说.还有}</div>}
                  {说.同事 && <div className="cd-transfer-mut">{说.同事}</div>}
                </>
              )}
            </div>
          </div>
          {要说明 && (
            <div className="cd-transfer-row">
              <span className="cd-transfer-k">同事项目</span>
              <div className="cd-transfer-v">
                {预览?.原?.同事在推?.length ? <逐项选块 预览={预览.原} 选={逐项} 改={set逐项} 忙={忙} /> : <span className="cd-transfer-mut">没有同事在推的项目要选</span>}
              </div>
            </div>
          )}
          {要说明 && (
            <div className="cd-transfer-row">
              <span className="cd-transfer-k">原因</span>
              <div className="cd-transfer-v"><说明框 预览={预览?.原} 值={说明} 改={set说明} 忙={忙} onEnter={() => void 发()} /></div>
            </div>
          )}
          {!自动中 && 谁 && 预览 && 预览.谁 === 谁 && !预览.原?.要说明 && 要申请 && (
            <div className="cd-transfer-row">
              <span className="cd-transfer-k">同事项目</span>
              <div className="cd-transfer-v cd-transfer-mut" data-testid="transfer-colleague-note">同事在推的项目不随客户转；要带请上级在转让时勾。</div>
            </div>
          )}
          {原因选项.length > 0 && !要说明 && (
            <div className="cd-transfer-row">
              <span className="cd-transfer-k">原因</span>
              <div className="cd-transfer-v csq-why" role="radiogroup" aria-label="转让原因（可不选）">
                <div className="csq-chips">
                  {原因选项.map((o) => (
                    <button key={o} type="button" role="radio" aria-checked={选 === o} className="csq-chip" disabled={忙}
                      onClick={() => { set选(选 === o ? null : o); set错(""); if (o === 其他项) requestAnimationFrame(() => 写框.current?.focus()); }}>
                      {o}
                    </button>
                  ))}
                </div>
                {选 === 其他项 && (
                  <Input ref={(r) => { 写框.current = r?.input ?? null; }} className="csq-other" maxLength={其他补充上限} showCount disabled={忙}
                    placeholder="具体是什么（必填）" aria-label="转让原因：其他的具体内容" value={写} onChange={(e) => set写(e.target.value)} />
                )}
              </div>
            </div>
          )}
          <div className="cd-transfer-cq">
            {自动中
              ? 自动分配生效话
              : 要申请 ? `接手人确认后生效，之前仍在你名下；${作废天数} 天不确认自动作废` : "转了马上换负责人，几秒内可以撤销"}
          </div>
          {错 && <div className="csq-err" role="alert">{错}</div>}
        </div>
      )}
    </Modal>
  );
}
