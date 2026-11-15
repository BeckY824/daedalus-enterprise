"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Checkbox } from "antd";
import { CheckOutlined, CloseOutlined, RightOutlined } from "@ant-design/icons";
import { motion } from "motion/react";
import ProposalCard, { type 卡况, type 卡句柄 } from "@/components/ProposalCard";
import Shortcut from "@/components/Shortcut";
import { describeProposal, 可改字段表, type Proposal } from "@/lib/agent/proposals";
import { useBusiness } from "@/lib/business-client";
import { 建议结果 } from "@/lib/ai-jobs";
import { useMotionTheme } from "@/components/MotionTheme";

/**
 * 合并确认（2026-11-15）：同一轮回答出了 ≥2 张建议卡，收成一张「待确认 N 项」清单。
 *
 *   每行  一个勾 + 一行摘要（放不下省略号 + 悬停）+「改」：展开就是原来那张卡，字段就地改
 *   底部  「确认选中 N 项」（⌘↵），逐张调用卡片自己那套确认（applyProposal），不并发、不绕路
 *   写完  收成一行「已写入 N 项 · 撤销」；撤销逐张调用卡片自己那套撤销（undoProposal，只认本人、限时，规则一行没动）
 *
 * **人的决定一次都没少**：每一项写不写由那个勾说了算，底部那一下是人点的；没勾的那几张算「忽略」，
 * 和单张卡上点忽略同一个结果。只有 1 张卡时不走这里，照旧单张确认（TurnView）。
 *
 * 卡片一直挂着（收起时只是藏起来）：草稿里改过的字段、记号恢复的状态都在卡里，卸掉就丢了。
 */
