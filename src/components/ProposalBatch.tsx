"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Checkbox } from "antd";
import { CheckOutlined, CloseOutlined, RightOutlined } from "@ant-design/icons";
import { motion } from "motion/react";
import ProposalCard, { 自动分整句, type 卡况, type 卡句柄 } from "@/components/ProposalCard";
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
 * **人的决定一次都没少**：每一项写不写由那个勾说了算，底部那一下是人点的；没勾的那几张留着待确认，
 * 清单收成「已写入 N 项 · 还有 K 项待确认」，剩下的照样能勾、能确认。只有点「全部忽略」才算忽略。只有 1 张卡时不走这里，照旧单张确认（TurnView）。
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
    const 这批 = 选中.slice();
    set忙("写入");
    /** 按 提交() 的返回值认失败的那几张：渲染时的状态这会儿还没更新，靠不住 */
    const 败: string[] = [];
    try {
      // 逐张、按顺序：每张走它自己的 applyProposal，服务端每张各判一次权限
      for (const p of 这批) {
        const h = 句柄们.current.get(p.id);
        let 成 = false;
        try {
          成 = !!h && (await h.提交());
        } catch {
          成 = false; // 卡片自己已经接住并写了原因；这里兜底，后面的卡照样往下走
        }
        if (!成) 败.push(p.id);
      }
    } finally {
      set忙(null);
    }
    // 没勾的不动：留着待确认，人可以接着勾、接着确认；只有点「全部忽略」才算忽略
    set展开(new Set(败));
    if (败.length) message.warning(`${这批.length - 败.length} 项已写入，${败.length} 项没写进去，原因写在卡上`);
  }

  async function 撤销() {
    const 这批 = 可撤.slice();
    if (!这批.length) return;
    set忙("撤销");
    let 成 = 0;
    try {
      for (const p of 这批) {
        try {
          if (await 句柄们.current.get(p.id)?.撤销()) 成 += 1;
        } catch {
          /* 卡片自己报了错；接着撤下一张 */
        }
      }
    } finally {
      set忙(null);
    }
    set看回执(false);
    if (成) message.success(`已撤销 ${成} 项，回到确认之前`);
  }

  if (在.length === 0) return null;
  const 有写 = 写了.length > 0;
  const 有待 = 待.length > 0;
  const 已写摘要 = 写了.map((p) => describeProposal(p, b.customer, 字段表, b)).join("；");

  /* 待确认和写完两种样子用同一棵树：卡片挂在同一个位置上，换样子时不重挂（重挂会丢掉卡里刚建的那些记号） */
  return (
    <motion.div
      className={`pbat${有待 ? "" : " pbat-done"}`}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 时长.base, ease: 曲线.ease }}
      onKeyDown={(e) => {
        if (有待 && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void 确认();
        }
      }}
    >
      {有写 ? (
        <motion.div key="done" className="pbat-done-h" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 时长.morph, ease: 曲线.morph }}>
          <span className="prop-seal">
            <CheckOutlined /> 已写入 {写了.length} 项
          </span>
          <span className={`pbat-done-t${有待 ? " is-left" : ""}`} title={有待 ? undefined : 已写摘要}>
            {有待 ? `还有 ${待.length} 项待确认` : 已写摘要}
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
        </div>
      )}
      {proposals.map((p, i) => {
        const c = 况(p);
        const 已写 = c?.状态 === "done";
        const 摘要 = describeProposal(p, b.customer, 字段表, b);
        const 开 = 展开.has(p.id);
        /* 写进去的那几张收在「已写入 N 项」那一行里，点「逐项看」才露回执；待确认的照常一行一项 */
        return (
          <div key={p.id} className={`pbat-row${已写 ? " is-done" : ""}${!已写 && !勾.has(p.id) ? " is-off" : ""}`} hidden={c?.状态 === "denied" || (已写 && !看回执)}>
            {!已写 && (
              <div className="pbat-li">
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
                <span className="pbat-n" title={p.reason ? `${摘要}\n${p.reason}` : 摘要}>
                  {摘要}
                </span>
                {c?.后果 && <span className="pbat-tag pbat-tag-warn">确认后自动分出去</span>}
                {c?.不可撤销 && <span className="pbat-tag pbat-tag-warn">不可撤销</span>}
                {c && !c.能确认 && c.缺 && (
                  <span className="pbat-tag" title={c.缺}>
                    {c.缺}
                  </span>
                )}
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
                  {开 ? "收起" : "改"} <RightOutlined className={`pbat-chev${开 ? " is-open" : ""}`} />
                </button>
              </div>
            )}
            <div className="pbat-card" hidden={已写 ? !看回执 : !开}>
              <ProposalCard proposal={p} 记号={记号(p)} 报={收况} 批={批} />
            </div>
          </div>
        );
      })}
      {有待 && (
        <div className="prop-foot">
          <button type="button" className="prop-ok" onClick={() => void 确认()} disabled={!能确认}>
            <CheckOutlined /> {忙 === "写入" ? "写入中…" : `确认选中 ${选中.length} 项${选中后果.length ? `（${选中后果.length} 项自动分出去）` : ""}`}
          </button>
          <button type="button" className="prop-no" disabled={!!忙} onClick={() => 待.forEach((p) => 句柄们.current.get(p.id)?.忽略())}>
            <CloseOutlined /> 全部忽略
          </button>
          {/* 后果整句写在屏上（不只放悬停）：⌘↵ 之前人就看得见 */}
          {选中后果.length > 0 && <span className="prop-consequence">{自动分整句(选中后果.length, true)}</span>}
          <span className="prop-note">
            {选中.length === 0 ? "一项都没选" : 选中缺.length ? `${选中缺.length} 项还没填完，点「改」补上` : <Shortcut>没勾的留着待确认 · 确认前不会写入任何数据 · ⌘↵</Shortcut>}
          </span>
        </div>
      )}
    </motion.div>
  );
}
