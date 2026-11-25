"use client";
/**
 * 「领取并记沟通」键（员工反馈 F-016；客户 11-19：市场成员查重撞上公海里的客户可以领，但「1.必须写沟通记录；2.只能自动分配」）。
 * 查重说「公海待捞」、服务端说 市场可领 时摆在提示里，替掉「去领取」（公海页市场成员领不了，P-公海-01）。
 * 建档向导（新建线索 / 新建客户）、首页查重框、首页 AI 建档卡片共用；服务端动作 customers/pool-actions.ts 查重领取：
 * 只认号码、重查一遍，领了直接自动分给销售（不落在你名下），沟通和领取同一个事务，挑不到人整笔不做。
 * 框里没有「指定」「留给自己」。结果就地写在键后面一行（同 RescueKey），领成了键收起。
 * 新建线索项目那条路（dedupe-claim.ts 查重领取口径，用户 11-19「客户来源以首次永不变更，项目来源以每次新建的为主……项目对接人以录入为主」）：
 *   - 这次的渠道必填、不默认带客户的来源（同新建线索的主 / 子渠道）
 *     建档向导 / AI 建档卡上已经选了渠道的带进来当默认（仍可改、仍必填）；向导选的是渠道触点（公司资源、客户介绍）的提示先找销售管理分配
 *   - 对接人必填：号码撞上的那位先带出来（没名字也挂他），可换成客户别的联系人——选已有的就挂他、他原有的信息不改；
 *     选「新的人」才填名字（必填）、职务，在客户下新建一位（不设主联系人）
 * 只领旧项目那条路只有记沟通的几格（沟通方式、时间、内容）
 * 截图 / 录音（员工反馈 F-054「最次得能加个图片」，选填）：内容框下挂记沟通框同一个挑选块（类型、大小、条数照沟通附件）；
 *   领成了凭服务端签的附件票传到这条沟通上（领了就分给销售，我不是负责人，照原规矩传不上）。没传上的写一句，等点「知道了」再关；
 *   建档向导撞号、AI 新线索卡转过来领时，把那边已挑的附件 / 勾了存的对话截图带进来（带进来的仍可删）
 */
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, Input, Modal, Select, Spin } from "antd";
import ChannelPicker from "@/components/ChannelPicker";
import { 主渠道入口前缀, 渠道显示名 } from "@/lib/enterprise/channel-main-core";
import DatePicker from "@/components/BusinessDatePicker";
import FollowMethodSelect, { useHabitDefault } from "@/components/FollowMethodSelect";
import { useBusiness } from "@/lib/business-client";
import { 跟进类型们 } from "@/lib/constants";
import { 外贸精简 } from "@/lib/business-config";
import { dayjs } from "@/lib/utils";
import { 动作出错话 } from "@/lib/stale-deploy";
import { useFormDraft } from "@/components/FormDraft";
import { 查重领取, 查重领取框数据, type 查重领取沟通, type 查重领取框 } from "./pool-actions";

const 时间格式 = "YYYY-MM-DD HH:mm";
/**
 * 截图 / 录音挑选块按需加载（F-054，速度闸门 A）：这个键摆在首页查重框、AI 建档卡上，挑选块（antd Upload、粘贴截图）静态引进来
 * 首页首屏 JS 超线；它只在框打开后才用，开框再取。取到之前摆一个灰的同名键占位（不跳版）
 */
const 选沟通附件 = dynamic(() => import("@/components/FollowAttachments").then((m) => m.选沟通附件), {
  ssr: false,
  loading: () => <Button size="small" disabled>加截图 / 录音</Button>,
});
/** FollowMethodSelect 只收 style：撑满格子 */
const 满宽 = { width: "100%" } as const;

export const 查重领取说明 = "只能自动分配：领了直接按客户区域分给销售（不落在你名下），客户连项目一起给他；这条沟通记在领到的项目上";
export const 查重领取新建说明 = "只能自动分配：领了另建一条线索项目（这次的渠道、对接人），连客户和原来的项目一起按客户区域分给销售（不落在你名下）；沟通记在新建的线索项目上。客户原来的来源、联系人不改";
/** 对接人下拉里「新的人」那一项 */
const 新的人 = "";
const 没名字 = "（没填姓名）";

/** 带进来的渠道（向导给 id、AI 卡给渠道名）：在这次能选的里才带，认不出就空着让人选 */
export type 带进来的渠道 = { id?: string | null; 名?: string | null };
export function 认带进来的(带: 带进来的渠道 | null | undefined, 们: { id: string; name: string }[]): string | null {
  if (带?.id && (带.id.startsWith(主渠道入口前缀) || 们.some((c) => c.id === 带.id))) return 带.id;
  const 名 = 带?.名?.trim();
  if (!名) return null;
  const 中 = 们.filter((c) => c.name === 名 || 渠道显示名(c.name) === 名);
  return 中.length === 1 ? 中[0].id : null;
}

