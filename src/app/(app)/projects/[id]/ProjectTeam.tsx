"use client";

import { useState } from "react";
import dayjs from "dayjs";
import { Button, Card, Input, InputNumber, Modal, Popconfirm, Select, Space, Tag } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import { 币种选项, 默认币种 } from "@/lib/currency";
import { 金额格式 } from "@/lib/money-input";
import { 成员选项, 独自一人, type 可选成员 } from "@/lib/utils";
import { 项目名上限, 备注上限 } from "@/lib/project/wizard";
import ChannelPicker, { type 可选渠道 } from "@/components/ChannelPicker";
import AddressInput, { 空地址 } from "@/components/AddressInput";
import { 企业客户级别, 企业级别说明, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 级别星 } from "@/lib/enterprise/level-stars";
import { 详细地址上限, 详细地址提示, 成交需求上限, type 项目成交钱 } from "@/lib/project/profile-rules";
import { 合同状态们, 痛点标注上限, type 合同状态 } from "@/lib/project/proj-fields";
import { 编辑项目, 加项目组员, 换项目组员角色, 移出项目组员 } from "../actions";

type 跑法 = (f: () => Promise<{ ok: boolean; error?: string }>, 成了?: string) => Promise<boolean>;
export type 组员 = { id: string; userId: string; name: string; roleId: string | null; inviteStatus: string };
export type 角色 = { id: string; name: string; active: boolean };
export type 联系人 = { id: string; name: string; position: string | null };

/** 停用的角色不让新选；已经用着它的组员照样显示名字 */
function 角色选项(角色们: 角色[], 现在?: string | null) {
  return 角色们.filter((r) => r.active || r.id === 现在).map((r) => ({ value: r.id, label: r.active ? r.name : `${r.name}（已停用）` }));
}

const 邀请说法: Record<string, string> = { INVITED: "已邀请", DECLINED: "没接受" };

/**
 * 编辑项目：名称、负责人、金额 + 币种、备注、主联系人。规矩和建档向导第四步一样（服务端 规整项目）。
 * 企业版另有项目级别（S / A / B / C，显示成星）、所在地四格 + 详细地址（P11 定稿 -2 版）：和客户地址同一套组件和校验（AddressInput / 规整地址）；
 * 需求描述（原成交需求）、合同金额、定金金额（迁移 097）：两个金额和上面「金额」一样，左边币种下拉、右边数字连成一格（Space.Compact）；
 * 痛点标注（多行）、合同状态（七项单选）（迁移 101）：哪一项没传（不是企业版 / 字段权限藏了）就不摆、不交
 */
