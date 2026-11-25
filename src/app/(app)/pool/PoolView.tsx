"use client";

/**
 * 企业版统一公海（2026-10-29，P7）：客户公海 + 项目公海一张表。
 * 上面一排（10-31 晚定：入池方式、排序、搜索和属性放同一行）：公海属性（全部 / 线索池 / 商机池 / 订单池 / 客户池，带数，全部 = 四者之和，11-11；
 * 属性块自己不折行，窄了横向滚）、入池方式下拉（带数和一行说明，M-公海-09 原「入池原因」改名）、排序、搜索；整排太窄才把后面几个挤到下一行
 * 表里「入池原因」一列 = 退回时选的原因（M-公海-09）；「当前进程」一列 = 阶段-节点（如 线索-潜客培育），有结局再带结局（U-公海-04，11-01 改）
 * 条件都在地址栏（useUrlFilters），服务端筛排分页；规矩见 lib/enterprise/unified-pool.ts
 * 客户池一位客户一行（11-11）：名下不止一个项目在项目公海的，行上写最近那个的进程 +「共 N 个项目」，点行或「展开」逐个看、逐个领 / 分；
 * 勾这一行 = 勾下面能动的那几个项目（领取：能领的；分配：本业务线的），动不了的在提示条「看原因」里说
 *
 * 10-30 交互改版：领取、分配都带 6 秒撤销（规则 B）；老板、主管行内「⋯」和批量里有「分配给同事」（11-15 P-界面-43 写全、走选人框），业务员没有；
 * 领取灰着时原因写在按钮下面（规则 A）；持有上限开着时页头写「我手上 N / 上限 M」；批量有没领到的，提示条能展开看每一条为什么
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Dropdown, Grid, Segmented, Select, Space, Tag } from "antd";
import type { MenuProps } from "antd";
import { CloseOutlined, MoreOutlined, RightOutlined } from "@ant-design/icons";
import DataList, { type 列 } from "@/components/DataList";
import { useConsequence } from "@/components/ConsequenceDialog";
import InlineConfirm from "@/components/InlineConfirm";
import SaveButton from "@/components/SaveButton";
import Skeleton from "@/components/Skeleton";
import { useMotionTheme } from "@/components/MotionTheme";
import { showUndo } from "@/components/UndoBar";
import type { 做的结果 } from "@/lib/confirm-result";
import PoolAssignPicker from "./PoolAssignPicker";
import ListSearch from "@/components/ListSearch";
import ResetFilters from "@/components/ResetFilters";
import CreatedRangeFilter from "@/components/CreatedRangeFilter";
import { useCustomFilters } from "@/components/CustomFilters";
import { PageHead, RowLink } from "@/components/ui";
import { fmtDateTime, smartTime, 成员选项, type 可选成员 } from "@/lib/utils";
import { useUrlFilters } from "@/lib/url-filters";
import BatchFilterTag from "@/components/BatchFilterTag";
import { 带走说法, 转走项目说法, type 转走项目预览 } from "@/lib/carry-over";
import { 转走项目列表 } from "../customers/useCarryConfirm";
import { 公海规则, 原负责人不能领回提示, 项目不能单独领提示, 无效客户不能领短话 } from "@/lib/enterprise/pool-rules";
import { 公海属性们, 快捷们, 排序们, 默认排序, 多次退回起, 没原因, 入池类叫法, type 公海行, type 公海属性, type 快捷 } from "@/lib/enterprise/unified-pool";
import { 领取, 分配公海, 撤销公海, type 公海结果 } from "../customers/pool-actions";
import { 确认条行们 } from "@/lib/enterprise/pool-ask-rows";
import { 标无效客户, 恢复有效客户, 分配公海项目, 撤销公海项目, type 整包撤销 } from "./actions";

type Props = {
  行: 公海行[];
  总数: number;
  /** 总数里几位客户（客户行）、几个项目（线索公海项目行）：页脚写清单位（审核 11-18 统计 P2-2）；没给照旧「共 N 条」 */
  分项?: { 客户: number; 项目: number };
  当前页: number;
  pageSize: number;
  快捷数: Record<快捷, number>;
  属性数: Record<公海属性 | "全部", number>;
  截断: boolean;
  库里有: boolean;
  /**
   * projChannel / phase：渠道名单（渠道页「另 M 条在公海」点进来）；不进筛选栏，页头挂一枚能关掉的标签。
   * createdFrom / createdTo：项目创建时间（「更多筛选」里的「创建时间」，渠道看板 TOP5 点进来也带）；筛了按项目一条一行
   */
  filters: { keyword: string; attr: string; quick: string; sort: string; channelId: string; projChannel: string; phase: string; createdFrom: string; createdTo: string;
    /** 号码不全（三态 T10）：=1 只看三态自动收回时打了「号码不全」的客户；三态关着服务端不认、页面不摆 */
    phoneIncomplete?: string;
    /** 导入批次（11-19，lib/project/import-batch.ts）：数据页点进来带的；不进筛选栏，页头挂一枚能关掉的标签 */
    batch?: string;
    /**
     * open=1 只看没结局的、onlyNew=1 按创建时间筛时排掉补建（filters.ts 读公海页筛）：不进筛选栏、不算在筛，
     * 但要留在 filters 里——翻页、换池、改筛选都按它重拼地址，不留就丢了，名单条数和点进来的卡对不上
     */
    open?: string; onlyNew?: string };
  /** 自定义筛选「客户来源」的候选 */
  渠道筛选项: { value: string; label: string }[];
  /** 老板、主管 */
  能标无效: boolean;
  /** 只有老板 */
  能恢复: boolean;
  /** 老板、主管：行内和批量里有「分配给同事」 */
  能分配: boolean;
  /** 不是我这条业务线的行（「c:客户 id」/「p:项目 id」，P-公海-07）：不摆分配、标无效、恢复；批量里混了服务端整批拦 */
  别线ids?: string[];
  /** 分配给谁（能分配时才有） */
  users: 可选成员[];
  /** 选人框用（P-界面-43）：每位候选的部门（空 = 没分部门）、当前持有 / 上限（上限没开或不限 = null） */
  候选信息?: Record<string, { 组: string; 组序?: number; 持有: number | null; 上限: number | null }>;
  /** 标无效时选的原因（P-界面-42，字典「无效原因」启用项）；空 = 不问 */
  无效原因选项?: string[];
  /** 持有上限开着、我不是不限：手上几个（同 超上限 的口径） / 上限几个；没开为 null */
  持有: { 有: number; 上限: number } | null;
  /** 只读管理员（11-03 B2-1）：不摆领取、不给勾选；行末没别的操作时操作列整列不出 */
  只读?: boolean;
  /** 客户三态开着（P-界面-19 ⑦，构想页 C14）：客户名后「号码不全」小红标签、「号码不全」筛选、领取 / 分配前一句提示（不拦）。关着都不出 */
  三态开?: boolean;
  /** 「号码不全」上的数 = 在现在这些筛选上再点它会列出几行（三态开着才给，lib/enterprise/unified-pool-db.ts 读公海页） */
  号码不全数?: number | null;
  /**
   * 领客户前数「会一起转走的项目」（customers/actions 转走项目预览of，页面当参数递进来）：行内点「领取」时原地确认里列出来，
   * 和客户详情页领取前那个框同一份数（P-转-07 / M-公海-05）。不给 = 不列（老调用方、界面测试）
   */
  转走预览?: (ids: string[]) => Promise<转走项目预览>;
};

/** 「号码不全」标签的悬停说明（M-公海-51：同手动退回公海那把尺） */
const 号码不全说明 = "到期自动收回时查过联系方式：一个号码都没有，或者有号码但不对。可以照常领取，领到后记得补全";

/** 项目行操作列里的短说法（整句「项目不能单独领提示」在悬停里） */
const 项目不能单独领短说 = "要连客户一起领";

/** 客户池并成一行的里面有别线的项目：勾这一行分配时先不带它们（服务端混了别线的整批拦，P-公海-07） */
const 别线不分 = "不是你这条业务线的项目，分不了";

