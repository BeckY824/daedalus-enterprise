"use client";

/**
 * 客户页「新增项目」弹窗（企业版项目模式，2026-10-29，定稿 P5 待定 16）：客户自动带上，只填项目和首条沟通。
 * 几格和建档向导第四、五步一样（projects/new/ProjectWizard.tsx），校验以服务端为准（project-actions.ts 给客户建项目）。
 * 10-31 会议 U-客户-05：用开项目那套向导界面——上面同一排步骤，前 3 步（查重、联系人、客户）带出现有的、标成已完成，
 * 从「项目」那步开始：先填项目信息，下一步再填首条沟通。
 * 11-01 会议 §6：建好不跳去项目页，留在客户页刷新，提示里带「去看看」
 * 11-01 会议 §3：加「分配方式」（默认按业务角色，A6）和「业务线」（内贸 / 外贸 / 暂不分配，必填，默认带客户的业务线，A1）；
 * 只有指定分配要选负责人，其余建在我名下、建好按分配方式走（服务端 给客户建项目）
 * 11-02：加选填的「项目所在地」（四格 + 详细地址，项目自己的，不看客户 / 联系人地址）；填了按所在地给业务线建议——
 * 没手动选过业务线就预填建议、旁边写「请确认」；手动选过不覆盖，和建议不一样时提示一句。点「建好」= 确认
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Dayjs } from "dayjs";
import { Alert, App, Button, Form, Input, Modal, Select, Steps } from "antd";
import { 下一步文字上限 } from "@/lib/project/project-fields";
import { 有效线索节点 } from "@/lib/project/stage-gates";
import { 没业务角色不能新建话 } from "@/lib/enterprise/permissions";
import DatePicker from "@/components/BusinessDatePicker";
import { useBusiness } from "@/lib/business-client";
import { 跟进类型们 } from "@/lib/constants";
import FollowMethodSelect from "@/components/FollowMethodSelect";
import { 对得上的方式 } from "@/lib/follow-method";
import { 外贸精简 } from "@/lib/business-config";
import { 成员选项, dayjs, type 可选成员 } from "@/lib/utils";
import { 项目名上限 } from "@/lib/project/wizard";
import { 详细地址上限, 详细地址提示 } from "@/lib/project/profile-rules";
import AddressInput, { 空地址 } from "@/components/AddressInput";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";
import { 给客户建项目, 建项目带走的项目, 新项目分配数据, type 新项目分配数据 as 分配数据 } from "./project-actions";
import { useCarryConfirm } from "../useCarryConfirm";
import { 三种业务线, 分配说明, 销售自动分确认, 建议业务线, 所在地预填, 所在地提示, type 项目线 } from "@/lib/enterprise/assign-line";

const 时间格式 = "YYYY-MM-DD HH:mm";
/** 和建档向导同一排步骤（ProjectWizard 步骤们）；这里前 3 步已带上 */
const 向导步骤 = ["查重", "联系人", "客户", "项目", "首条沟通"] as const;
const 跳过几步 = 3;

