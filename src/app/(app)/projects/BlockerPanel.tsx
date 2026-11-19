"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Input, Modal, Select, Space, Tag, Timeline } from "antd";
import InlineConfirm from "@/components/InlineConfirm";
import SaveButton from "@/components/SaveButton";
import { dayjs, fmtDateTime } from "@/lib/utils";
import type { 卡点卡 } from "@/lib/project/blocker";
import { 卡点类型们, 影响等级们, 动作叫法, 描述上限, 原因最多, 缺原因话, 清原因们, type 卡点默认 } from "@/lib/project/blocker-rules";
import { 发布卡点Action, 认领卡点Action, 完成卡点Action, 删卡点Action } from "./blocker-actions";
import { useFormDraft } from "@/components/FormDraft";
import { 有字 } from "@/lib/form-draft";
import { 动作出错话 } from "@/lib/stale-deploy";

export type { 卡点卡 };

type 结果 = { ok: boolean; error?: string; 解决了?: boolean };

/**
 * 跑一个卡点动作（dt.blocker）：不弹顶部提示。没成回原因，由调用方就地写（框里 / 那一条卡点下面）；
 * 成了刷新页面——卡点就地变样（认领了变色、发布了出现在列表里、删了消失）就是反馈
 */
function useRun() {
  const router = useRouter();
  const [忙, set忙] = useState(false);
  const 跑 = async (f: () => Promise<结果>): Promise<结果> => {
    set忙(true);
    try {
      const r = await f();
      if (r.ok) router.refresh();
      return r.ok ? r : { ...r, error: r.error ?? "没改成，请稍后再试" };
    } catch (出错) {
      return { ok: false, error: 动作出错话(出错, "没改成，请稍后再试") };
    } finally {
      set忙(false);
    }
  };
  return { 忙, 跑 };
}

