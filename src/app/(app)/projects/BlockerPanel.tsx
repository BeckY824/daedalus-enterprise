"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LinkPending } from "@/components/NavProgress";
import { Button, Dropdown, Input, Modal, Select, Space, Timeline } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import InlineConfirm from "@/components/InlineConfirm";
import SaveButton from "@/components/SaveButton";
import { dayjs, fmtDateTime, smartTime } from "@/lib/utils";
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
  // 时间和沟通列表同一套（今天 13:13 / 昨天 / 3 天前 / 11 月 18 日，D4 · M9 · D15）
  return `${smartTime(f.occurredAt)} ${头 || "（没写内容）"}`;
}

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

/** 阻碍原因的多选（11-19 起选了卡点类型就必填）：下拉是设置里启用的原因，也能现打一个新的（发出去后进「待审核」，总管理员在设置里审）；空白、纯空格不算 */
// 中文名 原因选择 = 它
export function ReasonSelect({ 原因们, 值, on改, disabled, 错 }: { 原因们: string[]; 值: string[]; on改: (v: string[]) => void; disabled?: boolean; 错?: boolean }) {
  return (
    <Select
      aria-label="阻碍原因"
      mode="tags"
      maxCount={原因最多}
      disabled={disabled}
      status={错 ? "error" : undefined}
      // 必填写在标签上（* 在前），占位字只说怎么填（D4 · M9-a · D03）
      placeholder="可多选；没有合适的可以直接打字新增"
      value={值}
      onChange={(v: string[]) => on改(清原因们(v))}
      options={原因们.map((t) => ({ value: t, label: t }))}
      style={{ width: "100%", minWidth: 0 }}
    />
  );
}
export const 原因选择 = ReasonSelect;

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
  // 设计语言 D4 · M9-a（D03 / D14）：提交键叫「保存」、一直能点；点了还缺原因就在格子下报红、焦点落到原因格（原来「发布」灰着、底下一行小灰字）
  const [试过, set试过] = useState(false);
  const 交 = async () => {
    if (差) {
      set试过(true);
      window.setTimeout(() => document.querySelector<HTMLElement>(".blocker-modal [data-fk=\"阻碍原因\"] input")?.focus(), 0);
      return { ok: false as const, error: "有一项没填好，看标红的" };
    }
    return 跑(() => 发布卡点Action(挂在, { type, impact, reasons, resourceRequest }));
  };
  return (
    <Modal
      open
      title="新建卡点"
      rootClassName="blocker-modal"
      onCancel={不要了}
      // 原型 dt.blocker「改后」：保存键里转圈 →「已保存」放完再关框，新卡点出现在列表里；没存上原因浮在键上方、框不关（不弹顶部提示）
      footer={<Space>
        <Button onClick={不要了}>取消</Button>
        <SaveButton 已保存="已保存" 没保存="没存上" 做={交} 成了={() => { 稿.存好了(); onClose(); }}>保存</SaveButton>
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
        {/* 类型、影响一行，带好默认值（设置 → 卡点默认值）；每格有标签（D4 · M9-a），不靠占位字 */}
        <div className="pd-blk-row">
          <div>
            <div className="fm-label"><span className="fm-req" aria-hidden>*</span>卡点类型</div>
            <Select aria-label="卡点类型" value={type} onChange={(v: string) => setType(v)} options={卡点类型们.filter((t) => t !== "暂无卡点").map((t) => ({ value: t, label: t }))} />
          </div>
          <div>
            <div className="fm-label"><span className="fm-req" aria-hidden>*</span>影响等级</div>
            <Select aria-label="影响等级" value={impact} onChange={(v: string) => setImpact(v)} options={影响等级们.map((t) => ({ value: t, label: t }))} />
          </div>
        </div>
        <div data-fk="阻碍原因">
          <div className="fm-label"><span className="fm-req" aria-hidden>*</span>阻碍原因</div>
          <原因选择 原因们={原因们} 值={reasons} on改={setReasons} 错={试过 && !!差} />
          {试过 && 差 && <div className="fm-err" role="alert">{差}</div>}
        </div>
        <div>
          <div className="fm-label">资源申请</div>
          <Input.TextArea aria-label="资源申请" rows={2} maxLength={描述上限} value={resourceRequest} onChange={(e) => setResourceRequest(e.target.value)} placeholder="需要什么资源" />
          <div className="fm-help">可不写</div>
        </div>
      </Space>
    </Modal>
  );
}