/** 草稿键不放号码（号码进本机存储的键名里不好）：有客户 id 用客户 id，没有用号码的短哈希 */
export function 号哈希(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

type 外面给的 = { 类型: string; 值: string; 客户id?: string | null; 渠道?: 带进来的渠道 | null; 触点?: string | null; 带来的附件?: File[] | null };

/**
 * 领成了凭票传附件：全传上回 null；没票 / 有没传上的回一句（领取照旧成了）。
 * 领完客户就归了接手的销售，领取人（渠运 / 市场管理）补不了（时间线不让传、项目页要负责人或记的人、没票 403）：叫他找负责人补传
 */
async function 领后传附件(文件们: File[], 票: { followUpId: string; 票: string } | undefined, 接手人: string): Promise<string | null> {
  if (!文件们.length) return null;
  const 找谁 = `请让负责人 ${接手人} 在这条沟通上补传`;
  if (!票) return `领好了，截图 / 录音没传上：没拿到上传凭据，${找谁}`;
  const { 传沟通附件 } = await import("@/components/FollowAttachments");
  const 错 = await 传沟通附件(票.followUpId, 文件们, 票.票);
  if (!错.length) return null;
  return 错.length === 文件们.length
    ? `领好了，截图 / 录音没传上（${错[0]}），${找谁}`
    : `领好了，${文件们.length} 个截图 / 录音传上 ${文件们.length - 错.length} 个，${错.length} 个没传上（${错[0]}），${找谁}`;
}

export default function DedupeClaimKey({ 领了, ...外 }: 外面给的 & { 领了?: (提示: string) => void }) {
  const [开, set开] = useState(false);
  const [话, set话] = useState<{ 话: string; 级: "常" | "错" } | null>(null);
  /** 交着 / 传附件着：框不让关（关了传没传上就看不到了） */
  const [锁, set锁] = useState(false);
  /** 已领成、在等点「知道了」：这时点右上角关掉也按领成了收（客户已出公海，键不能再摆） */
  const 已领 = useRef<string | null>(null);
  const 完 = (t: string) => { 已领.current = null; set锁(false); set开(false); set话({ 话: t, 级: "常" }); 领了?.(t); };
  return (
    <>
      {/* 领成了只留那一行话：客户已经出公海归了销售，再点只会撞上「没撞上公海」 */}
      {话?.级 !== "常" && <Button size="small" type="primary" data-testid="dedupe-claim" onClick={() => { set话(null); set开(true); }}>领取并记沟通</Button>}
      {话 && <span role={话.级 === "错" ? "alert" : "status"} className={话.级 === "错" ? "cu-said cu-said-err" : "cu-said"}>{话.话}</span>}
      <Modal
        open={开} title="领取这位公海客户" footer={null} destroyOnHidden width={560}
        closable={!锁} maskClosable={!锁} keyboard={!锁}
        onCancel={() => { if (锁) return; if (已领.current) 完(已领.current); else set开(false); }}
      >
        {开 && <Body {...外} 关={() => set开(false)} 成了={完} 领成未关={(t) => { 已领.current = t; }} 上锁={set锁} />}
      </Modal>
    </>
  );
}

function Body({ 类型, 值, 客户id, 渠道: 带渠道, 触点, 带来的附件, 关, 成了, 领成未关, 上锁 }: 外面给的 & {
  关: () => void; 成了: (提示: string) => void; 领成未关: (提示: string) => void; 上锁: (锁: boolean) => void;
}) {
  const b = useBusiness();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  const [f, setF] = useState<查重领取沟通>({ type: 能选类型[0]?.value ?? "PHONE", content: "", occurredAt: dayjs().format(时间格式) });
  const 人改了方式 = useHabitDefault(true, (x) => setF((o) => ({ ...o, type: x.type, method: x.method })));
  const [交中, set交中] = useState(false);
  const [错, set错] = useState("");
  /** 截图 / 录音（选填）：打开框时带上外面已挑的，文件进不了本机草稿（同记沟通框） */
  const [附件们, set附件们] = useState<File[]>(() => [...(带来的附件 ?? [])]);
  /** 领成了、有附件没传上：那句话 + 点「知道了」才关（读完原因再走） */
  const [领后话, set领后话] = useState<{ 话: string; 提示: string } | null>(null);
  const [传着, set传着] = useState(false);
  const [框, set框] = useState<查重领取框 | null>(null);
  const [渠道, set渠道] = useState<string | null>(null);
  const [带, set带] = useState<string>(新的人);
  const [名字, set名字] = useState("");
  const [职务, set职务] = useState("");
  const 带渠道id = 带渠道?.id ?? null;
  const 带渠道名 = 带渠道?.名 ?? null;
  useEffect(() => {
    let 在 = true;
    查重领取框数据(类型, 值)
      .then((r) => {
        if (!在) return;
        set框(r);
        if (r.ok && r.新建线索项目) {
          // 号码撞上的那位先带出来（没名字也挂他）；认不出就停在「新的人」
          if (r.默认对接人 && r.联系人们.some((c) => c.id === r.默认对接人)) set带(r.默认对接人);
          set渠道(认带进来的({ id: 带渠道id, 名: 带渠道名 }, r.渠道们));
        }
      })
      .catch((e) => 在 && set框({ ok: false, error: 动作出错话(e, "没打开，请稍后再试") }));
    return () => { 在 = false; };
  }, [类型, 值, 带渠道id, 带渠道名]);
  const 新建 = !!框?.ok && 框.新建线索项目;
  const 们 = 框?.ok ? 框.联系人们 : [];
  const 选新的人 = 带 === 新的人;
  // 沟通内容打了没交的留草稿（同线索转项目那一框）：刷新、发版后再查同一个号带回。方式、时间跟着习惯默认走，不进草稿
  const 稿 = useFormDraft({
    键: `查重领取:${客户id ?? 号哈希(`${类型}:${值}`)}`,
    值: { content: f.content },
    带回: (v) => setF((o) => ({ ...o, ...(v.content !== undefined ? { content: v.content } : {}) })),
    算填过: (改过) => !!改过.content?.trim(),
  });
  const 差 = !框 ? "还在取渠道和联系人"
    : !框.ok ? 框.error
    : 新建 && !渠道 ? "请选这次的渠道"
    : 新建 && 选新的人 && !名字.trim() ? "请填写新对接人的名字"
    : !f.content.trim() ? "请填写沟通内容：领取时必须写一条沟通记录" : "";
  async function 交() {
    set交中(true);
    上锁(true);
    set错("");
    try {
      const 对接人 = 选新的人 ? { 原id: null, 名字, 职务: 职务 || null } : { 原id: 带 };
      const r = await 查重领取(类型, 值, f, 客户id ?? null, 新建 ? { 渠道, 对接人 } : undefined, 附件们.length ? true : undefined);
      if (!r.ok) { set错(r.error); return; }
      稿.存好了();
      if (附件们.length) {
        领成未关(r.提示);
        set传着(true);
        const 没传上 = await 领后传附件(附件们, r.首条附件票, r.接手人);
        set传着(false);
        if (没传上) { set领后话({ 话: 没传上, 提示: r.提示 }); return; }
        return 成了(`${r.提示}；${附件们.length} 个截图 / 录音已挂上`);
      }
      成了(r.提示);
    } catch (e) {
      set错(动作出错话(e, "没领成，请稍后再试"));
    } finally {
      set交中(false);
      上锁(false);
    }
  }
  return (
    <div className="dc-claim-body" data-testid="dedupe-claim-form">
      {稿.提示}
      {框?.ok && <div className="dc-claim-who" title={框.客户名}>领取：{框.客户名}</div>}
      <p className="muted">{新建 ? 查重领取新建说明 : 查重领取说明}</p>
      {新建 && 触点 && <span className="cu-said cu-said-err" data-testid="dedupe-claim-touchpoint">这次是渠道触点（{触点}）来的：项目上记不了触点，先找销售管理分配，别在这里领</span>}
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
                aria-label="对接人"
                className="dc-claim-full"
                value={带}
                options={[...们.map((c) => ({ value: c.id, label: c.position ? `${c.name || 没名字}（${c.position}）` : c.name || 没名字 })), { value: 新的人, label: "新的人" }]}
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
            <span className="muted dc-claim-wide" data-testid="dedupe-claim-contact-hint">
              {选新的人 ? "会在这位客户下新建一位联系人（不设主联系人），只挂在新建的线索项目上" : "挂客户原有的这位联系人，他原来的名字、职务、号码都不改"}
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
      {/* 不用 <label>：点文件名会把文件选择框也点开（同建档向导） */}
      <div className="cr-field" data-testid="dedupe-claim-attachments">
        <span>截图 / 录音</span>
        {/* 交着 / 传着 / 等「知道了」：挑的文件已交不上了，挑选块灰掉（不然挑了悄悄丢） */}
        <选沟通附件 文件们={附件们} on改={set附件们} disabled={交中 || !!领后话} />
        <span className="muted">选填；领好后挂在这条沟通上，也可以直接粘贴截图</span>
      </div>
      {错 && <span role="alert" className="cu-said cu-said-err">{错}</span>}
      {传着 && <span role="status" className="cu-said">领好了，正在传 {附件们.length} 个截图 / 录音…</span>}
      {领后话 && <span role="alert" className="cu-said cu-said-err" data-testid="dedupe-claim-att-failed">{领后话.话}</span>}
      <div className="dc-claim-foot">
        {领后话 ? (
          <Button type="primary" autoFocus onClick={() => 成了(领后话.提示)}>知道了</Button>
        ) : (
          <>
            <Button disabled={交中} onClick={() => { 稿.丢掉(); 关(); }}>取消</Button>
            <Button type="primary" disabled={!!差} title={差 || undefined} loading={交中} onClick={() => void 交()}>领取并自动分配</Button>
          </>
        )}
      </div>
    </div>
  );
}