/** 发卡点框里「挂在」那一行列的沟通：日期 + 内容开头 */
export type 可挂沟通 = { id: string; occurredAt: string; content: string };
export function 沟通短名(f: 可挂沟通): string {
  const 头 = f.content.replace(/\s+/g, " ").trim().slice(0, 24);
  return `${dayjs(f.occurredAt).format("M月D日")} ${头 || "（没写内容）"}`;
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

/** 会签那一行：「处理中 2/3 ✓甲 ✓乙 ⏳丙」；还没人认领 = 「待接受，还没人认领」 */
export function 会签文字(b: Pick<卡点卡, "status" | "进度" | "认领">): string {
  if (!b.认领.length) return `${b.status}，还没人认领`;
  return `${b.status} ${b.进度.完成}/${b.进度.共} ${b.认领.map((c) => `${c.done ? "✓" : "⏳"}${c.名字}`).join(" ")}`;
}

/** 阻碍原因的多选（11-19 起选了卡点类型就必填）：下拉是设置里启用的原因，也能现打一个新的（发出去后进「待审核」，总管理员在设置里审）；空白、纯空格不算 */
export function 原因选择({ 原因们, 值, on改, disabled }: { 原因们: string[]; 值: string[]; on改: (v: string[]) => void; disabled?: boolean }) {
  return (
    <Select
      aria-label="阻碍原因"
      mode="tags"
      maxCount={原因最多}
      disabled={disabled}
      placeholder="阻碍原因（必填，可多选；没有合适的可以直接打字新增）"
      value={值}
      onChange={(v: string[]) => on改(清原因们(v))}
      options={原因们.map((t) => ({ value: t, label: t }))}
      style={{ width: "100%", minWidth: 0 }}
    />
  );
}

/**
 * 从一条沟通记录发布卡点：类型、影响、阻碍原因（多选、必填）、资源申请（11-19 去掉标题、卡在哪儿，同记沟通里的卡点）。
 * 不指给谁：发出去是「待接受」，看得到的人都能认领（11-01 定稿 B1/B3）
 */
export function PublishBlockerModal({ followUpId, 默认, 原因们, 沟通们, onClose }: { followUpId: string; 默认: 卡点默认; 原因们: string[]; /** 「挂在」可换到哪条沟通（项目详情给；不给就只写挂在哪、不能换） */ 沟通们?: 可挂沟通[]; onClose: () => void }) {
  const { 跑 } = useRun();
  const [挂在, set挂在] = useState(followUpId);
  const 挂的那条 = 沟通们?.find((f) => f.id === 挂在);
  const [type, setType] = useState<string>(默认.默认类型 === "暂无卡点" ? "轻度卡点" : 默认.默认类型);
  const [impact, setImpact] = useState<string>(默认.默认影响);
  const [reasons, setReasons] = useState<string[]>([]);
  const [resourceRequest, setResourceRequest] = useState("");
  // 打了没发的留草稿（11-17，components/FormDraft.tsx）：按挂的那条沟通分；发出去了、点了取消就删
  const 稿 = useFormDraft({
    键: `新建卡点:${followUpId}`,
    值: { 挂在, type, impact, reasons, resourceRequest },
    带回: (v) => {
      if (typeof v.挂在 === "string" && (!沟通们 || 沟通们.some((f) => f.id === v.挂在))) set挂在(v.挂在);
      if (typeof v.type === "string") setType(v.type);
      if (typeof v.impact === "string") setImpact(v.impact);
      if (Array.isArray(v.reasons)) setReasons(v.reasons);
      if (typeof v.resourceRequest === "string") setResourceRequest(v.resourceRequest);
    },
    算填过: (改) => 有字([改.resourceRequest, 改.reasons]),
  });
  const 不要了 = () => {
    稿.丢掉();
    onClose();
  };
  const 差 = !reasons.length ? 缺原因话 : "";
  return (
    <Modal
      open
      title="新建卡点"
      onCancel={不要了}
      // 原型 dt.blocker「改后」：发布键里转圈 →「已发布」放完再关框，新卡点出现在列表里；没发出去原因浮在键上方、框不关（不弹顶部提示）
      footer={<Space>
        <Button onClick={不要了}>取消</Button>
        <SaveButton disabled={!!差} 已保存="已发布" 没保存="没发出去" 做={() => 跑(() => 发布卡点Action(挂在, { type, impact, reasons, resourceRequest }))} 成了={() => { 稿.存好了(); onClose(); }}>发布</SaveButton>
      </Space>}
    >
      {稿.提示}
      <Space direction="vertical" style={{ width: "100%" }}>
        {/* 挂在哪条沟通（dt.blocker）：默认最近那条，可换 */}
        <div className="pd-blk-on">
          <span className="pd-blk-on-k">挂在</span>
          {沟通们 && 沟通们.length > 1 ? (
            <Select aria-label="挂在哪条沟通" className="pd-blk-on-v" value={挂在} onChange={(v: string) => set挂在(v)} popupMatchSelectWidth={false}
              options={沟通们.map((f) => ({ value: f.id, label: 沟通短名(f) }))} />
          ) : (
            <span className="pd-blk-on-v pd-blk-on-t" title={挂的那条 ? 挂的那条.content : undefined}>{挂的那条 ? 沟通短名(挂的那条) : "这条沟通"}</span>
          )}
        </div>
        {/* 类型、影响一行，带好默认值（设置 → 卡点默认值） */}
        <div className="pd-blk-row">
          <Select aria-label="卡点类型" value={type} onChange={(v: string) => setType(v)} options={卡点类型们.filter((t) => t !== "暂无卡点").map((t) => ({ value: t, label: t }))} />
          <Select aria-label="影响等级" value={impact} onChange={(v: string) => setImpact(v)} options={影响等级们.map((t) => ({ value: t, label: t }))} />
        </div>
        <原因选择 原因们={原因们} 值={reasons} on改={setReasons} />
        <Input.TextArea aria-label="资源申请" rows={2} maxLength={描述上限} value={resourceRequest} onChange={(e) => setResourceRequest(e.target.value)} placeholder="需要什么资源（可不写）" />
        {差 && <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{差}</div>}
      </Space>
    </Modal>
  );
}

/** 一条卡点的头：编号、状态、类型、影响、原因（待审核的标出来；老卡点没挂原因的显示「原阻碍主体：X」）、老卡点存着的标题（新卡点没有，不重复写类型和原因） */
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
        {b.原阻碍主体 && (
          <Tag title="老卡点，没归到阻碍原因（统计在「未分类（老数据）」里）" style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis" }}>
            原阻碍主体：{b.原阻碍主体}
          </Tag>
        )}
        {带项目 && <Link href={`/projects/${b.projectId}`} style={{ overflowWrap: "anywhere" }}>{b.项目}</Link>}
      </div>
      {/* 11-19：新卡点不存标题，类型、原因上面的标签已经写了，不再加粗重复一遍；老卡点有标题照旧显示 */}
      {b.有标题 && <div style={{ fontWeight: 600, marginTop: 4, overflowWrap: "anywhere" }}>{b.title}</div>}
    </>
  );
}