/**
 * 一串卡点：头 + 描述 + 会签行（x/y、每人打勾）+ 每人的备注；按钮只有「认领」「我已完成」（11-01 定稿：不指认、不转让、不退回）。
 * 最后一个点「我已完成」的人要写解决方案和解决结果，写完卡点就锁成已解决。
 * 项目详情和复盘页「卡点」页签共用；带项目 = 卡片上带项目名
 */
type 列表参数 = {
  们: 卡点卡[];
  带项目?: boolean;
  空?: string;
  /**
   * 在复盘「卡点」分栏看板里（设计语言 R-A）：栏头已经说了状态，卡片上不再写状态；待接受那栏也不写「还没人认领」。
   * 项目详情 / 客户详情不分栏，首行留「圆点 + 状态」
   */
  在分栏?: boolean;
};
const 状态圆点: Record<string, string> = { 待接受: "rblk-dot-wait", 处理中: "rblk-dot-doing", 已解决: "rblk-dot-done" };

/** 会签行：状态已在首行 / 栏头，这里只写进度（「会签 1/2 ✓甲 ⏳乙」）；没人认领 = 「还没人认领」 */
export function 会签进度(b: Pick<卡点卡, "进度" | "认领">): string {
  if (!b.认领.length) return "还没人认领";
  return `会签 ${b.进度.完成}/${b.进度.共} ${b.认领.map((c) => `${c.done ? "✓" : "⏳"}${c.名字}`).join(" ")}`;
}

/**
 * 卡点卡片（设计语言 R-A，落地计划-三页设计 R-A ⑤）：固定五段——
 *   ① 首行：项目名（带项目时，最多两行）/ 状态圆点 + 字（不在分栏时）｜右「已开 N 天」「用了 N 天解决」（耗时，10-27 定，不走 smartTime）
 *   ② 属性行：类型 · 影响 · 原因，灰字一行；只有「重要卡点」红小标、待审核原因橙小标；老卡点「原阻碍主体：X」照留
 *   ③ 正文：老卡点标题和描述一样时只写一次
 *   ④ 进度段：会签行（分栏里的待接受不写）、每人备注、资源申请、解决方案 / 结果
 *   ⑤ 底行：编号 · 发布人 · 来源沟通已删除｜认领、我已完成（描边小钮）、流转记录（N）、⋯（能删的人才有：删除 → 原地确认）
 */
