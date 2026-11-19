"use client";
/**
 * 「领取并记沟通」键（员工反馈 F-016；客户 11-19：市场成员查重撞上公海里的客户可以领，但「1.必须写沟通记录；2.只能自动分配」）。
 * 查重说「公海待捞」、服务端说 市场可领 时摆在提示里，替掉「去领取」（公海页市场成员领不了，P-公海-01）。
 * 建档向导（新建线索 / 新建客户）、首页查重框、首页 AI 建档卡片共用；服务端动作 customers/pool-actions.ts 查重领取：
 * 只认号码、重查一遍，领了直接自动分给销售（不落在你名下），沟通和领取同一个事务，挑不到人整笔不做。
 * 框里没有「指定」「留给自己」。结果就地写在键后面一行（同 RescueKey），领成了键收起。
 * 新建线索项目那条路（dedupe-claim.ts 查重领取口径，用户 11-19「客户来源以首次永不变更，项目来源以每次新建的为主……项目对接人以录入为主」）：
 *   - 这次的渠道必填、不默认带客户的来源（同新建线索的主 / 子渠道）
 *   - 对接人必填：号码撞上的那位先带出来，名字、职务可改成这次录的，也可换成客户别的联系人或新的人；
 *     名字和已有联系人一样就挂原人（原信息不改），不一样就在客户下新建一位（不设主联系人）
 * 只领旧项目那条路只有记沟通的几格（沟通方式、时间、内容）
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
import { 查重领取, 查重领取框数据, type 查重领取沟通, type 查重领取框, type 框里的联系人 } from "./pool-actions";

const 时间格式 = "YYYY-MM-DD HH:mm";
/** FollowMethodSelect 只收 style：撑满格子 */
const 满宽 = { width: "100%" } as const;

export const 查重领取说明 = "只能自动分配：领了直接按客户区域分给销售（不落在你名下），客户连项目一起给他；这条沟通记在领到的项目上";
export const 查重领取新建说明 = "只能自动分配：领了另建一条线索项目（这次的渠道、对接人），连客户和原来的项目一起按客户区域分给销售（不落在你名下）；沟通记在新建的线索项目上。客户原来的来源、联系人不改";
/** 对接人下拉里「新的人」那一项 */
const 新的人 = "";

/** 录的名字和带出来的那位一样就挂他；不一样就新建（服务端 认对接人 同口径，这里只是提示） */
function 对接人提示(带的: 框里的联系人 | undefined, 名字: string, 们: 框里的联系人[]): string {
  const 名 = 名字.trim();
  if (!名) return "";
  const 同名 = 带的 && 带的.name.trim() === 名 ? 带的 : 们.find((c) => c.name.trim() === 名);
  return 同名 ? `挂客户原有的联系人「${同名.name}」，他原来的名字、职务、号码都不改` : "客户名下没有这个名字：会在这位客户下新建一位联系人（不设主联系人），只挂在新建的线索项目上";
}

export default function DedupeClaimKey({ 类型, 值, 客户id, 领了 }: { 类型: string; 值: string; 客户id?: string | null; 领了?: (提示: string) => void }) {
  const [开, set开] = useState(false);
  const [话, set话] = useState<{ 话: string; 级: "常" | "错" } | null>(null);
  return (
    <>
      {/* 领成了只留那一行话：客户已经出公海归了销售，再点只会撞上「没撞上公海」 */}
      {话?.级 !== "常" && <Button size="small" type="primary" data-testid="dedupe-claim" onClick={() => { set话(null); set开(true); }}>领取并记沟通</Button>}
      {话 && <span role={话.级 === "错" ? "alert" : "status"} className={话.级 === "错" ? "cu-said cu-said-err" : "cu-said"}>{话.话}</span>}
      <Modal open={开} title="领取这位公海客户" footer={null} onCancel={() => set开(false)} destroyOnHidden width={560}>
        {开 && <Body 类型={类型} 值={值} 客户id={客户id ?? null} 关={() => set开(false)} 成了={(t) => { set开(false); set话({ 话: t, 级: "常" }); 领了?.(t); }} />}
      </Modal>
    </>
  );
}