/**
 * 一串卡点：头 + 描述 + 会签行（x/y、每人打勾）+ 每人的备注；按钮只有「认领」「我已完成」（11-01 定稿：不指认、不转让、不退回）。
 * 最后一个点「我已完成」的人要写解决方案和解决结果，写完卡点就锁成已解决。
 * 项目详情和复盘页「卡点」页签共用；带项目 = 卡片上带项目名
 */
export function BlockerList({ 们, 带项目 = false, 空 = "还没有卡点" }: { 们: 卡点卡[]; 带项目?: boolean; 空?: string }) {
  const { 忙, 跑 } = useRun();
  const [完成于, set完成于] = useState<卡点卡 | null>(null);
  const [note, setNote] = useState("");
  const [solution, setSolution] = useState("");
  const [result, setResult] = useState("");
  const [展开, set展开] = useState<Set<string>>(new Set());
  /** 哪条卡点下面写着没成的原因（认领 / 删除没成）；完成没成写在完成框里 */
  const [错于, set错于] = useState<{ id: string; 话: string } | null>(null);
  const [完成错, set完成错] = useState<string | null>(null);
  /** 刚认领的：等刷新回来前先就地变成「处理中」的颜色（不弹提示、不给撤销） */
  const [刚认领, set刚认领] = useState<Set<string>>(new Set());
  const 认领 = async (b: 卡点卡) => {
    set错于(null);
    set刚认领((s) => new Set(s).add(b.id));
    const r = await 跑(() => 认领卡点Action(b.id));
    if (!r.ok) {
      set刚认领((s) => { const n = new Set(s); n.delete(b.id); return n; });
      set错于({ id: b.id, 话: r.error ?? "没认领上，请稍后再试" });
    }
  };
  const 删 = async (b: 卡点卡) => {
    set错于(null);
    const r = await 跑(() => 删卡点Action(b.id));
    if (!r.ok) set错于({ id: b.id, 话: r.error ?? "没删掉，请稍后再试" });
    return r;
  };

  const 开完成 = (b: 卡点卡) => { setNote(""); setSolution(""); setResult(""); set完成错(null); set完成于(b); };
  const 最后 = !!完成于?.能.最后一个;
  const 不能确定 = 最后 && (!solution.trim() || !result.trim());
  const 确定 = async () => {
    if (!完成于 || 不能确定) return;
    set完成错(null);
    // 成了关框，会签行就地打勾 / 卡点变成已解决；没成原因写在框里不关框
    const r = await 跑(() => 完成卡点Action(完成于.id, { note, ...(最后 ? { solution, result } : {}) }));
    if (r.ok) set完成于(null);
    else set完成错(r.error ?? "没记上，请稍后再试");
  };

  if (!们.length) return <div style={{ color: "var(--text-muted)" }}>{空}</div>;
  return (
    <>
      {们.map((b) => (
        <div key={b.id} className={`pd-blk${刚认领.has(b.id) ? " is-claimed" : ""}`} data-status={刚认领.has(b.id) && b.status === "待接受" ? "处理中" : b.status} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid var(--line-soft)", minWidth: 0 }}>
          <卡点头 b={b} 带项目={带项目} />
          {/* 11-19 起新卡点不写「卡在哪儿」：没有就不占一行；老卡点的照旧显示 */}
          {b.description && <div style={{ whiteSpace: "pre-wrap", marginTop: 4, overflowWrap: "anywhere" }}>{b.description}</div>}
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
            {b.能.认领 && !刚认领.has(b.id) && <Button size="small" type="primary" disabled={忙} onClick={() => void 认领(b)}>认领</Button>}
            {刚认领.has(b.id) && b.status === "待接受" && <span role="status" className="pd-blk-claimed">已认领</span>}
            {b.能.完成 && <Button size="small" type={b.能.认领 ? "default" : "primary"} disabled={忙} onClick={() => 开完成(b)}>我已完成</Button>}
            {b.能.删 && (
              <InlineConfirm 问="连流转记录一起删，找不回来" 做={() => 删(b)}>
                <Button size="small" danger type="text" disabled={忙}>删除</Button>
              </InlineConfirm>
            )}
            <Button size="small" type="link" onClick={() => set展开((s) => { const n = new Set(s); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}>
              {展开.has(b.id) ? "收起流转" : `流转（${b.流转.length}）`}
            </Button>
          </Space>
          {错于?.id === b.id && <div role="alert" className="cd-task-err">{错于.话}</div>}
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
          {完成错 && <div role="alert" className="csq-err">{完成错}</div>}
        </Space>
      </Modal>
    </>
  );
}
