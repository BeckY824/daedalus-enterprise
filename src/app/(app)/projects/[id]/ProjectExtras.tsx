"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Card, InputNumber, Select, Space } from "antd";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import DatePicker from "@/components/BusinessDatePicker";
import InlineConfirm from "@/components/InlineConfirm";
import type { 项目画像键 } from "@/lib/enterprise/dict-kinds";
import { 币种选项, 金额, 合计文字, 按币种合计, 默认币种 } from "@/lib/currency";
import { dayjs } from "@/lib/utils";
import type { 回款 } from "@/lib/project/payment-db";
import { 改项目画像Action } from "../actions";
import { 记回款, 删回款 } from "../payment-actions";

/** 项目画像（企业版 P11）：五项字典（所在地、级别在编辑项目框里改）。选项 = 启用着的 + 这个项目已经存着、后来停用的（不然下拉里显示不出来） */
export type 项目画像 = {
  项们: { 键: 项目画像键; 名: string; 多选: boolean; 选项: string[] }[];
  值: Partial<Record<Exclude<项目画像键, "productNeeds">, string | null>> & { productNeeds: string[] };
};

/** 没选的项写「待选择X」（浅灰，和输入框占位同色），只是显示 */
const 空 = (名: string) => <span style={{ color: "var(--text-faint)" }}>待选择{名}</span>;

/**
 * 「项目画像」卡：能改的人改一项存一项（下拉选了就存），不能改的只看。
 * 存失败（选项刚被停用、没权限了）提示原因并回到存之前的样子
 */
