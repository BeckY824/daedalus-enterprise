"use client";
/**
 * 「在 X 名下新建线索」键（重复咨询第一步 · 出口 C，lib/enterprise/repeat-inquiry.ts）：市场成员查号码撞上同事名下的客户、
 * 服务端说 出口C 时摆在撞号提示里，和「申请挂靠」「写进现有项目」并排。客户负责人接不了指定分配（停用、暂停 / 禁止、不是销售）时
 * 服务端带 交销售：键写「新建线索交销售」，新线索按客户区域自动分给销售、客户不动。两种都没有选人框：落给谁全由服务端定（客户 E-218 二①）。
 * 建档向导（新建线索 / 新建客户）、首页查重框、首页 AI 新线索卡共用；服务端动作 customers/repeat-inquiry-actions.ts：只认号码、重查一遍。
 * 框里三样必填（同查重领取那一框）：这次的渠道、对接人、一条沟通。同事的客户资料、联系人名字一律不列：
 * 对接人默认挂「号码对应的那位联系人」（不显示名字），或者填新的人。结果就地写在键后面一行，建成了键收起
 */
import { useEffect, useState } from "react";
import { Button, Input, Modal, Select, Spin } from "antd";
import ChannelPicker from "@/components/ChannelPicker";
import DatePicker from "@/components/BusinessDatePicker";
import FollowMethodSelect, { useHabitDefault } from "@/components/FollowMethodSelect";
import { useBusiness } from "@/lib/business-client";
import { 跟进类型们 } from "@/lib/constants";
import { 外贸精简 } from "@/lib/business-config";
import { dayjs } from "@/lib/utils";
import { 动作出错话 } from "@/lib/stale-deploy";
import { useFormDraft } from "@/components/FormDraft";
import { 出口C建线索, 出口C框数据, type 出口C框 } from "./repeat-inquiry-actions";
import type { 查重领取沟通 } from "./pool-actions";
import { 认带进来的, 号哈希, type 带进来的渠道 } from "./DedupeClaimKey";

const 时间格式 = "YYYY-MM-DD HH:mm";
const 满宽 = { width: "100%" } as const;
const 撞上的 = "hit";
const 新的人 = "new";

export const 出口C说明 = (负责人: string, 交销售 = false) =>
  交销售
    ? `客户负责人 ${负责人} 现在接不了新线索（账号停用、暂停或禁止参与分配、或不是销售），这次新建的线索（标「老客户重复咨询」）按客户区域定内贸 / 外贸、自动分配给一位能接的销售（计入他本月已分），进线索验证由他判；挑不到人就留在新线索待分配、提醒能分配的人。创建人记你、项目来源记这次的渠道，这次的沟通记在新线索上。客户的负责人、来源、联系人和原来的项目都不改；建好后你在项目列表里能看到进度`
    : `在 ${负责人} 名下新建一条线索（标「老客户重复咨询」，指定分配给他、计入他本月已分），进线索验证由他判；创建人记你、项目来源记这次的渠道，这次的沟通记在新线索上。客户的负责人、来源、联系人和原来的项目都不改；建好后你在项目列表里能看到进度`;

/** 交销售：客户负责人接不了指定分配，新线索按区域自动分给销售（服务端 出口C按钮给不给 带来的） */
type 外面给的 = { 类型: string; 值: string; 负责人名: string; 交销售?: boolean; 渠道?: 带进来的渠道 | null; 触点?: string | null };

export default function RepeatInquiryKey({ 建了, ...外 }: 外面给的 & { 建了?: (提示: string) => void }) {
  const [开, set开] = useState(false);
  const [话, set话] = useState<{ 话: string; 级: "常" | "错" } | null>(null);
  return (
    <>
      {话?.级 !== "常" && (
        <Button size="small" type="primary" data-testid="repeat-inquiry" onClick={() => { set话(null); set开(true); }}>
          {外.交销售 ? "新建线索交销售" : <>在 {外.负责人名} 名下新建线索</>}
        </Button>
      )}
      {话 && <span role={话.级 === "错" ? "alert" : "status"} className={话.级 === "错" ? "cu-said cu-said-err" : "cu-said"}>{话.话}</span>}
      <Modal open={开} title="老客户重复咨询：新建线索" footer={null} onCancel={() => set开(false)} destroyOnHidden width={560}>
        {开 && <Body {...外} 关={() => set开(false)} 成了={(t) => { set开(false); set话({ 话: t, 级: "常" }); 建了?.(t); }} />}
      </Modal>
    </>
  );
}

