"use client";

import { isFormValidationError } from "@/lib/form-validation";

import { useMe, 默认负责人 } from "@/lib/me-client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Space, Tag, Modal, Form, Input, Select, App, Tooltip, Row as 行, Col, Radio } from "antd";
import { PlusOutlined, EditOutlined, DeleteOutlined, StopOutlined, CheckCircleOutlined, SearchOutlined, AccountBookOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import ResetFilters from "@/components/ResetFilters";
import DatePicker from "@/components/BusinessDatePicker";
import { 列表不问归属 } from "@/lib/solo";
import { PageHead, UserCell } from "@/components/ui";
import DataList, { type 列 } from "@/components/DataList";
import { 合计文字 } from "@/lib/currency";
import { dayjs, fmtDate, 成员选项, 独自一人, 可选成员 } from "@/lib/utils";
import { saveChannel, toggleChannel, deleteChannel } from "./actions";
import { useBusiness } from "@/lib/business-client";
import { 聚焦首项 } from "@/lib/modal-focus";
import { useFormGuard } from "@/lib/form-guard";
import { 拼全称, 拆来源, 全称上限, 显示产出比分布, 产出比分布, type 渠道统计 } from "@/lib/enterprise/channel-stats";
import ChannelDrawer from "./ChannelDrawer";

export type 渠道行 = {
  id: string;
  /** 渠道全称（库里唯一） */
  name: string;
  /** 表单里不问了，编辑时原样交回（打码号由服务端认回） */
  phone: string | null;
  remark: string | null;
  active: boolean;
  /** 渠道属性；老渠道可能没有 */
  attr: string | null;
  /** 渠道名称；老渠道可能没有 */
  platform: string | null;
  endDate: string | null;
  createdAt: string;
  /** 编辑框的版本号（排查 D3） */
  updatedAt: string;
  createdByName: string | null;
  channelOwnerId: string;
  channelOwnerName: string;
  统计?: 渠道统计;
};
type Row = 渠道行;

const 空统计: 渠道统计 = { 关联线索: 0, 有效线索: 0, 关联商机: 0, 关联订单: 0, 关联项目: 0, 累计成交: [], 当前投入: [], 产出比: null, 产出比说明: "还没录投入", 累计运营天数: 0 };
const 统计 = (r: { 统计?: 渠道统计 }) => r.统计 ?? 空统计;
const 无 = <span className="muted">—</span>;

/** 编辑老渠道时回填表单：没有渠道名称的老渠道，名称和来源都先填成全称 */
function 编辑初值(r: Row) {
  const platform = r.platform ?? r.name;
  return {
    attr: r.attr ?? undefined,
    platform,
    source: 拆来源(r.name, platform),
    name: r.name,
    endDate: r.endDate ? dayjs(r.endDate) : undefined,
    channelOwnerId: r.channelOwnerId,
    active: r.active,
    remark: r.remark,
  };
}

export default function ChannelsView({
  rows: 全部行,
  users,
  属性选项 = [],
}: {
  rows: Row[];
  users: 可选成员[];
  /** 字典里启用着的渠道属性（设置 → 字典 → 渠道属性） */
  属性选项?: string[];
}) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const 我 = useMe();
  const b = useBusiness();
  /* 筛选条件都在本地：行已经全在手上了 */
  const [kw, setKw] = useState("");
  const [attr, setAttr] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [active, setActive] = useState("");
  const rows = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return 全部行.filter(
      (r) =>
        (!k || [r.name, r.platform, r.attr, r.remark].some((x) => (x ?? "").toLowerCase().includes(k))) &&
        (!attr || r.attr === attr) &&
        (!ownerId || r.channelOwnerId === ownerId) &&
        (!active || (active === "on") === r.active),
    );
  }, [全部行, kw, attr, ownerId, active]);
  /** 属性筛选：字典里的 + 表里实际出现的（停用了的旧属性也能筛出来） */
  const 筛选属性 = useMemo(() => [...new Set([...属性选项, ...全部行.map((r) => r.attr).filter((x): x is string => Boolean(x))])], [属性选项, 全部行]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [详情id, set详情id] = useState<string | null>(null);
  const 详情 = 详情id ? 全部行.find((r) => r.id === 详情id) ?? null : null;
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  // 点外面不关、关前问一句、新建的草稿留在本机（2026-10-19 客户反馈，lib/form-guard.tsx）
  const 守 = useFormGuard({ open, form, 草稿键: editing ? null : "新建渠道", 关: () => { setOpen(false); setEditing(null); }, 忙: saving, afterOpenChange: 聚焦首项 });
  /** 只有一个人：渠道负责人那一列和筛选都不摆（审查 D2 / M3） */
  const 不问归属 = !ownerId && 列表不问归属(users, 全部行.map((r) => r.channelOwnerName));
  /** 刚停用 / 恢复的那一行亮两秒（row-fresh） */
  const [亮行, set亮行] = useState<string[]>([]);
  const 亮计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  function 亮一下(id: string) {
    if (亮计时.current) clearTimeout(亮计时.current);
    set亮行([]);
    requestAnimationFrame(() => set亮行([id]));
    亮计时.current = setTimeout(() => set亮行([]), 2000);
  }
  /**
   * 全称跟着「渠道名称 / 来源」自动拼，人改过就不再覆盖：
   * 当前全称是空的、或者正是上一次自动拼出来的那串，才换成新拼的
   */
  const 上次拼 = useRef("");

  function openForm(r: Row | null) {
    setEditing(r);
    if (r) {
      const 初 = 编辑初值(r);
      上次拼.current = 拼全称(初.platform, 初.source);
    } else 上次拼.current = "";
    setOpen(true);
  }

  function 表单变了(changed: Record<string, unknown>, all: { platform?: string; source?: string; name?: string }) {
    if ("platform" in changed || "source" in changed) {
      const 新 = 拼全称(all.platform, all.source);
      const 现 = (all.name ?? "").trim();
      if (!现 || 现 === 上次拼.current) form.setFieldValue("name", 新);
      上次拼.current = 新;
    }
    守.改了();
  }

  async function onOk() {
    if (saving) return;
    setSaving(true);
    try {
      const v = await form.validateFields();
      const res = await saveChannel({
        id: editing?.id,
        版本: editing?.updatedAt,
        name: v.name ?? "",
        phone: editing?.phone ?? null,
        remark: v.remark ?? null,
        channelOwnerId: v.channelOwnerId,
        attr: v.attr ?? "",
        platform: v.platform ?? "",
        source: v.source ?? "",
        endDate: v.endDate ? (v.endDate as Dayjs).format("YYYY-MM-DD") : null,
        active: v.active !== false,
      });
      if (!res.ok) return message.error(res.error);
      message.success(editing ? "已保存" : "渠道已创建");
      守.存好了();
      setOpen(false);
      setEditing(null);
      router.refresh();
    } catch (error) {
      if (!isFormValidationError(error)) message.error("保存失败，请刷新确认结果后重试");
    } finally {
      setSaving(false);
    }
  }

  type 数键 = "关联线索" | "有效线索" | "关联商机" | "关联订单" | "关联项目";
  const 数列 = (键: 数键, 说明: string): 列<Row> => ({
    title: <Tooltip title={说明}>{键}</Tooltip>, key: 键, width: 88, align: "right",
    sorter: (a, b2) => 统计(a)[键] - 统计(b2)[键],
    render: (_: unknown, r: Row) => (统计(r)[键] > 0 ? <span className="chan-num">{统计(r)[键]}</span> : 无),
  });
  const 本位 = (x: { 币种: string; 合计: number }[]) => x.find((y) => y.币种 === b.currency)?.合计 ?? 0;
  const 钱列 = (键: "累计成交" | "当前投入", 说明: string): 列<Row> => ({
    title: <Tooltip title={说明}>{键}</Tooltip>, key: 键, width: 132, align: "right",
    // 排序只看本位币那一份（不换汇）
    sorter: (a, b2) => 本位(统计(a)[键]) - 本位(统计(b2)[键]),
    render: (_: unknown, r: Row) => (统计(r)[键].length ? <span className="chan-num nowrap">{合计文字(统计(r)[键], b.currency)}</span> : 无),
  });

  /** 产出比平均 / 最高 / 最低（显示产出比分布 打开才摆）：同一个「渠道名称」下各来源的产出比 */
  const 分布 = useMemo(() => {
    const m = new Map<string, ReturnType<typeof 产出比分布>>();
    if (!显示产出比分布) return m;
    const 组 = new Map<string, 渠道统计[]>();
    for (const r of 全部行) {
      const k = r.platform ?? r.name;
      (组.get(k) ?? 组.set(k, []).get(k)!).push(统计(r));
    }
    for (const [k, v] of 组) m.set(k, 产出比分布(v));
    return m;
  }, [全部行]);
  const 分布列: 列<Row>[] = 显示产出比分布
    ? (["平均", "最高", "最低"] as const).map((k) => ({
        title: `产出比${k}`, key: `产出比${k}`, width: 96, align: "right" as const,
        render: (_: unknown, r: Row) => {
          const d = 分布.get(r.platform ?? r.name);
          return d ? <span className="chan-num">{d[k]}</span> : 无;
        },
      }))
    : [];

  const 列表: 列<Row>[] = [
    {
      /*
        全称放第一列、钉在左边：后面一长排统计数横滚出去时，还认得出是哪一行（Windows 1024 宽时尤其）。
        属性、名称紧跟在后面。名字再长也只占一行，鼠标停上去看全
      */
      title: "渠道全称", key: "name", dataIndex: "name", width: 220, 常驻: true,
      render: (v: string, r) => (
        <span className="chan-full">
          <button type="button" className="link-plain link-strong" title={v} onClick={() => set详情id(r.id)}>{v}</button>
          {!r.active && <Tag style={{ margin: 0, borderRadius: 6, flex: "none" }}>已停用</Tag>}
        </span>
      ),
    },
    { title: "渠道属性", key: "attr", dataIndex: "attr", width: 104, ellipsis: true, render: (v: string | null) => (v ? <Tag style={{ margin: 0, borderRadius: 6 }}>{v}</Tag> : 无) },
    { title: "渠道名称", key: "platform", dataIndex: "platform", width: 120, ellipsis: true, render: (v: string | null) => v ?? 无 },
    {
      // 1280 以下收起这一列：停用的在全称旁边已经写着
      title: "渠道状态", key: "active", dataIndex: "active", width: 92, responsive: ["xl"],
      render: (v: boolean) =>
        v ? (
          <Tag color="success" style={{ margin: 0, borderRadius: 6 }}><CheckCircleOutlined /> 启用</Tag>
        ) : (
          <Tag style={{ margin: 0, borderRadius: 6 }}><StopOutlined /> 停用</Tag>
        ),
    },
    数列("关联线索", `这个渠道的${b.customer}名下，眼下还在线索阶段的项目`),
    数列("有效线索", "关联线索里有效的那些（现在还没有判无效的记号，和关联线索一样）"),
    数列("关联商机", "眼下在商机阶段的项目"),
    数列("关联订单", "眼下在订单阶段的项目"),
    数列("关联项目", "这个渠道带来的全部项目，各阶段都算"),
    钱列("累计成交", "订单阶段、不是异常状态的项目金额；按币种分开写，不换汇"),
    钱列("当前投入", "在渠道详情里录的投入合计"),
    {
      title: <Tooltip title="累计成交 ÷ 当前投入">投入产出比</Tooltip>, key: "产出比", width: 104, align: "right",
      sorter: (a, b2) => (统计(a).产出比 ?? -1) - (统计(b2).产出比 ?? -1),
      render: (_: unknown, r: Row) => {
        const s = 统计(r);
        return s.产出比 === null ? <Tooltip title={s.产出比说明}>{无}</Tooltip> : <span className="chan-num">{s.产出比}</span>;
      },
    },
    ...分布列,
    { title: "创建日期", key: "createdAt", dataIndex: "createdAt", width: 112, sorter: (a, b2) => a.createdAt.localeCompare(b2.createdAt), render: (v: string) => <span className="muted nowrap">{fmtDate(v)}</span> },
    {
      title: <Tooltip title="从创建日期到结束日期；没填结束日期就算到今天">累计运营天数</Tooltip>, key: "累计运营天数", width: 116, align: "right",
      sorter: (a, b2) => 统计(a).累计运营天数 - 统计(b2).累计运营天数,
      render: (_: unknown, r: Row) => <span className="chan-num nowrap">{统计(r).累计运营天数} 天</span>,
    },
    ...(不问归属 ? [] : [{ title: "负责人", key: "channelOwnerName", dataIndex: "channelOwnerName", width: 120, render: (v: string) => <UserCell name={v} size={24} /> }]),
    { title: "结束日期", key: "endDate", dataIndex: "endDate", width: 112, 默认: false, render: (v: string | null) => (v ? <span className="nowrap">{fmtDate(v)}</span> : 无) },
    { title: "创建人", key: "createdByName", dataIndex: "createdByName", width: 110, 默认: false, ellipsis: true, render: (v: string | null) => v ?? 无 },
    { title: "备注", key: "remark", dataIndex: "remark", width: 200, 默认: false, ellipsis: true, render: (v: string | null) => v ?? 无 },
    {
      title: "", key: "act", width: 136, 常驻: true, fixed: "right",
      render: (_, r) => (
        <Space size={2}>
          <Button aria-label={`${r.name} 的详情和投入`} title="详情和投入" type="text" size="small" icon={<AccountBookOutlined />} onClick={() => set详情id(r.id)} />
          <Button aria-label={`编辑 ${r.name}`} title="编辑" type="text" size="small" icon={<EditOutlined />} onClick={() => openForm(r)} />
          <Tooltip title={r.active ? "停用" : "启用"}>
            <Button
              aria-label={`${r.active ? "停用" : "启用"} ${r.name}`}
              type="text"
              size="small"
              icon={r.active ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={async () => {
                const res = await toggleChannel(r.id, !r.active);
                if (!res.ok) return void message.error(res.error);
                message.success(r.active ? `「${r.name}」已停用` : `「${r.name}」已启用`);
                router.refresh();
                亮一下(r.id);
              }}
            />
          </Tooltip>
          <Button
            aria-label={`删除 ${r.name}`}
            title="删除"
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() =>
              modal.confirm({
                title: `删除渠道「${r.name}」？`,
                okText: "删除",
                okButtonProps: { danger: true },
                cancelText: "取消",
                async onOk() {
                  const res = await deleteChannel(r.id);
                  if (!res.ok) return message.error(res.error);
                  message.success("已删除");
                  router.refresh();
                },
              })
            }
          />
        </Space>
      ),
    },
  ];

  /** 表单下拉：字典里启用的 + 正在编辑的这条原来的属性（后来停用了也照旧能留着） */
  const 表单属性 = editing?.attr && !属性选项.includes(editing.attr) ? [...属性选项, editing.attr] : 属性选项;

  return (
    <>
      <PageHead
        title="渠道"
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm(null)}>
            新建渠道
          </Button>
        }
      />

      <DataList<Row>
        页="channels"
        空库={全部行.length === 0}
        列={列表}
        行={rows}
        亮={亮行}
        行类={(r) => (r.active ? undefined : "row-off")}
        空态={{
          title: "还没有渠道",
          hint: `渠道是${b.customer}从哪来的：按「渠道属性 → 渠道名称 → 来源」建一条，新建${b.customer}时从清单里选；在渠道详情里录投入，这里就算得出投入产出比。不再用的渠道停用即可。`,
          primary: { label: "新建第一个渠道", onClick: () => openForm(null) },
        }}
        筛选={
          /* 渠道页一次就把行全拿下来了（没有服务端分页），所以筛在本地做 */
          <Space wrap size={[10, 10]}>
            <Input
              style={{ width: 240, maxWidth: "100%" }}
              placeholder="搜索渠道全称、名称、属性"
              prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />}
              value={kw}
              allowClear
              onChange={(e) => setKw(e.target.value)}
            />
            <Select
              style={{ width: 140 }}
              placeholder="全部属性"
              allowClear
              value={attr || undefined}
              onChange={(v) => setAttr(v ?? "")}
              options={筛选属性.map((x) => ({ value: x, label: x }))}
            />
            {!不问归属 && (
              <Select
                style={{ width: 150 }}
                placeholder="全部负责人"
                allowClear
                value={ownerId || undefined}
                onChange={(v) => setOwnerId(v ?? "")}
                options={成员选项(users)}
              />
            )}
            <Select
              style={{ width: 130 }}
              placeholder="全部状态"
              allowClear
              value={active || undefined}
              onChange={(v) => setActive(v ?? "")}
              options={[{ value: "on", label: "已启用" }, { value: "off", label: "已停用" }]}
            />
            <ResetFilters 显示={Boolean(kw || attr || ownerId || active)} onClick={() => { setKw(""); setAttr(""); setOwnerId(""); setActive(""); }} />
          </Space>
        }
      />

      {详情 && <ChannelDrawer key={详情.id} row={详情} 不问归属={不问归属} onClose={() => set详情id(null)} onEdit={() => openForm(详情)} />}

      {open && (
        <Modal
          {...守.弹窗}
          open
          title={editing ? "编辑渠道" : "新建渠道"}
          onOk={onOk}
          confirmLoading={saving}
          okText="保存"
          cancelText="取消"
          destroyOnHidden
          width={600}
        >
          <Form
            form={form}
            layout="vertical"
            style={{ marginTop: 8 }}
            onValuesChange={表单变了}
            // 新建时渠道负责人默认是我（团队同步之后候选里有同事）
            initialValues={editing ? 编辑初值(editing) : { active: true, channelOwnerId: 默认负责人(我, users) }}
          >
            <行 gutter={16}>
              <Col xs={24} sm={12}>
                <Form.Item label="渠道属性" name="attr" rules={[{ required: true, message: "请选择渠道属性" }]}>
                  <Select placeholder="请选择" options={表单属性.map((x) => ({ value: x, label: x }))} notFoundContent="字典里还没有渠道属性，到 设置 → 字典 里加" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="渠道状态" name="active">
                  <Radio.Group optionType="button" options={[{ value: true, label: "启用" }, { value: false, label: "停用" }]} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="渠道名称" name="platform" rules={[{ required: true, whitespace: true, message: "请填写渠道名称" }]}>
                  <Input placeholder="如：短视频平台" maxLength={全称上限} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="来源" name="source" rules={[{ required: true, whitespace: true, message: "请填写来源" }]}>
                  <Input placeholder="如：官方账号" maxLength={全称上限} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item
                  label="渠道全称"
                  name="name"
                  extra="按「渠道名称|来源」自动拼好；要换个叫法可以直接改。全称不能和别的渠道重名"
                  rules={[{ max: 全称上限, message: `渠道全称最多 ${全称上限} 个字` }]}
                >
                  <Input placeholder="填了渠道名称和来源后自动出来" />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item label="结束日期" name="endDate" extra="不填 = 还在运营，天数算到今天">
                  <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
                </Form.Item>
              </Col>
              {/*
                **只有一个人时不问这一项**（2026-09-18）：让他从一个只有自己的下拉里选一次自己，
                是在问一个只有一个答案的问题。留空交给服务端填（actions.ts 的 唯一负责人）。
                编辑一条挂在别人名下的旧记录时照样问。
              */}
              {!独自一人(users, editing?.channelOwnerId) && (
                <Col xs={24} sm={12}>
                  <Form.Item
                    label="负责人"
                    name="channelOwnerId"
                    rules={[{ required: true, message: "请选择渠道负责人" }]}
                    extra={`之后由该渠道新增的${b.customer}归此人；已有的归属不变`}
                  >
                    <Select placeholder="请选择" options={成员选项(users)} />
                  </Form.Item>
                </Col>
              )}
              <Col span={24}>
                <Form.Item label="备注" name="remark">
                  <Input.TextArea rows={3} placeholder="渠道背景、合作方式…" />
                </Form.Item>
              </Col>
            </行>
          </Form>
        </Modal>
      )}
    </>
  );
}
