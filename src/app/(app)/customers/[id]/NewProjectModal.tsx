"use client";

/**
 * 客户页「新建项目」弹窗（企业版项目模式，2026-10-29，定稿 P5 待定 16）：客户自动带上，只填项目和首条沟通。
 * 几格和建档向导第四、五步一样（projects/new/ProjectWizard.tsx），校验以服务端为准（project-actions.ts 给客户建项目）
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dayjs } from "dayjs";
import { App, Form, Input, Modal, Radio, Select } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import { useBusiness } from "@/lib/business-client";
import { 跟进类型们 } from "@/lib/constants";
import { 外贸精简 } from "@/lib/business-config";
import { 成员选项, dayjs, type 可选成员 } from "@/lib/utils";
import { 项目名上限 } from "@/lib/project/wizard";
import { 给客户建项目 } from "./project-actions";

const 时间格式 = "YYYY-MM-DD HH:mm";

type 表单 = {
  name: string;
  ownerId?: string;
  联系人Id?: string;
  type: string;
  occurredAt: Dayjs;
  content: string;
  节点?: string;
  明确回复?: boolean;
  下一步时间?: Dayjs | null;
};

export default function NewProjectModal({
  open,
  onClose,
  customerId,
  customerName,
  默认负责人,
  users,
  联系人们,
  节点们,
  要下一步,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string;
  /** 项目名默认带客户名（简称优先），能改 */
  customerName: string;
  默认负责人: string | null;
  users: 可选成员[];
  联系人们: { id: string; name: string; isPrimary: boolean }[];
  /** 线索阶段的节点（企业版字典），服务端给 */
  节点们: readonly string[];
  /** 开了超时回收：下一步时间必填 */
  要下一步: boolean;
}) {
  const { message } = App.useApp();
  const router = useRouter();
  const b = useBusiness();
  const [form] = Form.useForm<表单>();
  const [存着, set存着] = useState(false);
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  const 主 = 联系人们.find((c) => c.isPrimary) ?? 联系人们[0];

  async function 存() {
    let v: 表单;
    try {
      v = await form.validateFields();
    } catch {
      return;
    }
    set存着(true);
    try {
      const r = await 给客户建项目({
        customerId,
        联系人Id: v.联系人Id ?? null,
        项目: { name: v.name, ownerId: v.ownerId ?? null },
        跟进: {
          type: v.type,
          content: v.content,
          occurredAt: v.occurredAt.format(时间格式),
          下一步时间: v.下一步时间 ? v.下一步时间.format("YYYY-MM-DD") : null,
          节点: v.节点,
          明确回复: v.明确回复 ?? null,
        },
      });
      if (!r.ok) {
        message.error(r.error);
        return;
      }
      message.success("项目建好了");
      onClose();
      router.push(`/projects/${r.projectId}`);
    } finally {
      set存着(false);
    }
  }

  return (
    <Modal
      open={open}
      title="新建项目"
      okText="建好"
      cancelText="取消"
      onOk={存}
      onCancel={onClose}
      confirmLoading={存着}
      destroyOnHidden
      mask={{ closable: false }}
    >
      <div style={{ color: "var(--text-muted)", fontSize: 12, marginBottom: 12 }}>客户：{customerName}（自动带上）</div>
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{
          name: customerName.slice(0, 项目名上限),
          ownerId: 默认负责人 && users.some((u) => u.id === 默认负责人) ? 默认负责人 : undefined,
          联系人Id: 主?.id,
          type: 能选类型[0]?.value ?? "PHONE",
          occurredAt: dayjs(),
          节点: 节点们[0],
        }}
      >
        <Form.Item name="name" label="项目名称" rules={[{ required: true, whitespace: true, message: "请填写项目名称" }]}>
          <Input maxLength={项目名上限} showCount />
        </Form.Item>
        <Form.Item name="ownerId" label="负责人" rules={[{ required: true, message: "请选项目负责人" }]}>
          <Select placeholder="选项目负责人" options={成员选项(users)} showSearch optionFilterProp="label" />
        </Form.Item>
        {联系人们.length > 0 && (
          <Form.Item name="联系人Id" label="联系人">
            <Select options={联系人们.map((c) => ({ value: c.id, label: c.isPrimary ? `${c.name}（主要）` : c.name }))} />
          </Form.Item>
        )}
        <Form.Item name="type" label="沟通方式" rules={[{ required: true }]}>
          <Select options={能选类型.map((t) => ({ value: t.value, label: t.label }))} />
        </Form.Item>
        <Form.Item name="occurredAt" label="时间" rules={[{ required: true, message: "请选时间" }]}>
          <DatePicker showTime={{ format: "HH:mm" }} format={时间格式} allowClear={false} style={{ width: "100%" }} disabledDate={(x) => x.isAfter(dayjs(), "day")} />
        </Form.Item>
        <Form.Item name="content" label="沟通内容" rules={[{ required: true, whitespace: true, message: "请填写首条跟进的沟通内容" }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="节点" label="当前进程" rules={[{ required: true, message: "请选当前进程（线索阶段的哪一步）" }]}>
          <Select options={节点们.map((n) => ({ value: n, label: n }))} />
        </Form.Item>
        <Form.Item name="明确回复" label="客户明确回复了吗" rules={[{ required: true, message: "请选：客户明确回复了吗" }]}>
          <Radio.Group>
            <Radio value={true}>明确回复了</Radio>
            <Radio value={false}>没有明确回复</Radio>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="下一步时间"
          label="下一步时间"
          rules={要下一步 ? [{ required: true, message: "请填下一步时间：到那天还没跟进，项目会自动回到项目公海" }] : []}
          extra={要下一步 ? "到那天还没人跟进，项目会自动回到项目公海" : "选填：打算哪天再跟进，项目上会显示"}
        >
          <DatePicker style={{ width: "100%" }} disabledDate={(x) => x.isBefore(dayjs(), "day")} placeholder="选一天" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