export default function ProposalBatch({ proposals, 记号前缀, 报 }: { proposals: Proposal[]; 记号前缀: string; 报?: (id: string, 况: 卡况) => void }) {
  const b = useBusiness();
  const { message } = App.useApp();
  const { 曲线, 时长 } = useMotionTheme();
  const 字段表 = 可改字段表(b);
  const 记号 = useCallback((p: Proposal) => `${记号前缀}:${p.id}`, [记号前缀]);
  /* 卡片报上来之前先按任务表里记着的结果画，免得重挂时清单闪一下 */
  const [况们, set况们] = useState<Record<string, 卡况>>(() =>
    Object.fromEntries(
      proposals.map((p) => {
        const 结果 = 建议结果(记号(p));
        return [p.id, { 状态: 结果 ?? "idle", 能确认: true, 缺: "", 能撤: false, 不可撤销: false } satisfies 卡况];
      }),
    ),
  );
  const [勾, set勾] = useState<Set<string>>(() => new Set(proposals.map((p) => p.id)));
  const [展开, set展开] = useState<Set<string>>(() => new Set());
  const [看回执, set看回执] = useState(false);
  const [忙, set忙] = useState<"写入" | "撤销" | null>(null);
  const 句柄们 = useRef(new Map<string, 卡句柄>());
  const 报Ref = useRef(报);
  useEffect(() => {
    报Ref.current = 报;
  });

  const 交句柄 = useCallback((id: string, h: 卡句柄 | null) => {
    if (h) 句柄们.current.set(id, h);
    else 句柄们.current.delete(id);
  }, []);
  const 批 = useMemo(() => ({ 交句柄 }), [交句柄]);
  const 收况 = useCallback((id: string, 况: 卡况) => {
    set况们((m) => ({ ...m, [id]: 况 }));
    报Ref.current?.(id, 况);
  }, []);

  const 况 = (p: Proposal) => 况们[p.id];
  const 在 = proposals.filter((p) => 况(p)?.状态 !== "denied");
  const 待 = 在.filter((p) => 况(p)?.状态 === "idle" || 况(p)?.状态 === "saving");
  const 写了 = 在.filter((p) => 况(p)?.状态 === "done");
  const 选中 = 待.filter((p) => 勾.has(p.id));
  const 选中缺 = 选中.filter((p) => !况(p)?.能确认);
  const 选中后果 = 选中.filter((p) => 况(p)?.后果);
  const 能确认 = !忙 && 选中.length > 0 && 选中缺.length === 0;
  const 可撤 = 写了.filter((p) => 况(p)?.能撤);

  async function 确认() {
    if (!能确认) return;
    set忙("写入");
    let 失败 = 0;
    // 逐张、按顺序：每张走它自己的 applyProposal，服务端每张各判一次权限
    for (const p of 选中) {
      const h = 句柄们.current.get(p.id);
      if (!h || !(await h.提交())) 失败 += 1;
    }
    if (失败 === 0) {
      // 都写进去了：没勾的那几张就是人说了不要，按「忽略」收掉
      for (const p of 待) if (!勾.has(p.id)) 句柄们.current.get(p.id)?.忽略();
    } else {
      // 有没写进去的：展开它们，卡上写着原因，人改完再点一次
      set展开(new Set(选中.filter((p) => 况们[p.id]?.状态 !== "done").map((p) => p.id)));
      message.warning(`${选中.length - 失败} 项已写入，${失败} 项没写进去，原因写在卡上`);
    }
    set忙(null);
  }

  async function 撤销() {
    if (!可撤.length) return;
    set忙("撤销");
    let 成 = 0;
    for (const p of 可撤) if (await 句柄们.current.get(p.id)?.撤销()) 成 += 1;
    set忙(null);
    set看回执(false);
    if (成) message.success(`已撤销 ${成} 项，回到确认之前`);
  }

  if (在.length === 0) return null;
  const 都结了 = 待.length === 0 && 写了.length > 0;
  const 已写摘要 = 写了.map((p) => describeProposal(p, b.customer, 字段表, b)).join("；");

  /* 待确认和写完两种样子用同一棵树：卡片挂在同一个位置上，换样子时不重挂（重挂会丢掉卡里刚建的那些记号） */
  return (
    <motion.div
      className={`pbat${都结了 ? " pbat-done" : ""}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 时长.base, ease: 曲线.ease }}
      onKeyDown={(e) => {
        if (!都结了 && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void 确认();
        }
      }}
    >
      {都结了 ? (
        <motion.div key="done" className="pbat-done-h" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 时长.morph, ease: 曲线.morph }}>
          <span className="prop-seal">
            <CheckOutlined /> 已写入 {写了.length} 项
          </span>
          <span className="pbat-done-t" title={已写摘要}>
            {已写摘要}
          </span>
          {可撤.length > 0 && (
            <button type="button" className="cli-link" onClick={() => void 撤销()} disabled={!!忙}>
              {忙 === "撤销" ? "撤销中…" : 可撤.length === 写了.length ? "撤销" : `撤销其中 ${可撤.length} 项`}
            </button>
          )}
          <button type="button" className="cli-link pbat-more" aria-expanded={看回执} onClick={() => set看回执((v) => !v)}>
            {看回执 ? "收起" : "逐项看"}
          </button>
        </motion.div>
      ) : (
        <div className="pbat-h">
          <span className="prop-tag">AI 草稿</span>
          <span className="pbat-h-t">待确认 {待.length} 项</span>
          {写了.length > 0 && <span className="pbat-h-n">另有 {写了.length} 项已写入</span>}
        </div>
      )}
      {proposals.map((p, i) => {
        const c = 况(p);
        const 已写 = c?.状态 === "done";
        const 摘要 = describeProposal(p, b.customer, 字段表, b);
        const 开 = 展开.has(p.id);
        const 露卡 = 都结了 ? 看回执 : 开;
        return (
          <div key={p.id} className={`pbat-row${已写 ? " is-done" : ""}${!已写 && !勾.has(p.id) ? " is-off" : ""}`} hidden={c?.状态 === "denied" || (都结了 && !看回执)}>
            {!都结了 && (
              <div className="pbat-li">
                {已写 ? (
                  <span className="pbat-ok" aria-label="已写入">
                    <CheckOutlined />
                  </span>
                ) : (
                  <Checkbox
                    checked={勾.has(p.id)}
                    disabled={!!忙}
                    aria-label={`确认这一项：${摘要}`}
                    onChange={(e) =>
                      set勾((s) => {
                        const n = new Set(s);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })
                    }
                  />
                )}
                <span className="pbat-n" title={p.reason ? `${摘要}\n${p.reason}` : 摘要}>
                  {摘要}
                </span>
                {!已写 && c?.后果 && (
                  <span className="pbat-tag pbat-tag-warn" title={c.后果}>
                    确认后自动分出去
                  </span>
                )}
                {!已写 && c?.不可撤销 && <span className="pbat-tag pbat-tag-warn">不可撤销</span>}
                {!已写 && c && !c.能确认 && c.缺 && (
                  <span className="pbat-tag" title={c.缺}>
                    {c.缺}
                  </span>
                )}
                {已写 && <span className="pbat-tag">已写入</span>}
                <button
                  type="button"
                  className="cli-link pbat-edit"
                  aria-expanded={开}
                  aria-label={`${开 ? "收起" : "展开"}第 ${i + 1} 项`}
                  onClick={() =>
                    set展开((s) => {
                      const n = new Set(s);
                      if (n.has(p.id)) n.delete(p.id);
                      else n.add(p.id);
                      return n;
                    })
                  }
                >
                  {开 ? "收起" : 已写 ? "查看" : "改"} <RightOutlined className={`pbat-chev${开 ? " is-open" : ""}`} />
                </button>
              </div>
            )}
            <div className="pbat-card" hidden={!露卡}>
              <ProposalCard proposal={p} 记号={记号(p)} 报={收况} 批={批} />
            </div>
          </div>
        );
      })}
      {!都结了 && (
        <div className="prop-foot">
          <button type="button" className="prop-ok" onClick={() => void 确认()} disabled={!能确认} title={选中后果.length ? 况(选中后果[0])?.后果 : undefined}>
            <CheckOutlined /> {忙 === "写入" ? "写入中…" : `确认选中 ${选中.length} 项${选中后果.length ? `（${选中后果.length} 项自动分出去）` : ""}`}
          </button>
          <button type="button" className="prop-no" disabled={!!忙} onClick={() => 待.forEach((p) => 句柄们.current.get(p.id)?.忽略())}>
            <CloseOutlined /> 全部忽略
          </button>
          <span className="prop-note">
            {选中.length === 0 ? "一项都没选" : 选中缺.length ? `${选中缺.length} 项还没填完，点「改」补上` : <Shortcut>没勾的算忽略 · 确认前不会写入任何数据 · ⌘↵</Shortcut>}
          </span>
        </div>
      )}
    </motion.div>
  );
}
