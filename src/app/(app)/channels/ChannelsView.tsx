"use client";

import { isFormValidationError } from "@/lib/form-validation";

import { useMe, 默认负责人 } from "@/lib/me-client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Space, Tag, Modal, Form, Input, Select, App, Tooltip, Row as 行, Col, Radio, Dropdown, type MenuProps } from "antd";
import { PlusOutlined, SearchOutlined, MoreOutlined } from "@ant-design/icons";
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
import { 拼全称, 拆来源, 全称上限, 显示产出比分布, 产出比分布, type 渠道统计, type 转化 } from "@/lib/enterprise/channel-stats";
import { 转化率字 } from "../overview/funnel";
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
  /** 名下客户数（来源或归属落在这个渠道），删除项变不变灰看它；口径同 deleteChannel */
  客户数?: number;
  /** 录过几笔投入，同上 */
  投入数?: number;
};
type Row = 渠道行;

const 空转化: 转化 = { 分子: 0, 分母: 0, 比例: null };
const 空统计: 渠道统计 = { 关联线索: 0, 有效线索: 0, 关联商机: 0, 关联订单: 0, 关联项目: 0, 累计成交: [], 当前投入: [], 产出比: null, 产出比说明: "还没录投入", 累计运营天数: 0, 线索转商机: 空转化, 商机转订单: 空转化 };
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

/**
 * 渠道全称（P16）：不让手填，永远是「渠道名称|来源」拼出来的（服务端 saveChannel 也照这个重拼）。
 * 这里只给预览；编辑一条老渠道、拼出来和原来的全称不一样时，写清保存后会从什么改成什么，免得悄悄被换掉
 */
function FullNamePreview({ 原名 }: { 原名: string | null }) {
  const form = Form.useFormInstance();
  const platform = Form.useWatch("platform", form) as string | undefined;
  const source = Form.useWatch("source", form) as string | undefined;
  const 新 = 拼全称(platform, source);
  const 会改 = 原名 !== null && 新 !== "" && 新 !== 原名;
  return (
    <Form.Item label="渠道全称" extra="按「渠道名称|来源」自动拼，不用填；改全称就改上面两项。全称不能和别的渠道重名">
      <div aria-live="polite" style={{ overflowWrap: "anywhere", minHeight: 22 }}>
        {新 ? <strong>{新}</strong> : <span className="muted">填了渠道名称和来源后自动出来</span>}
      </div>
      {会改 && (
        <div className="muted" style={{ fontSize: 12, marginTop: 4, overflowWrap: "anywhere" }}>
          保存后全称从「{原名}」改成「{新}」
        </div>
      )}
    </Form.Item>
  );
}

