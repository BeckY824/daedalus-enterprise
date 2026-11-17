"use client";
/**
 * 客户转让一个框（dt.transfer，P-转-16、P-界面-40）：选接手人、会一起转走的项目、转让原因放进同一个框，不再三个框接力。
 *   - 负责人本人发起（转让要申请）：写明接手人确认后生效、确认前仍在你名下、几天不确认自动作废；发出后框里原地说一句，没有撤销
 *   - 直接转（实线上级、条线总管理、系统管理员）：成了关框，底部撤销条由调用方给
 *   - 原因可不选；点「其他」原地变输入框，要写一句（P-界面-42）
 *   - 服务端挡了：原因写在框里，框不关、不报成功
 *   - 市场成员转「暂不分配」的客户（客户 11-17，给了 自动）：先选「指定分配 / 自动分配」。指定 = 上面这套；
 *     自动 = 不选人，服务端按新线索的自动分配挑销售（按客户区域定内贸 / 外贸、本月分得最少的优先），成了框里原地说分给了谁，没挑到人原因写在框里
 */
import { useEffect, useRef, useState } from "react";
import { Button, Input, Modal, Select } from "antd";
import { 其他项, 其他补充上限, 合其他 } from "@/lib/enterprise/dict-kinds";
import { 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";
import { 动作出错话 } from "@/lib/stale-deploy";

export type 转让结果 = { ok: false; error: string } | { ok: true; 话?: string };
type 方式 = "指定" | "自动";
/** 选了自动分配时「转给」那一格的说明（P-转-26 市场成员按客户区域定事业部；P-转-17 只通知接手人） */
export const 自动分配说明 = "系统挑：按客户区域定事业部（中国大陆 → 内贸，其余含港澳台 → 外贸），挑这条线本月分得最少的销售，不分给销售管理；挑不到人就不转";

export default function TransferBox({
  open,
  客户名,
  候选,
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
  要申请: boolean;
  作废天数: number;
  /** 字典「转让原因」；空 = 不问原因 */
  原因选项: readonly string[];
  取预览: (接手人: string) => Promise<转走项目预览 | null | undefined>;
  做: (o: { value: string; label: string }, 原因: string | null) => Promise<转让结果>;
  /** 市场成员转暂不分配的客户才给：摆「指定分配 / 自动分配」。取预览 = 还没挑人时会一起转走的项目 */
  自动?: { 做: (原因: string | null) => Promise<转让结果>; 取预览: () => Promise<转走项目预览 | null | undefined> };
  onClose: () => void;
}) {
  const [谁, set谁] = useState<string | undefined>();
  const [预览, set预览] = useState<{ 谁: string; 说: ReturnType<typeof 转走项目说法> } | null>(null);
  const [选, set选] = useState<string | null>(null);
  const [写, set写] = useState("");
  const [忙, set忙] = useState(false);
  const [错, set错] = useState("");
  const [发出, set发出] = useState<string | null>(null);
  const [法, set法] = useState<方式>("指定");
  /** 自动分配那份「一起转」：还没挑人，打开选了自动才取一次 */
  const [自动预览, set自动预览] = useState<{ 说: ReturnType<typeof 转走项目说法> } | null>(null);
  const 写框 = useRef<HTMLInputElement>(null);

  // 每次打开从头来
  const [上次开, set上次开] = useState(open);
  if (open !== 上次开) {
    set上次开(open);
    if (open) { set谁(undefined); set预览(null); set选(null); set写(""); set忙(false); set错(""); set发出(null); set法("指定"); set自动预览(null); }
  }
  const 自动中 = !!自动 && 法 === "自动";

  useEffect(() => {
    if (!谁) return;
    let 作废 = false;
    取预览(谁).then((x) => { if (!作废) set预览({ 谁, 说: 转走项目说法(x) }); }, () => { if (!作废) set预览({ 谁, 说: null }); });
    return () => { 作废 = true; };
  }, [谁, 取预览]);

  useEffect(() => {
    if (!open || !自动中 || 自动预览 || !自动) return;
    let 作废 = false;
    自动.取预览().then((x) => { if (!作废) set自动预览({ 说: 转走项目说法(x) }); }, () => { if (!作废) set自动预览({ 说: null }); });
    return () => { 作废 = true; };
  }, [open, 自动中, 自动预览, 自动]);

  const 原因齐 = !选 || 选 !== 其他项 || !!写.trim();
  const 能发 = (自动中 || !!谁) && 原因齐 && !忙;
  const 说 = 自动中 ? 自动预览?.说 ?? null : 预览 && 预览.谁 === 谁 ? 预览.说 : null;
  /** 「一起转」那格：还在取 / 取到了 */
  const 取到了 = 自动中 ? !!自动预览 : !!预览 && 预览.谁 === 谁;

  async function 发() {
    const o = 候选.find((x) => x.value === 谁);
    if (!能发 || (!自动中 && !o)) return;
    set忙(true);
    set错("");
    let r: 转让结果;
    const 因 = 原因选项.length ? 合其他(选, 写) : null;
    try {
      r = 自动中 && 自动 ? await 自动.做(因) : await 做(o!, 因);
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
              options={候选}
              value={谁}
              onChange={(v: string) => set谁(v)}
              aria-label="转给谁"
              disabled={忙}
              className="cd-transfer-v"
            />
            )}
          </div>
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
          {原因选项.length > 0 && (
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
              ? "分出去马上换负责人，名下联系人、项目一起给他；只通知接手人，不用对方确认"
              : 要申请 ? `接手人确认后生效，之前仍在你名下；${作废天数} 天不确认自动作废` : "转了马上换负责人，几秒内可以撤销"}
          </div>
          {错 && <div className="csq-err" role="alert">{错}</div>}
        </div>
      )}
    </Modal>
  );
}
