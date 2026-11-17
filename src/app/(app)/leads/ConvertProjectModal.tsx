"use client";

import { useState } from "react";
import { Button, Input, Modal } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import { useBusiness } from "@/lib/business-client";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect, { useHabitDefault } from "@/components/FollowMethodSelect";
import { 外贸精简 } from "@/lib/business-config";
import { dayjs } from "@/lib/utils";
import type { 向导跟进 } from "@/lib/project/wizard";
import { useFormDraft } from "@/components/FormDraft";

const 时间格式 = "YYYY-MM-DD HH:mm";

/**
 * 企业版线索转项目：转之前记一条首条跟进（10-26 验收 #13）。
 * 和建档向导第五步同几格（沟通方式、时间、内容、下一步时间），服务端也是同一套规整（lib/project/wizard.ts 规整沟通）。
 * 要下一步 = 开了超时回收：下一步时间必填；没开选填。交上去由调用方处理（转化、撞号后并到已有客户都带着这条）
 */
export default function ConvertProjectModal({
  lead,
  要下一步,
  说明,
  关,
  交,
}: {
  lead: { id: string; name: string } | null;
  要下一步: boolean;
  /** 会带过去什么、会建什么项目：和原来确认框里那句一样 */
  说明: string;
  关: () => void;
  /** 回 true = 转成了（草稿删掉）；没转成（撞号、出错）草稿留着 */
  交: (跟进: 向导跟进) => Promise<boolean>;
}) {
  const b = useBusiness();
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  // 每次打开都从空的一份起：key 换了整块重来，见下面 <Body key>
  return (
    <Modal
      open={!!lead}
      title={lead ? `将「${lead.name}」转为项目` : ""}
      footer={null}
      onCancel={关}
      destroyOnHidden
      width={520}
    >
      {lead && <Body key={lead.id} leadId={lead.id} 能选类型={能选类型} 要下一步={要下一步} 说明={说明} 关={关} 交={交} />}
    </Modal>
  );
}

function Body({
  leadId,
  能选类型,
  要下一步,
  说明,
  关,
  交,
}: {
  leadId: string;
  能选类型: readonly { value: string; label: string }[];
  要下一步: boolean;
  说明: string;
  关: () => void;
  交: (跟进: 向导跟进) => Promise<boolean>;
}) {
  const [f, setF] = useState<向导跟进>({ type: 能选类型[0]?.value ?? "PHONE", content: "", occurredAt: dayjs().format(时间格式), 下一步时间: null });
  // 沟通方式按个人习惯默认（11-18，同记沟通框）；人改过的不盖
  const 人改了方式 = useHabitDefault(true, (x) => setF((o) => ({ ...o, type: x.type, method: x.method })));
  const [交中, set交中] = useState(false);
  // 首条跟进打了没交的字留草稿（复盘第 1 类：刷新、发版后重开同一条线索带回）。沟通方式、时间跟着习惯默认走，不进草稿
  const 稿 = useFormDraft({
    键: `线索转项目:${leadId}`,
    值: { content: f.content, 下一步时间: f.下一步时间 },
    带回: (v) => setF((o) => ({ ...o, ...(v.content !== undefined ? { content: v.content } : {}), ...(v.下一步时间 !== undefined ? { 下一步时间: v.下一步时间 } : {}) })),
    算填过: (改过) => !!改过.content?.trim(),
  });
  const 差 = !f.content.trim() ? "请填写首条跟进的沟通内容" : 要下一步 && !f.下一步时间 ? "请填下一步时间：到那天还没跟进，项目会自动回到线索公海" : "";
  const 行 = (label: string, el: React.ReactNode, 必填 = false) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 4 }}>{必填 && <span style={{ color: "var(--danger)" }}>* </span>}{label}</div>
      {el}
    </div>
  );
  return (
    <div data-testid="lead-convert-follow">
      {稿.提示}
      <p className="muted" style={{ marginTop: 0 }}>{说明}</p>
      <p style={{ fontWeight: 500 }}>首条跟进：这次和对方聊了什么</p>
      {行("沟通方式", (
        <FollowMethodSelect style={{ width: "100%" }} aria-label="沟通方式" type={f.type} method={f.method} 类型们={能选类型} onChange={(v) => { 人改了方式(); setF({ ...f, ...v }); }} />
      ), true)}
      {行("时间", (
        <DatePicker
          showTime={{ format: "HH:mm" }}
          format={时间格式}
          allowClear={false}
          style={{ width: "100%" }}
          value={dayjs(f.occurredAt, 时间格式)}
          disabledDate={(x) => x.isAfter(dayjs(), "day")}
          onChange={(v) => v && setF({ ...f, occurredAt: v.format(时间格式) })}
        />
      ), true)}
      {行("沟通内容", <Input.TextArea aria-label="沟通内容" rows={4} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} />, true)}
      {行("下一步时间", (
        <>
          <DatePicker
            style={{ width: "100%" }}
            value={f.下一步时间 ? dayjs(f.下一步时间) : null}
            disabledDate={(x) => x.isBefore(dayjs(), "day")}
            onChange={(v) => setF({ ...f, 下一步时间: v ? v.format("YYYY-MM-DD") : null })}
            placeholder="选一天"
          />
          <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>{要下一步 ? "到那天还没人跟进，项目会自动回到线索公海" : "选填：打算哪天再跟进，项目上会显示"}</div>
        </>
      ), 要下一步)}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button onClick={() => { 稿.丢掉(); 关(); }}>取消</Button>
        <Button
          type="primary"
          disabled={!!差}
          loading={交中}
          title={差 || undefined}
          onClick={async () => {
            set交中(true);
            try {
              if (await 交(f)) 稿.存好了();
            } finally {
              set交中(false);
            }
          }}
        >
          转为项目
        </Button>
      </div>
    </div>
  );
}
