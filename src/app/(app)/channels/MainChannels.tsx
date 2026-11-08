"use client";

/**
 * 主渠道管理（2026-11-08 渠道两层）：渠道页「主渠道」按钮打开。只给能管渠道的人（服务端 挡管 再挡一道）。
 * 一行一个主渠道：名字、可设子渠道、支持自拓、下面几个子渠道、启用。两个开关互不相关。
 * 改名时下面子渠道的全称一起改（saveMainChannel 一个事务）；停用后新建渠道选不到，已挂的照旧
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Form, Input, Modal, Space, Switch, Table, Tag, Tooltip } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { saveMainChannel, toggleMainChannel } from "./actions";
import { 主渠道名上限, type 主渠道行 } from "@/lib/enterprise/channel-main-core";

type 编辑中 = { id?: string; name: string; allowSub: boolean; selfDev: boolean; category: string | null };

export default function MainChannels({ 主渠道们, 子渠道数, onClose }: { 主渠道们: 主渠道行[]; 子渠道数: Map<string, number>; onClose: () => void }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [kw, setKw] = useState("");
  const [编辑, set编辑] = useState<编辑中 | null>(null);
  const [忙, set忙] = useState<string | null>(null);
  const [form] = Form.useForm<{ name: string }>();
  const 行 = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return k ? 主渠道们.filter((m) => m.name.toLowerCase().includes(k)) : 主渠道们;
  }, [主渠道们, kw]);

  /** 开关、启用直接存：一次只存一个，存完刷新 */
  async function 存开关(m: 主渠道行, 改: Partial<Pick<主渠道行, "allowSub" | "selfDev">>) {
    if (忙) return;
    set忙(m.id);
    try {
      const res = await saveMainChannel({ id: m.id, name: m.name, allowSub: m.allowSub, selfDev: m.selfDev, category: m.category, ...改 });
      if (!res.ok) return void message.error(res.error);
      router.refresh();
    } finally {
      set忙(null);
    }
  }
  async function 切启用(m: 主渠道行) {
    if (忙) return;
    set忙(m.id);
    try {
      const res = await toggleMainChannel(m.id, !m.active);
      if (!res.ok) return void message.error(res.error);
      message.success(m.active ? `主渠道「${m.name}」已停用` : `主渠道「${m.name}」已启用`);
      router.refresh();
    } finally {
      set忙(null);
    }
  }
  async function 存名字() {
    if (!编辑 || 忙) return;
    const { name } = await form.validateFields();
    set忙(编辑.id ?? "新");
    try {
      const res = await saveMainChannel({ ...编辑, name });
      if (!res.ok) return void message.error(res.error);
      message.success(编辑.id ? "已保存" : `主渠道「${name.trim()}」已新建`);
      set编辑(null);
      router.refresh();
    } finally {
      set忙(null);
    }
  }

  return (
    <Modal open title="主渠道" onCancel={onClose} footer={null} width={720} destroyOnHidden>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        每个渠道挂在一个主渠道下。「可设子渠道」关掉的主渠道只能当单一入口用，子渠道留空；「支持自拓」标出业务员自己能拓客的主渠道，和前一项互不相关。
      </div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
        <Input style={{ width: 240, maxWidth: "100%" }} placeholder="搜索主渠道" allowClear prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />} value={kw} onChange={(e) => setKw(e.target.value)} />
        <Button icon={<PlusOutlined />} onClick={() => { form.setFieldsValue({ name: "" }); set编辑({ name: "", allowSub: true, selfDev: false, category: null }); }}>新建主渠道</Button>
      </Space>
      {/* 搜索时表格变短，弹窗不跟着缩：表格区定高，弹窗位置不跳 */}
      <div style={{ minHeight: 460 }}>
      <Table<主渠道行>
        size="small"
        rowKey="id"
        dataSource={行}
        pagination={false}
        scroll={{ y: 420 }}
        rowClassName={(m) => (m.active ? "" : "row-off")}
        locale={{ emptyText: kw ? "没有对上的主渠道" : "还没有主渠道" }}
        columns={[
          {
            title: "主渠道", key: "name", dataIndex: "name", ellipsis: true,
            render: (v: string, m) => (
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                <span title={v} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v}</span>
                {!m.active && <Tag style={{ margin: 0, flex: "none" }}>已停用</Tag>}
              </div>
            ),
          },
          {
            title: <Tooltip title="关掉 = 单一入口，新建、改渠道时子渠道留空；已有的子渠道名不会被拆掉"><span className="nowrap">可设子渠道</span></Tooltip>,
            key: "allowSub", width: 104, align: "center",
            render: (_, m) => <Switch size="small" aria-label={`${m.name} 可设子渠道`} checked={m.allowSub} loading={忙 === m.id} disabled={Boolean(忙)} onChange={(v) => 存开关(m, { allowSub: v })} />,
          },
          {
            title: <span className="nowrap">支持自拓</span>, key: "selfDev", width: 92, align: "center",
            render: (_, m) => <Switch size="small" aria-label={`${m.name} 支持自拓`} checked={m.selfDev} loading={忙 === m.id} disabled={Boolean(忙)} onChange={(v) => 存开关(m, { selfDev: v })} />,
          },
          {
            title: <span className="nowrap">渠道数</span>, key: "subs", width: 76, align: "right",
            render: (_, m) => <span className="chan-num">{子渠道数.get(m.id) ?? 0}</span>,
          },
          {
            title: "", key: "act", width: 116,
            render: (_, m) => (
              <Space size={2}>
                <Button type="link" size="small" onClick={() => { form.setFieldsValue({ name: m.name }); set编辑({ id: m.id, name: m.name, allowSub: m.allowSub, selfDev: m.selfDev, category: m.category }); }}>改名</Button>
                <Button type="link" size="small" disabled={Boolean(忙)} onClick={() => 切启用(m)}>{m.active ? "停用" : "启用"}</Button>
              </Space>
            ),
          },
        ]}
      />
      </div>
      {编辑 && (
        <Modal open title={编辑.id ? `改名：${编辑.name}` : "新建主渠道"} onCancel={() => set编辑(null)} onOk={存名字} confirmLoading={Boolean(忙)} okText="保存" cancelText="取消" destroyOnHidden width={440}>
          <Form form={form} layout="vertical" style={{ marginTop: 8 }} initialValues={{ name: 编辑.name }}>
            <Form.Item
              label="主渠道名"
              name="name"
              extra={编辑.id && (子渠道数.get(编辑.id) ?? 0) > 0 ? `下面 ${子渠道数.get(编辑.id)} 个渠道的全称会一起改` : undefined}
              rules={[
                { required: true, whitespace: true, message: "请填写主渠道名" },
                { pattern: /^[^|｜]*$/, message: "主渠道名里不能有「|」" },
              ]}
            >
              <Input autoFocus maxLength={主渠道名上限} placeholder="如：阿里国际站" onPressEnter={存名字} />
            </Form.Item>
          </Form>
        </Modal>
      )}
    </Modal>
  );
}
