"use client";

import { isFormValidationError } from "@/lib/form-validation";

import { useMe, 默认负责人 } from "@/lib/me-client";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Button, Space, Tag, Modal, Form, Input, Select, App, Tooltip, Row as 行, Col, Radio, Dropdown, Segmented, type MenuProps } from "antd";
import { PlusOutlined, SearchOutlined, MoreOutlined } from "@ant-design/icons";
import type { Dayjs } from "dayjs";
import ResetFilters from "@/components/ResetFilters";
import { useCustomFilters } from "@/components/CustomFilters";
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
import OptionInput from "@/components/OptionInput";
import { 子渠道名, 子渠道提示, 主渠道名上限, 按主渠道汇总, type 主渠道行, type 主渠道汇总 } from "@/lib/enterprise/channel-main-core";
import MainChannels from "./MainChannels";
import ChannelDrawer from "./ChannelDrawer";
import ChannelDash from "./ChannelDash";
import { 筛渠道, type 看板底数, type 看板公海 } from "@/lib/enterprise/channel-dash";
import type { 日期段 } from "@/lib/custom-date-range";

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
  /** 渠道名称（企业版两层后 = 主渠道名）；老渠道可能没有 */
  platform: string | null;
  /** 挂在哪个主渠道下（企业版渠道两层，11-08）；还没补挂的是 null */
  mainId?: string | null;
  /** 运营策略（字典 channelStrategy 多选） */
  strategies?: string[];
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
  /** 项目来源是这个渠道的项目数，同上（11-03 A1-1） */
  项目数?: number;
};
type Row = 渠道行;

const 空转化: 转化 = { 分子: 0, 分母: 0, 比例: null };
const 空统计: 渠道统计 = { 关联线索: 0, 有效线索: 0, 关联商机: 0, 关联订单: 0, 关联项目: 0, 累计成交: [], 当前投入: [], 产出比: null, 产出比说明: "还没录投入", 累计运营天数: 0, 线索转商机: 空转化, 商机转订单: 空转化 };
type 有统计 = { 统计?: 渠道统计 };
const 统计 = (r: 有统计) => r.统计 ?? 空统计;
const 无 = <span className="muted">—</span>;
/** 渠道名那一列最宽多少（再长省略、悬停看全称）：这一列钉在左边，1024 宽也得给后面的数留地方 */
const 名字最宽 = 480;
/** 估一个渠道名一行要多宽，按 16px 的字宽估（宁宽勿窄，省得刚好差一点被省略）：中文、全角字 16，其余 9，两边留白 24 */
function 名字宽(名: string): number {
  let w = 24;
  for (const ch of 名) w += /[\u2e80-\uffef]/.test(ch) ? 16 : 9;
  return Math.ceil(w);
}