/** 入池方式下拉里每一项的一行说明（规则 C）：「多次退回」的门槛是常量，跟着改 */
const 快捷说明: Record<快捷, string> = {
  超时回收: "太久没跟进，系统自动收回来的",
  首次退回: "被同事主动放回公海，累计第 1 次",
  二次退回: "被同事主动放回公海，累计第 2 次",
  三次退回: "被同事主动放回公海，累计第 3 次",
  多次退回: `被同事主动放回公海，累计 ${多次退回起} 次及以上`,
  无效客户: "总管理或销售管理标了无效的客户：全员看得到、查重查得到，领不了，系统管理员能恢复",
};

/**
 * 「公海 + 标无效」在界面上统一叫「公海回收站」（P-公海-09，客户 11-09 回执 X1 = A）：只改显示，
 * 筛选值、地址栏参数还是「无效客户」（老链接不坏）。和 设置 → 回收站（删掉的记录，30 天后清）是两回事
 */
const 公海回收站 = "公海回收站";
const 快捷叫法 = (k: 快捷): string => (k === "无效客户" ? 公海回收站 : k);

const 无效原因 = 无效客户不能领短话;

const 行名 = (r: 公海行) => (r.种 === "项目" ? r.项目名 ?? r.客户名 : r.客户名 ?? r.项目名) ?? "这一行";
/** 提示条里叫这一行：项目行写明是项目，别读成客户被领走 / 分走（11-03 B2-6：只动了项目，提示写的是客户名） */
const 叫 = (r: 公海行) => (r.种 === "项目" && r.项目名 ? `项目「${r.项目名}」` : `「${行名(r)}」`);

type 没到 = { 名: string; 原因: string };
/** 领取 / 分配做完的结果：调用方决定写在哪（行下、批量条里、表格上方），不弹顶部提示 */
type 动手结果 =
  | { ok: false; error: string; 没领到: 没到[] }
  | { ok: true; 文案: string; 没领到: 没到[]; 撤销: () => Promise<做的结果>; 到行: string[]; 字: string };

/** 表格上方一条就地提示：这一批有几个没领到 / 没分出去，能展开看每一条为什么，可以关掉 */
function ResultNote({ 文案, 没领到, 关 }: { 文案: string; 没领到: 没到[]; 关: () => void }) {
  const [展开, set展开] = useState(false);
  return (
    <div className="pool-note" role="status">
      <div className="pool-note-h">
        <span>{文案}</span>
        {没领到.length > 0 && <Button type="link" size="small" onClick={() => set展开(!展开)}>{展开 ? "收起" : "看原因"}</Button>}
        <Button type="text" size="small" aria-label="关掉这条提示" icon={<CloseOutlined />} onClick={关} />
      </div>
      {展开 && <ul className="pool-note-list">{没领到.map((x, i) => <li key={i} className="muted">{x.名}：{x.原因}</li>)}</ul>}
    </div>
  );
}

