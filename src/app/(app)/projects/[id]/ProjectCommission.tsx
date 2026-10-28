"use client";

/**
 * 企业版提成卡（2026-10-26）：成交金额、项目底价、项目溢价、预估提成、实际提成，和组长分给组员的比例。
 * 只有服务端给了 提成（企业版 + 看得了）才挂上；项目底价只有项目负责人填，改分配给组长和管理员（服务端再查一遍）；
 * 已固定的实际提成只有总管理员能更正（10-27，要写原因）
 */
import { useState } from "react";
import { Button, Card, Input, InputNumber, Modal, Space, Tag } from "antd";
import { 金额 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { 两位, 分配问题, 更正问题, 更正原因上限, type 提成卡, type 分配 } from "@/lib/project/commission";
import { 存项目底价, 存提成分配, 更正实际提成 } from "../commission-actions";

type 跑法 = (f: () => Promise<{ ok: boolean; error?: string }>, 成了?: string) => Promise<boolean>;

const 行样: React.CSSProperties = { display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8, minWidth: 0, flexWrap: "wrap" };
const 键样: React.CSSProperties = { color: "var(--text-muted)", flex: "0 0 64px" };
const 淡: React.CSSProperties = { color: "var(--text-muted)" };

export function ProjectCommissionCard({ projectId, t, 忙, 跑 }: { projectId: string; t: 提成卡; 忙: boolean; 跑: 跑法 }) {
  const [底价, set底价] = useState<number | null>(t.项目底价);
  const [分开着, set分开着] = useState(false);
  const [更正开着, set更正开着] = useState(false);
  const 钱 = (n: number | null | undefined) => (n == null ? "—" : 金额(n, t.币种));
  const 用的 = t.实际 ?? t.预估;
  const 固定了 = !!t.实际;
  const 底价能改 = t.能填底价 && !固定了;

  return (
    <Card title="提成" extra={固定了 ? <Tag color="green">实际提成已固定</Tag> : <Tag>预估</Tag>}>
      <div style={行样}><span style={键样}>成交金额</span>{钱(t.实际?.成交金额 ?? t.成交金额)}{固定了 && t.实际!.成交金额 !== t.成交金额 && <span style={淡}>（现在项目金额 {钱(t.成交金额)}）</span>}</div>
      <div style={行样}>
        <span style={键样}>项目底价</span>
        {底价能改 ? (
          <Space.Compact>
            <InputNumber<number> aria-label="项目底价" min={0} precision={2} formatter={金额格式} style={{ width: 160 }} placeholder="还没填" value={底价} onChange={(v) => set底价(v ?? null)} />
            <Button disabled={忙 || 底价 === t.项目底价} onClick={() => void 跑(() => 存项目底价(projectId, 底价), "已存项目底价")}>保存</Button>
          </Space.Compact>
        ) : (
          <span title={t.能填底价 && 固定了 ? "已经赢单，实际提成已固定，不能再改" : "项目底价由项目负责人填"}>{钱(t.实际?.项目底价 ?? t.项目底价)}</span>
        )}
      </div>
      <div style={行样}><span style={键样}>项目溢价</span>{用的 ? 钱(用的.项目溢价) : "—"}{用的 && 用的.项目溢价 === 0 && 用的.成交金额 < 用的.项目底价 && <span style={淡}>（成交金额低于底价，溢价算 0）</span>}</div>
      <div style={行样}>
        <span style={键样}>预估提成</span>
        {t.预估 ? <span>{钱(t.预估.合计)} <span style={淡}>= 底价 × {t.比例.底价比例}%（{钱(t.预估.底价提成)}）+ 溢价 × {t.比例.溢价比例}%（{钱(t.预估.溢价提成)}），{t.单设 === "全部" ? "按负责人单设的比例" : t.单设 === "部分" ? `按负责人单设的比例（没设的那项按${t.范围}）` : `按${t.范围}比例`}</span></span> : <span style={淡}>填了项目底价才算得出来</span>}
      </div>
      <div style={行样}>
        <span style={键样}>实际提成</span>
        {t.实际
          ? <span>{钱(t.实际.合计)} <span style={淡}>{t.实际.按算式 != null
              ? `（总管理员已更正；按算式是 ${钱(t.实际.按算式)}）`
              : `（赢单时按 底价 ${t.实际.比例.底价比例}% / 溢价 ${t.实际.比例.溢价比例}% 固定）`}</span></span>
          : <span style={淡}>赢单（进到订单阶段）时固定{t.项目底价 == null ? "；底价要先填" : ""}</span>}
        {t.能更正 && <Button type="link" size="small" disabled={忙} onClick={() => set更正开着(true)}>更正</Button>}
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <strong>分配</strong>
        {t.能改 && <Button type="link" size="small" disabled={忙} onClick={() => set分开着(true)}>改分配</Button>}
      </div>
      {t.每人.map((x) => (
        <div key={x.userId} style={{ ...行样, marginBottom: 4 }}>
          <span style={{ flex: "1 1 120px", minWidth: 0, overflowWrap: "anywhere" }}>{x.name}{x.组长 && <Tag style={{ marginLeft: 6 }}>组长</Tag>}</span>
          <span style={{ flex: "0 0 64px", textAlign: "right" }}>{x.比例}%</span>
          <span style={{ flex: "0 0 auto", minWidth: 96, textAlign: "right" }}>{钱(x.金额)}</span>
        </div>
      ))}
      <div style={{ ...淡, marginTop: 4 }}>组长把提成按比例分给已进组的组员，剩下的归组长{固定了 ? "" : "；金额按预估算，赢单后按实际提成算"}</div>

      {分开着 && <SplitModal projectId={projectId} t={t} 跑={跑} onClose={() => set分开着(false)} />}
      {更正开着 && t.实际 && <FixModal projectId={projectId} 现在={t.实际.合计} 钱={钱} 跑={跑} onClose={() => set更正开着(false)} />}
    </Card>
  );
}

function SplitModal({ projectId, t, 跑, onClose }: { projectId: string; t: 提成卡; 跑: 跑法; onClose: () => void }) {
  const [分, set分] = useState<分配>(() => ({ ...t.分配 }));
  const [忙, set忙] = useState(false);
  const 给出去 = 两位(Object.values(分).reduce((a, v) => a + Math.round((v || 0) * 100), 0) / 100);
  const 问题 = 分配问题(Object.fromEntries(Object.entries(分).filter(([, v]) => v != null)));
  return (
    <Modal
      open title="改提成分配" okText="保存" cancelText="取消" onCancel={onClose}
      okButtonProps={{ disabled: !!问题 || 忙, loading: 忙 }}
      onOk={async () => {
        set忙(true);
        const ok = await 跑(() => 存提成分配(projectId, 分), "已存提成分配");
        set忙(false);
        if (ok) onClose();
      }}
    >
      {t.组员.length === 0 ? (
        <div style={淡}>项目组里还没有已进组的组员（邀请要对方同意了才算），提成全归组长</div>
      ) : (
        t.组员.map((m) => (
          <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
            <span style={{ flex: "1 1 auto", minWidth: 0, overflowWrap: "anywhere" }}>{m.name}</span>
            <InputNumber<number> aria-label={`${m.name}的提成比例`} min={0} max={100} precision={2} suffix="%" style={{ width: 120 }}
              value={分[m.userId] ?? 0} onChange={(v) => set分((o) => ({ ...o, [m.userId]: v ?? 0 }))} />
          </div>
        ))
      )}
      <div style={{ marginTop: 8, color: 问题 ? "var(--danger-text)" : "var(--text-muted)" }}>
        {问题 ?? `分出去 ${给出去}%，组长留 ${两位(100 - 给出去)}%`}
      </div>
    </Modal>
  );
}

function FixModal({ projectId, 现在, 钱, 跑, onClose }: { projectId: string; 现在: number; 钱: (n: number) => string; 跑: 跑法; onClose: () => void }) {
  const [金额, set金额] = useState<number | null>(现在);
  const [原因, set原因] = useState("");
  const [忙, set忙] = useState(false);
  const 问题 = 更正问题(金额, 原因);
  return (
    <Modal
      open title="更正已固定提成" okText="更正" cancelText="取消" onCancel={onClose}
      okButtonProps={{ disabled: !!问题 || 金额 === 现在 || 忙, loading: 忙 }}
      onOk={async () => {
        set忙(true);
        const ok = await 跑(() => 更正实际提成(projectId, 金额, 原因), "已更正实际提成");
        set忙(false);
        if (ok) onClose();
      }}
    >
      <div style={{ ...淡, marginBottom: 12 }}>现在的实际提成 {钱(现在)}。更正后组员按原来的比例分新金额，操作记录里留更正前后的金额和原因</div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ flex: "0 0 auto" }}>更正为</span>
        <InputNumber<number> aria-label="更正后的实际提成" min={0} precision={2} formatter={金额格式} style={{ width: 180 }} value={金额} onChange={(v) => set金额(v ?? null)} />
      </div>
      <Input.TextArea aria-label="更正原因" rows={3} maxLength={更正原因上限} showCount placeholder="更正原因（必填），比如：回款少了一笔，按实收重算" value={原因} onChange={(e) => set原因(e.target.value)} />
    </Modal>
  );
}