export function BlockerList({ 们, 带项目 = false, 空 = "还没有卡点", 在分栏 = false }: 列表参数) {
  const { 忙, 跑 } = useRun();
  const [完成于, set完成于] = useState<卡点卡 | null>(null);
  const [展开, set展开] = useState<Set<string>>(new Set());
  const [错于, set错于] = useState<{ id: string; 话: string } | null>(null);
  const [刚认领, set刚认领] = useState<Set<string>>(new Set());
  const [待删, set待删] = useState<string | null>(null);
  const 认领 = async (b: 卡点卡) => {
    set错于(null);
    set刚认领((x) => new Set(x).add(b.id));
    const r = await 跑(() => 认领卡点Action(b.id));
    if (!r.ok) {
      set刚认领((x) => { const n = new Set(x); n.delete(b.id); return n; });
      set错于({ id: b.id, 话: r.error ?? "没认领上，请稍后再试" });
    }
  };
  const 删 = async (b: 卡点卡) => {
    set错于(null);
    const r = await 跑(() => 删卡点Action(b.id));
    if (!r.ok) set错于({ id: b.id, 话: r.error ?? "没删掉，请稍后再试" });
    return r;
  };

  if (!们.length) return <p className="bk-none">{空}</p>;
  return (
    <>
      <div className={`bk-list${在分栏 ? " is-col" : ""}`}>
        {们.map((b) => {
          const 认领中 = 刚认领.has(b.id) && b.status === "待接受";
          const 状态 = 认领中 ? "处理中" : b.status;
          const 重要 = b.type === "重要卡点";
          const 标题另写 = b.有标题 && b.title.trim() !== b.description.trim();
          const 写会签 = !(在分栏 && b.status === "待接受" && !b.认领.length);
          return (
            <article key={b.id} className={`bk-card${认领中 ? " is-claimed" : ""}`} data-status={状态} aria-label={`卡点 ${b.code}`}>
              <div className="bk-r1">
                {带项目 ? (
                  <Link href={`/projects/${b.projectId}`} className="bk-proj" title={b.项目}>{b.项目}<LinkPending /></Link>
                ) : null}
                {!在分栏 && (
                  <span className="bk-st"><i className={`rblk-dot ${状态圆点[状态] ?? ""}`} aria-hidden />{状态}</span>
                )}
                <span className="bk-age">{耗时文字(b)}</span>
              </div>
              <div className="bk-meta">
                {重要 ? <span className="bk-flag is-bad">{b.type}</span> : <span>{b.type}</span>}
                <span className="bk-sep" aria-hidden>·</span>
                <span>{b.impact}</span>
                {b.原因们.map((r) => (
                  <span key={r.id} className="bk-reason">
                    <span className="bk-sep" aria-hidden>·</span>
                    {r.name}
                    {r.status === "待审核" && <span className="bk-flag is-warn" title="新加的原因，等总管理员审核">待审核</span>}
                  </span>
                ))}
                {b.原阻碍主体 && (
                  <span className="bk-reason" title="老卡点，没归到阻碍原因（统计在「未分类（老数据）」里）">
                    <span className="bk-sep" aria-hidden>·</span>原阻碍主体：{b.原阻碍主体}
                  </span>
                )}
              </div>
              {标题另写 && <div className="bk-title">{b.title}</div>}
              {(b.description || (b.有标题 && !标题另写)) && <div className="bk-desc">{b.description || b.title}</div>}
              {(写会签 || b.认领.some((c) => c.note) || b.resourceRequest || b.solution || b.result) && (
                <div className="bk-prog">
                  {写会签 && <div className="bk-sign" aria-label="会签进度">{会签进度(b)}</div>}
                  {b.认领.filter((c) => c.note).map((c) => (
                    <div key={c.名字} className="bk-line is-muted">{c.名字}：{c.note}</div>
                  ))}
                  {b.resourceRequest && <div className="bk-line"><span className="bk-k">资源申请</span>{b.resourceRequest}</div>}
                  {b.solution && <div className="bk-line"><span className="bk-k">解决方案</span>{b.solution}</div>}
                  {b.result && <div className="bk-line"><span className="bk-k">解决结果</span>{b.result}</div>}
                </div>
              )}
              <div className="bk-foot">
                <span className="bk-id">
                  {b.code} · {b.发布人} 发布{b.followUpId ? "" : " · 来源沟通已删除"}
                </span>
                <span className="bk-acts">
                  {b.能.认领 && !刚认领.has(b.id) && <Button size="small" disabled={忙} onClick={() => void 认领(b)}>认领</Button>}
                  {认领中 && <span role="status" className="pd-blk-claimed">已认领</span>}
                  {b.能.完成 && <Button size="small" disabled={忙} onClick={() => set完成于(b)}>我已完成</Button>}
                  <Button size="small" type="text" className="bk-log" aria-expanded={展开.has(b.id)} onClick={() => set展开((x) => { const n = new Set(x); if (n.has(b.id)) n.delete(b.id); else n.add(b.id); return n; })}>
                    {展开.has(b.id) ? "收起流转" : `流转记录（${b.流转.length}）`}
                  </Button>
                  {b.能.删 && (
                    <InlineConfirm 问="连流转记录一起删，找不回来" 做={() => 删(b)} 开={待删 === b.id} set开={(v) => set待删(v ? b.id : null)}>
                      <Dropdown
                        trigger={["click"]}
                        menu={{ items: [{ key: "del", danger: true, label: "删除" }], onClick: () => set待删(b.id) }}
                      >
                        <Button size="small" type="text" className="bk-more" aria-label="更多操作" icon={<MoreOutlined />} disabled={忙} />
                      </Dropdown>
                    </InlineConfirm>
                  )}
                </span>
              </div>
              {错于?.id === b.id && <div role="alert" className="cd-task-err">{错于.话}</div>}
              {展开.has(b.id) && (
                <Timeline
                  className="bk-timeline"
                  items={b.流转.map((l) => ({
                    color: l.action === "resolve" ? "green" : l.action === "handover" || l.action === "takeover" ? "orange" : "blue",
                    content: (
                      <div>
                        <div>{流转文字(l)}</div>
                        {l.note && <div className="bk-line is-muted">说明：{l.note}</div>}
                        <div className="bk-when">{fmtDateTime(l.at)}</div>
                      </div>
                    ),
                  }))}
                />
              )}
            </article>
          );
        })}
      </div>
      {完成于 && <CompleteBlockerModal b={完成于} 跑={跑} 忙={忙} 关={() => set完成于(null)} />}
    </>
  );
}

