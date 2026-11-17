"use client";

/**
 * 主渠道管理（2026-11-08 渠道两层）：渠道页「主渠道」按钮打开。只给能管渠道的人（服务端 挡管 再挡一道）。
 * 一行一个主渠道：名字、分类、可设子渠道、支持自拓、下面几个子渠道、启用。两个开关互不相关。
 * 分类（11-10 P-渠道-04：独立站→自有阵地、公司资源 / 客户介绍→转介绍要能在页面上核对）只显示，表单里没有这一项、不在这里改
 * 改名时下面子渠道的全称一起改（saveMainChannel 一个事务）；停用后新建渠道选不到，已挂的照旧
 * 负责人、渠道属性（= 获客方式）（11-10，迁移 118，P-渠道-10 / P-渠道-11）：主渠道自己记一份，一个子渠道都没有的也能填；
 * 表里两列只显示，在「编辑」弹窗里改。改负责人只改主渠道这一行，下面的子渠道、已有客户不跟着换
 * 删除（11-17）：只有下面一个渠道都没挂的才摆。渠道列表里删的是子渠道，单一入口的子渠道和主渠道同名，
 * 删完主渠道还在这里——人以为没删掉（客户报「删了义乌门店，上面还有」），主渠道要在这里另删
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Form, Input, Modal, Select, Space, Switch, Table, Tag, Tooltip } from "antd";
import { PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { saveMainChannel, toggleMainChannel, deleteMainChannel } from "./actions";
import SaveButton from "@/components/SaveButton";
import InlineConfirm from "@/components/InlineConfirm";
import { isFormValidationError } from "@/lib/form-validation";
import { 主渠道名上限, 分类文字, type 主渠道行 } from "@/lib/enterprise/channel-main-core";
import { 成员选项, type 可选成员 } from "@/lib/utils";

export type 主渠道编辑中 = { id?: string; name: string; allowSub: boolean; selfDev: boolean; category: string | null; ownerId?: string | null; ownerName?: string | null; attr?: string | null };
const 新主渠道: 主渠道编辑中 = { name: "", allowSub: true, selfDev: false, category: null, ownerId: null, attr: null };
/** 一行主渠道 → 编辑弹窗的初值 */
export const 主渠道编辑初值 = (m: 主渠道行): 主渠道编辑中 => ({ id: m.id, name: m.name, allowSub: m.allowSub, selfDev: m.selfDev, category: m.category, ownerId: m.ownerId ?? null, ownerName: m.ownerName ?? null, attr: m.attr ?? null });

/**
 * 新建 / 编辑一个主渠道的弹窗：名字、负责人、渠道属性。主渠道管理和渠道页「按主渠道」那张表都用这一个。
 * 负责人候选没给（users 空）时不摆后两项、保存也不带它们（服务端 不交 = 不动）
 */