export function ProjectEditModal({
  open, onClose, 跑, p, 候选, 联系人们, 渠道们, 改负责人 = true,
}: {
  open: boolean;
  onClose: () => void;
  跑: 跑法;
  /** expectedDealAt：企业版才传（YYYY-MM-DD 或 null）；不传 = 不摆这格、不交 */
  p: {
    id: string; name: string; ownerId: string; amount: number; currency: string; remark: string | null; contactId: string | null; expectedDealAt?: string | null; channelId?: string | null;
    /** 企业版才传；不传 = 不摆、不交 */
    level?: string | null;
    /** 企业版、看得到客户资料才传（公海里同事客户的项目不给）；不传或 null = 不摆、不交 */
    所在地?: (客户地址 & { location: string | null }) | null;
    /** 企业版才传；不传 = 不摆、不交 */
    成交钱?: 项目成交钱;
    /** 企业版才传；里面哪个键没有 = 那一项不摆、不交 */
    项目新字段?: { painPoints?: string | null; contractStatus?: 合同状态 };
  };
  候选: 可选成员[];
  联系人们: 联系人[];
  /** 企业版项目来源可选的渠道；不传 = 不摆「项目来源」、不交 channelId */
  渠道们?: 可选渠道[];
  /** false = 不摆「负责人」这格（企业版换负责人走详情页的「转给…」，带 6 秒撤销） */
  改负责人?: boolean;
}) {
  // 父组件每次打开时才挂上，初值就是最新的
  const [d, setD] = useState({ name: p.name, ownerId: p.ownerId, amount: p.amount, currency: p.currency, remark: p.remark ?? "", contactId: p.contactId, expectedDealAt: p.expectedDealAt, channelId: 渠道们 ? (p.channelId ?? null) : undefined });
  const [级别, set级别] = useState(p.level ?? null);
  const [地址, set地址] = useState<客户地址>(p.所在地 ? { addrCountry: p.所在地.addrCountry, addrProvince: p.所在地.addrProvince, addrCity: p.所在地.addrCity, addrDistrict: p.所在地.addrDistrict } : 空地址);
  const [详细, set详细] = useState(p.所在地?.location ?? "");
  // 金额空着时币种下拉先摆人民币；金额没填交上去币种服务端会存空（项目成交钱改成）
  const [钱, set钱] = useState(p.成交钱 ? { ...p.成交钱, dealDemand: p.成交钱.dealDemand ?? "", contractCurrency: p.成交钱.contractCurrency ?? 默认币种, depositCurrency: p.成交钱.depositCurrency ?? 默认币种 } : null);
  const 新 = p.项目新字段;
  const [痛点, set痛点] = useState(新?.painPoints ?? "");
  const [合同, set合同] = useState<合同状态 | undefined>(新?.contractStatus);
  const [忙, set忙] = useState(false);
  const 改 = (x: Partial<typeof d>) => setD((o) => ({ ...o, ...x }));
  const 改钱 = (x: Partial<NonNullable<typeof 钱>>) => set钱((o) => (o ? { ...o, ...x } : o));
  // 没传的不交：服务端按「没传 = 不动」处理（项目级别和地址改成）
  const 附带 = {
    ...(p.level !== undefined ? { level: 级别 } : {}),
    ...(p.所在地 ? { ...地址, location: 详细.trim() || null } : {}),
    ...(钱 ? { ...钱, dealDemand: 钱.dealDemand.trim() || null } : {}),
    ...(新 && "painPoints" in 新 ? { painPoints: 痛点.trim() || null } : {}),
    ...(新?.contractStatus ? { contractStatus: 合同 } : {}),
  };
  const 行 = (label: string, el: React.ReactNode) => (
    <div style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 4, color: "var(--text-muted)" }}>{label}</div>
      {el}
    </div>
  );
  return (
    <Modal
      open={open}
      title="编辑项目"
      okText="保存"
      okButtonProps={{ loading: 忙, disabled: !d.name.trim() }}
      onCancel={onClose}
      onOk={async () => {
        set忙(true);
        const ok = await 跑(() => 编辑项目(p.id, { ...d, amount: d.amount ?? 0, ...附带 }), "已保存");
        set忙(false);
        if (ok) onClose();
      }}
    >
      {行("项目名称", <Input value={d.name} maxLength={项目名上限} showCount onChange={(e) => 改({ name: e.target.value })} />)}
      {p.level !== undefined && 行("项目级别", (
        <Select
          style={{ width: "100%" }}
          aria-label="项目级别"
          allowClear
          placeholder="不分级"
          value={级别 ?? undefined}
          options={企业客户级别.map((x) => ({ value: x, label: `${级别星(x)}  ${企业级别说明[x]}` }))}
          onChange={(v?: string) => set级别(v ?? null)}
        />
      ))}
      {改负责人 && !独自一人(候选, d.ownerId) && 行("负责人", (
        <Select style={{ width: "100%" }} value={d.ownerId} options={成员选项(候选)} onChange={(v) => 改({ ownerId: v })} />
      ))}
      {行("主联系人", (
        <Select
          style={{ width: "100%" }}
          allowClear
          placeholder="不填"
          value={d.contactId ?? undefined}
          options={联系人们.map((c) => ({ value: c.id, label: c.position ? `${c.name} · ${c.position}` : c.name }))}
          onChange={(v) => 改({ contactId: v ?? null })}
        />
      ))}
      {行("金额", (
        <Space.Compact style={{ width: "100%" }}>
          <Select style={{ width: 140 }} value={d.currency} options={币种选项()} onChange={(v) => 改({ currency: v })} showSearch optionFilterProp="label" />
          <InputNumber<number> style={{ width: "100%" }} min={0} value={d.amount} formatter={金额格式} onChange={(v) => 改({ amount: v ?? 0 })} />
        </Space.Compact>
      ))}
      {钱 && 行("定金金额", (
        <Space.Compact style={{ width: "100%" }}>
          <Select style={{ width: 140 }} aria-label="定金金额币种" value={钱.depositCurrency} options={币种选项()} onChange={(v) => 改钱({ depositCurrency: v })} showSearch optionFilterProp="label" />
          <InputNumber<number> style={{ width: "100%" }} aria-label="定金金额" min={0} placeholder="待填写定金金额" value={钱.depositAmount} formatter={金额格式} onChange={(v) => 改钱({ depositAmount: v ?? null })} />
        </Space.Compact>
      ))}
      {钱 && 行("合同金额", (
        <Space.Compact style={{ width: "100%" }}>
          <Select style={{ width: 140 }} aria-label="合同金额币种" value={钱.contractCurrency} options={币种选项()} onChange={(v) => 改钱({ contractCurrency: v })} showSearch optionFilterProp="label" />
          <InputNumber<number> style={{ width: "100%" }} aria-label="合同金额" min={0} placeholder="待填写合同金额" value={钱.contractAmount} formatter={金额格式} onChange={(v) => 改钱({ contractAmount: v ?? null })} />
        </Space.Compact>
      ))}
      {新?.contractStatus && 行("合同状态", <Select style={{ width: "100%" }} aria-label="合同状态" value={合同} options={合同状态们.map((v) => ({ value: v, label: v }))} onChange={(v) => set合同(v)} />)}
      {钱 && 行("需求描述", <Input.TextArea aria-label="需求描述" rows={2} maxLength={成交需求上限} placeholder="客户想买什么、要多少" value={钱.dealDemand} onChange={(e) => 改钱({ dealDemand: e.target.value })} />)}
      {新 && "painPoints" in 新 && 行("痛点标注", <Input.TextArea aria-label="痛点标注" rows={3} maxLength={痛点标注上限} placeholder="客户现在卡在哪、最着急解决什么" value={痛点} onChange={(e) => set痛点(e.target.value)} />)}
      {p.expectedDealAt !== undefined && 行("预计成交日期", (
        <DatePicker
          style={{ width: "100%" }}
          value={d.expectedDealAt ? dayjs(d.expectedDealAt) : null}
          onChange={(v) => 改({ expectedDealAt: v ? v.format("YYYY-MM-DD") : null })}
          placeholder="选一天"
        />
      ))}
      {渠道们 && 行("项目来源", (
        <ChannelPicker
          channels={渠道们}
          value={d.channelId ?? null}
          onChange={(v) => 改({ channelId: v })}
          allowClear
          placeholder="不填 = 渠道统计跟客户来源走"
          style={{ width: "100%" }}
          aria-label="项目来源"
        />
      ))}
      {p.所在地 && 行("所在地", <AddressInput value={地址} onChange={set地址} />)}
      {p.所在地 && 行("详细地址", <Input aria-label="详细地址" placeholder={详细地址提示} maxLength={详细地址上限} value={详细} onChange={(e) => set详细(e.target.value)} />)}
      {行("备注", <Input.TextArea rows={3} maxLength={备注上限} showCount value={d.remark} onChange={(e) => 改({ remark: e.target.value })} />)}
    </Modal>
  );
}