export default function PoolView({ 行, 总数, 分项, 当前页, pageSize, 快捷数, 属性数, 截断, 库里有, filters, 渠道筛选项, 能标无效, 能恢复, 能分配, 别线ids = [], users, 候选信息 = {}, 无效原因选项 = [], 转走预览, 持有, 只读 = false, 三态开 = false, 号码不全数 = null }: Props) {
  const 别线 = new Set(别线ids);
  const router = useRouter();
  /*
    设计语言 G-A：页头计数和持有胶囊、池子行 + 筛选行两行、回收站开关挪到池子行右端、
    390 池子改下拉、属性列灰标签 / 选了池整列不摆、同客户名、1024 列取舍、领取确认挪到行下、批量条同客户列表
  */
  const 屏 = Grid.useBreakpoint();
  /** 手机宽（< 768；服务端那一版还不知道多宽，照电脑画）：池子分段改下拉（D34） */
  const 手机 = 屏.md === false;
  /** 1024 这一档（< 1200）：不摆「当前进程」、两列时间并成一列，「入池原因」留着（G-新4） */
  const 窄 = 屏.xl === false;
  const 数 = (n: number) => n.toLocaleString("zh-CN");
  const { f, setF, apply, 翻页, reset, pending } = useUrlFilters("/pool", filters, pageSize);
  const 在筛 = !!(f.keyword || f.attr || f.quick || f.sort || f.channelId || f.projChannel || f.createdFrom || f.createdTo || f.batch || (三态开 && f.phoneIncomplete));
  /** 关掉名单类的标签 / 清掉创建时间：名单的条件都没了，open / onlyNew 一起去掉（它们只对名单起作用，留着会跟到下次筛的名单上） */
  const 改名单 = (改: Partial<typeof f>) => {
    const 后 = { ...f, ...改 };
    apply(后.projChannel || 后.createdFrom || 后.createdTo || 后.batch ? 改 : { ...改, open: "", onlyNew: "" });
  };
  // 渠道名单：说清现在只看哪个渠道、哪个阶段的公海项目（一条一行，条数 = 渠道页的「另 M 条在公海」），能关掉
  const 名单渠道 = filters.projChannel ? (渠道筛选项.find((o) => o.value === filters.projChannel)?.label ?? "这个渠道") : "";
  const 名单标 = filters.projChannel ? (
    <Tag closable title="从渠道页点进来的：这个渠道（项目没填来源的跟客户来源）在公海里的项目，一个一行" onClose={(e) => { e.preventDefault(); 改名单({ projChannel: "", phase: "" }); }} closeIcon={<CloseOutlined aria-label="清掉渠道名单筛选" />}>
      渠道名单：{名单渠道}{filters.phase ? ` · ${filters.phase}` : ""}
    </Tag>
  ) : undefined;
  // 导入批次（数据页「公海里还有 N 个」点进来）：说清只看 / 排掉了哪一批，能关掉；样子同项目列表那一枚
  const 批标 = filters.batch ? <BatchFilterTag batch={filters.batch} 清掉={() => 改名单({ batch: "" })} /> : undefined;
  // 只带 open=1（数据页没选批次时「公海里还有 N 个 ›」点进来）：公海里还没结局的项目一个一行，条数 = 那个 N；能关掉回到平常的公海
  const 进行中标 = filters.open && !(filters.projChannel || filters.createdFrom || filters.createdTo || filters.batch) ? (
    <Tag closable title="从数据页点进来的：公海里还没结局的项目，一个一行" onClose={(e) => { e.preventDefault(); 改名单({}); }} closeIcon={<CloseOutlined aria-label="清掉进行中项目筛选" />}>
      公海里进行中的项目
    </Tag>
  ) : undefined;
  const 到上限 = !!持有 && 持有.有 >= 持有.上限;
  const 分给谁 = 成员选项(users);
  /** 客户池并成一行、展开着的（行 id） */
  const [展开的, set展开的] = useState<string[]>([]);
  const 切展开 = (id: string) => set展开的((x) => (x.includes(id) ? x.filter((k) => k !== id) : [...x, id]));
  /** 企业版 C-06：领取、分配时，进公海时关掉的原负责人待办一起转给新负责人（默认勾，可以手动关掉；pool-rules.ts） */
  const [带待办, set带待办] = useState<boolean>(公海规则.带待办默认勾);
  /** 后果框（标无效、批量分配） */
  const [问后果, 后果框] = useConsequence();
  /** 正在就地确认领取的那一行（同一时刻只一行） */
  const [问着, set问着] = useState<string | null>(null);
  /*
    行下确认条是键盘点开的：焦点从行上的「领取」挪到条里的「取消」，和旧摆法（InlineConfirm 包着键）一样——
    回车再按一下是退出不是领取；焦点在条里 InlineConfirm 才停住 8 秒计时、Esc 才收得回（G-A 审查）。
    只认键盘点开的：按这一下是怎么点的算（click 的 detail 为 0 = 回车 / 空格），不看 :focus-visible——
    键盘开过一次、Esc 收回后焦点回到「领取」还带着 :focus-visible，再用鼠标点它会被当成键盘（#414 3704 实操）。
    鼠标点开的不挪，焦点停在条里会让它一直不收。收起时焦点还给「领取」见 收确认
  */
  const 键盘开 = useRef(false);
  useEffect(() => {
    if (!问着 || !键盘开.current) return;
    键盘开.current = false;
    const 键 = document.activeElement;
    if (!(键 instanceof HTMLElement) || 键.dataset.claim !== 问着) return;
    const 帧 = requestAnimationFrame(() => document.querySelector<HTMLElement>(`.pool-ask[data-for="${CSS.escape(问着)}"] .inlc-no`)?.focus());
    return () => cancelAnimationFrame(帧);
  }, [问着]);
  /** 鼠标停在行下确认条上：读到一半不自己收 */
  const [悬着, set悬着] = useState(false);
  /**
   * 行内领客户时会一起转走的项目（行 id → 说法；「取中」= 在数，null = 没有要转走的 / 数不出来）：点「领取」时现取，原地确认里列名单（同客户详情页的领取框）。
   * 数不出来不拦着（领取本身照样带走项目），只是不列
   */
  const [转走, set转走] = useState<Record<string, ReturnType<typeof 转走项目说法> | "取中">>({});
  function 数转走(r: 公海行) {
    if (!转走预览 || r.种 !== "客户" || r.子) return;
    set转走((x) => ({ ...x, [r.id]: "取中" }));
    转走预览([r.customerId]).then(
      (p) => set转走((x) => ({ ...x, [r.id]: 转走项目说法(p) })),
      () => set转走((x) => ({ ...x, [r.id]: null })),
    );
  }
  /** 行上没领到的原因（行 id → 原因），写在按钮下面 */
  const [行错, set行错] = useState<Record<string, string>>({});
  /** 表格上方的就地提示：这一批有几个没领到 / 没分出去 */
  const [结果, set结果] = useState<{ 文案: string; 没领到: 没到[] } | null>(null);
  /** 选人框：分给谁（单个 / 批量） */
  const [选人, set选人] = useState<{ 们: 公海行[]; 批: boolean; 完?: () => void } | null>(null);
  /** 批量领取：选择条原地变确认（原型 pool.batch）。存的是那一批勾选的键，勾选变了就回到平时 */
  const [批问, set批问] = useState<string | null>(null);
  const [批忙, set批忙] = useState(false);
  const [批错, set批错] = useState("");
  /**
   * 原型 pool.claim / pool.batch：领到 / 分出去的行先在按钮处写「已领取 ✓」，停一下滑出（行 id → 那一句），刷新回来它就不在了；
   * 原型 pool.undo：撤销成了，回来的行滑回原位、淡亮一下（行 id），不另弹提示
   */
  const [走的, set走的] = useState<Record<string, string>>({});
  const [回来的, set回来的] = useState<string[]>([]);
  const 回来计时 = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 新的一页数据到了：滑出的那几行已经不在了，记号清掉（同一行以后再回来——比如别人放回公海——不该还是透明的）。渲染时比上一次的行，不用 effect
  const [上次行, set上次行] = useState(行);
  if (行 !== 上次行) {
    set上次行(行);
    if (Object.keys(走的).length) set走的({});
  }
  /**
   * 原型 pool.attr / pool.bin：换分池、开关公海回收站、换入池方式时表格先换成骨架，数据到了再换内容（翻页、排序、搜索照旧表格内转圈）。
   * 记下要去的那一池；页面拿到的 filters 还不是它、又在等，就是换池在路上
   */
  const [去池, set去池] = useState<{ attr: string; quick: string } | null>(null);
  const 换池中 = pending && !!去池 && (去池.attr !== filters.attr || 去池.quick !== filters.quick);
  const 换池 = (改: { attr?: string; quick?: string }) => {
    const 到 = { attr: 改.attr ?? f.attr, quick: 改.quick ?? f.quick };
    set去池(到);
    apply(改);
  };
  const { 曲线, 时长 } = useMotionTheme();
  /** 无效行、能恢复、本线：行上只一个「恢复」（P-界面-44） */
  const 可恢复 = (r: 公海行) => r.种 === "客户" && r.类 === "无效" && 能恢复 && !别线.has(r.id);

  /** 领取按钮灰着的原因（规则 A：写在按钮下面）；能领返回 null。持有上限只拦项目（同 领取公海项目），客户行不拦 */
  function 领不了(r: 公海行): string | null {
    if (r.类 === "无效") return 无效原因;
    if (r.原负责人是我) return 原负责人不能领回提示;
    // 项目只能随客户一起领（10-31 晚定，pool-rules.ts）；主管照样能分配
    if (r.种 === "项目" && !公海规则.项目能单独领) return 项目不能单独领提示;
    if (r.种 === "项目" && 到上限) return `你已持有 ${持有!.有} / ${持有!.上限}`;
    return null;
  }

  /**
   * 领取 / 分配一行或几行：客户行、项目行一起勾的，一次交给 领取 / 分配公海（同一个事务，持有上限整批核，超了一个都不做）；只勾了项目行的分配走 分配公海项目。
   * 不弹提示：回结果，调用方写在行下 / 批量条里 / 表格上方，成了的给底部撤销条（客户行走 撤销公海，项目行走 撤销公海项目）。
   * 号码不全（M-公海-51、C14：只提示，不拦）不再单独弹框，写进领取确认 / 分配后果里（原型 pool.phone）
   */
  async function 动手(动作: "领取" | "分配", 选的: 公海行[], 给?: string): Promise<动手结果> {
    // 客户池并成一行的（11-11）：勾它 = 勾下面能动的那几个项目；动不了的不交上去，原因记下来一起说
    const 先拦: { 名: string; 原因: string }[] = [];
    const 们 = 选的.flatMap((r) => (r.子 ?? [r]).filter((c) => {
      if (!r.子) return true;
      const 因 = 动作 === "领取" ? 领不了(c) : 别线.has(c.id) ? 别线不分 : null;
      if (因) 先拦.push({ 名: 行名(c), 原因: 因 });
      return !因;
    }));
    if (!们.length) {
      if (先拦.length === 1) return { ok: false, error: 先拦[0].原因, 没领到: 先拦 };
      return { ok: false, error: 动作 === "领取" ? "一个都没领到" : "一个都没分出去", 没领到: 先拦 };
    }
    // 企业版 C-06：页头那个勾，这一页的领取、分配都按它（进公海时关掉的待办要不要重新打开给新负责人）
    const 带 = 公海规则.换负责人带待办 ? 带待办 : undefined;
    const 客户们 = 们.filter((r) => r.种 === "客户");
    const 项目们 = 们.filter((r) => r.种 === "项目" && r.projectId);
    const 没领到: { 名: string; 原因: string }[] = [];
    const 项目到: string[] = [];
    let 客户res: 公海结果 | null = null;
    /** 整批没做成的那句（超持有上限等）：一个都没到手时直接说它，不让人展开逐条看同一句 */
    let 整批错: string | null = null;
    // 客户行、项目行一次交给 领取 / 分配公海（同一个事务、整批核持有上限，超了一个都不做，M-公海-18）；分配只有项目行的走下面 分配公海项目
    if (项目们.length && (动作 === "领取" || 客户们.length)) {
      客户res = 动作 === "领取"
        ? await 领取(客户们.map((r) => r.customerId), 带, 项目们.map((r) => r.projectId!))
        : await 分配公海(客户们.map((r) => r.customerId), 给!, 带, 项目们.map((r) => r.projectId!));
      if (客户res.ok) {
        项目到.push(...(客户res.项目?.领到 ?? []));
        for (const x of 客户res.项目?.没领到 ?? []) 没领到.push({ 名: 行名(项目们.find((r) => r.projectId === x.id)!), 原因: x.原因 });
      } else for (const r of 项目们) 没领到.push({ 名: 行名(r), 原因: 客户res.error });
    } else if (客户们.length) {
      客户res = 动作 === "领取" ? await 领取(客户们.map((r) => r.customerId), 带) : await 分配公海(客户们.map((r) => r.customerId), 给!, 带);
    }
    if (客户res && !客户res.ok) 整批错 = 客户res.error;
    if (客户们.length && 客户res) {
      const 到 = new Set(客户res.ok ? (客户res.原负责人 ?? []).map((x) => x.id) : []);
      for (const r of 客户们) {
        if (到.has(r.customerId)) continue;
        没领到.push({
          名: 行名(r),
          原因: !客户res.ok ? 客户res.error : r.类 === "无效" ? 无效原因 : 动作 === "领取" && r.原负责人是我 ? 原负责人不能领回提示 : "已经被别人领走了",
        });
      }
    }
    // 分配时客户整包出了客户公海（P-公海-10）：撤销时整包退回
    let 整包: 整包撤销 | undefined = 客户res?.ok ? 客户res.项目?.整包 : undefined;
    let 给谁: { id: string; name: string } | undefined = 客户res?.ok ? 客户res.给谁 : undefined;
    // 分配只勾了项目行：一次分（分配公海项目）
    if (项目们.length && 动作 === "分配" && !客户们.length) {
      const res = await 分配公海项目(项目们.map((r) => r.projectId!), 给!, 带);
      if (!res.ok) 整批错 = res.error;
      if (res.ok) {
        给谁 = res.给谁;
        整包 = res.整包;
        项目到.push(...res.分到);
        for (const x of res.没分到) 没领到.push({ 名: 行名(项目们.find((r) => r.projectId === x.id)!), 原因: x.原因 });
      } else for (const r of 项目们) 没领到.push({ 名: 行名(r), 原因: res.error });
    }
    // 刷新：一个都没到手的这里就刷；到手了的交给 报——等「已领取 ✓」停一下、行滑出去之后再刷（原型 pool.claim），不然行没滑就没了
    没领到.push(...先拦);
    const 客户到 = 客户res?.ok ? 客户res.updated : 0;
    const 到数 = 客户到 + 项目到.length;
    if (!到数) router.refresh();
    if (!到数) {
      if (们.length === 1) return { ok: false, error: 没领到[0]?.原因 ?? "没领到，刷新看看", 没领到 };
      if (整批错) return { ok: false, error: 整批错, 没领到: [] };
      return { ok: false, error: 动作 === "领取" ? "一个都没领到" : "一个都没分出去", 没领到 };
    }
    const 带走 = 客户res?.ok ? 带走说法(客户res.带走) : "";
    const 单 = 们.length === 1 && !先拦.length;
    const 文案 = 动作 === "领取"
      ? (单 ? `已领取${叫(们[0])}${带走}` : 没领到.length ? `领到 ${到数} 个，${没领到.length} 个没领到` : `已领取 ${到数} 个${带走}`)
      : (单 ? `已把${叫(们[0])}分给 ${给谁?.name ?? "同事"}${带走}` : `已分给 ${给谁?.name ?? "同事"} ${到数} 个${没领到.length ? `，${没领到.length} 个没分出去` : ""}`);
    // 撤销（底部撤销条调）：没撤成的原因写在撤销条上（UndoBar「撤销不了：原因」），不另弹提示
    const 撤销 = async (): Promise<做的结果> => {
      let 撤了 = 0;
      let 错: string | null = null;
      let 提示: string | undefined;
      if (客户res?.ok && 客户到) {
        const r = await 撤销公海(动作, 客户res.原负责人 ?? [], 客户res.带过来, 客户res.给谁?.id, 客户res.公海项目);
        // 并发里先撤回去的（已撤回）也已经回了公海：算撤了，撤销条上说一句，不报错（11-26 审查）
        if (r.ok) { 撤了 += r.updated + (r.已撤回 ?? 0); 提示 = r.提示; } else 错 = r.error;
      }
      if (项目到.length) {
        const r = await 撤销公海项目(动作, 项目到, 给谁?.id, 整包);
        if (r.ok) 撤了 += r.updated; else 错 = r.error;
      }
      router.refresh();
      if (错) return { ok: false, error: 错 };
      if (!撤了) return { ok: false, error: "已经有人动过了" };
      if (撤了 < 到数) set结果({ 文案: `已撤销 ${撤了} 个，其余已经有人动过了`, 没领到: [] });
      return { ok: true, 提示 };
    };
    // 真到手 / 分出去的那几行（客户池并成一行的：名下有一个项目到了就算），滑出、撤销后滑回用
    const 到客户 = new Set(客户res?.ok ? (客户res.原负责人 ?? []).map((x) => x.id) : []);
    const 到项目 = new Set(项目到);
    const 到行 = 选的.filter((r) => (r.子 ? r.子.some((c) => !!c.projectId && 到项目.has(c.projectId)) : r.种 === "客户" ? 到客户.has(r.customerId) : !!r.projectId && 到项目.has(r.projectId))).map((r) => r.id);
    const 字 = 动作 === "领取" ? "已领取 ✓" : `已分给 ${给谁?.name ?? "同事"} ✓`;
    return { ok: true, 文案, 没领到, 撤销, 到行, 字 };
  }

  /** 做成了：底部 6 秒撤销条（原型 pool.undo：撤销后行回原位、不再多弹提示）；有没领到的在表格上方就地列出来 */
  function 报(r: Extract<动手结果, { ok: true }>) {
    set结果(r.没领到.length ? { 文案: r.文案, 没领到: r.没领到 } : null);
    set走的(Object.fromEntries(r.到行.map((id) => [id, r.字])));
    // 行滑出（CSS：停 --t 再走 --t；--t-seal 只许落印用，见 motion-tokens 测试）放完再刷新，刷新回来它就不在了
    if (r.到行.length) setTimeout(() => router.refresh(), (时长.base * 2) * 1000 + 40);
    else router.refresh();
    showUndo({
      话: r.文案,
      毫秒: 6000,
      // 撤成了：那几行滑回原位、淡亮一下（撤销条自己写「已撤销」，不另弹提示）
      撤销: async () => {
        const x = await r.撤销();
        if (!x || x.ok) {
          set走的({});
          set回来的(r.到行);
          if (回来计时.current) clearTimeout(回来计时.current);
          回来计时.current = setTimeout(() => set回来的([]), 2400);
        }
        return x;
      },
    });
  }

  /**
   * 领取前就地确认写的后果（P-界面-41）：占几个名额、超时按节点收回、退回后不能再领回；号码不全的提一句（原型 pool.phone）。
   * 持有上限只算项目（同 领不了），客户行不占
   */
  function 领取后果(们: 公海行[]): string[] {
    const 项目数 = 们.flatMap((r) => (r.子 ? r.子.filter((c) => !领不了(c)) : [r])).filter((r) => r.种 === "项目").length;
    const 线: string[] = [];
    if (持有 && 项目数) 线.push(`占 ${项目数} 个名额（${持有.有 + 项目数} / ${持有.上限}）`);
    线.push(项目数 ? "没跟进按节点天数收回公海" : "超时没跟进会收回公海");
    线.push("以后退回公海就不能再领回");
    const 不全 = 三态开 ? 们.filter((r) => r.号码不全).length : 0;
    if (不全) 线.push(们.length === 1 ? "号码不全，领到后记得补全" : `其中 ${不全} 位号码不全，领到后记得补全`);
    return 线;
  }

  const 清行错 = (id: string) => set行错((x) => { if (!(id in x)) return x; const y = { ...x }; delete y[id]; return y; });

  /** 单个领取：就地确认之后。没领到原因写在这一行按钮下面 */
  async function 领一个(r: 公海行): Promise<做的结果> {
    清行错(r.id);
    const res = await 动手("领取", [r]);
    set问着(null);
    if (!res.ok) {
      set行错((x) => ({ ...x, [r.id]: res.error }));
      return { ok: false, error: res.error };
    }
    报(res);
  }

  /** 分配的后果（选人框底下那句、批量后果框）：待办怎么走、号码不全 */
  const 待办说法 = (名: string) => (公海规则.换负责人带待办 ? (带待办 ? `原负责人没做完的待办一起转给 ${名}` : "原负责人没做完的待办不转") : "");
  const 不全数 = (们: 公海行[]) => (三态开 ? 们.filter((r) => r.号码不全).length : 0);

  /** 批量分配：选人框选好人 → 后果框（P-界面-40 批量分配走后果框）→ 分；成了清掉勾选、给撤销条 */
  async function 批分(们: 公海行[], 给: string, 名: string, 完?: () => void) {
    const 盒: { r?: Extract<动手结果, { ok: true }> } = {};
    const 不全 = 不全数(们);
    const 待办 = 待办说法(名);
    const 成 = await 问后果({
      题: `把 ${们.length} 个分配给 ${名}`,
      后果: [
        { 标: "换负责人", 话: `这 ${们.length} 个归 ${名} 负责，${名} 会收到通知`, 级: "警" },
        ...(待办 ? [{ 标: "待办", 话: 待办 }] : []),
        ...(不全 ? [{ 标: "号码不全", 话: `其中 ${不全} 位客户号码不全，分出去后记得补全`, 级: "警" as const }] : []),
        { 标: "之后", 话: "分完 6 秒内可撤销" },
      ],
      是: "分配",
      危: false,
      做: async () => {
        const r = await 动手("分配", 们, 给);
        if (!r.ok) {
          if (r.没领到.length > 1) set结果({ 文案: r.error, 没领到: r.没领到 });
          return { ok: false, error: r.error };
        }
        盒.r = r;
      },
    });
    if (成 && 盒.r) {
      完?.();
      报(盒.r);
    }
  }

  /** 标成无效（P-界面-40 后果框：能恢复的人少，保留确认；原型 pool.invalid 后果分条写）。没成原因写在框里 */
  function 标无效(r: 公海行) {
    void 问后果({
      题: `把「${行名(r)}」标成无效客户`,
      后果: [
        { 标: "会发生", 话: `进${公海回收站}，谁都领不了`, 级: "警" },
        { 标: "谁能恢复", 话: "系统管理员、回收站副手" },
        { 标: "不变", 话: "全员还看得到、查重查得到" },
      ],
      是: "标成无效",
      // P-界面-42：字典常用项做小块，「其他」原地写（后果框自带）；字典一项都没启用就不问
      原因: 无效原因选项.length ? { 选项: 无效原因选项, 叫: "无效原因" } : undefined,
      做: async (原因) => {
        const res = await 标无效客户([r.customerId], 原因);
        router.refresh();
        if (!res.ok) return res;
        if (!res.updated) return { ok: false, error: "已经是无效客户，或者已被领走" };
      },
    });
  }

  /** 恢复成有效（P-界面-44：回收站只这一个操作，行上直接放「恢复」；原型 pool.restore 一步完成、6 秒可撤销） */
  async function 恢复(r: 公海行): Promise<做的结果> {
    const res = await 恢复有效客户([r.customerId]);
    if (!res.ok) return res;
    if (!res.updated) return { ok: false, error: "已经恢复过了" };
    showUndo({
      话: `已恢复「${行名(r)}」，现在能领了`,
      毫秒: 6000,
      撤销: async () => {
        const x = await 标无效客户([r.customerId]);
        router.refresh();
        if (x.ok && !x.updated) return { ok: false, error: "已经有人动过了" };
        return x;
      },
    });
    router.refresh();
  }

  /** 行末「⋯」：分配给同事（老板、主管）、标成无效客户。都没有就不放。恢复不进菜单，行上直接放（P-界面-44） */
  function 更多(r: 公海行): MenuProps["items"] {
    const 无效 = r.类 === "无效";
    const items: NonNullable<MenuProps["items"]> = [];
    if (别线.has(r.id)) return items;
    // P-界面-43：写全「分配给同事」，人多走选人框（不再是二级菜单点人就分）
    if (能分配 && !无效 && 分给谁.length) items.push({ key: "分配", label: "分配给同事", onClick: () => set选人({ 们: [r], 批: false }) });
    if (r.种 === "客户" && !无效 && 能标无效) {
      // G4：前面有别的项时隔一道分隔线；不标红——标了能恢复，不是删除（落地计划危险色：行上不红、只有不可恢复的删除用红字）
      if (items.length) items.push({ type: "divider", key: "无效-线" });
      items.push({ key: "无效", label: "标成无效客户", onClick: () => 标无效(r) });
    }
    return items;
  }

  /**
   * 一个项目的领取（就地确认，P-界面-41）/ 恢复 + ⋯（行末和展开里共用）。
   * 行下确认（表格里的一行，K4）：「领取」只是开关，确认条在这一行下面整行宽（确认条()），操作格不再变成「确认领取 · 取消」
   */
  function 操作(r: 公海行, 因: string | null, 菜单: MenuProps["items"], 行下确认 = false): ReactNode {
    const 问 = 问着 === r.id;
    const 能恢复这行 = 可恢复(r);
    // 刚领到 / 分出去：按钮处写「已领取 ✓」，这一行随后滑出（原型 pool.claim）
    if (走的[r.id]) return <span className="pool-act" data-no-tip><Tag color="success" className="pool-done">{走的[r.id]}</Tag></span>;
    return (
      // data-no-tip：操作格展开成「确认领取 · 取消」时不冒全文悬停（TruncTip），按钮自己就是全文
      <span className="pool-act" data-no-tip onClick={(e) => e.stopPropagation()}>
        {能恢复这行 ? (
          <SaveButton type="default" size="small" className="row-act" aria-label={`恢复 ${行名(r)}`} 已保存="已恢复" 没保存="没恢复上" 做={() => 恢复(r)}>
            恢复
          </SaveButton>
        ) : !只读 && 行下确认 ? (
          <Button className="row-act" aria-label={`领取 ${行名(r)}`} aria-expanded={问} data-claim={r.id} disabled={!!因} size="small"
            onClick={(e) => { 清行错(r.id); if (问) set问着(null); else { 键盘开.current = e.detail === 0; set问着(r.id); 数转走(r); } }}>
            领取
          </Button>
        ) : !只读 && (
          <InlineConfirm 问="" 中性 是="确认领取" 毫秒={8000} 开={问} set开={(v) => set问着(v ? r.id : null)} 做={() => 领一个(r)}>
            <Button className="row-act" aria-label={`领取 ${行名(r)}`} disabled={!!因} size="small"
              onClick={() => { 清行错(r.id); set问着(r.id); 数转走(r); }}>
              领取
            </Button>
          </InlineConfirm>
        )}
        {!问 && !能恢复这行 && !!菜单?.length && (
          <Dropdown trigger={["click"]} menu={{ items: 菜单, onClick: ({ domEvent }) => domEvent.stopPropagation() }}>
            <Button className="row-act" aria-label={`更多操作 ${行名(r)}`} type="text" size="small" icon={<MoreOutlined />} />
          </Dropdown>
        )}
      </span>
    );
  }

  /**
   * 领取就地确认展开时写后果；没领到的原因也写在这里（不弹顶部提示）。
   * 原型 pool.claim：写在名字下（操作列只放「确认领取 · 取消」两颗键），高度从 0 长出来、收回去也是收，行高不跳一下
   */
  function 行下(r: 公海行): ReactNode {
    const 问 = 问着 === r.id;
    const 错 = !问 && !走的[r.id] ? 行错[r.id] : undefined;
    return (
      <AnimatePresence initial={false}>
        {(问 || 错) && (
          <motion.div
            key={问 ? "问" : "错"}
            className="pool-why-box"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 时长.base, ease: 曲线.ease }}
          >
            {问
              ? <div className="pool-why" aria-live="polite">{领取后果([r]).map((t) => <div key={t}>{t}</div>)}{转走说法(r)}</div>
              : <div className="pool-err pool-row-err" role="alert">{错}</div>}
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  /**
   * 行下确认条（K4 / P-界面-41）：表格展开行，整行宽、贴着可视区（antd 展开行在横滚表里是 sticky 的），不被钉住的操作列盖。
   * 左边后果（名额、超时收回、不能领回、号码不全、会一起转走的项目），右边「确认领取 · 取消」；8 秒不动自己收，鼠标停在条上不收，Esc 取消（InlineConfirm）。
   * 没领到的原因也写在这里（不弹顶部提示）
   */
  function 确认条(r: 公海行): ReactNode {
    const 问 = 问着 === r.id;
    const 错 = !问 && !走的[r.id] ? 行错[r.id] : undefined;
    if (!问 && !错) return null;
    return (
      <div className="pool-ask" data-for={r.id} data-no-tip role={问 ? "group" : undefined} aria-label={问 ? `确认领取 ${行名(r)}` : undefined}
        onMouseEnter={() => set悬着(true)} onMouseLeave={() => set悬着(false)}>
        {问 ? (
          <>
            <div className="pool-why" aria-live="polite">{领取后果([r]).map((t) => <div key={t}>{t}</div>)}{转走说法(r)}</div>
            <InlineConfirm 问="" 中性 是="确认领取" 毫秒={悬着 ? 3_600_000 : 8000} 开 set开={(v) => { if (!v) 收确认(r.id); }} 做={() => 领一个(r)}>
              {null}
            </InlineConfirm>
          </>
        ) : <div className="pool-err pool-row-err" role="alert">{错}</div>}
      </div>
    );
  }
  /** 收起行下确认条：焦点在条里的，还给这一行的「领取」，不掉回 <body> */
  function 收确认(id: string) {
    const 条里 = !!document.activeElement?.closest(".pool-ask");
    set问着((x) => (x === id ? null : x));
    set悬着(false);
    if (条里) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-claim="${CSS.escape(id)}"]`)?.focus());
  }

  /** 原地确认里「会一起转走的 N 个项目」：项目名一行一个（同客户详情页领取框，useCarryConfirm 的 转走项目列表）；同事在推的只说个数 */
  function 转走说法(r: 公海行): ReactNode {
    const 说 = 转走[r.id];
    if (说 === "取中") return <div className="muted">在数会一起转走的项目…</div>;
    if (!说) return null;
    return (
      <div className="pool-carry">
        <div>{说.标题}{说.行.length ? "，负责人一起改成你" : ""}</div>
        <转走项目列表 说法={说} />
        {说.同事 && <div>{说.同事}</div>}
      </div>
    );
  }

  /** 客户池并成一行的展开（11-11）：每个项目一小行——项目名、当前进程、入池方式 / 原因、入池时间、领取 / 分配 */
  function 子列表(r: 公海行): ReactNode {
    return (
      <div className="pool-sub" role="list" aria-label={`${r.客户名 ?? "这位客户"}名下在公海的 ${r.子?.length ?? 0} 个项目`}>
        {(r.子 ?? []).map((c) => {
          const 因 = 领不了(c);
          const 方式 = c.快捷 ? 快捷叫法(c.快捷) : 入池类叫法[c.类];
          return (
            <div key={c.id} className={走的[c.id] ? "pool-sub-row pool-sub-leave" : 回来的.includes(c.id) ? "pool-sub-row pool-sub-back" : "pool-sub-row"} role="listitem">
              <RowLink href={c.项目去 ?? `/projects/${c.projectId}`} className="fulltext" title={c.项目名 ?? ""}>{c.项目名 ?? "项目"}</RowLink>
              <span className="clamp" title={c.进程 ?? ""}>{c.进程 ?? 没原因}</span>
              <span className="clamp muted" title={`${方式}：${c.入池原因}`}>{方式} · {c.入池原因}</span>
              <span className="nowrap muted" title={fmtDateTime(c.入池时间)}>{smartTime(c.入池时间)}</span>
              <span className="pool-sub-act">
                {操作(c, 因, 更多(c))}
                {因 && !只读 && !可恢复(c) && <span className="muted clamp pool-sub-why" title={因}>{因 === 项目不能单独领提示 ? 项目不能单独领短说 : 因}</span>}
                {行下(c)}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  /** 入池原因那一格：退回原因（M-公海-09）；标了无效的前面多一个红标，原因照旧写（无效是入池方式，不是原因） */
  const 原因格 = (r: 公海行): ReactNode => (
    <span className="clamp" title={r.类 === "无效" ? `无效客户：${r.入池原因}` : r.入池原因}>
      {r.类 === "无效" && <Tag color="red" style={{ marginInlineEnd: 4 }}>无效</Tag>}
      <span className={r.入池原因 === 没原因 ? "muted" : undefined}>{r.入池原因}</span>
    </span>
  );

  /** 客户名称那一格：三态号码不全的小红标；看不到的写「领取后可见」 */
  const 客户格 = (r: 公海行): ReactNode => r.客户名
    ? (三态开 && r.号码不全
      // C14：客户名后一个小红标签（三态自动收回时打的）
      ? (
        <span className="tri-name-row">
          <RowLink href={`/customers/${r.customerId}`} className="link-strong fulltext" title={r.客户名}>{r.客户名}</RowLink>
          <span className="tri-miss" title={号码不全说明}>号码不全</span>
        </span>
      )
      : <RowLink href={`/customers/${r.customerId}`} className="link-strong fulltext" title={r.客户名}>{r.客户名}</RowLink>)
    : <span className="muted">领取后可见</span>;

  /** 操作那一格：客户池并成一行的是「展开 N 个 / 收起」，别的是领取 / 恢复 + ⋯（确认条在行下），领不了的短原因写在下面 */
  const 操作格 = (r: 公海行): ReactNode => {
    if (r.子) {
      const 开 = 展开的.includes(r.id);
      return (
        <Button className="row-act" size="small" aria-expanded={开} aria-label={`${开 ? "收起" : "展开"} ${行名(r)} 名下 ${r.子.length} 个项目`}
          onClick={(e) => { e.stopPropagation(); 切展开(r.id); }}>
          {开 ? "收起" : `展开 ${r.子.length} 个`}
        </Button>
      );
    }
    const 因 = 领不了(r);
    const 菜单 = 更多(r);
    return (
      <div className="pool-op" data-no-tip>
        {操作(r, 因, 菜单, true)}
        {/* 操作列窄：长的那句（项目不能单独领）行内写短的、整句放悬停里；回收站「标了无效…」那句折行写完，不被表格右边裁掉（原型 pool.bin） */}
        {因 && !只读 && !可恢复(r) && !走的[r.id] && <span className="muted pool-op-why" title={因}>{因 === 项目不能单独领提示 ? 项目不能单独领短说 : 因}</span>}
      </div>
    );
  };

  /**
   * 列（设计语言 G-A · G3）：
   *   客户名称排第一、钉左（这一行是谁，同客户列表；390 不再是属性钉着、客户名滑到操作列底下）；客户池并成一行的名字前一个展开箭头（G5）
   *   公海属性：「全部」里灰标签（D10：绿只给完成）；选了某一池整列不摆（同一池不用每行说）
   *   项目名 = 客户名：项目格写灰字「同客户名」，照旧点得进、悬停看全名（G-新5）
   *   最后跟进跨年写全「2025 年 10 月 26 日」不截（D15）；日期 13 号字、右对齐、等宽数字（并成两行那一列 12 号）
   *   1024 这一档：不摆「当前进程」，「最后跟进」「入池时间」并成一列两行，「入池原因」留着（G-新4：领不领看它）
   */
  const 时间 = (d: string | Date | null | undefined, 空 = "没跟进过") =>
    d ? <span className="nowrap pool-t" title={fmtDateTime(d)}>{smartTime(d)}</span> : <span className="muted">{空}</span>;
  const 全部列: 列<公海行>[] = [
    {
      // 列宽留余量（G-A 审查）：1366 各列 + 勾选列 1062 对内容区 1094、1024 是 720 对 752，各留 32——Windows 纵向滚动条占 17 也不横滚、
      // 钉住的操作列不冒阴影线；客户名、项目名各让出 8（原来 168 / 160、窄档 132 / 116，只留 16）
      title: "客户名称", key: "客户", width: 窄 ? 124 : 160, 常驻: true,
      render: (_, r) => r.子 ? (
        <span className="pool-name">
          <RightOutlined className="pool-fold" rotate={展开的.includes(r.id) ? 90 : 0} aria-hidden />
          {客户格(r)}
        </span>
      ) : 客户格(r),
    },
    ...(filters.attr ? [] : [{
      title: "公海属性", key: "属性", width: 92, 常驻: true,
      render: (_: unknown, r: 公海行) => <Tag className="pool-attr">{r.属性}</Tag>,
    }]),
    {
      title: "项目名称", key: "项目", width: 窄 ? 108 : 152,
      render: (_, r) => {
        if (r.子) return (
          <span className="pool-many">
            <span className="fulltext" title={r.子.map((c) => c.项目名 ?? "").join("、")}>{r.项目名}</span>
            <span className="pool-many-n">{r.子.length} 个项目</span>
          </span>
        );
        if (!r.项目名) return <span className="muted">领取后可见</span>;
        const 同 = !!r.客户名 && r.项目名 === r.客户名;
        const 类 = 同 ? "fulltext pool-same" : "fulltext";
        const 字 = 同 ? "同客户名" : r.项目名;
        return r.projectId && r.种 === "项目"
          ? <RowLink href={r.项目去 ?? `/projects/${r.projectId}`} className={类} title={r.项目名}>{字}</RowLink>
          : <span className={类} title={r.项目名}>{字}</span>;
      },
    },
    ...(窄 ? [] : [{
      title: "当前进程", key: "进程", width: 128,
      render: (_: unknown, r: 公海行) => r.进程 ? <span className="clamp" title={r.进程明细 ?? r.进程}>{r.进程}</span> : <span className="muted">—</span>,
    }]),
    ...(窄
      ? [{
        title: "入池 / 跟进", key: "时间", width: 140, align: "right" as const, className: "pool-tcol",
        render: (_: unknown, r: 公海行) => (
          <div className="pool-t2">
            <div>{时间(r.入池时间)}</div>
            <div className="muted">{时间(r.最后跟进)}</div>
          </div>
        ),
      }]
      : [
        { title: "最后跟进", key: "跟进", width: 150, align: "right" as const, className: "pool-tcol", render: (_: unknown, r: 公海行) => 时间(r.最后跟进) },
        { title: "入池时间", key: "入池", width: 104, align: "right" as const, className: "pool-tcol", render: (_: unknown, r: 公海行) => 时间(r.入池时间) },
      ]),
    { title: "入池原因", key: "原因", width: 窄 ? 120 : 140, render: (_, r) => 原因格(r) },
    // 手机宽「领取」触屏 44 高、左右各 12 内边距（D34，约 54 宽）+「⋯」44：格子 136 才放得下，原来 120 撑出 12（PR #414 排版闸门 375 / 390）
    { title: "操作", key: "操作", width: 手机 ? 136 : 104, 常驻: true, fixed: "right", render: (_, r) => 操作格(r) },
  ];
  const 列们 = 全部列.filter((c) => !(只读 && c.key === "操作" && !能分配 && !能标无效 && !能恢复));

  // 自定义筛选（11-06）：属性分段、排序、搜索固定；默认摆的和原来一样只有入池方式，「客户来源」收在更多筛选
  const { 外露: 筛选外露, 更多按钮: 更多筛选按钮 } = useCustomFilters("pool", [
    {
      键: "quick", 名: "入池方式", 宽: 140, 默认外露: true, 有值: !!f.quick,
      渲染: (style: CSSProperties) => (
        <Select style={style} aria-label="入池方式" placeholder="全部入池方式" allowClear
          popupMatchSelectWidth={260}
          value={f.quick || undefined}
          onChange={(v) => 换池({ quick: v ?? "" })}
          options={快捷们.map((k) => ({ value: k, label: `${快捷叫法(k)} ${快捷数[k]}` }))}
          optionRender={(o) => (
            <div>
              <div>{o.label}</div>
              <div className="muted" style={{ fontSize: 12, whiteSpace: "normal" }}>{快捷说明[o.value as 快捷]}</div>
            </div>
          )}
        />
      ),
    },
    {
      // 项目创建时间（11-11）：按项目算，筛了客户公海里的客户按名下项目拆成几行（同渠道名单），条数和渠道看板对得上
      键: "created", 名: "创建时间", 宽: 240, 默认外露: false, 有值: !!(f.createdFrom || f.createdTo),
      渲染: (style: CSSProperties) => (
        <CreatedRangeFilter style={style} from={f.createdFrom} to={f.createdTo} 改={(v) => 改名单(v)} />
      ),
    },
    {
      键: "channelId", 名: "客户来源", 宽: 150, 默认外露: false, 有值: !!f.channelId,
      渲染: (style: CSSProperties) => (
        <Select style={style} aria-label="客户来源" placeholder="全部客户来源" allowClear showSearch={{ optionFilterProp: "label" }} popupMatchSelectWidth={false} value={f.channelId || undefined} onChange={(v?: string) => apply({ channelId: v ?? "" })} options={渠道筛选项} />
      ),
    },
    // 号码不全（C14，三态开着才有）：只看三态自动收回时打了「号码不全」的客户，再点一次取消。
    // 收在「更多筛选」里（可钉到外面）：公海筛选行 1024 宽有筛选时已满两行，摆外面会折出第三行（11-12 量过）；三态关着这一项不在
    ...(三态开 ? [{
      键: "phoneIncomplete", 名: "号码不全", 宽: 126, 默认外露: false, 有值: f.phoneIncomplete === "1",
      渲染: (style: CSSProperties) => (
        <Button style={style} className="nowrap" aria-pressed={f.phoneIncomplete === "1"} type={f.phoneIncomplete === "1" ? "primary" : "default"} ghost={f.phoneIncomplete === "1"}
          title="只看到期自动收回时号码不全的客户"
          onClick={() => apply({ phoneIncomplete: f.phoneIncomplete === "1" ? "" : "1" })}>
          号码不全{号码不全数 === null ? "" : ` ${号码不全数}`}
        </Button>
      ),
    }] : []),
  ]);

  /** 公海回收站开关（P-公海-09）= 入池方式筛「无效客户」，再点一次取消；和入池方式下拉同一个值、联动照旧 */
  const 回收站开 = f.quick === "无效客户";
  const 切回收站 = () => 换池({ quick: 回收站开 ? "" : "无效客户" });
  /**
   * 设计语言 G-A · G1：两行固定结构——
   *   池子行：全部 / 线索池 / 商机池 / 订单池 / 客户池（数用 --count-fg 灰、等宽，0 的照摆）；最右「公海回收站」独立开关（按下态，不并进分段、不叫池），
   *     数是当前池里的（选了某一池写「（线索池 N）」）；390 池子改下拉（D34：分段横滑「订单池」露半个、「客户池」看不到）
   *   筛选行：搜索（占位写全）、入池方式（「全部入池方式」墨色，D37）、排序、更多筛选（N）、有筛选才出的重置；右端「列」。1024 不折第三行
   */
  const 池名 = (k: "全部" | 公海属性) => (
    // 池名单独一个 span：390 下拉选了值、挤的时候只截池名，后面的数照全写（globals.css .pool-pick-attr）
    <span className="pool-seg"><span className="pool-seg-k">{k}</span> <span className="pool-n">{数(属性数[k])}</span></span>
  );
  const 池选项 = (["全部", ...公海属性们] as const).map((k) => ({ value: k, label: 池名(k) }));
  const 筛选 = (
    <div className="pool-bar">
      <div className="pool-pools">
        {手机 ? (
          <Select aria-label="公海属性" className="pool-pick-attr" value={f.attr || "全部"} popupMatchSelectWidth={false}
            onChange={(v) => 换池({ attr: v === "全部" ? "" : String(v) })} options={池选项} />
        ) : (
          <Segmented aria-label="公海属性" className="pool-seg-attr" value={f.attr || "全部"}
            onChange={(v) => 换池({ attr: v === "全部" ? "" : String(v) })} options={池选项} />
        )}
        <Button className="pool-bin nowrap" aria-pressed={回收站开}
          title={`标了无效的客户都在这里：全员看得到、查重查得到，不会自动删${f.attr ? `；数字是${f.attr}里的` : ""}`}
          onClick={切回收站}>
          {/* 一整段字（antd 按钮里每个子元素是一格 flex，分开写会被按钮的 gap 隔开） */}
          <span>{公海回收站}{f.attr ? <span className="pool-n">（<span className="pool-bin-attr">{f.attr} </span>{数(快捷数.无效客户)}）</span> : <> <span className="pool-n">{数(快捷数.无效客户)}</span></>}</span>
        </Button>
      </div>
      <div className="pool-fl">
        <ListSearch
          value={f.keyword}
          onChange={(v) => setF({ ...f, keyword: v })}
          onSearch={(v) => apply({ keyword: v })}
          placeholder="搜客户名 / 项目名"
          width={240}
        />
        {筛选外露}
        <Select className="pool-sort" aria-label="排序"
          value={f.sort || 默认排序}
          onChange={(v) => apply({ sort: v === 默认排序 ? "" : v })}
          options={排序们.map((o) => ({ value: o.value, label: `按${o.label}` }))}
        />
        {更多筛选按钮}
        <ResetFilters 显示={在筛} onClick={reset} />
      </div>
    </div>
  );

  /** G7 / D21：筛了没对上时那一句；只选了某一池、别的都没筛时说「X 池里还没有」 */
  const 只筛了池 = !!filters.attr && !filters.keyword && !filters.quick && !filters.channelId && !filters.projChannel && !filters.createdFrom && !filters.createdTo && !filters.batch && !(三态开 && filters.phoneIncomplete);
  const 没对上话 = 只筛了池 ? `${filters.attr}里还没有`
    : `${filters.keyword ? `没有对得上「${filters.keyword}」的客户或项目` : "没有对得上这些筛选的客户或项目"}，换个条件或点「重置」看全部`;
  /** 行下确认条 / 没领到的原因（K4）：表格展开行；客户池并成一行的照旧展开子列表 */
  const 顶行 = new Set(行.filter((r) => !r.子).map((r) => r.id));
  const 条行 = 确认条行们({ 问着, 行错, 走的, 顶行 });

  return (
    <>
      <PageHead
        title="公海"
        // G0：标题后挂总数（四池之和，--count-fg，同客户列表「客户 N」的位置）；跟着搜索 / 来源变，不跟池子、入池方式变。
        // 名单类标签（渠道名单 / 导入批次 / 数据页点进来的「公海里进行中的项目」）跟在后面
        titleAside={<><span className="pool-head-n" title="四个池加起来">{数(属性数.全部)}</span>{名单标}{批标}{进行中标}</>}
        subtitle="没人负责的客户和项目都在这里：领了就归你"
        // G0：「我手上 N / 上限 M」做成右上一枚中性胶囊（--tag-bg），到上限换要人处理的橙底（--warning-bg）
        extra={持有 ? <span className="pool-hold nowrap" data-full={到上限 || undefined}>我手上 {持有.有} / 上限 {持有.上限}</span> : undefined}
      />
      <DataList<公海行>
        页="pool"
        // 进详情再回来、刷新：勾选和横滚位置还原（29R）
        回来还原
        列={列们}
        行={行}
        空库={!库里有 && !在筛}
        // G7 / D21 空态句
        空态={{ title: "公海里还没有客户和项目", hint: "超时没跟进、被退回的客户和项目会出现在这里", demo: false }}
        没对上={<div className="list-none">{没对上话}</div>}
        筛选={筛选}
        汇总={结果 || 截断 ? (
          <>
            {结果 && <ResultNote 文案={结果.文案} 没领到={结果.没领到} 关={() => set结果(null)} />}
            {/* G2：13 号灰字、写数 */}
            {截断 && <div className="muted pool-cut">公海里太多了，这里只列最近入池的 {数(总数)} 条；更早的请用搜索找</div>}
          </>
        ) : undefined}
        批量={只读 ? undefined : (选中, 清空, 选中行) => {
          const 键 = 选中.join(",");
          // 原型 pool.batch：选择条原地变确认，写清后果；确认后清掉勾选、底部撤销条
          // G6：批量条同客户列表那一款（浮在底部）；条头自己写「已选 N 个」——公海一行可能是客户也可能是项目，不说「位」
          const 已选 = <b className="pool-sel-n">已选 {选中.length} 个</b>;
          if (批问 === 键) return (
            <span className="pool-batch-ask" role="group" aria-label="确认批量领取">
              {已选}
              <b>领取 {选中行.length} 个？</b>
              <span className="pool-batch-why">{领取后果(选中行).join(" · ")}</span>
              {批错 && <span className="pool-err" role="alert">{批错}</span>}
              <Button size="small" type="primary" loading={批忙} onClick={async () => {
                if (批忙) return;
                set批忙(true);
                set批错("");
                const res = await 动手("领取", 选中行);
                set批忙(false);
                if (!res.ok) {
                  if (res.没领到.length > 1) set结果({ 文案: res.error, 没领到: res.没领到 });
                  return void set批错(res.error);
                }
                set批问(null);
                清空();
                报(res);
              }}>确认领取</Button>
              <Button size="small" type="text" disabled={批忙} onClick={() => { set批问(null); set批错(""); }}>取消</Button>
            </span>
          );
          return (
            <Space size={6} wrap>
              {已选}
              {/* 原型 pool.carry：带待办跟着这一批走，默认勾上，可当场改 */}
              {公海规则.换负责人带待办 && (
                <Checkbox className="nowrap" checked={带待办} onChange={(e) => set带待办(e.target.checked)} title="原负责人没做完的待办一起转给新负责人">
                  原负责人的待办一起转
                </Checkbox>
              )}
              {/* 「领取」是这一条唯一的主色钮 */}
              <Button size="small" type="primary" onClick={() => { set批错(""); set批问(键); }}>领取</Button>
              {能分配 && 分给谁.length > 0 && (
                <Button size="small" onClick={() => set选人({ 们: 选中行, 批: true, 完: 清空 })}>分配给同事</Button>
              )}
            </Space>
          );
        }}
        // 换池时先出骨架（原型 pool.attr / pool.bin），翻页、排序、搜索照旧表格内转圈
        加载中={pending && !换池中}
        替表格={换池中 ? <Skeleton 行={6} 高={14} 间距={18} className="pool-skel" 说法="正在换一池" /> : undefined}
        亮={回来的}
        // 客户池并成一行的：点行展开 / 收起（客户归别人，不跳客户页）
        行链接={(r) => (r.子 ? "" : r.种 === "项目" ? r.项目去 ?? `/projects/${r.projectId}` : `/customers/${r.customerId}`)}
        行点击={(r) => { if (r.子) 切展开(r.id); }}
        浮起操作条
        展开={{ expandedRowKeys: [...展开的, ...条行], showExpandColumn: false, rowExpandable: (r) => !!r.子 || 条行.includes(r.id), expandedRowRender: (r) => (r.子 ? 子列表(r) : 确认条(r)), expandedRowClassName: (r) => (r.子 ? "pool-sub-tr" : "pool-ask-tr") }}
        行类={(r) => [r.类 === "无效" ? "row-off" : "", 走的[r.id] ? "pool-row-leave" : "", 回来的.includes(r.id) ? "pool-row-back" : ""].filter(Boolean).join(" ") || undefined}
        分页={{ 当前页, 每页: pageSize, 总数, 翻页, ...(分项 ? { 单位: (n: ReactNode) => (分项.项目 ? <>{n} 行：客户 {分项.客户} 位、项目 {分项.项目} 个</> : <>{n} 位客户</>) } : {}) }}
      />
      {后果框}
      <PoolAssignPicker
        open={!!选人}
        题={选人 ? (选人.们.length === 1 && !选人.批 ? `把「${行名(选人.们[0])}」分配给` : `把 ${选人.们.length} 个分配给`) : ""}
        人们={分给谁.map((o) => ({ ...o, ...候选信息[o.value] }))}
        批={选人?.批}
        后果={(名) => [`${名} 会收到通知`, 待办说法(名), 选人 && 不全数(选人.们) ? "号码不全，分出去后记得补全" : "", 选人?.批 ? "" : "6 秒内可撤销"].filter(Boolean).join(" · ")}
        做={async (id, 名) => {
          const 这次 = 选人;
          if (!这次) return;
          if (这次.批) {
            // 选好人先关选人框，再进后果框
            queueMicrotask(() => void 批分(这次.们, id, 名, 这次.完));
            return;
          }
          const r = await 动手("分配", 这次.们, id);
          if (!r.ok) return { ok: false, error: r.error };
          报(r);
        }}
        onClose={() => set选人(null)}
      />
    </>
  );
}