function Body({ 类型, 值, 负责人名, 交销售: 外交销售, 渠道: 带渠道, 触点, 关, 成了 }: 外面给的 & { 关: () => void; 成了: (提示: string) => void }) {
  const b = useBusiness();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  const [f, setF] = useState<查重领取沟通>({ type: 能选类型[0]?.value ?? "PHONE", content: "", occurredAt: dayjs().format(时间格式) });
  const 人改了方式 = useHabitDefault(true, (x) => setF((o) => ({ ...o, type: x.type, method: x.method })));
  const [交中, set交中] = useState(false);
  const [错, set错] = useState("");
  const [框, set框] = useState<出口C框 | null>(null);
  const [渠道, set渠道] = useState<string | null>(null);
  const [带, set带] = useState<string>(新的人);
  const [名字, set名字] = useState("");
  const [职务, set职务] = useState("");
  const 带渠道id = 带渠道?.id ?? null;
  const 带渠道名 = 带渠道?.名 ?? null;
  useEffect(() => {
    let 在 = true;
    出口C框数据(类型, 值)
      .then((r) => {
        if (!在) return;
        set框(r);
        if (r.ok) {
          if (r.有撞上的联系人) set带(撞上的);
          set渠道(认带进来的({ id: 带渠道id, 名: 带渠道名 }, r.渠道们));
        }
      })
      .catch((e) => 在 && set框({ ok: false, error: 动作出错话(e, "没打开，请稍后再试") }));
    return () => { 在 = false; };
  }, [类型, 值, 带渠道id, 带渠道名]);
  const 选新的人 = 带 === 新的人;
  const 稿 = useFormDraft({
    键: `出口C:${号哈希(`${类型}:${值}`)}`,
    值: { content: f.content },
    带回: (v) => setF((o) => ({ ...o, ...(v.content !== undefined ? { content: v.content } : {}) })),
    算填过: (改过) => !!改过.content?.trim(),
  });
  const 差 = !框 ? "还在取渠道"
    : !框.ok ? 框.error
    : !渠道 ? "请选这次的渠道"
    : 选新的人 && !名字.trim() ? "请填写新对接人的名字"
    : !f.content.trim() ? "请填写这次的沟通内容" : "";
  const 负责人 = 框?.ok ? 框.负责人名 : 负责人名;
  // 以框打开时服务端重判的为准（按钮摆出来之后负责人可能刚被暂停 / 恢复）
  const 交销售 = 框?.ok ? 框.交销售 : !!外交销售;
  async function 交() {
    set交中(true);
    set错("");
    try {
      const r = await 出口C建线索(类型, 值, f, { 渠道, 对接人: 选新的人 ? { 名字, 职务: 职务 || null } : { 撞上的: true }, 负责人名: 负责人 });
      if (!r.ok) { set错(r.error); return; }
      稿.存好了();
      成了(r.提示);
    } catch (e) {
      set错(动作出错话(e, "没建成，请稍后再试"));
    } finally {
      set交中(false);
    }
  }
  return (
    <div className="dc-claim-body" data-testid="repeat-inquiry-form">
      {稿.提示}
      <div className="dc-claim-who" title={负责人}>{交销售 ? `客户负责人：${负责人}（接不了，交销售自动分配）` : `负责人：${负责人}`}</div>
      <p className="muted" data-testid="repeat-inquiry-explain">{出口C说明(负责人, 交销售)}</p>
      {触点 && <span className="cu-said cu-said-err" data-testid="repeat-inquiry-touchpoint">这次是渠道触点（{触点}）来的：项目上记不了触点，先找销售管理，别在这里建</span>}
      {!框 && <Spin size="small" />}
      {框 && !框.ok && <span role="alert" className="cu-said cu-said-err">{框.error}</span>}
      <div className="dc-claim-grid">
        {框?.ok && (
          <>
            <div className="cr-field">
              <span><span className="dc-claim-req">* </span>这次的渠道</span>
              <ChannelPicker aria-label="这次的渠道" 层级="两级" channels={框.渠道们} value={渠道} allowClear placeholder="这次从哪个渠道来" onChange={(v) => set渠道(v ?? null)} />
            </div>
            <div className="cr-field">
              <span><span className="dc-claim-req">* </span>对接人</span>
              <Select
                aria-label="对接人"
                className="dc-claim-full"
                value={带}
                options={[...(框.有撞上的联系人 ? [{ value: 撞上的, label: "号码对应的联系人" }] : []), { value: 新的人, label: "新的人" }]}
                onChange={(v: string) => { set带(v); set名字(""); set职务(""); }}
              />
            </div>
            {选新的人 && (
              <>
                <div className="cr-field">
                  <span><span className="dc-claim-req">* </span>新对接人名字</span>
                  <Input aria-label="对接人名字" placeholder="这次录的名字" value={名字} maxLength={100} onChange={(e) => set名字(e.target.value)} />
                </div>
                <div className="cr-field">
                  <span>职务</span>
                  <Input aria-label="对接人职务" placeholder="选填" value={职务} maxLength={100} onChange={(e) => set职务(e.target.value)} />
                </div>
              </>
            )}
            <span className="muted dc-claim-wide" data-testid="repeat-inquiry-contact-hint">
              {选新的人 ? "会在这位客户下新建一位联系人（不设主联系人），只挂在新建的线索上" : "挂这个号码对应的那位联系人，他原来的信息都不改"}
            </span>
          </>
        )}
        <div className="cr-field">
          <span><span className="dc-claim-req">* </span>沟通方式</span>
          <FollowMethodSelect style={满宽} aria-label="沟通方式" type={f.type} method={f.method} 类型们={能选类型} onChange={(v) => { 人改了方式(); setF({ ...f, ...v }); }} />
        </div>
        <div className="cr-field">
          <span><span className="dc-claim-req">* </span>时间</span>
          <DatePicker
            showTime={{ format: "HH:mm" }}
            format={时间格式}
            allowClear={false}
            className="dc-claim-full"
            value={dayjs(f.occurredAt, 时间格式)}
            disabledDate={(x) => x.isAfter(dayjs(), "day")}
            onChange={(v) => v && setF({ ...f, occurredAt: v.format(时间格式) })}
          />
        </div>
      </div>
      <div className="cr-field">
        <span><span className="dc-claim-req">* </span>沟通内容</span>
        <Input.TextArea aria-label="沟通内容" rows={3} value={f.content} placeholder="这次咨询聊了什么" onChange={(e) => setF({ ...f, content: e.target.value })} />
      </div>
      {错 && <span role="alert" className="cu-said cu-said-err">{错}</span>}
      <div className="dc-claim-foot">
        <Button onClick={() => { 稿.丢掉(); 关(); }}>取消</Button>
        <Button type="primary" disabled={!!差} title={差 || undefined} loading={交中} onClick={() => void 交()}>新建线索</Button>
      </div>
    </div>
  );
}