export function ProjectProfileCard({ projectId, 画像, 能改 }: { projectId: string; 画像: 项目画像; 能改: boolean }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [值, set值] = useState(画像.值);
  const [忙, set忙] = useState(false);
  // 服务端刷新后（别人改了、自己存完 router.refresh）跟着新值走；渲染时比上一次的，不用 effect
  const [上次, set上次] = useState(画像);
  if (画像 !== 上次) {
    set上次(画像);
    set值(画像.值);
  }

  const 存 = async (patch: Parameters<typeof 改项目画像Action>[1], 回退: () => void) => {
    set忙(true);
    try {
      const r = await 改项目画像Action(projectId, patch);
      if (!r.ok) {
        message.error(r.error);
        回退();
      } else router.refresh();
    } finally {
      set忙(false);
    }
  };

  return (
    <Card title="项目画像">
      <div className="proj-profile">
        {画像.项们.map((项) => (
          <div key={项.键} className="proj-profile-row">
            <span className="proj-profile-key">{项.名}</span>
            <div className="proj-profile-val">
              {!能改 ? (
                项.多选 ? (值.productNeeds.length ? 值.productNeeds.join("、") : 空(项.名)) : (值[项.键 as Exclude<项目画像键, "productNeeds">] ?? 空(项.名))
              ) : 项.多选 ? (
                <Select
                  mode="multiple"
                  aria-label={项.名}
                  style={{ width: "100%" }}
                  placeholder={`待选择${项.名}（可多选）`}
                  allowClear
                  disabled={忙}
                  value={值.productNeeds}
                  options={项.选项.map((x) => ({ value: x, label: x }))}
                  onChange={(v: string[]) => {
                    const 原 = 值.productNeeds;
                    set值({ ...值, productNeeds: v });
                    void 存({ productNeeds: v }, () => set值((s) => ({ ...s, productNeeds: 原 })));
                  }}
                />
              ) : (
                <Select
                  aria-label={项.名}
                  style={{ width: "100%" }}
                  placeholder={`待选择${项.名}`}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  disabled={忙}
                  value={值[项.键 as Exclude<项目画像键, "productNeeds">] ?? undefined}
                  options={项.选项.map((x) => ({ value: x, label: x }))}
                  onChange={(v?: string) => {
                    const k = 项.键 as Exclude<项目画像键, "productNeeds">;
                    const 原 = 值[k] ?? null;
                    set值({ ...值, [k]: v ?? null });
                    void 存({ [k]: v ?? null }, () => set值((s) => ({ ...s, [k]: 原 })));
                  }}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** 「附件」卡（企业版 P11）：10-31 起分三张——合同附件 / 项目方案 / 其它附件（分类 = Attachment.tag）；看得到项目就能看、能改项目才能传和删（接口 api/attachments/access.ts 认项目） */
export function ProjectAttachmentsCard({ projectId, 分类, 标题, 起始个数, 只读 }: { projectId: string; 分类: "合同" | "方案" | "其它"; 标题: string; 起始个数: number; 只读: boolean }) {
  const [个数, set个数] = useState(起始个数);
  return (
    <Card title={`${标题}（${个数}）`}>
      <AttachmentsPanel 归属={{ projectId }} 分类={分类} 只读={只读} on个数={set个数} />
    </Card>
  );
}

/**
 * 「回款」卡（2026-10-31，迁移 100）：一笔一行（时间、币种、金额），上面写当前回款（按币种加，不换汇）。
 * 只加、删：记错了删掉重记。能改 = 能改这个项目；字段权限「商机金额」锁了的，服务端拦并回一句人话
 */
export function ProjectPaymentsCard({ projectId, 回款们, 能改, 默认: 默认币 }: { projectId: string; 回款们: 回款[]; 能改: boolean; 默认?: string }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [日, set日] = useState<string | null>(dayjs().format("YYYY-MM-DD"));
  const [币, set币] = useState(默认币 ?? 默认币种);
  const [数, set数] = useState<number | null>(null);
  const [忙, set忙] = useState(false);
  const 合计 = 回款们.length ? 合计文字(按币种合计(回款们, (x) => x.amount, (x) => x.currency)) : "还没有回款";

  async function 记() {
    if (!日 || !数) return;
    set忙(true);
    try {
      const r = await 记回款(projectId, { paidAt: 日, currency: 币, amount: 数 });
      if (!r.ok) { message.error(r.error); return; }
      message.success("自动推到" in r && r.自动推到?.length ? `已记一笔回款，必填齐了，自动推到「${r.自动推到.join("」→「")}」` : "已记一笔回款");
      set数(null);
      router.refresh();
    } finally { set忙(false); }
  }

  async function 删(id: string) {
    const r = await 删回款(id);
    if (!r.ok) { message.error(r.error); return; }
    message.success("已删掉这笔回款");
    router.refresh();
  }

  return (
    <Card title={`回款（${回款们.length}）`}>
      <div style={{ marginBottom: 8 }}>当前回款：<b style={{ overflowWrap: "anywhere" }}>{合计}</b></div>
      {回款们.map((x) => (
        <div key={x.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "4px 0", borderTop: "1px solid var(--line-soft)" }}>
          <span style={{ color: "var(--text-muted)" }}>{dayjs(x.paidAt).format("YYYY-MM-DD")}</span>
          <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{金额(x.amount, x.currency)}</span>
          {能改 && <InlineConfirm 问="删掉这笔回款" 做={() => 删(x.id)}><Button type="link" size="small" danger>删除</Button></InlineConfirm>}
        </div>
      ))}
      {能改 && (
        <Space wrap style={{ marginTop: 8 }}>
          <DatePicker aria-label="回款时间" allowClear={false} value={日 ? dayjs(日, "YYYY-MM-DD") : null} onChange={(v) => set日(v ? v.format("YYYY-MM-DD") : null)} />
          <Select aria-label="回款币种" showSearch style={{ width: 130 }} value={币} options={币种选项()} onChange={(v: string) => set币(v)} />
          <InputNumber aria-label="回款金额" min={0.01} max={1e12} precision={2} placeholder="回款金额" style={{ width: 160 }} value={数} onChange={(v) => set数(typeof v === "number" ? v : null)} />
          <Button type="primary" loading={忙} disabled={!日 || !数} onClick={() => void 记()}>记一笔</Button>
        </Space>
      )}
    </Card>
  );
}

