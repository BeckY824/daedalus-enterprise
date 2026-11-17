"use client";

import CopyValue from "@/components/CopyValue";
import AttachmentsPanel from "@/components/AttachmentsPanel";
import { requiredText } from "@/lib/form-validation";

import { 签约叫 } from "@/lib/business-config";
import OptionInput from "@/components/OptionInput";
import { useEffect, useRef, useState } from "react";
import { useConsequence } from "@/components/ConsequenceDialog";
import { useRouter } from "next/navigation";
import { Input, Button, Space, Select, Tag, Modal, Form, Row, Col, App } from "antd";
import {
  PlusOutlined,
  SwapRightOutlined,
  DeleteOutlined,
  EditOutlined,
  ThunderboltOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import ResetFilters from "@/components/ResetFilters";
import { 列表不问归属ID } from "@/lib/solo";
import ListSearch from "@/components/ListSearch";
import { RowLink, PageHead, UserCell } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import { LEAD_STATUSES, LEAD_STATUS_COLOR } from "@/lib/constants";
import { 成员选项, 独自一人, 可选成员, smartTime } from "@/lib/utils";
import { saveLead, deleteLeads, convertLead, mergeLeadInto, type 线索撞号 } from "./actions";
import { useBusiness } from "@/lib/business-client";
import { useUrlFilters } from "@/lib/url-filters";
import { 聚焦首项 } from "@/lib/modal-focus";
import { useFormGuard } from "@/lib/form-guard";
import { 转化会带上 } from "@/lib/lead-convert";
import { 自动分配线索, type 自动分配结果 } from "./assign-actions";
import { AssignLeadModal, AssignedOutButton, useBatchAutoAssign } from "./AssignLead";
import LeadFullNotices from "./LeadFullNotices";
import ConvertProjectModal from "./ConvertProjectModal";
import { useNewProjectFlow } from "../projects/NewProjectFlow";
import type { 向导跟进 } from "@/lib/project/wizard";
import { 公海线索先领取话 } from "@/lib/enterprise/pool-rules";
import type { 满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 动作出错话 } from "@/lib/stale-deploy";

type Row = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  industry: string | null;
  source: string;
  status: string;
  remark: string | null;
  ownerId: string | null;
  ownerName: string;
  customerId: string | null;
  createdAt: string;
  /** 编辑框的版本号（排查 D3） */
  updatedAt: string;
};

