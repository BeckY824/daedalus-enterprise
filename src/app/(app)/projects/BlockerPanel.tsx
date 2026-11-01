"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { App, Button, Card, Input, Modal, Select, Space, Tag, Timeline } from "antd";
import { dayjs, fmtDateTime } from "@/lib/utils";
import type { 卡点卡 } from "@/lib/project/blocker";
import { 卡点类型们, 影响等级们, 动作叫法, 描述上限, 标题上限, 原因最多, 原因名上限, type 卡点默认 } from "@/lib/project/blocker-rules";
import { 发布卡点Action, 认领卡点Action, 完成卡点Action } from "./blocker-actions";

export type { 卡点卡 };

type 结果 = { ok: boolean; error?: string; 解决了?: boolean };

/** 跑一个卡点动作：报错弹出来、成了刷新页面 */
function useRun() {
  const router = useRouter();
  const { message } = App.useApp();
  const [忙, set忙] = useState(false);
  const 跑 = async (f: () => Promise<结果>, 成了: string | ((r: 结果) => string)) => {
    set忙(true);
    try {
      const r = await f();
      if (!r.ok) message.error(r.error ?? "没改成，请稍后再试");
      else {
        message.success(typeof 成了 === "function" ? 成了(r) : 成了);
        router.refresh();
      }
      return r.ok;
    } catch {
      message.error("没改成，请稍后再试");
      return false;
    } finally {
      set忙(false);
    }
  };
  return { 忙, 跑 };
}

export const 状态色: Record<string, string> = { 待接受: "gold", 处理中: "blue", 已解决: "green" };
const 类型色: Record<string, string> = { 暂无卡点: "default", 轻度卡点: "cyan", 中度卡点: "orange", 重要卡点: "red" };

/** 流转一行：「张三 认领」「张三 离职交接 · 张三 → 李四」 */
function 流转文字(l: 卡点卡["流转"][number]): string {
  const 叫 = 动作叫法[l.action] ?? l.action;
  const 路 = l.从 && l.到 ? `${l.从} → ${l.到}` : l.到 ? `给 ${l.到}` : "";
  return [`${l.谁} ${叫}`, 路].filter(Boolean).join(" · ");
}

/**
 * 卡点用了多久（10-27 会议：不设解决时限，只记从出现到解决的实际耗时）：没解决的「已开 N 天」，解决了的「用了 N 天解决」。
 * 不满一天算 1 天；dueAt / dueDays 照旧在库里，界面不显示
 */
export function 耗时文字(b: Pick<卡点卡, "status" | "createdAt" | "resolvedAt">, now: Date = new Date()): string {
  const 止 = b.status === "已解决" && b.resolvedAt ? dayjs(b.resolvedAt) : dayjs(now);
  const 天 = Math.max(1, Math.ceil(止.diff(dayjs(b.createdAt), "hour", true) / 24));
  return b.status === "已解决" && b.resolvedAt ? `用了 ${天} 天解决（${fmtDateTime(b.resolvedAt)}）` : `已开 ${天} 天`;
}

/** 会签那一行：「处理中 2/3 ✓甲 ✓乙 ○丙」；还没人认领 = 「待接受，还没人认领」 */
export function 会签文字(b: Pick<卡点卡, "status" | "进度" | "认领">): string {
  if (!b.认领.length) return `${b.status}，还没人认领`;
  return `${b.status} ${b.进度.完成}/${b.进度.共} ${b.认领.map((c) => `${c.done ? "✓" : "○"}${c.名字}`).join(" ")}`;
}

/** 阻碍原因的多选：下拉是设置里启用的原因，也能现打一个新的（发出去后进「待审核」，总管理员在设置里审） */
export function 原因选择({ 原因们, 值, on改, disabled }: { 原因们: string[]; 值: string[]; on改: (v: string[]) => void; disabled?: boolean }) {
  return (
    <Select
      aria-label="阻碍原因"
      mode="tags"
      maxCount={原因最多}
      disabled={disabled}
      placeholder="阻碍原因（可多选；没有合适的可以直接打字新增）"
      value={值}
      onChange={(v: string[]) => on改([...new Set(v.map((x) => x.trim().slice(0, 原因名上限)).filter(Boolean))])}
      options={原因们.map((t) => ({ value: t, label: t }))}
      style={{ width: "100%", minWidth: 0 }}
    />
  );
}

