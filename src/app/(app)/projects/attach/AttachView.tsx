"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, App, Button, Card, Empty, Modal, Skeleton, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { PageHead } from "@/components/ui";
import { dayjs } from "@/lib/utils";
import type { 待审批挂靠, 我的挂靠 } from "@/lib/enterprise/attach-approval";
import type { 客户只读卡 } from "@/lib/enterprise/customer-readonly-card";
import { 卡内容 } from "../[id]/CustomerReadonlyCard";
import { 批准挂靠, 拒绝挂靠, 打开挂靠只读卡 } from "./actions";

const 时刻 = (d: Date | string | null) => (d ? dayjs(d).format("YYYY-MM-DD HH:mm") : "");
const 省略 = { ellipsis: true } as const;

/**
 * 挂靠申请（P-挂靠-02）：等我审批的一张表（批准 / 拒绝），我申请过的一张表（批准了点开只读卡）。
 * 客户名、人名可能很长：表格固定列宽、单元格省略号，窄屏不横向溢出
 */
export default function AttachView({ 待批, 我的 }: { 待批: 待审批挂靠[]; 我的: 我的挂靠[] }) {
  const { message } = App.useApp();
  const router = useRouter();
  const [忙, set忙] = useState<string | null>(null);
  const [卡, set卡] = useState<{ 开着: boolean; 卡: 客户只读卡 | null; 错: string | null }>({ 开着: false, 卡: null, 错: null });

  const 审 = async (id: string, 批: boolean) => {
    set忙(id);
    const r = await (批 ? 批准挂靠 : 拒绝挂靠)(id).catch(() => ({ ok: false as const, error: "没办成，网络可能断了，再点一次" }));
    set忙(null);
    if (r.ok) {
      message.success(批 ? "已批准，对方拿到这家客户的只读卡" : "已拒绝");
      router.refresh();
    } else message.error(r.error);
  };
  const 开卡 = async (id: string) => {
    set卡({ 开着: true, 卡: null, 错: null });
    const r = await 打开挂靠只读卡(id).catch(() => ({ ok: false as const, error: "没打开，网络可能断了，再点一次" }));
    set卡({ 开着: true, 卡: r.ok ? r.卡 : null, 错: r.ok ? null : r.error });
  };

  const 待批列: ColumnsType<待审批挂靠> = [
    { title: "申请人", dataIndex: "申请人", width: 110, ...省略 },
    { title: "客户", dataIndex: "客户名", width: 180, ...省略, render: (v: string, r) => <>{v}{r.转来的 && <Tag style={{ marginInlineStart: 6 }}>超时转来</Tag>}</> },
    { title: "撞的", dataIndex: "撞的", width: 180, ...省略 },
    { title: "客户负责人", dataIndex: "负责人", width: 110, ...省略 },
    { title: "申请时间", dataIndex: "申请时间", width: 150, render: 时刻 },
    {
      title: "", key: "op", width: 150, render: (_, r) => (
        <Space size={4}>
          <Button size="small" type="primary" loading={忙 === r.id} disabled={!!忙} onClick={() => void 审(r.id, true)}>批准</Button>
          <Button size="small" disabled={!!忙} onClick={() => void 审(r.id, false)}>拒绝</Button>
        </Space>
      ),
    },
  ];
  const 我的列: ColumnsType<我的挂靠> = [
    { title: "客户", dataIndex: "客户名", width: 180, ...省略, render: (v: string | null) => v ?? "—" },
    { title: "撞的", dataIndex: "撞的", width: 180, ...省略 },
    { title: "状态", dataIndex: "状态", width: 120, render: (v: 我的挂靠["状态"]) => <Tag color={v === "已批准" ? "green" : v === "没批准" ? "default" : v === "客户已进公海" ? "orange" : "blue"}>{v}</Tag> },
    { title: "申请时间", dataIndex: "申请时间", width: 150, render: 时刻 },
    { title: "", key: "op", width: 110, render: (_, r) => r.状态 === "已批准" && <Button size="small" onClick={() => void 开卡(r.id)}>打开只读卡</Button> },
  ];

  return (
    <div>
      <PageHead title="挂靠申请" subtitle="同事撞上你负责的客户、申请一起跟：你批准后客户负责人不变，对方只拿到这家客户的只读卡；24 小时没处理会转给直属上级，没有上级转给总管理" />
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Card title="等我审批" size="small">
          {待批.length ? <Table rowKey="id" size="small" columns={待批列} dataSource={待批} pagination={false} tableLayout="fixed" scroll={{ x: 880 }} /> : <Empty description="没有等你审批的挂靠申请" />}
        </Card>
        <Card title="我的申请" size="small">
          {我的.length ? <Table rowKey="id" size="small" columns={我的列} dataSource={我的} pagination={false} tableLayout="fixed" scroll={{ x: 710 }} /> : <Empty description="还没申请过挂靠" />}
        </Card>
      </Space>
      <Modal open={卡.开着} title="客户资料（只读）" footer={<Button onClick={() => set卡((x) => ({ ...x, 开着: false }))}>关闭</Button>} onCancel={() => set卡((x) => ({ ...x, 开着: false }))} destroyOnHidden>
        {卡.错 ? <Alert type="warning" showIcon title={卡.错} /> : 卡.卡 ? <卡内容 卡={卡.卡} 没给的说法="不在你自己的项目上，联系方式不显示" /> : <Skeleton active paragraph={{ rows: 4 }} />}
      </Modal>
    </div>
  );
}