export default function LeadsView({
  rows,
  总数,
  users,
  filters,
  来源们,
  me,
  能自动分配 = false,
  企业版项目 = false,
  要下一步 = false,
  线索分配开着 = false,
  满额提醒 = [],
  联系人附件 = false,
}: {
  rows: Row[];
  /** 库里一共多少条。行只取了前 300，分页条不能拿行数冒充总数 */
  总数: number;
  users: 可选成员[];
  filters: { keyword: string; status: string; ownerId: string; source: string };
  /** 来源筛选的候选：设置里的 + 库里用着的 */
  来源们: string[];
  me: string;
  /** 企业版「线索分配」规则开着、且这人能分配（老板 / 总管理员 / 市场管理）才摆「自动分配」 */
  能自动分配?: boolean;
  /** 企业版且开了项目模式（10-25 F1、F6）：新建线索照常弹表单，市场、渠道能只建一条线索；转化顺手建项目 */
  企业版项目?: boolean;
  /** 企业版开了超时回收：转项目时首条跟进的下一步时间必填（验收 #13） */
  要下一步?: boolean;
  /** 企业版「线索分配」规则开着：负责人只能经「分配」换，编辑框里负责人只读；页头摆「我分出去的」 */
  线索分配开着?: boolean;
  /** 企业版自动分配因都已满额没分出去的提醒，只有市场管理、总管理员有（lib/enterprise/lead-full-notice.ts） */
  满额提醒?: 满额提醒[];
  /**
   * 企业版联系人附件（2026-10-28）：编辑线索时表单底下摆附件区（名片原图等），转客户时这些附件跟到联系人上。
   * 新建时不摆：线索还没有 id，存了再传
   */
  联系人附件?: boolean;
}) {
  const router = useRouter();
  const { modal } = App.useApp();
  const [问后果, 后果框] = useConsequence();
  const b = useBusiness();
  /**
   * g.save：这一页做完一件事的回话（保存了、分给谁了、删了、没成的原因）就地写在列表上方一行，几秒后收，不弹顶部提示。
   * 错的留久一点（要读原因）
   */
  const [提示, set提示] = useState<{ 话: string; 错?: boolean } | null>(null);
  const 提示计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  const 说 = (话: string, 错 = false) => {
    if (提示计时.current) clearTimeout(提示计时.current);
    set提示({ 话, 错 });
    提示计时.current = setTimeout(() => set提示(null), 错 ? 8000 : 5000);
  };
  /*
    项目模式开着：新建一律走建档向导，在本页弹框、项目开关开着锁住（原 /projects/new 整页，11-15 删了）。
    企业版例外，线索先单独建、转化时再建项目（10-25 F1）。节点们只给「老客户」那条路用，这里不开
  */
  const 建档向导 = useNewProjectFlow({ users, 节点们: [], 要下一步: false });
  const 新建 = () => {
    if (b.projectMode && !企业版项目) return void 建档向导.开建档("新增项目", "锁开");
    setEditing(null);
    setOpen(true);
  };
  const { f, setF, apply, reset, pending } = useUrlFilters("/leads", filters);
  /** 空库 = 一条都没有**且**没在筛。筛出 0 条时筛选栏要留着，见 DataList */
  const 空库 = rows.length === 0 && !Object.values(filters).some((v) => v);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [分配中, set分配中] = useState<Row | null>(null);
  /** 企业版转项目：先记首条跟进再转（验收 #13） */
  const [转项目, set转项目] = useState<Row | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    if (!open) return;
    if (editing) form.setFieldsValue(editing);
    else {
      form.resetFields();
      // 来源不预填（审查 M13）：原来默认「官网注册」，忘了改就悄悄进了「按来源」统计，
      // 外贸预设里压根没有这一项，下拉还会显示一个不在选项里的值。不选就记成「其他」
      form.setFieldsValue({ status: "待跟进", ownerId: me });
    }
  }, [open, editing, form, me]);

  // 保存中不再收第二下：网慢、连着团队时连点几下会建出几条一样的（10-07 Sam 实测建出三条重复商机）
  const [存着, set存着] = useState(false);
  // 点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）
  const 守 = useFormGuard({ open, form, 草稿键: editing ? null : "新建线索", 关: () => setOpen(false), 忙: 存着, afterOpenChange: 聚焦首项 });
  async function onOk() {
    if (存着) return;
    set存着(true);
    try {
      await 存();
    } finally {
      set存着(false);
    }
  }
  async function 存() {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const res = await saveLead({ id: editing?.id, 版本: editing?.updatedAt, ...v });
    if (!res.ok && "同号协同" in res) {
      说(res.error);
      守.存好了();
      setOpen(false);
      router.refresh();
      return;
    }
    if (!res.ok) {
      说(res.error, true);
      return;
    }
    说(editing ? "已保存" : "线索已创建");
    守.存好了();
    setOpen(false);
    router.refresh();
  }

  /**
   * 转客户撞了号（J-024）：原来只报「请勿重复建档」，线索永远转不了。
   * 看得到那位客户 → 问要不要并过去；看不到（业务员撞同事的）→ 说清是谁的、找谁并
   */
  function 撞号了(r: Row, 撞: 线索撞号, 说法: string, 跟进?: 向导跟进) {
    if (!撞.能并 || !撞.customerId) {
      modal.info({ title: 撞.客户名 ? `电话已经是「${撞.客户名}」的号码` : `电话已经在同事 ${撞.负责人} 名下`, content: 说法, okText: "知道了" });
      return;
    }
    // P-公海-08：撞上的客户在客户公海里，不给并，说先领取（服务端同一句）
    if (撞.先领取) {
      modal.info({ title: `电话已经是${b.customer}「${撞.客户名}」的号码`, content: 公海线索先领取话, okText: "知道了" });
      return;
    }
    const 到 = 撞.customerId;
    // 并入：后果框分条说清（P-界面-40）；没并成原因写在框里、框不关
    void 问后果({
      题: `把「${r.name}」并到${b.customer}「${撞.客户名}」`,
      后果: [
        { 标: "撞号", 话: `电话已经是「${撞.客户名}」的号码；${撞.在公海 ? "这位在公海里" : `负责人：${撞.负责人}`}` },
        { 标: "之后", 话: `线索标成已转化、关联到「${撞.客户名}」，不另建档案${企业版项目 ? `；会在「${撞.客户名}」名下建一个项目「${r.name}」` : ""}` },
        { 标: "不动", 话: `不改「${撞.客户名}」的资料` },
      ],
      是: `并到「${撞.客户名}」`,
      危: false,
      做: async () => {
        const res = await mergeLeadInto(r.id, 到, 跟进);
        if (!res.ok) return res;
        router.push(res.projectId ? `/projects/${res.projectId}` : `/customers/${res.customerId}`);
        return { ok: true };
      },
    });
  }

  /** 「已分给 某某（本月已分 N / 配额 M）」：D-38 的说法，单条和批量共用 */
  const 分给了 = (r: Extract<自动分配结果, { ok: true }>) => `已分给 ${r.接手人}（本月已分 ${r.已分} / 配额 ${r.配额 ?? "不限"}）`;

  /** 转客户：后果框（建一位客户 + 带过去哪些格子）；撞号了框先关，接着问要不要并过去（撞号了） */
  async function 转客户(r: Row) {
    let 撞: { 撞号: 线索撞号; error: string } | null = null;
    const 带 = 转化会带上(r, b.fields);
    await 问后果({
      题: `把「${r.name}」转为${b.customer}`,
      后果: [
        // 按实际会填的格子、用当前叫法说（2026-10-04 L-016），见 lib/lead-convert.ts 转化会带上
        { 标: "新建", 话: `会建一位${b.customer}${带 ? `，${带}一起带过去` : ""}` },
        { 标: "之后", 话: "线索标记为已转化" },
      ],
      是: `转为${b.customer}`,
      危: false,
      做: async () => {
        const res = await convertLead(r.id);
        if (res.ok) {
          router.push(res.projectId ? `/projects/${res.projectId}` : `/customers/${res.customerId}`);
          return { ok: true };
        }
        if (res.撞号) {
          撞 = { 撞号: res.撞号, error: res.error };
          return { ok: true };
        }
        return res;
      },
    });
    const 撞到 = 撞 as { 撞号: 线索撞号; error: string } | null;
    if (撞到) 撞号了(r, 撞到.撞号, 撞到.error);
  }

  /** 删线索：删除类，后果框（回不来）；没删成原因写在框里；删成了就地说一句（行可能已被别人删掉，如实说） */
  function 删线索(r: Row) {
    void 问后果({
      题: `删除线索「${r.name}」`,
      后果: [
        { 标: "回不来", 话: "删除后不可恢复", 级: "危" },
        { 标: "核对", 话: "确认前请核对线索名称；取消不会修改资料" },
      ],
      是: "删除",
      做: async () => {
        const res = await deleteLeads([r.id]);
        if (!res.ok) return res;
        说(res.deleted ? `已删除「${r.name}」` : "这条线索已经不在了（可能已删除）");
        router.refresh();
        return { ok: true };
      },
    });
  }

  async function 自动分(r: Row) {
    try {
      const res = await 自动分配线索(r.id, { 原负责人: r.ownerId });
      if (!res.ok) return void 说(res.error, true);
      说(`「${r.name}」${分给了(res)}：${res.为什么}`);
      router.refresh();
    } catch (出错) {
      说(动作出错话(出错, "没分成，请稍后再试"), true);
    }
  }

  const 批量自动分 = useBatchAutoAssign(分给了, { 先问: true });

  /** 只有一个人：负责人列不摆（审查 D2），见 lib/solo.ts */
  const 不问归属 = !f.ownerId && 列表不问归属ID(users, rows.map((r) => r.ownerId));

  const 列表: 列<Row>[] = [
    { title: "线索", key: "name", dataIndex: "name", width: 200, 常驻: true, render: (v) => <span className="link-strong">{v}</span> },
    { title: "联系人", key: "contact", dataIndex: "contact", width: 104, render: (v) => v ?? <span className="muted">—</span> },
    { title: "来源", key: "source", dataIndex: "source", width: 100, render: (v) => <Tag style={{ margin: 0 }}>{v}</Tag> },
    {
      title: "状态", key: "status", dataIndex: "status", width: 96,
      render: (v) => (
        <Tag color={LEAD_STATUS_COLOR[v] ?? "default"} style={{ margin: 0 }}>
          {v}
        </Tag>
      ),
    },
    ...(不问归属 ? [] : [{ title: "负责人", key: "ownerName", dataIndex: "ownerName", width: 120, render: (v: string) => <UserCell name={v} size={24} /> }]),
    { title: "创建时间", key: "createdAt", dataIndex: "createdAt", width: 116, render: (v) => <span className="muted nowrap">{smartTime(v)}</span> },

    { title: "联系电话", key: "phone", dataIndex: "phone", width: 140, 默认: false, render: (v) => (v ? <CopyValue 叫法="电话" value={v} style={{ maxWidth: 120 }} /> : <span className="muted">—</span>) },
    { title: "所属行业", key: "industry", dataIndex: "industry", width: 130, 默认: false, render: (v) => <span className="muted">{v ?? "—"}</span> },
    { title: "邮箱", key: "email", dataIndex: "email", width: 200, 默认: false, render: (v) => (v ? <CopyValue 种类="邮箱" 叫法="邮箱" value={v} style={{ maxWidth: 180 }} /> : <span className="muted">—</span>) },
    {
      title: "", key: "act", width: 能自动分配 ? 210 : 150, 常驻: true, fixed: "right",
      render: (_, r) =>
        r.customerId ? (
          <RowLink href={`/customers/${r.customerId}`}>查看{b.customer} ›</RowLink>
        ) : r.status === "已转化" ? (
          // 并到了一位已经关联着别的线索的客户（J-024，Lead.customerId 唯一）：没有直接的关联，按电话去客户列表找
          <RowLink href={`/customers?keyword=${encodeURIComponent(r.phone && !r.phone.includes("*") ? r.phone : r.name)}`}>查看{b.customer} ›</RowLink>
        ) : (
          <Space size={2}>
            <Button
              type="link"
              size="small"
              icon={<SwapRightOutlined />}
              onClick={() =>
                企业版项目 ? set转项目(r) : void 转客户(r)
              }
            >
              {企业版项目 ? "转项目" : `转${b.customer}`}
            </Button>
            {能自动分配 && (
              <Button
                aria-label={`分配 ${r.name}`}
                title="分配给…"
                type="text"
                size="small"
                icon={<UserSwitchOutlined />}
                onClick={() => set分配中(r)}
              />
            )}
            {能自动分配 && (
              <Button
                aria-label={`自动分配 ${r.name}`}
                title="自动分配"
                type="text"
                size="small"
                icon={<ThunderboltOutlined />}
                onClick={() => void 自动分(r)}
              />
            )}
            <Button
              aria-label={`编辑 ${r.name}`}
              title="编辑"
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditing(r);
                setOpen(true);
              }}
            />
            <Button
              aria-label={`删除 ${r.name}`}
              title="删除"
              type="text"
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={() => void 删线索(r)}
            />
          </Space>
        ),
    },
  ];

  return (
    <>
      {建档向导.弹框}
      {后果框}
      <PageHead
        title={企业版项目 ? "新线索" : "线索"}
        subtitle="还没建档的线索"
        extra={
          <Space>
            {线索分配开着 && <AssignedOutButton />}
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={新建}
            >
              新建线索
            </Button>
          </Space>
        }
      />

      <LeadFullNotices 提醒={满额提醒} />
      {批量自动分.框}
      {提示 && (
        <div className={`ls-ld-note${提示.错 ? " is-err" : ""}`} role={提示.错 ? "alert" : "status"} title={提示.话}>{提示.话}</div>
      )}

      <DataList<Row>
        截断={{ 总数 }}
        页="leads"
        空库={空库}
        列={列表}
        行={rows}
        加载中={pending}
        空态={{
          title: "还没有线索",
          hint: `线索是还没确认要不要跟的人。确认要跟了就转成${b.customer}，之后的跟进、商机、${签约叫(b)}都在${b.customer}那边走。`,
          primary: { label: "新建第一条线索", onClick: 新建 },
        }}
        批量={能自动分配 ? (选中, 清空, 选中行) => (
          <Button size="small" icon={<ThunderboltOutlined />} onClick={() => void 批量自动分(选中, 清空, 选中行)}>自动分配</Button>
        ) : undefined}
        筛选={
          <Space wrap size={[10, 10]}>
            <ListSearch
              width={280}
              placeholder="线索名称 / 联系人 / 电话"
              value={f.keyword}
              onChange={(v) => setF({ ...f, keyword: v })}
              onSearch={(v) => apply({ keyword: v })}
            />
            <Select
              style={{ width: 152 }}
              placeholder="全部状态"
              allowClear
              value={f.status || undefined}
              onChange={(v) => apply({ status: v ?? "" })}
              options={LEAD_STATUSES.map((s2) => ({ value: s2, label: s2 }))}
            />
            {/* 负责人、来源（T-029）：照客户列表的写法，只有一个人时负责人不摆 */}
            {!不问归属 && (
              <Select style={{ width: 150 }} placeholder="全部负责人" allowClear
                value={f.ownerId || undefined} onChange={(v) => apply({ ownerId: v ?? "" })}
                options={成员选项(users)} />
            )}
            <Select style={{ width: 140 }} placeholder="全部来源" allowClear
              value={f.source || undefined} onChange={(v) => apply({ source: v ?? "" })}
              options={来源们.map((s2) => ({ value: s2, label: s2 }))} />
            <ResetFilters 显示={Boolean(f.keyword || f.status || f.ownerId || f.source)} onClick={reset} />
          </Space>
        }
      />

      <Modal
        {...守.弹窗}
        open={open}
        title={editing ? "编辑线索" : "新建线索"}
        onOk={onOk} confirmLoading={存着}
        okText="保存"
        cancelText="取消"
        width={600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 8 }} onValuesChange={守.改了}>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="name" label="线索名称" rules={[requiredText("请填写线索名称")]}>
                <Input placeholder="公司名称或线索标题" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contact" label="联系人"><Input placeholder="张伟" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="phone" label="联系电话"><Input placeholder="13800002211" /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="email" label="邮箱"><Input /></Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="industry" label="所属行业">
                <OptionInput options={b.industries} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="source" label="线索来源">
                <OptionInput options={b.sources} placeholder="选或直接填" maxLength={30} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="status" label="状态">
                <Select options={LEAD_STATUSES.filter((s) => s !== "已转化").map((i) => ({ value: i, label: i }))} />
              </Form.Item>
            </Col>
            {/* 只有一个人时不问归属，见 lib/utils.ts 的 独自一人 */}
            {!独自一人(users, editing?.ownerId) && (
              <Col span={8}>
                <Form.Item
                  name="ownerId"
                  label="负责人"
                  extra={线索分配开着 ? (能自动分配 ? "换负责人请用列表里的「分配」" : "换负责人要由总管理、销售管理或市场管理来分配") : undefined}
                >
                  <Select options={成员选项(users)} disabled={线索分配开着} />
                </Form.Item>
              </Col>
            )}
            <Col span={24}>
              <Form.Item name="remark" label="备注">
                <Input.TextArea rows={2} placeholder="线索来源细节、初步需求…" />
              </Form.Item>
            </Col>
          </Row>
        </Form>
        {联系人附件 && editing && (
          <div style={{ marginTop: 4 }}>
            <div className="section-title" style={{ marginBottom: 8 }}>联系人附件</div>
            <AttachmentsPanel 归属={{ leadId: editing.id }} 说明="把名片或联系人相关图片拖到这里，或点一下选图片" />
          </div>
        )}
      </Modal>
      {能自动分配 && <AssignLeadModal lead={分配中} 关={() => set分配中(null)} />}
      {企业版项目 && (
        <ConvertProjectModal
          lead={转项目}
          要下一步={要下一步}
          说明={转项目 ? (() => {
            const 带 = 转化会带上(转项目, b.fields);
            return `会建一位${b.customer}${带 ? `，${带}一起带过去` : ""}，并在名下建一个项目「${转项目.name}」，线索标记为已转化。`;
          })() : ""}
          关={() => set转项目(null)}
          交={async (跟进) => {
            const r = 转项目!;
            const res = await convertLead(r.id, 跟进);
            if (res.ok) {
              set转项目(null);
              router.push(res.projectId ? `/projects/${res.projectId}` : `/customers/${res.customerId}`);
            } else if (res.撞号) {
              set转项目(null);
              撞号了(r, res.撞号, res.error, 跟进);
            } else 说(res.error, true);
          }}
        />
      )}
    </>
  );
}
