"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Dropdown, Input, Modal } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import type { 三态条, 三态条按钮 } from "@/lib/enterprise/tri-state-detail";
import { fmtDateTime } from "@/lib/utils";
import { 三态继续持有, 三态暂缓回收, 三态让同事结束项目 } from "../tri-state-actions";
import { 三态显示名 } from "@/lib/enterprise/tri-state-label";

const 标签色 = { 沉睡: "sleep", 待回收: "pend", 暂缓回收中: "hold" } as const;

/**
 * 客户三态状态条（P-界面-19 ③，构想页 C10）：客户名一行下面，属于客户层；只在沉睡 / 待回收 / 暂缓回收中时由服务端给，活跃什么都不摆。
 * 按钮给不给、悬停那段话都是服务端算好的（lib/enterprise/tri-state-detail.ts），这里只画、点了调现有动作、成了刷新。
 * 一行不换行：文字放不下省略号（悬停看全）；按钮多、窄的时候只留主按钮，其余收进「更多」（CSS 容器查询，globals.css .tri-bar）
 */
export default function TriStateBar({ 条, customerId, 开客户转让 }: { 条: 三态条; customerId: string; 开客户转让: (() => void) | null }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [框, set框] = useState<三态条按钮 | null>(null);
  const [理由, set理由] = useState("");
  const [忙, set忙] = useState(false);
  // 客户转让走页头那个框；页头没给（我不能转）就不摆这颗
  const 钮们 = 条.按钮们.filter((b) => b.动作 !== "客户转让" || 开客户转让);
  const 次 = 钮们.filter((b) => !b.主);
  const 主 = 钮们.find((b) => b.主);

  const 点 = (b: 三态条按钮) => {
    if (b.动作 === "客户转让") return 开客户转让?.();
    set理由("");
    set框(b);
  };
  const 确定 = async () => {
    if (!框) return;
    const 话 = 理由.trim();
    if (框.要理由 && !话) return void message.warning("请写理由");
    set忙(true);
    try {
      const r = 框.动作 === "继续持有" ? await 三态继续持有(customerId, 话 || null)
        : 框.动作 === "暂缓回收" ? await 三态暂缓回收(customerId, 话 || null)
        : await 三态让同事结束项目(customerId);
      if (!r.ok) return void message.error(r.error);
      message.success(框.动作 === "继续持有" ? `已顺延${r.剩次数 != null ? `，还可用 ${r.剩次数} 次` : ""}` : 框.动作 === "暂缓回收" ? "已暂缓回收" : `已通知${r.通知了 ? ` ${r.通知了} 位` : ""}同事`);
      set框(null);
      router.refresh();
    } catch {
      message.error("没办成，请刷新后重试");
    } finally {
      set忙(false);
    }
  };
  const 钮 = (b: 三态条按钮, cls?: string) => (
    <Button key={b.动作} size="small" type={b.主 ? "primary" : "default"} className={cls} title={b.说明} onClick={() => 点(b)}>{b.字}</Button>
  );

  return (
    <div className={`tri-bar ${标签色[条.状态]}`} data-testid="tri-state-bar" role="status">
      <span className={`tri-st ${标签色[条.状态]}`}>{三态显示名(条.状态)}</span>
      <span className="tri-tx" title={条.悬停}>{条.文字}</span>
      <span className="tri-sp" />
      {条.旁注 && <span className="tri-note" title={条.旁注}>{条.旁注}</span>}
      {钮们.length > 0 && (
        <span className="tri-acts">
          {次.map((b) => 钮(b, "tri-sec"))}
          {次.length > 0 && (
            <Dropdown trigger={["click"]} menu={{ items: 次.map((b) => ({ key: b.动作, label: <span title={b.说明}>{b.字}</span>, onClick: () => 点(b) })) }}>
              <Button size="small" className="tri-more" icon={<MoreOutlined />} aria-label="更多">更多</Button>
            </Dropdown>
          )}
          {主 && 钮(主)}
        </span>
      )}
      {框 && (
        <Modal open title={框.字} okText={框.字} cancelText="取消" confirmLoading={忙} onOk={() => void 确定()} onCancel={() => set框(null)} width={480}>
          <p className="tri-dlg-note">{框.说明}</p>
          {框.动作 !== "让同事结束项目" && (
            <Input.TextArea
              value={理由}
              onChange={(e) => set理由(e.target.value)}
              maxLength={500}
              autoSize={{ minRows: 2, maxRows: 5 }}
              placeholder={框.要理由 ? "必填：为什么还要留着这位客户" : "可以写一句（选填）"}
              aria-label="理由"
            />
          )}
        </Modal>
      )}
    </div>
  );
}

/**
 * 「进程变更」卡里的「客户状态」一段（C13，用户 11-12 选「并进现有的进程变更卡」）：客户层的状态留痕（状态变化、继续持有、暂缓回收、
 * 换负责人归零、撤销转让），新的在前，每条一行（时间、谁、什么事），放不下省略号、悬停看全。默认收起；切项目页签不变（客户层）
 */
export function TriStateLog({ 行们 }: { 行们: { at: string; 谁: string; 事: string }[] }) {
  const [开, set开] = useState(false);
  return (
    <div className="tri-log">
      <button type="button" className="tri-log-h" aria-expanded={开} onClick={() => set开((x) => !x)}>
        <span>客户状态</span>
        <span className="tri-log-n">{行们.length} 条 {开 ? "▾" : "▸"}</span>
      </button>
      {开 && (
        行们.length ? (
          <ul className="tri-log-ul">
            {行们.map((x, i) => {
              const 时 = fmtDateTime(x.at);
              return (
                <li key={`${x.at}-${i}`} className="tri-log-li" title={`${时} · ${x.谁} · ${x.事}`}>
                  <span className="tri-log-t">{时}</span>
                  <span className="tri-log-w">{x.谁}</span>
                  <span className="tri-log-e">{x.事}</span>
                </li>
              );
            })}
          </ul>
        ) : <div className="tri-log-empty">还没有客户状态的变化</div>
      )}
    </div>
  );
}