/** 「项目」这一步的格：下一步前先校验这几格 */
const 项目格 = ["name", "分配方式", "业务线", "ownerId", "联系人Id"] as const;
type 表单 = {
  name: string;
  分配方式?: number;
  业务线?: 项目线;
  ownerId?: string;
  联系人Id?: string;
  type: string;
  method?: string | null;
  occurredAt: Dayjs;
  content: string;
  节点?: string;
  下一步时间?: Dayjs | null;
  /** 下一步计划（11-05，代替「客户明确回复了吗」）：开了超时回收时必填 */
  下一步?: string;
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
  const { message, modal } = App.useApp();
  const 问一起转 = useCarryConfirm();
  const router = useRouter();
  const b = useBusiness();
  const [form] = Form.useForm<表单>();
  const 类型 = Form.useWatch("type", form);
  const 方式 = Form.useWatch("method", form);
  const [存着, set存着] = useState(false);
  // 分配方式、业务线默认值：打开时问服务端（没开 / 取不到 = 不摆这两格，和原来一样直接选负责人）
  const [分配, set分配] = useState<分配数据 | null>(null);
  // 项目所在地（选填）和「业务线手动选过没有」：客户默认带的业务线不算手动选，所在地建议可以换掉它
  const [地址, set地址] = useState<客户地址>(空地址);
  const [详细, set详细] = useState("");
  const 手选 = useRef(false);
  useEffect(() => {
    if (!open) return;
    let 还在 = true;
    void 新项目分配数据(customerId).then((x) => {
      if (!还在 || !x) return;
      set分配(x);
      const 默认 = x.默认分配方式 ?? (x.分配方式们.length === 1 ? x.分配方式们[0].i : undefined);
      if (form.getFieldValue("分配方式") === undefined && 默认 !== undefined) form.setFieldValue("分配方式", 默认);
      if (!form.getFieldValue("业务线") && x.客户业务线) form.setFieldValue("业务线", x.客户业务线);
    }).catch(() => {});
    return () => {
      还在 = false;
    };
  }, [open, customerId, form]);
  const 分配方式 = Form.useWatch("分配方式", form);
  const 业务线 = Form.useWatch("业务线", form);
  const 建议 = 建议业务线(地址);
  const 线提示 = 所在地提示(建议, 业务线);
  const 改地址 = (a: 客户地址) => {
    set地址(a);
    const 预填 = 所在地预填(建议业务线(a), form.getFieldValue("业务线"), 手选.current);
    if (预填) form.setFieldValue("业务线", 预填);
  };
  const 有分配 = !!分配 && 分配.分配方式们.length > 0;
  // 只有指定分配（或没有分配方式可选）要选负责人
  const 要负责人 = !有分配 || 分配方式 === 0;
  /** 0 = 项目，1 = 首条沟通 */
  const [步, set步] = useState(0);
  const 关 = () => {
    set步(0);
    set地址(空地址);
    set详细("");
    手选.current = false;
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
    } catch {
      return 真存();
    }
    // 销售选自动分配：分出去后就看不到这个项目了，先确认一次（A9）
    if (分配?.是销售 && v.分配方式 === 1) {
      modal.confirm({ title: "按自动分配建", content: 销售自动分确认, okText: "确定，分出去", cancelText: "再想想", onOk: () => void 真存() });
      return;
    }
    return 真存();
  }

  async function 真存() {
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
      // P-转-07：这次走 X-18、客户名下有同事的项目，会一起转走的先列出来（同分配弹窗）；取消就不建，弹窗留着
      const 负责人 = 要负责人 ? v.ownerId ?? null : null;
      if (!(await 问一起转(() => 建项目带走的项目(customerId, { ownerId: 负责人, ...(有分配 ? { 分配方式: v.分配方式 ?? null, 业务线: v.业务线 ?? null } : {}) })))) return;
      const r = await 给客户建项目({
        customerId,
        联系人Id: v.联系人Id ?? null,
        项目: {
          name: v.name,
          ownerId: 负责人,
          ...(有分配 ? { 分配方式: v.分配方式 ?? null, 业务线: v.业务线 ?? null } : {}),
          所在地: { ...地址, location: 详细.trim() || null },
        },
        跟进: {
          type: v.type,
          method: 对得上的方式(v.type, v.method),
          content: v.content,
          occurredAt: v.occurredAt.format(时间格式),
          下一步时间: v.下一步时间 ? v.下一步时间.format("YYYY-MM-DD") : null,
          节点: v.节点,
          下一步: v.下一步?.trim() || null,
        },
      });
      if (!r.ok) {
        message.error(r.error);
        return;
      }
      // 市场把客户分给了销售（X-18）：这位客户我看不到了，留着刷新就是 404，回客户列表
      if (r.看不到客户了) {
        message.info(r.提示 ?? "客户已转出");
        关();
        router.push("/customers");
        return;
      }
      // 11-01 会议 §6：整套在弹窗里走完，不跳页；建好留在客户页（刷新出新项目），提示里给一个「去看看」
      message.success({
        content: (
          <span data-testid="new-project-done">
            项目建好了 <Link href={`/projects/${r.projectId}`}>去看看</Link>
          </span>
        ),
      });
      // 按分配方式分走了 / 进了公海 / 待分配：再补一句去向
      if (r.提示) (r.转走 ? message.info : message.warning)(r.提示);
      关();
      router.refresh();
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
              <Button key="n" type="primary" onClick={下一步} disabled={!!分配?.没角色} title={分配?.没角色 ? 没业务角色不能新建话 : undefined}>下一步</Button>,
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
      {/* 没设业务角色：哪种分配方式都用不了，一打开就说清，别填完才被拦（D3-6） */}
      {分配?.没角色 && <Alert type="warning" showIcon style={{ marginBottom: 12 }} title={没业务角色不能新建话} />}
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
        <Form.Item label="项目所在地" extra="选填；项目在哪就填哪（不是客户地址），填了会按所在地建议业务线">
          <AddressInput value={地址} onChange={改地址} />
        </Form.Item>
        <Form.Item label="详细地址">
          <Input aria-label="详细地址" placeholder={详细地址提示} maxLength={详细地址上限} value={详细} onChange={(e) => set详细(e.target.value)} />
        </Form.Item>
        {有分配 && (
          <Form.Item
            name="分配方式"
            label="分配方式"
            rules={[{ required: true, message: "请选分配方式" }]}
            extra={分配方式 !== undefined ? 分配说明[分配方式] : undefined}
          >
            <Select placeholder="选分配方式" options={分配!.分配方式们.map((x) => ({ value: x.i, label: x.名 }))} />
          </Form.Item>
        )}
        {有分配 && (
          <Form.Item
            name="业务线"
            label="业务线"
            rules={[{ required: true, message: "请选业务线（内贸 / 外贸 / 暂不分配）" }]}
            extra={
              <>
                {线提示 && <div data-testid="new-project-bizline-hint" style={线提示.同 ? undefined : { color: "var(--warning-text)" }}>{线提示.话}</div>}
                自动分配只分给这条线的销售；暂不分配 = 不自动分，留在新线索等人指派。超时回收按这条线的时长算
              </>
            }
          >
            <Select
              placeholder="内贸 / 外贸 / 暂不分配"
              options={三种业务线.map((x) => ({ value: x, label: x }))}
              onChange={() => {
                手选.current = true;
              }}
            />
          </Form.Item>
        )}
        {要负责人 && (
          <Form.Item name="ownerId" label="负责人" rules={[{ required: true, message: "请选项目负责人" }]}>
            <Select placeholder="选项目负责人" options={成员选项(users)} showSearch optionFilterProp="label" />
          </Form.Item>
        )}
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
          <Select options={节点们.slice(0, 节点们.indexOf(有效线索节点) + 1 || undefined).map((n) => ({ value: n, label: n }))} />
        </Form.Item>
        <Form.Item
          name="下一步时间"
          label="下一步时间"
          rules={要下一步 ? [{ required: true, message: "请填下一步时间：到那天还没跟进，项目会自动回到线索公海" }] : []}
          extra={要下一步 ? "到那天还没人跟进，项目会自动回到线索公海" : "选填：打算哪天再跟进，项目上会显示"}
        >
          <DatePicker style={{ width: "100%" }} disabledDate={(x) => x.isBefore(dayjs(), "day")} placeholder="选一天" />
        </Form.Item>
        <Form.Item name="下一步" label="下一步计划" rules={要下一步 ? [{ required: true, whitespace: true, message: "请写下一步做什么" }] : []}>
          <Input aria-label="下一步计划" maxLength={下一步文字上限} placeholder="下一步打算做什么，例如：发报价单" />
        </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