export default function ChannelsView({
  rows: 全部行,
  users,
  属性选项 = [],
  能录 = false,
  能管 = true,
}: {
  rows: Row[];
  users: 可选成员[];
  /** 字典里启用着的渠道属性（设置 → 字典 → 渠道属性） */
  属性选项?: string[];
  /** 能录投入的才在行上摆「录投入」（老板、总管理员、市场管理，channel-stats.ts 的 能录投入），别人摆「详情」 */
  能录?: boolean;
  /**
   * 能不能新建、编辑、停用、删除渠道（10-30 B1）：企业版只有老板、总管理员、市场管理（channel-stats.ts 的 能管渠道），
   * 别人只读——「新建渠道」、空态的新建、行上「⋯」、抽屉里的「编辑」都不出。服务端 挡管 再挡一道
   */
  能管?: boolean;
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
  /** 从行上「录投入」打开的：抽屉一开就展开录入表单 */
  const [先录, set先录] = useState(false);
  function 看详情(id: string, 录 = false) {
    set先录(录);
    set详情id(id);
  }
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
  function openForm(r: Row | null) {
    setEditing(r);
    setOpen(true);
  }

  async function onOk() {
    if (saving) return;
    setSaving(true);
    try {
      const v = await form.validateFields();
      const res = await saveChannel({
        id: editing?.id,
        版本: editing?.updatedAt,
        // 全称不让手填（P16）：服务端也照「渠道名称|来源」重拼，这里交一份一样的
        name: 拼全称(v.platform, v.source),
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
  const 数列 = (键: 数键, 说明: string, 标题: string = 键): 列<Row> => ({
    title: <Tooltip title={说明}><span className="nowrap">{标题}</span></Tooltip>, key: 键, width: 104, align: "right",
    sorter: (a, b2) => 统计(a)[键] - 统计(b2)[键],
    render: (_: unknown, r: Row) => (统计(r)[键] > 0 ? <span className="chan-num">{统计(r)[键]}</span> : 无),
  });
  /** 两个转化率列（10-30 B5）：分母 0 显示「—」，鼠标停上去看几个里有几个；口径见 channel-stats.ts 的 算转化 */
  const 转化列 = (键: "线索转商机" | "商机转订单", 标题: string, 说明: string): 列<Row> => ({
    title: <Tooltip title={说明}><span className="nowrap">{标题}</span></Tooltip>, key: 键, width: 112, align: "right",
    sorter: (a, b2) => (统计(a)[键].比例 ?? -1) - (统计(b2)[键].比例 ?? -1),
    render: (_: unknown, r: Row) => {
      const z = 统计(r)[键];
      return z.比例 === null ? 无 : <Tooltip title={`${z.分母} 个里 ${z.分子} 个`}><span className="chan-num">{转化率字(z.比例)}</span></Tooltip>;
    },
  });
  const 本位 = (x: { 币种: string; 合计: number }[]) => x.find((y) => y.币种 === b.currency)?.合计 ?? 0;
  const 钱列 = (键: "累计成交" | "当前投入", 说明: string): 列<Row> => ({
    title: <Tooltip title={说明}><span className="nowrap">{键}</span></Tooltip>, key: 键, width: 144, align: "right",
    // 排序只看本位币那一份（不换汇）
    sorter: (a, b2) => 本位(统计(a)[键]) - 本位(统计(b2)[键]),
    render: (_: unknown, r: Row) => (统计(r)[键].length ? <span className="chan-num nowrap">{合计文字(统计(r)[键], b.currency)}</span> : 无),
  });

  /** 产出比平均值 / 最高值 / 最低值（显示产出比分布 打开才摆）：同一个「渠道名称」下各来源的产出比，抽屉里也用 */
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
  const 分布说明 = { 平均: "简单平均，不按投入加权", 最高: "取最高的那个", 最低: "取最低的那个" } as const;
  const 分布列: 列<Row>[] = 显示产出比分布
    ? (["平均", "最高", "最低"] as const).map((k) => ({
        title: (
          <Tooltip title={`同一个渠道名称下各来源的投入产出比，${分布说明[k]}；没录投入、混了币种的来源不算`}>
            <span className="nowrap">产出比{k}值</span>
          </Tooltip>
        ),
        key: `产出比${k}`, width: 128, align: "right" as const,
        sorter: (a: Row, b2: Row) => (分布.get(a.platform ?? a.name)?.[k] ?? -1) - (分布.get(b2.platform ?? b2.name)?.[k] ?? -1),
        render: (_: unknown, r: Row) => {
          const 名 = r.platform ?? r.name;
          const d = 分布.get(名);
          return d ? (
            <Tooltip title={`「${名}」下 ${d.个数} 个来源能算产出比`}>
              <span className="chan-num">{d[k]}</span>
            </Tooltip>
          ) : (
            <Tooltip title={`「${名}」下的来源都还算不了产出比`}>{无}</Tooltip>
          );
        },
      }))
    : [];

  /** 每一行关联线索、有效线索都一样（现在还没有判无效的记号）：合成一列，差别写在表头的悬停里 */
  const 线索一样 = 全部行.every((r) => 统计(r).关联线索 === 统计(r).有效线索);
  const 线索说明 = `这个渠道的${b.customer}名下，眼下还在线索阶段的项目`;

  /** 行上「⋯ → 删除」变灰的原因（交互规则 A）：有关联数据的删不了，口径同 deleteChannel */
  function 删不了(r: Row): string | null {
    const 因 = [r.客户数 ? `名下有 ${r.客户数} 位${b.customer}` : "", r.投入数 ? `录过 ${r.投入数} 笔投入` : ""].filter(Boolean);
    return 因.length ? `${因.join("、")}，不能删；不用了就停用` : null;
  }
  async function 切停用(r: Row) {
    const res = await toggleChannel(r.id, !r.active);
    if (!res.ok) return void message.error(res.error);
    message.success(r.active ? `「${r.name}」已停用` : `「${r.name}」已启用`);
    router.refresh();
    亮一下(r.id);
  }

  const 列表: 列<Row>[] = [
    {
      /*
        只留「渠道」一列（10-30）：全称后面跟着属性标签；原来的「渠道属性」「渠道名称」两列名字差不多、名称几乎都是「—」，去掉了
        （名称照旧能搜）。停用的再跟一个「已停用」，原来那列「渠道状态」也就不要了。
        名字整段显示（10-30 用户：「要显示完整」）：放不下折行，标签钉在第一行右边（.chan-full）；列宽 240，1024 宽也够折成两三行
      */
      title: "渠道", key: "name", dataIndex: "name", width: 240, 常驻: true,
      render: (v: string, r) => (
        <span className="chan-full">
          <button type="button" className="link-plain link-strong" title={v} onClick={() => 看详情(r.id)}>{v}</button>
          {r.attr && <Tag style={{ margin: 0, borderRadius: 6, flex: "none" }}>{r.attr}</Tag>}
          {!r.active && <Tag style={{ margin: 0, borderRadius: 6, flex: "none" }}>已停用</Tag>}
        </span>
      ),
    },
    ...(线索一样
      ? [数列("关联线索", `${线索说明}。有效线索是其中有效的那些，现在还没有判无效的记号、两个数一样，合成这一列`, "线索")]
      : [数列("关联线索", 线索说明), 数列("有效线索", "关联线索里有效的那些")]),
    数列("关联商机", "眼下在商机阶段的项目"),
    数列("关联订单", "眼下在订单阶段的项目"),
    转化列("线索转商机", "线索→商机", "从线索起步的项目里，后来到过商机（含已进订单）的占几成；退回去的也算到过。导入时直接落在商机、订单的不算在里面"),
    转化列("商机转订单", "商机→订单", "到过商机的项目里，后来到过订单的占几成；导入时直接落在订单的不算在里面"),
    // 1366 宽放得下（规则 G）：关联项目、创建日期、累计运营天数默认收进「列」里，要看再勾
    { ...数列("关联项目", "这个渠道带来的全部项目，各阶段都算"), 默认: false },
    钱列("累计成交", "订单阶段、不是异常状态的项目金额；按币种分开写，不换汇"),
    钱列("当前投入", "在渠道详情里录的投入合计"),
    {
      title: <Tooltip title="累计成交 ÷ 当前投入"><span className="nowrap">投入产出比</span></Tooltip>, key: "产出比", width: 116, align: "right",
      sorter: (a, b2) => (统计(a).产出比 ?? -1) - (统计(b2).产出比 ?? -1),
      render: (_: unknown, r: Row) => {
        const s = 统计(r);
        return s.产出比 === null ? <Tooltip title={s.产出比说明}>{无}</Tooltip> : <span className="chan-num">{s.产出比}</span>;
      },
    },
    ...分布列,
    { title: "创建日期", key: "createdAt", dataIndex: "createdAt", width: 112, 默认: false, sorter: (a, b2) => a.createdAt.localeCompare(b2.createdAt), render: (v: string) => <span className="muted nowrap">{fmtDate(v)}</span> },
    {
      title: <Tooltip title="从创建日期到结束日期；没填结束日期就算到今天">累计运营天数</Tooltip>, key: "累计运营天数", width: 116, align: "right", 默认: false,
      sorter: (a, b2) => 统计(a).累计运营天数 - 统计(b2).累计运营天数,
      render: (_: unknown, r: Row) => <span className="chan-num nowrap">{统计(r).累计运营天数} 天</span>,
    },
    ...(不问归属 ? [] : [{ title: "负责人", key: "channelOwnerName", dataIndex: "channelOwnerName", width: 112, render: (v: string) => <UserCell name={v} size={24} /> }]),
    { title: "结束日期", key: "endDate", dataIndex: "endDate", width: 112, 默认: false, render: (v: string | null) => (v ? <span className="nowrap">{fmtDate(v)}</span> : 无) },
    // 创建人、备注是辅助列：一行省略照旧（ellipsis 下 antd 自己给字符串格子写 title，悬停看全）
    { title: "创建人", key: "createdByName", dataIndex: "createdByName", width: 110, 默认: false, ellipsis: true, render: (v: string | null) => v ?? 无 },
    { title: "备注", key: "remark", dataIndex: "remark", width: 200, 默认: false, ellipsis: true, render: (v: string | null) => v ?? 无 },
    {
      /* 行上只留一个带字的按钮（规则 D）：能录投入的是「录投入」，别人是「详情」；编辑、停用、删除收进「⋯」，删除不标红 */
      title: "", key: "act", width: 108, 常驻: true, fixed: "right",
      render: (_, r) => {
        const 删因 = 删不了(r);
        const 菜单: NonNullable<MenuProps["items"]> = [
          { key: "edit", label: "编辑", onClick: () => openForm(r) },
          {
            key: "toggle",
            label: r.active ? "停用" : "启用",
            onClick: () =>
              r.active
                ? modal.confirm({
                    title: `停用渠道「${r.name}」？`,
                    content: "停用后新线索里选不到。",
                    okText: "停用",
                    cancelText: "取消",
                    onOk: () => 切停用(r),
                  })
                : void 切停用(r),
          },
          {
            key: "delete",
            disabled: Boolean(删因),
            label: 删因 ? (
              <div>
                <div>删除</div>
                <div className="muted" style={{ fontSize: 12, lineHeight: "16px", whiteSpace: "normal", maxWidth: 220 }}>{删因}</div>
              </div>
            ) : "删除",
            onClick: () =>
              modal.confirm({
                title: `删除渠道「${r.name}」？`,
                okText: "删除",
                cancelText: "取消",
                async onOk() {
                  const res = await deleteChannel(r.id);
                  if (!res.ok) return message.error(res.error);
                  message.success("已删除");
                  router.refresh();
                },
              }),
          },
        ];
        return (
          <Space size={2}>
            {能录 ? (
              <Button className="row-act" aria-label={`给 ${r.name} 录投入`} size="small" onClick={() => 看详情(r.id, true)}>录投入</Button>
            ) : (
              <Button className="row-act" aria-label={`${r.name} 的详情`} size="small" onClick={() => 看详情(r.id)}>详情</Button>
            )}
            {能管 && (
              <Dropdown trigger={["click"]} menu={{ items: 菜单, onClick: ({ domEvent }) => domEvent.stopPropagation() }}>
                <Button className="row-act" aria-label={`更多操作 ${r.name}`} type="text" size="small" icon={<MoreOutlined />} />
              </Dropdown>
            )}
          </Space>
        );
      },
    },
  ];

  /** 表单下拉：字典里启用的 + 正在编辑的这条原来的属性（后来停用了也照旧能留着） */
  const 表单属性 = editing?.attr && !属性选项.includes(editing.attr) ? [...属性选项, editing.attr] : 属性选项;

  return (
    <>
      <PageHead
        title="渠道"
        extra={
          能管 && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm(null)}>
              新建渠道
            </Button>
          )
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
          primary: 能管 ? { label: "新建第一个渠道", onClick: () => openForm(null) } : undefined,
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

      {详情 && <ChannelDrawer key={详情.id} row={详情} 先录={先录} 同名分布={显示产出比分布 ? (分布.get(详情.platform ?? 详情.name) ?? null) : undefined} 不问归属={不问归属} onClose={() => set详情id(null)} onEdit={能管 ? () => openForm(详情) : undefined} />}

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
            onValuesChange={() => 守.改了()}
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
                <Form.Item
                  label="来源"
                  name="source"
                  dependencies={["platform"]}
                  rules={[
                    { required: true, whitespace: true, message: "请填写来源" },
                    ({ getFieldValue }) => ({
                      validator: (_, v: string | undefined) =>
                        拼全称(getFieldValue("platform"), v).length > 全称上限
                          ? Promise.reject(new Error(`渠道名称加来源拼成的全称最多 ${全称上限} 个字，请缩短`))
                          : Promise.resolve(),
                    }),
                  ]}
                >
                  <Input placeholder="如：官方账号" maxLength={全称上限} />
                </Form.Item>
              </Col>
              <Col span={24}>
                <FullNamePreview 原名={editing?.name ?? null} />
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