export function MainChannelEdit({ 编辑, users = [], 属性选项 = [], 子渠道数 = 0, onClose, onSaved }: {
  编辑: 主渠道编辑中;
  users?: 可选成员[];
  属性选项?: string[];
  /** 下面挂了几个渠道：改名时提醒全称会一起改 */
  子渠道数?: number;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const router = useRouter();
  const [form] = Form.useForm<{ name: string; ownerId?: string; attr?: string }>();
  const 问归属 = users.length > 0;
  /** 候选：在职能当负责人的 + 这条原来的负责人（后来停用了也照旧留着，不被悄悄清掉） */
  const 人选 = 成员选项(users);
  if (编辑.ownerId && !users.some((u) => u.id === 编辑.ownerId)) 人选.push({ value: 编辑.ownerId, label: 编辑.ownerName ? `${编辑.ownerName}（已停用）` : "（已不在的成员）" });
  const 属性们 = 编辑.attr && !属性选项.includes(编辑.attr) ? [...属性选项, 编辑.attr] : 属性选项;
  /** g.save：成败都在保存键里（SaveButton），✓ 放完再关框；不弹顶部提示 */
  async function 存() {
    let v;
    try {
      v = await form.validateFields();
    } catch (e) {
      if (isFormValidationError(e)) return { ok: false as const, error: "还有必填项没填" };
      throw e;
    }
    const res = await saveMainChannel({
      id: 编辑.id, name: v.name, allowSub: 编辑.allowSub, selfDev: 编辑.selfDev, category: 编辑.category,
      ...(问归属 ? { ownerId: v.ownerId ?? null, attr: v.attr ?? null } : {}),
    });
    if (!res.ok) return res;
    onSaved?.();
    router.refresh();
    return { ok: true as const };
  }
  return (
    <Modal open title={编辑.id ? `编辑：${编辑.name}` : "新建主渠道"} onCancel={onClose} footer={(_, { CancelBtn }) => (<><CancelBtn /><SaveButton 做={存} 成了={onClose}>保存</SaveButton></>)} cancelText="取消" destroyOnHidden width={440}>
      <Form form={form} layout="vertical" className="chan-main-form" initialValues={{ name: 编辑.name, ownerId: 编辑.ownerId ?? undefined, attr: 编辑.attr ?? undefined }}>
        <Form.Item
          label="主渠道名"
          name="name"
          extra={编辑.id && 子渠道数 > 0 ? `改名的话，下面 ${子渠道数} 个渠道的全称会一起改` : undefined}
          rules={[
            { required: true, whitespace: true, message: "请填写主渠道名" },
            { pattern: /^[^|｜]*$/, message: "主渠道名里不能有「|」" },
          ]}
        >
          <Input autoFocus maxLength={主渠道名上限} placeholder="如：阿里国际站" onPressEnter={存} />
        </Form.Item>
        {问归属 && (
          <>
            <Form.Item label="负责人" name="ownerId" extra="这个主渠道归谁管；换人只改这里，下面的子渠道和已有客户保持原归属">
              <Select allowClear showSearch={{ optionFilterProp: "label" }} placeholder="还没指定" options={人选} />
            </Form.Item>
            <Form.Item label="渠道属性" name="attr" extra="即获客方式；下面的子渠道自己没填时沿用这一项">
              <Select allowClear placeholder="还没指定" options={属性们.map((x) => ({ value: x, label: x }))} notFoundContent="字典里还没有渠道属性，到 设置 → 字典 里加" />
            </Form.Item>
          </>
        )}
      </Form>
    </Modal>
  );
}

export default function MainChannels({ 主渠道们, 子渠道数, users = [], 属性选项 = [], onClose }: {
  主渠道们: 主渠道行[];
  子渠道数: Map<string, number>;
  /** 负责人候选、字典里启用着的渠道属性：编辑弹窗里选（11-10，迁移 118） */
  users?: 可选成员[];
  属性选项?: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  /** 这一行刚才没存上的原因：就地写在操作格里，几秒后收（不弹顶部提示） */
  const [行错, set行错] = useState<{ id: string; 话: string } | null>(null);
  const 说行错 = (id: string, 话: string) => { set行错({ id, 话 }); setTimeout(() => set行错((x) => (x?.id === id && x.话 === 话 ? null : x)), 5000); };
  const [kw, setKw] = useState("");
  const [编辑, set编辑] = useState<主渠道编辑中 | null>(null);
  const [忙, set忙] = useState<string | null>(null);
  /** 刚存好的那个开关：「主渠道id:键:时刻」，那一格闪一下（ch.main） */
  const [刚存, set刚存] = useState<string | null>(null);
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
      if (!res.ok) return void 说行错(m.id, res.error);
      set行错(null);
      // ch.main：存好在原处闪一下（键带上是哪个开关，换一次重挂一次，动画才会再放）
      set刚存(`${m.id}:${Object.keys(改).join()}:${Date.now()}`);
      router.refresh();
    } finally {
      set忙(null);
    }
  }
  async function 删主(m: 主渠道行) {
    const res = await deleteMainChannel(m.id);
    if (!res.ok) {
      说行错(m.id, res.error);
      return res;
    }
    set行错(null);
    router.refresh();
    return { ok: true as const };
  }
  async function 切启用(m: 主渠道行) {
    if (忙) return;
    set忙(m.id);
    try {
      const res = await toggleMainChannel(m.id, !m.active);
      if (!res.ok) return void 说行错(m.id, res.error);
      // 不弹顶部提示：这一行原地变灰 / 恢复（row-off），操作格闪一下
      set行错(null);
      set刚存(`${m.id}:active:${Date.now()}`);
      router.refresh();
    } finally {
      set忙(null);
    }
  }
  /** 负责人、渠道属性两格：一行省略、悬停看全；没填写「—」 */
  const 省略格 = (v: string | null | undefined) => (v ? <span className="chan-name" title={v}>{v}</span> : <span className="muted">—</span>);

  return (
    <Modal open title="主渠道" onCancel={onClose} footer={null} width={960} destroyOnHidden>
      <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
        每个渠道挂在一个主渠道下。「可设子渠道」关掉的主渠道只能当单一入口用，子渠道留空；「支持自拓」标出业务员自己能拓客的主渠道，和前一项互不相关。
        主渠道停用后，下面的渠道在列表里一起算停用、新线索里选不到。渠道列表里删的是子渠道；主渠道下一个渠道都没有了，才能在这里删。
      </div>
      <Space style={{ marginBottom: 12, width: "100%", justifyContent: "space-between" }} wrap>
        <Input style={{ width: 240, maxWidth: "100%" }} placeholder="搜索主渠道" allowClear prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />} value={kw} onChange={(e) => setKw(e.target.value)} />
        <Button icon={<PlusOutlined />} onClick={() => set编辑(新主渠道)}>新建主渠道</Button>
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
            title: <span className="nowrap">分类</span>, key: "category", dataIndex: "category", width: 96, ellipsis: true,
            render: (v: string | null) => {
              const t = 分类文字(v);
              return <span title={v ? t : undefined} className={v ? undefined : "muted"} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t}</span>;
            },
          },
          {
            title: <Tooltip title="关掉 = 单一入口，新建、改渠道时子渠道留空；已有的子渠道名不会被拆掉"><span className="nowrap">可设子渠道</span></Tooltip>,
            key: "allowSub", width: 104, align: "center",
            render: (_, m) => { const 闪 = 刚存?.startsWith(`${m.id}:allowSub:`); return <span key={闪 ? 刚存 : "s"} className={闪 ? "chan-main-saved" : undefined}><Switch size="small" aria-label={`${m.name} 可设子渠道`} checked={m.allowSub} loading={忙 === m.id} disabled={Boolean(忙)} onChange={(v) => 存开关(m, { allowSub: v })} /></span>; },
          },
          {
            title: <span className="nowrap">支持自拓</span>, key: "selfDev", width: 92, align: "center",
            render: (_, m) => { const 闪 = 刚存?.startsWith(`${m.id}:selfDev:`); return <span key={闪 ? 刚存 : "s"} className={闪 ? "chan-main-saved" : undefined}><Switch size="small" aria-label={`${m.name} 支持自拓`} checked={m.selfDev} loading={忙 === m.id} disabled={Boolean(忙)} onChange={(v) => 存开关(m, { selfDev: v })} /></span>; },
          },
          // 负责人、渠道属性（迁移 118）：只显示，在「编辑」里改；人已停用的名字照给
          { title: <span className="nowrap">负责人</span>, key: "owner", width: 104, render: (_, m) => 省略格(m.ownerId ? m.ownerName ?? "（已不在的成员）" : null) },
          { title: <Tooltip title="即获客方式；下面的子渠道自己没填时沿用"><span className="nowrap">渠道属性</span></Tooltip>, key: "attr", width: 104, render: (_, m) => 省略格(m.attr) },
          {
            title: <span className="nowrap">渠道数</span>, key: "subs", width: 76, align: "right",
            render: (_, m) => <span className="chan-num">{子渠道数.get(m.id) ?? 0}</span>,
          },
          {
            title: "", key: "act", width: 156,
            render: (_, m) => (
              <span className="ch-act">
                <Space size={2}>
                  <Button type="link" size="small" onClick={() => set编辑(主渠道编辑初值(m))}>编辑</Button>
                  <span key={刚存?.startsWith(`${m.id}:active:`) ? 刚存 : "a"} className={刚存?.startsWith(`${m.id}:active:`) ? "chan-main-saved" : undefined}>
                    <Button type="link" size="small" disabled={Boolean(忙)} onClick={() => 切启用(m)}>{m.active ? "停用" : "启用"}</Button>
                  </span>
                  {!子渠道数.get(m.id) && (
                    <InlineConfirm 问="删除这个主渠道？" 做={() => 删主(m)}>
                      <Button type="link" size="small" disabled={Boolean(忙)}>删除</Button>
                    </InlineConfirm>
                  )}
                </Space>
                {行错?.id === m.id && <span className="ch-act-err" role="alert" title={行错.话}>{行错.话}</span>}
              </span>
            ),
          },
        ]}
      />
      </div>
      {编辑 && <MainChannelEdit key={编辑.id ?? "新"} 编辑={编辑} users={users} 属性选项={属性选项} 子渠道数={编辑.id ? 子渠道数.get(编辑.id) ?? 0 : 0} onClose={() => set编辑(null)} />}
    </Modal>
  );
}