/**
 * 「我已完成」框（设计语言 R-A ⑥，规则「必填标记」「校验」）：每格有标签、必填 * 在标签前、提交键一直可点，
 * 缺了就格子红框 + 格子下一行红字、焦点跳到第一处；提交键写动作名（最后一位「我已完成，标为已解决」）。
 * 最后一位点了就锁成已解决、不能撤回（P-界面-40 原地确认那一类，这句照留）
 */
function CompleteBlockerModal({ b, 跑, 忙, 关 }: { b: 卡点卡; 跑: (f: () => Promise<结果>) => Promise<结果>; 忙: boolean; 关: () => void }) {
  const [note, setNote] = useState("");
  const [solution, setSolution] = useState("");
  const [result, setResult] = useState("");
  const [试过, set试过] = useState(false);
  const 最后 = !!b.能.最后一个;
  const 缺方案 = 最后 && !solution.trim();
  const 缺结果 = 最后 && !result.trim();
  const 交 = async (): Promise<结果> => {
    if (缺方案 || 缺结果) {
      set试过(true);
      const 第一处 = 缺方案 ? "解决方案" : "解决结果";
      window.setTimeout(() => document.querySelector<HTMLElement>(`.bk-done-modal textarea[aria-label="${第一处}"]`)?.focus(), 0);
      return { ok: false, error: "有一项没填好，看标红的" };
    }
    return 跑(() => 完成卡点Action(b.id, { note, ...(最后 ? { solution, result } : {}) }));
  };
  const 叫 = 最后 ? "我已完成，标为已解决" : "我已完成";
  return (
    <Modal
      open
      title="我已完成"
      rootClassName="bk-done-modal"
      onCancel={关}
      footer={<Space>
        <Button onClick={关} disabled={忙}>取消</Button>
        <SaveButton 已保存="已记上" 没保存="没记上" 做={交} 成了={关}>{叫}</SaveButton>
      </Space>}
    >
      <div className="bk-done-form">
        <div>
          <div className="fm-label">我的备注</div>
          <Input.TextArea aria-label="我的备注" rows={2} maxLength={描述上限} value={note} onChange={(e) => setNote(e.target.value)} placeholder="我这边做了什么" />
          <div className="fm-help">可不写</div>
        </div>
        {最后 && (
          <>
            <div>
              <div className="fm-label"><span className="fm-req" aria-hidden>*</span>解决方案</div>
              <Input.TextArea aria-label="解决方案" aria-required status={试过 && 缺方案 ? "error" : undefined} rows={3} maxLength={描述上限} value={solution} onChange={(e) => setSolution(e.target.value)} />
              {试过 && 缺方案 && <div className="fm-err" role="alert">写一下怎么解决的</div>}
            </div>
            <div>
              <div className="fm-label"><span className="fm-req" aria-hidden>*</span>解决结果</div>
              <Input.TextArea aria-label="解决结果" aria-required status={试过 && 缺结果 ? "error" : undefined} rows={2} maxLength={描述上限} value={result} onChange={(e) => setResult(e.target.value)} />
              {试过 && 缺结果 && <div className="fm-err" role="alert">写一下结果怎样</div>}
            </div>
          </>
        )}
        <div className="fm-help">{最后 ? "你是最后一位：点了卡点就标为已解决，不能撤回。" : "点了就不能撤回；所有认领人都完成后卡点锁定为已解决。"}</div>
      </div>
    </Modal>
  );
}