/**
 * 项目组：谁在组里、各自什么角色。能管项目的人加人、换角色、移出；团队版拉进来就算进组。
 * 企业版（10-26）= 发邀请，对方在项目列表上点同意才进组；没接受的可以再邀一次；组长 = 项目负责人
 */
export function ProjectTeamCard({
  projectId, 组员们, 角色们, 在职, 能改, 忙, 跑, 企业版 = false, 组长,
}: {
  projectId: string;
  组员们: 组员[];
  角色们: 角色[];
  在职: 可选成员[];
  能改: boolean;
  忙: boolean;
  跑: 跑法;
  企业版?: boolean;
  组长?: string;
}) {
  const [加谁, set加谁] = useState<string | undefined>();
  const [加角色, set加角色] = useState<string | undefined>();
  const 在组 = new Set(组员们.filter((m) => !(企业版 && m.inviteStatus === "DECLINED")).map((m) => m.userId));
  const 可加 = 在职.filter((u) => !在组.has(u.id));
  const 不能改 = 能改 ? undefined : "只有项目负责人、老板或主管能改";

  return (
    <Card title="项目组">
      {企业版 && 组长 && <div style={{ marginBottom: 8 }}>组长：{组长}</div>}
      {组员们.length === 0 && <div style={{ color: "var(--text-muted)", marginBottom: 8 }}>还没有拉人进项目组</div>}
      {组员们.map((m) => (
        <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, minWidth: 0 }}>
          <span style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.name}>{m.name}</span>
          {邀请说法[m.inviteStatus] && <Tag>{邀请说法[m.inviteStatus]}</Tag>}
          <Select
            style={{ width: 140, flex: "0 0 auto" }}
            size="small"
            allowClear
            placeholder="不填角色"
            aria-label={`${m.name}的角色`}
            disabled={!能改 || 忙}
            title={不能改}
            value={m.roleId ?? undefined}
            options={角色选项(角色们, m.roleId)}
            onChange={(v) => void 跑(() => 换项目组员角色(m.id, v ?? null))}
          />
          {能改 && (
            <Popconfirm title={`把${m.name}移出项目组？`} okText="移出" okButtonProps={{ danger: true }} onConfirm={() => void 跑(() => 移出项目组员(m.id), "已移出")}>
              <Button size="small" type="text" danger disabled={忙}>移出</Button>
            </Popconfirm>
          )}
        </div>
      ))}
      {能改 && (
        <Space.Compact style={{ width: "100%", marginTop: 4 }}>
          <Select
            style={{ flex: "1 1 auto", minWidth: 0 }}
            placeholder={可加.length ? "选一位成员" : "在职成员都在组里了"}
            aria-label="要加进项目组的成员"
            disabled={!可加.length || 忙}
            showSearch
            optionFilterProp="label"
            value={加谁}
            options={成员选项(可加)}
            onChange={set加谁}
          />
          <Select style={{ width: 120 }} allowClear placeholder="角色" aria-label="新组员的角色" disabled={忙} value={加角色} options={角色选项(角色们)} onChange={set加角色} />
          <Button
            disabled={!加谁 || 忙}
            onClick={async () => {
              if (!加谁) return;
              if (await 跑(() => 加项目组员(projectId, 加谁, 加角色 ?? null), 企业版 ? "已发邀请，等对方同意" : "已加进项目组")) {
                set加谁(undefined);
                set加角色(undefined);
              }
            }}
          >
            {企业版 ? "邀请" : "加进来"}
          </Button>
        </Space.Compact>
      )}
    </Card>
  );
}