/**
 * 从一条沟通记录发布卡点：类型、影响、标题、阻碍原因（多选）、描述、资源申请。
 * 不指给谁：发出去是「待接受」，看得到的人都能认领（11-01 定稿 B1/B3）
 */
export function PublishBlockerModal({ followUpId, 默认, 原因们, onClose }: { followUpId: string; 默认: 卡点默认; 原因们: string[]; onClose: () => void }) {
  const { 忙, 跑 } = useRun();
  const [type, setType] = useState<string>(默认.默认类型 === "暂无卡点" ? "轻度卡点" : 默认.默认类型);
  const [impact, setImpact] = useState<string>(默认.默认影响);
  const [title, setTitle] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [resourceRequest, setResourceRequest] = useState("");
  const 差 = !reasons.length ? "选一个阻碍原因" : !description.trim() ? "写一句卡在哪" : "";
  return (
    <Modal
      open
      title="发布卡点"
      okText="发布"
      okButtonProps={{ disabled: !!差, loading: 忙 }}
      onCancel={onClose}
      onOk={async () => {
        if (差) return;
        const ok = await 跑(() => 发布卡点Action(followUpId, { type, impact, title, reasons, description, resourceRequest }), "已发布，等人认领");
        if (ok) onClose();
      }}
    >
      <Space direction="vertical" style={{ width: "100%" }}>
        <Select aria-label="卡点类型" value={type} onChange={(v: string) => setType(v)} options={卡点类型们.filter((t) => t !== "暂无卡点").map((t) => ({ value: t, label: t }))} />
        <Select aria-label="影响等级" value={impact} onChange={(v: string) => setImpact(v)} options={影响等级们.map((t) => ({ value: t, label: t }))} />
        <Input aria-label="卡点标题" maxLength={标题上限} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题（不写就取描述的前 20 个字）" />
        <原因选择 原因们={原因们} 值={reasons} on改={setReasons} />
        <Input.TextArea aria-label="卡点描述" rows={3} maxLength={描述上限} showCount value={description} onChange={(e) => setDescription(e.target.value)} placeholder="卡在哪（必填）" />
        <Input.TextArea aria-label="资源申请" rows={2} maxLength={描述上限} value={resourceRequest} onChange={(e) => setResourceRequest(e.target.value)} placeholder="需要什么资源（可不写）" />
        {差 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{差}</div>}
      </Space>
    </Modal>
  );
}

/** 一条卡点的头：编号、状态、类型、影响、原因（待审核的标出来）、标题 */
export function 卡点头({ b, 带项目 = false }: { b: 卡点卡; 带项目?: boolean }) {
  return (
    <>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)" }}>{b.code}</span>
        <Tag color={状态色[b.status]}>{b.status}</Tag>
        <Tag color={类型色[b.type]}>{b.type}</Tag>
        <Tag>{b.impact}</Tag>
        {b.原因们.map((r) => (
          <Tag key={r.id} color={r.status === "待审核" ? "warning" : undefined} title={r.status === "待审核" ? "新加的原因，等总管理员审核" : undefined} style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
            {r.name}{r.status === "待审核" ? "（待审核）" : ""}
          </Tag>
        ))}
        {带项目 && <Link href={`/projects/${b.projectId}`} style={{ overflowWrap: "anywhere" }}>{b.项目}</Link>}
      </div>
      <div style={{ fontWeight: 600, marginTop: 4, overflowWrap: "anywhere" }}>{b.title}</div>
    </>
  );
}

/**
 * 一串卡点：头 + 描述 + 会签行（x/y、每人打勾）+ 每人的备注；按钮只有「认领」「我已完成」（11-01 定稿：不指认、不转让、不退回）。
 * 最后一个点「我已完成」的人要写解决方案和解决结果，写完卡点就锁成已解决。
 * 项目详情和「我的卡点」共用；带项目 = 卡片上带项目名
 */