function Body({ 类型, 值, 客户id, 关, 成了 }: { 类型: string; 值: string; 客户id: string | null; 关: () => void; 成了: (提示: string) => void }) {
  const b = useBusiness();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  const [f, setF] = useState<查重领取沟通>({ type: 能选类型[0]?.value ?? "PHONE", content: "", occurredAt: dayjs().format(时间格式) });
  const 人改了方式 = useHabitDefault(true, (x) => setF((o) => ({ ...o, type: x.type, method: x.method })));
  const [交中, set交中] = useState(false);
  const [错, set错] = useState("");
  const [框, set框] = useState<查重领取框 | null>(null);
  const [渠道, set渠道] = useState<string | null>(null);
  const [带, set带] = useState<string>(新的人);
  const [名字, set名字] = useState("");
  const [职务, set职务] = useState("");
  useEffect(() => {
    let 在 = true;
    查重领取框数据(类型, 值)
      .then((r) => {
        if (!在) return;
        set框(r);
        if (r.ok && r.新建线索项目) {
          const 默认 = r.联系人们.find((c) => c.id === r.默认对接人);
          if (默认) { set带(默认.id); set名字(默认.name); set职务(默认.position ?? ""); }
        }
      })
      .catch((e) => 在 && set框({ ok: false, error: 动作出错话(e, "没打开，请稍后再试") }));
    return () => { 在 = false; };
  }, [类型, 值]);
  const 新建 = !!框?.ok && 框.新建线索项目;
  const 们 = 框?.ok ? 框.联系人们 : [];
  // 沟通内容打了没交的留草稿（同线索转项目那一框）：刷新、发版后再查同一个号带回。方式、时间跟着习惯默认走，不进草稿
  const 稿 = useFormDraft({
    键: `查重领取:${类型}:${值}`,
    值: { content: f.content },
    带回: (v) => setF((o) => ({ ...o, ...(v.content !== undefined ? { content: v.content } : {}) })),
    算填过: (改过) => !!改过.content?.trim(),
  });
  const 差 = !框?.ok ? "还在取渠道和联系人"
    : 新建 && !渠道 ? "请选这次的渠道"
    : 新建 && !名字.trim() ? "请填写这次的对接人"
    : !f.content.trim() ? "请填写沟通内容：领取时必须写一条沟通记录" : "";
  async function 交() {
    set交中(true);
    set错("");
    try {
      const r = await 查重领取(类型, 值, f, 客户id, 新建 ? { 渠道, 对接人: { 原id: 带 || null, 名字, 职务: 职务 || null } } : undefined);
      if (!r.ok) { set错(r.error); return; }
      稿.存好了();
      成了(r.提示);
    } catch (e) {
      set错(动作出错话(e, "没领成，请稍后再试"));
    } finally {
      set交中(false);
    }
  }
  return (
    <div className="dc-claim-body" data-testid="dedupe-claim-form">
      {稿.提示}
      <p className="muted">{新建 ? 查重领取新建说明 : 查重领取说明}</p>
      {!框 && <Spin size="small" />}
      {框 && !框.ok && <span role="alert" className="cu-said cu-said-err">{框.error}</span>}
      {/* 两列排（渠道 | 对接人、名字 | 职务、沟通方式 | 时间）：1366×768 笔记本上整框不出滚动条；窄屏一列（globals.css） */}
      <div className="dc-claim-grid">
        {新建 && 框?.ok && (
          <>
            <div className="cr-field">
              <span><span className="dc-claim-req">* </span>这次的渠道</span>
              <ChannelPicker aria-label="这次的渠道" 层级="两级" channels={框.渠道们} value={渠道} allowClear placeholder="这次从哪个渠道来" onChange={(v) => set渠道(v ?? null)} />
            </div>
            <div className="cr-field">
              <span><span className="dc-claim-req">* </span>对接人</span>
              <Select
                aria-label="从客户联系人带出"
                className="dc-claim-full"
                value={带}
                options={[...们.map((c) => ({ value: c.id, label: c.position ? `${c.name || "（没填姓名）"}（${c.position}）` : c.name || "（没填姓名）" })), { value: 新的人, label: "新的人" }]}
                onChange={(v: string) => { set带(v); const c = 们.find((x) => x.id === v); set名字(c?.name ?? ""); set职务(c?.position ?? ""); }}
              />
            </div>
            <div className="cr-field">
              <span><span className="dc-claim-req">* </span>对接人名字</span>
              <Input aria-label="对接人名字" placeholder="这次录的名字" value={名字} maxLength={100} onChange={(e) => set名字(e.target.value)} />
            </div>
            <div className="cr-field">
              <span>职务</span>
              <Input aria-label="对接人职务" placeholder="选填" value={职务} maxLength={100} onChange={(e) => set职务(e.target.value)} />
            </div>
            {名字.trim() && <span className="muted dc-claim-wide" data-testid="dedupe-claim-contact-hint">{对接人提示(们.find((c) => c.id === 带), 名字, 们)}</span>}
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
        <Button type="primary" disabled={!!差} title={差 || undefined} loading={交中} onClick={() => void 交()}>领取并自动分配</Button>
      </div>
    </div>
  );
}
