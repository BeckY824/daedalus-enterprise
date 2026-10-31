"use client";

/**
 * 客户页「新增项目」弹窗（企业版项目模式，2026-10-29，定稿 P5 待定 16）：客户自动带上，只填项目和首条沟通。
 * 几格和建档向导第四、五步一样（projects/new/ProjectWizard.tsx），校验以服务端为准（project-actions.ts 给客户建项目）。
 * 10-31 会议 U-客户-05：用开项目那套向导界面——上面同一排步骤，前 3 步（查重、联系人、客户）带出现有的、标成已完成，
 * 从「项目」那步开始：先填项目信息，下一步再填首条沟通
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dayjs } from "dayjs";
import { App, Button, Form, Input, Modal, Radio, Select, Steps } from "antd";
import DatePicker from "@/components/BusinessDatePicker";
import { useBusiness } from "@/lib/business-client";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { 外贸精简 } from "@/lib/business-config";
import { 成员选项, dayjs, type 可选成员 } from "@/lib/utils";
import { 项目名上限 } from "@/lib/project/wizard";
import { 给客户建项目 } from "./project-actions";

const 时间格式 = "YYYY-MM-DD HH:mm";
/** 和建档向导同一排步骤（ProjectWizard 步骤们）；这里前 3 步已带上 */
const 向导步骤 = ["查重", "联系人", "客户", "项目", "首条沟通"] as const;
const 跳过几步 = 3;

/** 「项目」这一步的格：下一步前先校验这几格 */
const 项目格 = ["name", "ownerId", "联系人Id"] as const;

type 表单 = {
  name: string;
  ownerId?: string;
  联系人Id?: string;
  type: string;
  method?: string | null;
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
  const 类型 = Form.useWatch("type", form);
  const 方式 = Form.useWatch("method", form);
  const [存着, set存着] = useState(false);
  /** 0 = 项目，1 = 首条沟通 */
  const [步, set步] = useState(0);
  const 关 = () => {
    set步(0);
    onClose();
  };
  async function 下一步() {
    try {
      await form.validateFields([...项目格]);
    } catch {
      return;
    }
    set步(1);
  }
  const 能选类型 = 跟进类型们(外贸精简(b)).filter((t) => t.value !== "TASK" && t.value !== "REMIND");
  const 主 = 联系人们.find((c) => c.isPrimary) ?? 联系人们[0];

  async function 存() {
    let v: 表单;
    try {
      v = await form.validateFields();
    } catch (e) {
      // 项目那一步的格没过：退回那一步给人看
      const 错 = (e as { errorFields?: { name: (string | number)[] }[] }).errorFields ?? [];
      if (错.some((x) => (项目格 as readonly (string | number)[]).includes(x.name[0]))) set步(0);
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
          method: 对得上的方式(v.type, v.method),
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
      关();
      router.push(`/projects/${r.projectId}`);
    } finally {
      set存着(false);
    }
  }

  return (
    <Modal
      open={open}
      title="新增项目"
      width={640}
      onCancel={关}
      destroyOnHidden
      mask={{ closable: false }}
      footer={
        步 === 0
          ? [
              <Button key="x" onClick={关}>取消</Button>,
              <Button key="n" type="primary" onClick={下一步}>下一步</Button>,
            ]
          : [
              <Button key="b" onClick={() => set步(0)} disabled={存着}>上一步</Button>,
              <Button key="ok" type="primary" loading={存着} onClick={存}>建好</Button>,
            ]
      }
    >
      <Steps
        current={跳过几步 + 步}
        size="small"
        style={{ marginBottom: 12 }}
        items={向导步骤.map((t, i) => ({ title: t, ...(i < 跳过几步 ? { status: "finish" as const } : {}) }))}
      />
      <div className="new-proj-carried" title={customerName}>客户：{customerName}（已带上）</div>
      {/* 两步共用一张表：另一步的格只藏起来、值留着，最后一起交（藏起来的格仍挂着；弹窗关了才卸掉，preserve=false 清值） */}
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
        <div style={步 === 0 ? undefined : { display: "none" }}>
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
        </div>
        <div style={步 === 1 ? undefined : { display: "none" }}>
        <Form.Item name="type" hidden rules={[{ required: true }]}><Input /></Form.Item>
        <Form.Item name="method" hidden><Input /></Form.Item>
        <Form.Item label="沟通方式" required>
          <FollowMethodSelect aria-label="沟通方式" type={类型 ?? 能选类型[0]?.value ?? "PHONE"} method={方式} 类型们={能选类型} onChange={(v) => form.setFieldsValue(v)} />
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
        </div>
      </Form>
    </Modal>
  );
}