export function BlockerList({ 们, 带项目 = false, 空 = "还没有卡点" }: { 们: 卡点卡[]; 带项目?: boolean; 空?: string }) {
  const { 忙, 跑 } = useRun();
  const [完成于, set完成于] = useState<卡点卡 | null>(null);
  const [note, setNote] = useState("");
  const [solution, setSolution] = useState("");
  const [result, setResult] = useState("");
  const [展开, set展开] = useState<Set<string>>(new Set());

  const 开完成 = (b: 卡点卡) => { setNote(""); setSolution(""); setResult(""); set完成于(b); };
  const 最后 = !!完成于?.能.最后一个;
  const 不能确定 = 最后 && (!solution.trim() || !result.trim());
  const 确定 = async () => {
    if (!完成于 || 不能确定) return;
    const ok = await 跑(
      () => 完成卡点Action(完成于.id, { note, ...(最后 ? { solution, result } : {}) }),
      (r) => (r.解决了 ? "大家都完成了，卡点已解决" : "已记下，等其他认领人完成"),
    );
    if (ok) set完成于(null);
  };

  if (!们.length) return <div style={{ color: "var(--text-muted)" }}>{空}</div>;
  return (
    <>
      {们.map((b) => (
        <div key={b.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--line-soft)", minWidth: 0 }}>
          <卡点头 b={b} 带项目={带项目} />
          <div style={{ whiteSpace: "pre-wrap", marginTop: 4, overflowWrap: "anywhere" }}>{b.description}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2, overflowWrap: "anywhere" }}>
            {耗时文字(b)}{" · "}{b.发布人} 发布{b.followUpId ? "" : " · 来源沟通已删除"}
          </div>
          <div style={{ fontSize: 13, marginTop: 4, overflowWrap: "anywhere" }} aria-label="会签进度">{会签文字(b)}</div>
          {b.认领.filter((c) => c.note).map((c) => (
            <div key={c.名字} style={{ fontSize: 13, color: "var(--text-muted)", overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>
              {c.名字}：{c.note}
            </div>
          ))}
          {b.resourceRequest && <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>资源申请：{b.resourceRequest}</div>}
          {b.solution && <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>解决方案：{b.solution}</div>}
          {b.result && <div style={{ fontSize: 13, overflowWrap: "anywhere" }}>解决结果：{b.result}</div>}
          <Space wrap size={4} style={{ marginTop: 6 }}>
            {b.能.认领 && <Button size="small" type="primary" disabled={忙} onClick={() => void 跑(() => 认领卡点Action(b.id), "已认领")}>认领</Button>}
            {b.能.完成 && <Button size="small" type={b.能.认领 ? "default" : "primary"} disabled={忙} onClick={() => 开完成(b)}>我已完成</Button>}
            <Button size="small" type="link" onClick={() => set展开((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}>
              {展开.has(b.id) ? "收起流转" : `流转（${b.流转.length}）`}
            </Button>
          </Space>
          {展开.has(b.id) && (
            <Timeline
              style={{ marginTop: 8 }}
              items={b.流转.map((l) => ({
                color: l.action === "resolve" ? "green" : l.action === "handover" || l.action === "takeover" ? "orange" : "blue",
                content: (
                  <div>
                    <div>{流转文字(l)}</div>
                    {l.note && <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>说明：{l.note}</div>}
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{fmtDateTime(l.at)}</div>
                  </div>
                ),
              }))}
            />
          )}
        </div>
      ))}

      <Modal
        open={!!完成于}
        title={最后 ? "我已完成（最后一位，卡点将标为已解决）" : "我已完成"}
        okText="确定"
        okButtonProps={{ disabled: 不能确定, loading: 忙 }}
        onCancel={() => set完成于(null)}
        onOk={确定}
      >
        <Space direction="vertical" style={{ width: "100%" }}>
          <Input.TextArea aria-label="我的备注" rows={2} maxLength={描述上限} value={note} onChange={(e) => setNote(e.target.value)} placeholder="我这边做了什么（可不写）" />
          {最后 && (
            <>
              <Input.TextArea aria-label="解决方案" rows={3} maxLength={描述上限} value={solution} onChange={(e) => setSolution(e.target.value)} placeholder="解决方案（必填）" />
              <Input.TextArea aria-label="解决结果" rows={2} maxLength={描述上限} value={result} onChange={(e) => setResult(e.target.value)} placeholder="解决结果（必填）" />
            </>
          )}
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>点了就不能撤回；所有认领人都完成后卡点锁定为已解决。</div>
        </Space>
      </Modal>
    </>
  );
}

/** 项目列表顶上：「我的卡点」（我看得到、还没人认领的，和我认领了还没完成的），没有就不显示 */
export function MyBlockersBoard({ 们 }: { 们: 卡点卡[] }) {
  if (!们.length) return null;
  const 待 = 们.filter((b) => b.status === "待接受").length;
  return (
    <Card title={`我的卡点（${们.length}${待 ? `，${待} 条等人认领` : ""}）`} size="small" style={{ marginBottom: 16 }}>
      <BlockerList 们={们} 带项目 />
    </Card>
  );
}
