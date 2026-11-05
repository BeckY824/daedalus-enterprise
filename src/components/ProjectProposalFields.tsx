"use client";

import DatePicker from "@/components/BusinessDatePicker";
import { Select, Input } from "antd";
import { FOLLOW_TYPES } from "@/lib/constants";
import { 币种符号 } from "@/lib/currency";
import { dayjs } from "@/lib/utils";
import { 卡点类型们, 影响等级们 } from "@/lib/project/blocker-rules";
import { 性别们 } from "@/lib/enterprise/customer-v2";
import { 每步能判, 联系人可改, type 项目卡 } from "@/lib/agent/project-proposals";

/**
 * 全页面 AI 的项目类建议卡（project-proposals.ts）在卡片上的那几格。
 *
 * 同名的不止一个时卡上先列候选，人挑一个（挑了把那一个的 补 —— 工具按它算好的落点、验证步、现值 —— 合进卡里）；
 * 挑之前「确认」是灰的（项目卡缺 → 「选哪一个」）。
 * 删除类的只摆名字，不给改；落库时 apply-project.ts 照库里重新认一遍，卡上的值只当人确认过的意图。
 */
export default function ProjectProposalFields({ draft, setDraft }: { draft: 项目卡; setDraft: (p: 项目卡) => void }) {
  const 候 = draft.候选 ?? [];
  const 日 = (v: string) => (v ? dayjs(v) : null);
  const 设 = (patch: Record<string, unknown>) => setDraft({ ...draft, ...patch } as 项目卡);

  return (
    <>
      {候.length > 0 && (
        <F label={draft.targetId ? "选的是" : "选哪一个"} block>
          <Select
            size="small"
            style={{ minWidth: 260 }}
            placeholder={`对上 ${候.length} 个，挑一个`}
            value={draft.targetId || undefined}
            options={候.map((c) => ({ value: c.id, label: c.说明 ? `${c.名}（${c.说明}）` : c.名 }))}
            onChange={(id) => {
              const c = 候.find((x) => x.id === id);
              if (c) setDraft({ ...draft, targetId: c.id, targetName: c.名, ...(c.补 ?? {}) } as 项目卡);
            }}
          />
        </F>
      )}

      {draft.kind === "project_node" && (
        <>
          <F label="去哪一步">
            <span>{draft.到 ? `${draft.到.phase} · ${draft.到.node}${draft.到.result ? ` · ${draft.到.result}` : ""}` : draft.目标 || "—"}</span>
          </F>
          {draft.到?.result === "异常状态" && (
            <F label="异常类别">
              <Select
                size="small"
                style={{ width: 200 }}
                value={draft.异常类别 || undefined}
                placeholder="选一类"
                options={(draft.异常类别们 ?? []).map((v) => ({ value: v, label: v }))}
                onChange={(v) => 设({ 异常类别: v })}
              />
            </F>
          )}
          {!!draft.到?.result && (
            <F label="原因" block>
              <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.原因} onChange={(e) => 设({ 原因: e.target.value })} />
            </F>
          )}
        </>
      )}

      {draft.kind === "project_followup" && (
        <>
          <F label="方式">
            <Select
              size="small"
              style={{ width: 140 }}
              value={draft.type}
              options={FOLLOW_TYPES.filter((t) => t.value !== "TASK" && t.value !== "REMIND").map((t) => ({ value: t.value, label: t.label }))}
              onChange={(v) => 设({ type: v })}
            />
          </F>
          <F label="内容" block>
            <Input.TextArea size="small" autoSize={{ minRows: 2, maxRows: 8 }} value={draft.content} onChange={(e) => 设({ content: e.target.value })} />
          </F>
          <F label="下一步">
            <Input size="small" style={{ width: 240 }} value={draft.下一步} onChange={(e) => 设({ 下一步: e.target.value })} />
          </F>
          <F label={draft.要时间 ? "下一步时间" : "下一步时间（可不填）"}>
            <DatePicker size="small" format="YYYY-MM-DD" value={日(draft.下一步时间)} onChange={(d) => 设({ 下一步时间: d ? d.format("YYYY-MM-DD") : "" })} />
          </F>
          {draft.要卡点 && (
            <>
              <F label="卡点类型">
                <Select size="small" style={{ width: 140 }} value={draft.卡点类型 || undefined} placeholder="选" options={卡点类型们.filter((t) => t !== "暂无卡点").map((v) => ({ value: v, label: v }))} onChange={(v) => 设({ 卡点类型: v })} />
              </F>
              <F label="影响">
                <Select size="small" style={{ width: 140 }} value={draft.影响等级 || undefined} placeholder="可不填" allowClear options={影响等级们.map((v) => ({ value: v, label: v }))} onChange={(v) => 设({ 影响等级: v ?? "" })} />
              </F>
              <F label="卡点描述" block>
                <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.卡点描述} onChange={(e) => 设({ 卡点描述: e.target.value })} />
              </F>
            </>
          )}
        </>
      )}

      {draft.kind === "blocker_resolve" && draft.最后一个 === false && (
        <F label="处理说明（选填）" block>
          <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.result} onChange={(e) => 设({ result: e.target.value })} />
        </F>
      )}

      {draft.kind === "blocker_resolve" && draft.最后一个 !== false && (
        <>
          <F label="解决方案" block>
            <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.solution} onChange={(e) => 设({ solution: e.target.value })} />
          </F>
          <F label="解决结果" block>
            <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.result} onChange={(e) => 设({ result: e.target.value })} />
          </F>
        </>
      )}

      {draft.kind === "payment_add" && (
        <>
          <F label="金额">
            <Input size="small" style={{ width: 140 }} prefix={币种符号(draft.currency)} value={draft.amount || ""} onChange={(e) => 设({ amount: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} />
          </F>
          <F label="回款时间">
            <DatePicker size="small" format="YYYY-MM-DD" value={日(draft.paidAt)} onChange={(d) => 设({ paidAt: d ? d.format("YYYY-MM-DD") : "" })} />
          </F>
        </>
      )}

      {draft.kind === "lead_verify" && (
        <>
          <F label="这一步">
            <span>{draft.步 || "—"}</span>
          </F>
          {draft.步 && (
            <F label="判定">
              <Select size="small" style={{ width: 140 }} value={draft.判 || undefined} placeholder="选" options={每步能判[draft.步].map((v) => ({ value: v, label: v }))} onChange={(v) => 设({ 判: v })} />
            </F>
          )}
          {draft.步 === "初判" && draft.判 === "无效" && (
            <F label="无效原因">
              <Select size="small" style={{ width: 200 }} value={draft.无效原因 || undefined} placeholder="选" options={(draft.无效原因们 ?? []).map((v) => ({ value: v, label: v }))} onChange={(v) => 设({ 无效原因: v })} />
            </F>
          )}
          {draft.判 === "还需培育" && (
            <>
              <F label="下一步时间">
                <DatePicker size="small" format="YYYY-MM-DD" value={日(draft.下一步时间)} onChange={(d) => 设({ 下一步时间: d ? d.format("YYYY-MM-DD") : "" })} />
              </F>
              <F label="计划内容" block>
                <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.计划内容} onChange={(e) => 设({ 计划内容: e.target.value })} />
              </F>
            </>
          )}
          <F label={draft.判 === "异议" ? "说明" : "说明（可不填）"} block>
            <Input.TextArea size="small" autoSize={{ minRows: 1, maxRows: 4 }} value={draft.说明} onChange={(e) => 设({ 说明: e.target.value })} />
          </F>
        </>
      )}

      {draft.kind === "contact_update" &&
        draft.改.map((c, i) => {
          const 改这项 = (v: string) => 设({ 改: draft.改.map((x, j) => (j === i ? { ...x, value: v } : x)) });
          return (
            <F key={c.field} label={联系人可改[c.field]} 现值={draft.现值?.[c.field]} block={c.field === "remark" || c.field === "address"}>
              {c.field === "gender" ? (
                <Select size="small" style={{ width: 90 }} value={c.value || undefined} allowClear options={性别们.map((v) => ({ value: v, label: v }))} onChange={(v) => 改这项(v ?? "")} />
              ) : c.field === "birthday" ? (
                <DatePicker size="small" format="YYYY-MM-DD" value={日(c.value)} onChange={(d) => 改这项(d ? d.format("YYYY-MM-DD") : "")} />
              ) : (
                <Input size="small" style={{ width: 240 }} value={c.value} onChange={(e) => 改这项(e.target.value)} />
              )}
            </F>
          );
        })}

      {(draft.kind === "customer_delete" || draft.kind === "payment_delete") && (
        <F label="删除">
          <span>{draft.targetName || "（先选上面哪一个）"}</span>
        </F>
      )}
    </>
  );
}

/** 和 ProposalCard 的 Field 同一套样式（prop-f），这里不要逐项勾 */
function F({ label, children, block, 现值 }: { label: string; children: React.ReactNode; block?: boolean; 现值?: string }) {
  return (
    <div className={`prop-f${block ? " prop-f-block" : ""}`}>
      <span className="prop-f-l">{label}</span>
      {现值 !== undefined && (
        <span className="prop-f-was">
          {现值 || "空"} <span className="prop-f-arrow">→</span>
        </span>
      )}
      {children}
    </div>
  );
}
