"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Empty, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHead } from "@/components/ui";
import InlineConfirm from "@/components/InlineConfirm";
import { dayjs } from "@/lib/utils";
import { 撤回客户合并申请, type 合并申请一条 } from "../merge-actions";
import { 凭叫法, 等待工作日 } from "../merge-request-words";
import "../merge.css";

const 时刻 = (d: Date | string | null) => (d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "");
const 省略 = { ellipsis: true } as const;
const 天 = 86_400_000;

/** 两家：「并进来那家 → 留下那家」（名字取发起那一刻的快照） */
export const 两家话 = (r: Pick<合并申请一条, "留下" | "并掉">) => `「${r.并掉.名}」并进「${r.留下.名}」`;
/** 已同意几位 / 共几位（发起人不在同意人里，发起即算同意） */
export const 同意进度 = (r: Pick<合并申请一条, "同意人">) => `${r.同意人.filter((x) => x.状态 === "同意").length} / ${r.同意人.length} 位同意`;
/** 还剩几天失效（不足一天按 1 天说；到点了说「今天到期」） */
export function 剩几天(到期: Date | string, 现在 = Date.now()): string {
  const 差 = new Date(到期).getTime() - 现在;
  if (差 <= 0) return "已到期";
  return `还剩 ${Math.max(1, Math.ceil(差 / 天))} 天`;
}
/** 已等几天（发起当天算 0 天，说「今天发起」） */
export function 等了几天(发起: Date | string, 现在 = Date.now()): string {
  const n = Math.floor((现在 - new Date(发起).getTime()) / 天);
  return n <= 0 ? "今天发起" : `已等 ${n} 天`;
}
const 状态色: Record<string, string> = { 待同意: "blue", 执行中: "blue", 已合并: "green", 已拒绝: "red", 已失效: "default", 已撤回: "default" };

/** 一位同意人在「我发起的」里：「张三 同意」「李四 待同意」「王五 拒绝：原因」 */
const 同意人话 = (x: 合并申请一条["同意人"][number]) => `${x.名} ${x.状态}${x.状态 === "拒绝" && x.一句 ? `：${x.一句}` : ""}`;

/**
 * 合并申请（第二批 2b-3 第一段）：等我同意的一张表，我发起的一张表（待同意时可撤回申请）。
 * 客户名、人名可能很长：表格固定列宽、单元格省略号（悬停看全），窄屏横向在表格里滚，不撑出页面。
 * 等我同意的这一段只列，同意 / 拒绝在第二段接上
 */
export default function MergeRequestsView({ 等我, 我发起, 我 }: { 等我: 合并申请一条[]; 我发起: 合并申请一条[]; 我: string }) {
  const router = useRouter();
  const [忙, set忙] = useState<string | null>(null);
  /** 没办成的原因：就地写在那一行的操作格里；办成了刷新后这一行变成已撤回 */
  const [行错, set行错] = useState<{ id: string; 话: string } | null>(null);

  const 撤 = async (id: string) => {
    set忙(id);
    set行错(null);
    const r = await 撤回客户合并申请(id).catch(() => ({ ok: false as const, error: "没办成，网络可能断了，再点一次" }));
    set忙(null);
    if (r.ok) {
      router.refresh();
      return { ok: true };
    }
    set行错({ id, 话: r.error });
    return r;
  };

  const 等我列: ColumnsType<合并申请一条> = [
    { title: "合并", key: "两家", width: 260, ...省略, render: (_, r) => <span title={两家话(r)}>{两家话(r)}</span> },
    { title: "发起人", dataIndex: "发起人", width: 100, ...省略 },
    {
      title: "要我同意是因为", key: "凭", width: 240, ...省略, render: (_, r) => {
        const 我那行 = r.同意人.find((x) => x.userId === 我);
        const 话 = 我那行 ? [...我那行.凭.map((v) => 凭叫法[v]), ...(我那行.项目.length ? [`${我那行.项目.length} 个项目：${我那行.项目.map((p) => p.name).join("、")}`] : [])].join("；") : "";
        return <span title={话}>{话}</span>;
      },
    },
    { title: "进度", key: "进度", width: 110, render: (_, r) => 同意进度(r) },
    { title: "发起时间", dataIndex: "发起", width: 150, render: 时刻 },
    { title: "失效", key: "到期", width: 100, render: (_, r) => <span title={`${时刻(r.到期)} 前没全部同意就失效`}>{剩几天(r.到期)}</span> },
  ];
  const 我发起列: ColumnsType<合并申请一条> = [
    { title: "合并", key: "两家", width: 260, ...省略, render: (_, r) => <span title={两家话(r)}>{两家话(r)}</span> },
    { title: "状态", dataIndex: "状态", width: 90, render: (v: string) => <Tag color={状态色[v] ?? "default"}>{v}</Tag> },
    {
      title: "同意人", key: "同意人", width: 260, ...省略, render: (_, r) => {
        const 话 = r.同意人.map(同意人话).join("，");
        return <span title={话}>{话}</span>;
      },
    },
    {
      title: "时间", key: "时间", width: 170, ...省略, render: (_, r) => {
        const 话 = r.状态 === "待同意" ? `${等了几天(r.发起)}，${剩几天(r.到期)}` : r.结束 ? `${时刻(r.结束)} 结束` : 时刻(r.发起);
        return <span title={`${时刻(r.发起)} 发起${r.原因 ? `；${r.原因}` : ""}`}>{话}</span>;
      },
    },
    {
      title: "", key: "op", width: 150, render: (_, r) => r.状态 === "待同意" && (
        <div className="ls-at-op">
          <InlineConfirm 问="撤回后同意人不用再处理，要并得重新发" 是="撤回申请" 中性 做={() => 撤(r.id)}>
            <Button size="small" disabled={!!忙 && 忙 !== r.id} data-testid="merge-request-withdraw">撤回申请</Button>
          </InlineConfirm>
          {行错?.id === r.id && <div className="ls-row-err" role="alert" title={行错.话}>{行错.话}</div>}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHead title="合并申请" subtitle={`同事负责的客户，或名下有同事在推的项目，合并要发申请：要同意的人都同意了才合并；${等待工作日} 个工作日内没全部同意，申请失效`} />
      <div className="mrq-stack">
        <Card title="等我同意" size="small">
          {等我.length ? <Table rowKey="id" size="small" columns={等我列} dataSource={等我} pagination={false} tableLayout="fixed" scroll={{ x: 960 }} data-testid="merge-req-wait" /> : <Empty description="没有等你同意的合并申请" />}
        </Card>
        <Card title="我发起的" size="small">
          {我发起.length ? <Table rowKey="id" size="small" columns={我发起列} dataSource={我发起} pagination={false} tableLayout="fixed" scroll={{ x: 930 }} data-testid="merge-req-mine" /> : <Empty description="还没发过合并申请" />}
        </Card>
      </div>
    </div>
  );
}