/** 编辑老渠道时回填表单：没有渠道名称的老渠道，名称和来源都先填成全称 */
function 编辑初值(r: Row) {
  const platform = r.platform ?? r.name;
  return {
    attr: r.attr ?? undefined,
    platform,
    // 两层后子渠道可以空：全称就是主渠道名 → 子渠道留空（子渠道名 认「|」和全角「｜」）
    source: r.platform ? 子渠道名(r.name, platform) : 拆来源(r.name, platform),
    strategies: r.strategies ?? [],
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
function FullNamePreview({ 原名, 两层 }: { 原名: string | null; 两层: boolean }) {
  const form = Form.useFormInstance();
  const platform = Form.useWatch("platform", form) as string | undefined;
  const source = Form.useWatch("source", form) as string | undefined;
  const 新 = 拼全称(platform, source);
  const 会改 = 原名 !== null && 新 !== "" && 新 !== 原名;
  return (
    <Form.Item
      label="渠道全称"
      extra={两层 ? "按「主渠道|子渠道」自动拼，不用填；子渠道留空时全称就是主渠道。全称不能和别的渠道重名" : "按「渠道名称|来源」自动拼，不用填；改全称就改上面两项。全称不能和别的渠道重名"}
    >
      <div aria-live="polite" style={{ overflowWrap: "anywhere", minHeight: 22 }}>
        {新 ? <strong>{新}</strong> : <span className="muted">{两层 ? "填了主渠道后自动出来" : "填了渠道名称和来源后自动出来"}</span>}
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
  看板底数,
  看板段 = null,
  公海 = null,
  主渠道们 = [],
  策略选项 = [],
  两层: 开两层 = false,
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
  /** 总览看板的底数（企业版才有，channel-dash.ts）；没有就不摆看板 */
  看板底数?: 看板底数 | null;
  /** 看板选着「自定义」时那一段（服务端读好地址栏）；没选 = null */
  看板段?: 日期段 | null;
  /** 看板的「进公海」那段（11-04 P-界面-09，只给市场成员 / 市场管理）；别人 null 不摆 */
  公海?: 看板公海 | null;
  /** 主渠道清单（企业版渠道两层，11-08）；是不是两层看下面的「两层」，不看这里空不空 */
  主渠道们?: 主渠道行[];
  /** 企业版渠道两层（11-08）：开着时主渠道一个都还没有，也照样走「主渠道 + 子渠道」表单，不退回老的单个名字 */
  两层?: boolean;
  /** 字典里启用着的运营策略（设置 → 字典 → 运营策略），没有默认项 */
  策略选项?: string[];
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
  const [creator, setCreator] = useState("");
  const [主, set主] = useState("");
  const 两层 = 开两层;
  /** 统计按两层看（P-渠道-01 附.5）：按子渠道一行（原样）/ 按主渠道并成一行；只有两层时才有这个切换 */
  const [按主看, set按主看] = useState(false);
  // 看板也吃这一份：列表剩几个渠道，看板就按这几个算
  const rows = useMemo(() => {
    const 筛过 = 筛渠道(全部行, { kw, attr, ownerId, active, creator });
    return 主 ? 筛过.filter((r) => r.mainId === 主) : 筛过;
  }, [全部行, kw, attr, ownerId, active, creator, 主]);
  /** 按主渠道看：筛过的子渠道按主渠道并行，数照 合并统计 加（转化率按分子分母重算、钱按币种加） */
  const 主行们 = useMemo(() => (两层 && 按主看 ? 按主渠道汇总(rows, 主渠道们) : []), [两层, 按主看, rows, 主渠道们]);
  /** 每个主渠道下挂了几个渠道（主渠道管理里摆） */
  const 子渠道数 = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of 全部行) if (r.mainId) m.set(r.mainId, (m.get(r.mainId) ?? 0) + 1);
    return m;
  }, [全部行]);
  const 按名找主 = useMemo(() => new Map(主渠道们.map((m) => [m.name, m])), [主渠道们]);
  const [开主渠道, set开主渠道] = useState(false);
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
  const 创建人们 = useMemo(() => [...new Set(全部行.map((r) => r.createdByName).filter((x): x is string => Boolean(x)))], [全部行]);
  // 自定义筛选（11-06）：搜索框固定；默认摆的和原来一样（属性、负责人、状态），「创建人」收在更多筛选
  // 两层（11-08）多了「主渠道」：「状态」默认也收进更多筛选，否则 1024 宽筛选行摆不下一行（e2e window-sizes 守着）；有值时照样外露
  const { 外露: 筛选外露, 更多按钮: 更多筛选按钮 } = useCustomFilters("channels", [
    ...(两层 ? [{ 键: "main", 名: "主渠道", 宽: 160, 默认外露: true, 有值: !!主, 渲染: (style: CSSProperties) => <Select style={style} aria-label="主渠道" placeholder="全部主渠道" allowClear showSearch={{ optionFilterProp: "label" }} popupMatchSelectWidth={false} value={主 || undefined} onChange={(v?: string) => set主(v ?? "")} options={主渠道们.filter((m) => m.active || 子渠道数.get(m.id)).map((m) => ({ value: m.id, label: m.active ? m.name : `${m.name}（已停用）` }))} /> }] : []),
    { 键: "attr", 名: "属性", 宽: 140, 默认外露: true, 有值: !!attr, 渲染: (style: CSSProperties) => <Select style={style} aria-label="属性" placeholder="全部属性" allowClear value={attr || undefined} onChange={(v?: string) => setAttr(v ?? "")} options={筛选属性.map((x) => ({ value: x, label: x }))} /> },
    ...(!不问归属 ? [{ 键: "ownerId", 名: "负责人", 宽: 150, 默认外露: true, 有值: !!ownerId, 渲染: (style: CSSProperties) => <Select style={style} aria-label="负责人" placeholder="全部负责人" allowClear showSearch={{ optionFilterProp: "label" }} popupMatchSelectWidth={false} value={ownerId || undefined} onChange={(v?: string) => setOwnerId(v ?? "")} options={成员选项(users)} /> }] : []),
    { 键: "active", 名: "状态", 宽: 130, 默认外露: !两层, 有值: !!active, 渲染: (style: CSSProperties) => <Select style={style} aria-label="状态" placeholder="全部状态" allowClear value={active || undefined} onChange={(v?: string) => setActive(v ?? "")} options={[{ value: "on", label: "已启用" }, { value: "off", label: "已停用" }]} /> },
    ...(!不问归属 ? [{ 键: "creator", 名: "创建人", 宽: 130, 默认外露: false, 有值: !!creator, 渲染: (style: CSSProperties) => <Select style={style} aria-label="创建人" placeholder="全部创建人" allowClear showSearch={{ optionFilterProp: "label" }} popupMatchSelectWidth={false} value={creator || undefined} onChange={(v?: string) => setCreator(v ?? "")} options={创建人们.map((x) => ({ value: x, label: x }))} /> }] : []),
  ]);
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
        ...(两层 ? { strategies: (v.strategies as string[] | undefined) ?? [] } : {}),
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
  // 列工厂对「按子渠道」「按主渠道」两种行都能用（只看 统计）
  const 数列 = <T extends 有统计,>(键: 数键, 说明: string, 标题: string = 键): 列<T> => ({
    title: <Tooltip title={说明}><span className="nowrap">{标题}</span></Tooltip>, key: 键, width: 104, align: "right",
    sorter: (a, b2) => 统计(a)[键] - 统计(b2)[键],
    render: (_: unknown, r: T) => (统计(r)[键] > 0 ? <span className="chan-num">{统计(r)[键]}</span> : 无),
  });
  /** 两个转化率列（10-30 B5）：分母 0 显示「—」，鼠标停上去看几个里有几个；口径见 channel-stats.ts 的 算转化 */
  const 转化列 = <T extends 有统计,>(键: "线索转商机" | "商机转订单", 标题: string, 说明: string): 列<T> => ({
    title: <Tooltip title={说明}><span className="nowrap">{标题}</span></Tooltip>, key: 键, width: 112, align: "right",
    sorter: (a, b2) => (统计(a)[键].比例 ?? -1) - (统计(b2)[键].比例 ?? -1),
    render: (_: unknown, r: T) => {
      const z = 统计(r)[键];
      return z.比例 === null ? 无 : <Tooltip title={`${z.分母} 个里 ${z.分子} 个`}><span className="chan-num">{转化率字(z.比例)}</span></Tooltip>;
    },
  });
  const 本位 = (x: { 币种: string; 合计: number }[]) => x.find((y) => y.币种 === b.currency)?.合计 ?? 0;
  const 钱列 = <T extends 有统计,>(键: "累计成交" | "当前投入", 说明: string): 列<T> => ({
    title: <Tooltip title={说明}><span className="nowrap">{键}</span></Tooltip>, key: 键, width: 144, align: "right",
    // 排序只看本位币那一份（不换汇）
    sorter: (a, b2) => 本位(统计(a)[键]) - 本位(统计(b2)[键]),
    render: (_: unknown, r: T) => (统计(r)[键].length ? <span className="chan-num nowrap">{合计文字(统计(r)[键], b.currency)}</span> : 无),
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

  /** 渠道名一列的宽：按最长的名字估（名字宽），最窄 120、最宽 名字最宽 */
  const 名列宽 = Math.min(名字最宽, Math.max(120, ...全部行.map((r) => 名字宽(r.name))));
  /** 属性列：有停用的要并排放「属性 + 已停用」两个标签 */
  const 属性列宽 = 全部行.some((r) => !r.active) ? 156 : 108;

  /** 行上「⋯ → 删除」变灰的原因（交互规则 A）：有关联数据的删不了，口径同 deleteChannel */
  function 删不了(r: Row): string | null {
    const 因 = [r.客户数 ? `名下有 ${r.客户数} 位${b.customer}` : "", r.投入数 ? `录过 ${r.投入数} 笔投入` : "", r.项目数 ? `是 ${r.项目数} 个项目的项目来源` : ""].filter(Boolean);
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
        渠道名一列、渠道属性一列（11-01 用户：「把名字和公域引流这个分开显示……然后所有列都要一行显示」）：
        名字一行不折，列宽按最长的名字估（名字宽）；再长也只到 名字最宽，超出的省略、悬停看全称。停用的在属性那列后面跟「已停用」
      */
      title: "渠道", key: "name", dataIndex: "name", width: 名列宽, 常驻: true,
      render: (v: string, r) => (
        <button type="button" className="link-plain link-strong chan-name" title={v} onClick={() => 看详情(r.id)}>{v}</button>
      ),
    },
    {
      title: "渠道属性", key: "attr", dataIndex: "attr", width: 属性列宽,
      render: (v: string, r) => (v || !r.active ? (
        <span className="chan-tags">
          {v && <Tag style={{ margin: 0, borderRadius: 6 }}>{v}</Tag>}
          {!r.active && <Tag style={{ margin: 0, borderRadius: 6 }}>已停用</Tag>}
        </span>
      ) : 无),
    },
    ...(线索一样
      ? [数列<Row>("关联线索", `${线索说明}。有效线索是其中有效的那些，现在还没有判无效的记号、两个数一样，合成这一列`, "线索")]
      : [数列<Row>("关联线索", 线索说明), 数列<Row>("有效线索", "关联线索里有效的那些")]),
    数列<Row>("关联商机", "眼下在商机阶段的项目"),
    数列<Row>("关联订单", "眼下在订单阶段的项目"),
    转化列<Row>("线索转商机", "线索→商机", "从线索起步的项目里，后来到过商机（含已进订单）的占几成；退回去的也算到过。导入时直接落在商机、订单的不算在里面"),
    转化列<Row>("商机转订单", "商机→订单", "到过商机的项目里，后来到过订单的占几成；导入时直接落在订单的不算在里面"),
    // 1366 宽放得下（规则 G）：关联项目、创建日期、累计运营天数默认收进「列」里，要看再勾
    { ...数列<Row>("关联项目", "这个渠道带来的全部项目，各阶段都算"), 默认: false },
    钱列<Row>("累计成交", "订单阶段、不是异常状态的项目金额；按币种分开写，不换汇"),
    钱列<Row>("当前投入", "在渠道详情里录的投入合计"),
    {
      title: <Tooltip title="累计成交 ÷ 当前投入"><span className="nowrap">投入产出比</span></Tooltip>, key: "产出比", width: 116, align: "right",
      sorter: (a, b2) => (统计(a).产出比 ?? -1) - (统计(b2).产出比 ?? -1),
      render: (_: unknown, r: Row) => {
        const s = 统计(r);
        return s.产出比 === null ? <Tooltip title={s.产出比说明}>{无}</Tooltip> : <span className="chan-num">{s.产出比}</span>;
      },
    },
    ...分布列,
    ...(两层
      ? [{
          title: "运营策略", key: "strategies", width: 160, 默认: false, ellipsis: true,
          render: (_: unknown, r: Row) => (r.strategies?.length ? <span title={r.strategies.join("、")}>{r.strategies.join("、")}</span> : 无),
        } as 列<Row>]
      : []),
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
    // 备注照旧折行写完（11-04 用户：「除了备注，备注信息有时候过多」）
    { title: "备注", key: "remark", dataIndex: "remark", width: 200, 默认: false, 折行: true, render: (v: string | null) => v ?? 无 },
    {
      /* 行上只留一个带字的按钮（规则 D）：能录投入的是「录投入」，别人是「详情」；编辑、停用、删除收进「⋯」，删除不标红 */
      title: "", key: "act", width: 124, 常驻: true, fixed: "right",
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

  /** 按主渠道看的列：只摆能相加的统计；点主渠道名 = 回到按子渠道、筛这个主渠道 */
  const 主名列宽 = Math.min(名字最宽, Math.max(120, ...主行们.map((r) => 名字宽(r.name) + (r.历史 || !r.active ? 84 : 0))));
  const 主列表: 列<主渠道汇总>[] = [
    {
      title: "主渠道", key: "name", dataIndex: "name", width: 主名列宽, 常驻: true,
      render: (v: string, r) => (
        // 名字可缩、标签不缩：超长主渠道名省略，「历史渠道」「已停用」不被挤出格子（1024 宽量过）
        <span className="chan-tags" style={{ display: "flex", alignItems: "center", flexWrap: "nowrap", minWidth: 0, maxWidth: "100%" }}>
          {r.mainId ? (
            <button type="button" className="link-plain link-strong chan-name" style={{ minWidth: 0 }} title={`${v}：看底下的子渠道`} onClick={() => { set主(r.mainId!); set按主看(false); }}>{v}</button>
          ) : (
            <span className="chan-name" style={{ minWidth: 0 }} title={`${v}（还没挂到主渠道上）`}>{v}</span>
          )}
          {r.历史 && <Tag style={{ margin: 0, borderRadius: 6, flex: "none" }} title="历史渠道：只承载历史客户，新数据不能选">历史渠道</Tag>}
          {!r.active && <Tag style={{ margin: 0, borderRadius: 6, flex: "none" }}>已停用</Tag>}
        </span>
      ),
    },
    { title: "子渠道数", key: "子渠道数", dataIndex: "子渠道数", width: 96, align: "right", sorter: (a, b2) => a.子渠道数 - b2.子渠道数, render: (v: number) => <span className="chan-num">{v}</span> },
    ...(线索一样
      ? [数列<主渠道汇总>("关联线索", `${线索说明}，这个主渠道下各子渠道加起来`, "线索")]
      : [数列<主渠道汇总>("关联线索", 线索说明), 数列<主渠道汇总>("有效线索", "关联线索里有效的那些")]),
    数列<主渠道汇总>("关联商机", "眼下在商机阶段的项目"),
    数列<主渠道汇总>("关联订单", "眼下在订单阶段的项目"),
    转化列<主渠道汇总>("线索转商机", "线索→商机", "各子渠道的分子、分母分别加起来再算，不是把比例平均"),
    转化列<主渠道汇总>("商机转订单", "商机→订单", "各子渠道的分子、分母分别加起来再算，不是把比例平均"),
    { ...数列<主渠道汇总>("关联项目", "这个主渠道下各子渠道带来的全部项目"), 默认: false },
    钱列<主渠道汇总>("累计成交", "各子渠道加起来；按币种分开写，不换汇"),
    钱列<主渠道汇总>("当前投入", "各子渠道录的投入加起来"),
    {
      title: <Tooltip title="合起来的累计成交 ÷ 合起来的当前投入"><span className="nowrap">投入产出比</span></Tooltip>, 列名: "投入产出比", key: "产出比", width: 116, align: "right",
      sorter: (a, b2) => (统计(a).产出比 ?? -1) - (统计(b2).产出比 ?? -1),
      render: (_: unknown, r) => {
        const s = 统计(r);
        return s.产出比 === null ? <Tooltip title={s.产出比说明}>{无}</Tooltip> : <span className="chan-num">{s.产出比}</span>;
      },
    },
  ];

  /** 表单下拉：字典里启用的 + 正在编辑的这条原来的属性（后来停用了也照旧能留着） */
  const 表单属性 = editing?.attr && !属性选项.includes(editing.attr) ? [...属性选项, editing.attr] : 属性选项;
  /** 运营策略下拉：字典里启用的 + 这条原来就有的（后来停用了也照旧留着） */
  const 表单策略 = [...new Set([...策略选项, ...(editing?.strategies ?? [])])];
  /** 主渠道候选：启用的；编辑时原来挂的那个停用了也列上 */
  const 主候选 = 主渠道们.filter((m) => m.active || m.id === editing?.mainId).map((m) => m.name);
  const 填的主 = ((Form.useWatch("platform", form) as string | undefined) ?? "").trim();
  const 选的主 = 填的主 ? 按名找主.get(填的主) ?? null : null;
  const 原子 = editing ? 编辑初值(editing).source : "";
  const 主没动 = Boolean(editing && 选的主 && editing.mainId === 选的主.id);
  /** 选的主渠道不设子渠道：子渠道锁住留空；编辑老渠道、主渠道没换、原来就有子渠道的照留（服务端同一个口径） */
  const 锁子 = 两层 && Boolean(选的主 && !选的主.allowSub);
  const 主提示 = !两层 || !填的主
    ? undefined
    : !选的主
      ? `保存时新建主渠道「${填的主}」`
      : !选的主.active && !主没动
        ? `主渠道「${填的主}」已停用，换一个或先到「主渠道」里启用`
        : undefined;

  /* 渠道页一次就把行全拿下来了（没有服务端分页），所以筛在本地做；按主渠道看时筛的还是子渠道，筛完再并 */
  const 筛选条 = (
    <Space wrap size={[10, 10]}>
      <Input
        style={{ width: 240, maxWidth: "100%" }}
        placeholder="搜索渠道全称、名称、属性"
        prefix={<SearchOutlined style={{ color: "var(--text-muted)" }} />}
        value={kw}
        allowClear
        onChange={(e) => setKw(e.target.value)}
      />
      {筛选外露}
      {更多筛选按钮}
      <ResetFilters 显示={Boolean(kw || attr || ownerId || active || creator || 主)} onClick={() => { setKw(""); setAttr(""); setOwnerId(""); setActive(""); setCreator(""); set主(""); }} />
    </Space>
  );

  return (
    <>
      <PageHead
        title="渠道"
        /*
          统计按两层看（P-渠道-01 附.5）：放页头不放筛选行，1024 宽筛选行照旧一行摆得下。
          摆标题旁边（照客户页「客户 / 公海」），不进右上那组动作：.page-head-a 不收缩，
          1024 宽 + AI 栏常驻时切换 + 「主渠道」+「新建渠道」一排会撑出页头；标题那块能折行，放不下就掉到标题下面
        */
        titleAside={
          两层 ? (
            <Segmented
              aria-label="统计口径"
              value={按主看 ? "主" : "子"}
              onChange={(v) => set按主看(v === "主")}
              options={[{ value: "子", label: "按子渠道" }, { value: "主", label: "按主渠道" }]}
            />
          ) : undefined
        }
        extra={
          能管 && (
            <Space size={8} wrap>
              {两层 && <Button onClick={() => set开主渠道(true)}>主渠道</Button>}
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openForm(null)}>
                新建渠道
              </Button>
            </Space>
          )
        }
      />

      <div className="chan-list">
      {两层 && 按主看 ? (
        <DataList<主渠道汇总>
          页="channels-main"
          空库={全部行.length === 0}
          列={主列表}
          行={主行们}
          行类={(r) => (r.active ? undefined : "row-off")}
          汇总={看板底数 && rows.length > 0 ? <ChannelDash 渠道们={rows} 底数={看板底数} 段={看板段} 公海={公海} 筛了负责人={Boolean(ownerId)} 能录={能录} 看详情={看详情} /> : undefined}
          空态={{ title: "还没有渠道", hint: "先建主渠道和子渠道，这里按主渠道把各子渠道的数加起来。" }}
          筛选={筛选条}
        />
      ) : (
      <DataList<Row>
        页="channels"
        空库={全部行.length === 0}
        列={列表}
        行={rows}
        亮={亮行}
        行类={(r) => (r.active ? undefined : "row-off")}
        汇总={看板底数 && rows.length > 0 ? <ChannelDash 渠道们={rows} 底数={看板底数} 段={看板段} 公海={公海} 筛了负责人={Boolean(ownerId)} 能录={能录} 看详情={看详情} /> : undefined}
        空态={{
          title: "还没有渠道",
          hint: `渠道是${b.customer}从哪来的：按「渠道属性 → 渠道名称 → 来源」建一条，新建${b.customer}时从清单里选；在渠道详情里录投入，这里就算得出投入产出比。不再用的渠道停用即可。`,
          primary: 能管 ? { label: "新建第一个渠道", onClick: () => openForm(null) } : undefined,
        }}
        筛选={筛选条}
      />
      )}
      </div>

      {开主渠道 && <MainChannels 主渠道们={主渠道们} 子渠道数={子渠道数} onClose={() => set开主渠道(false)} />}

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
            onValuesChange={(改: { platform?: string }) => {
              守.改了();
              // 换到一个不设子渠道的主渠道：子渠道清空（主渠道没换回原来那个、原来的子渠道才照留）
              if (两层 && 改.platform !== undefined) {
                const m = 按名找主.get(改.platform.trim());
                if (m && !m.allowSub && !(editing && editing.mainId === m.id)) form.setFieldValue("source", "");
                if (m && !m.allowSub && editing && editing.mainId === m.id) form.setFieldValue("source", 原子);
              }
            }}
            // 新建时渠道负责人默认是我（团队同步之后候选里有同事）
            initialValues={editing ? 编辑初值(editing) : { active: true, channelOwnerId: 默认负责人(我, users) }}
          >
            {/* U-渠道-01：表单单列排，一行一项，不分两栏 */}
            <行 gutter={16}>
              <Col span={24}>
                <Form.Item label="渠道属性" name="attr" rules={[{ required: true, message: "请选择渠道属性" }]}>
                  <Select placeholder="请选择" options={表单属性.map((x) => ({ value: x, label: x }))} notFoundContent="字典里还没有渠道属性，到 设置 → 字典 里加" />
                </Form.Item>
              </Col>
              <Col span={24}>
                <Form.Item label="渠道状态" name="active">
                  <Radio.Group optionType="button" options={[{ value: true, label: "启用" }, { value: false, label: "停用" }]} />
                </Form.Item>
              </Col>
              {两层 ? (
                <>
                  <Col span={24}>
                    <Form.Item
                      label="主渠道"
                      name="platform"
                      extra={主提示}
                      rules={[
                        { required: true, whitespace: true, message: "请选择或填写主渠道" },
                        { pattern: /^[^|｜]*$/, message: "主渠道名里不能有「|」" },
                      ]}
                    >
                      <OptionInput options={主候选} maxLength={主渠道名上限} placeholder="选一个主渠道，没有的直接填" popupMatchSelectWidth={false} />
                    </Form.Item>
                  </Col>
                  <Col span={24}>
                    <Form.Item
                      label="子渠道"
                      name="source"
                      dependencies={["platform"]}
                      extra={锁子 ? (主没动 && 原子 ? `主渠道「${填的主}」不设子渠道，原来的子渠道照留` : `主渠道「${填的主}」不设子渠道，子渠道留空`) : 子渠道提示}
                      rules={[
                        ({ getFieldValue }) => ({
                          validator: (_, v: string | undefined) =>
                            拼全称(getFieldValue("platform"), v).length > 全称上限
                              ? Promise.reject(new Error(`主渠道加子渠道拼成的全称最多 ${全称上限} 个字，请缩短`))
                              : Promise.resolve(),
                        }),
                      ]}
                    >
                      <Input placeholder={锁子 ? "留空" : "可留空"} maxLength={全称上限} disabled={锁子} />
                    </Form.Item>
                  </Col>
                </>
              ) : (
                <>
                <Col span={24}>
                  <Form.Item label="渠道名称" name="platform" rules={[{ required: true, whitespace: true, message: "请填写渠道名称" }]}>
                    <Input placeholder="如：短视频平台" maxLength={全称上限} />
                  </Form.Item>
                </Col>
                <Col span={24}>
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
                </>
              )}
              <Col span={24}>
                <FullNamePreview 原名={editing?.name ?? null} 两层={两层} />
              </Col>
              {两层 && (
                <Col span={24}>
                  <Form.Item label="运营策略" name="strategies" extra="可多选；选项在 设置 → 字典 → 运营策略 里加">
                    <Select mode="multiple" allowClear placeholder="请选择" options={表单策略.map((x) => ({ value: x, label: x }))} notFoundContent="还没有运营策略选项，到 设置 → 字典 → 运营策略 里加" />
                  </Form.Item>
                </Col>
              )}
              <Col span={24}>
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
                <Col span={24}>
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
