"use client";

import { 登记页面行 } from "@/lib/page-rows";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useNavGo } from "@/lib/nav-pending";
import { useHoverPrefetch } from "@/lib/prefetch-full";
import { Table, Button, Dropdown, Checkbox, Grid } from "antd";
import { SettingOutlined } from "@ant-design/icons";
import type { ColumnType, TableProps } from "antd/es/table";
import type { SortOrder } from "antd/es/table/interface";
import EmptyState from "@/components/EmptyState";
import Skeleton from "@/components/Skeleton";
import { useLocalPref } from "@/lib/local-pref";
import { 只留当前行, 露出这一列, 算可见列, 切换后存 } from "@/lib/list-select";
import { 当前列表地址, 读勾选, 记勾选, 记横滚, 记本地页, 清勾选, 进来可还原 } from "@/lib/list-return";
import { 横滚回 } from "@/lib/hscroll-restore";
import { 躲开钉住列补宽 } from "@/lib/list-edge-clear";

/**
 * 列表页的那张表。**全站只有这一个表格实现**（批 2 抽出来，批 3 六页照用）。
 *
 * 每个列表页自己要写的只剩四样：列、筛选、空状态的第一步、主动作。
 * 密度、选中态、分页、列设置、批量工具条、空库时收起筛选栏——都在这里，改一处全站都改。
 *
 * 几条不显然但踩过的：
 *   - 「空库」是「一条都没有**且**没在筛」。筛出 0 条不算——那时筛选栏必须留着，
 *     否则人看不见自己筛了什么，也点不到重置
 *   - 主动作不在这张表里，它在页头右上角（每个列表页自己用 PageHead 的 extra 放）。
 *     空状态里那个「新建第一位」是给第一次进来的人的引导，不是它的替代品
 *   - 列设置存在本地，一页一份。每个人常看的列不一样，不该逼所有人用同一套；
 *     后来新增的列按它自己的默认值补进去，不然加了列的人永远看不到
 *   - 勾选只认眼前的行：行一变（筛选、搜索、翻页）就清掉不在当前行里的勾选。
 *     看不见的勾选留着，下一次批量删除删的就是人没看见的人（交互审查 S4）
 *   - 勾选框和第一列（名字）固定在左边，页面不用自己写 fixed。列一多、表格一横滚，
 *     每一行是谁不能跟着滚走——右边的编辑、删除还固定着，认不出是谁却能删（S5）
 *   - 右边还能往右滚时，表格右沿有一道渐隐（globals.css 的 .list 那几条），
 *     不然被挤出去的列连个提示都没有（M3）
 */
export type 列<T> = ColumnType<T> & {
  /** 列设置里显示的名字。title 不是纯文字（带图标之类）时必须给 */
  列名?: string;
  /** false = 默认收在「列」里，要勾才显示。不写就是默认显示 */
  默认?: boolean;
  /**
   * 列设置里记这一列用的键（不写 = key）。换一个键 = 老设置里关于这一列的记录（勾着的「键」、藏着的「-键」）一律不算，按 默认 重来；
   * 老设置里原来那个键照样留着不删，换回原键（比如三态关了）时照旧生效。
   * 客户列表三态开着的「项目数」写「+projectCount」（PR #384，方案 A）：列设置存的是全部可见列，三态开着动过任何一列的人都带着 projectCount，
   * 不换键的话收起对多数老用户不生效；只有三态开着之后在「列」里勾出来的才显示
   */
  存键?: string;
  /** true = 不进列设置，永远跟着（操作列） */
  常驻?: boolean;
  /**
   * true = 手机宽（< 768）不钉右（只对 fixed: "right" / "end" 的列有用），跟着横滚到最后。不写照钉。
   * 只有客户列表的操作列写（#381 实操：只一颗「⋯」，让出中间给号码列）；线索、公海这些的操作列放着分配 / 领取按钮和分完的结果，
   * 手机上也得一眼看得见（e2e-ent/owner-first-batch A5：375 宽结果格不许跑出视口）
   */
  手机不钉?: boolean;
  /** true = 列设置里照列着、勾着，但灰掉不让取消（11-04 P-界面-08 市场角色项目页：项目、阶段、进程、验证结果、负责人锁定）。存的设置里藏过也照样显示 */
  锁定?: boolean;
  /** true = 这一列照旧折行写完（备注这类长文，11-04 用户：「除了备注，备注信息有时候过多」）。其余列一行、省略号、悬停看全 */
  折行?: boolean;
};

type Props<T> = {
  /** 记列设置用的键，一页一个，比如 "customers" */
  页: string;
  列: 列<T>[];
  行: T[];
  /** 一条都没有**且**没在筛 */
  空库: boolean;
  空态: Parameters<typeof EmptyState>[0];
  /** 不是空库、只是没对上时表格里那一句。不给就是通用的「换个条件或点重置」（客户页用它指一条去公海页签的路） */
  没对上?: React.ReactNode;
  /** 筛选栏。空库时整条不渲染 */
  筛选?: React.ReactNode;
  /** 工具栏右端、「列」左边的一格（客户页的「排序」按钮，E-332）；放在筛选栏外面，不参与「更多筛选」的挤。不给就没有 */
  排序钮?: React.ReactNode;
  /** 工具栏和表格之间那一条汇总（商机页的「总额 · 加权预测」）。不给就没有 */
  汇总?: React.ReactNode;
  /** 给了就用它替掉表格（筛选栏、汇总照留，批量条和表格不摆）：企业版客户页的看板（U-客户-06） */
  替表格?: React.ReactNode;
  /**
   * 勾了行之后才出现的工具条。不给就不支持多选。
   * 第三个参数是勾中的那几行本身——确认框要写出「是谁」，只有 id 写不出来
   */
  批量?: (选中: string[], 清空: () => void, 选中行: T[]) => React.ReactNode;
  /**
   * 批量工具条浮在列表底部（原型 cu.select「改后」）：不插在表格上方、表格不往下挪；条跟着滚动贴在可视区底部，
   * 但在文档流里占着位置（放在表格后面），滚到底时不压最后一行。默认关：别的列表页照旧插在表格上方。
   */
  浮起操作条?: boolean;
  加载中?: boolean;
  /** 点一行去哪。给了就整行可点；点在按钮、链接、勾选框上不算 */
  行链接?: (r: T) => string;
  /** 点行不去别的页、在这儿做点事（比如打开编辑框）。行链接给了空串的行也走它 */
  行点击?: (r: T) => void;
  横向?: number;
  /**
   * 横滚停在最左时，表头字别被右边钉住的操作列和它左边的渐隐压成半截（设计语言 C-A2 · C-新6）：给了列键，
   * 就按眼下的框宽给这一列多补一点宽，把后面的列往右推到「看得见的最后一个表头字在渐隐左边、下一个整个藏到钉住列底下」。
   * 算法在 lib/list-edge-clear.ts。补的这一列最好是靠左摆的短内容（渠道页是「渠道属性」），多出来的是右边留白。手机宽不补
   */
  补宽列?: string;
  /**
   * 不给 = 在浏览器里分页（行已经一次全拿下来了，多数列表页是这样）。
   * 给了 = 服务端分页，由调用方去翻。false = 不分页。
   */
  分页?: { 当前页: number; 每页: number; 总数: number; 翻页: (页: number, 每页: number) => void;
    /** 一行不一定是同一种东西时写清单位（审核 11-18 统计 P2-2，公海页：客户行、线索公海项目行）：给了就替换「共 N 条」里的「条」那句，数照旧滚 */
    单位?: (总数: ReactNode) => ReactNode } | false;
  排序?: (key: string, order: SortOrder) => void;
  /**
   * 这一页只取了前 N 条时，库里到底有多少。
   *
   * 2026-09-19 报上来的一类：线索 / 商机 / 联系人 / 跟进四页都是 `take: 300` 配
   * 浏览器端分页，而分页条上的 `showTotal` 数的是**取回来的行**——
   * 库里有 500 条线索的人，页脚白纸黑字写着「共 300 条」。
   * 这不是少显示了 200 条的问题，是页面报了一个错的总数。
   *
   * 说法照 CustomerRoster 那条来：「这里只有最近 N 条，全部 M 条…」。
   * 不给 = 行已经是全部（走服务端分页的 `/customers`，或者本来就取全了）。
   */
  截断?: {
    总数: number;
    说明?: string;
    /**
     * 从库里取回来几行（本地筛选之前）。页面在浏览器里再筛一道时要给（联系人页按关系、负责人筛）：
     * 不给就拿眼前的行数比，本地筛完行变少了，冒出一句「只有最近 2 条，库里一共 5 条」，像没取全（J-015）
     */
    取回?: number;
  };
  /**
   * 原地变了的行也亮一下（和新建的行同一个 row-fresh）：标赢单 / 丢单 / 撤销之后，
   * 那一行的阶段、概率换了，光一句 message 人还要自己去找是哪行变了。
   * 由调用方给 id，因为 id 没变、这里比不出来。
   */
  亮?: string[];
  /** 这一行额外挂的类名。渠道页用它把停用的那几行压淡（审查 D12） */
  行类?: (r: T) => string | undefined;
  /** 这一行不让勾（批量操作一律做不了的行）。企业版虚线下属的客户：只能看，勾上去批量什么都会被拦（10-25 实测 F4） */
  不可勾?: (r: T) => boolean;
  /**
   * 每格只占一行，放不下打省略号，悬停看全文（11-04 用户：「所有页面都是这样」，默认开）。
   * 悬停浮层是全站的 TruncTip，被截了才出。备注列给列上的 折行；整张表不要就传 false
   */
  单行?: boolean;
  /** 可展开的行（antd expandable 原样传）：公海客户池一位客户多个项目，展开逐个领（11-11）。行上别用 children 字段，antd 会当成树 */
  展开?: TableProps<T>["expandable"];
  /**
   * 进详情再回来（或刷新）还原勾选和表格横滚位置（29R，11-20 员工反馈「点进去再退出来，之前勾选的就全乱了」）。
   * 按「页 + 地址」记在 sessionStorage（lib/list-return.ts 读勾选）：地址一样才还原，还原的勾选也只留眼前的行。
   * 在浏览器里分页的表（不给 分页）第几页、每页几条也一起记。
   * 筛选、排序、页码、页签在地址栏，纵向滚动由外壳 ListMemory 滚回去，列设置本来就记在本地（useLocalPref）；
   * 筛选在本页 state 里的（联系人、渠道）用 lib/list-keep.ts 的 useListKeep 记。
   * 只在「回来」时还原（从详情页回来、浏览器后退、刷新），从左栏点进来回默认（lib/list-return.ts 进来可还原）
   */
  回来还原?: boolean;
};

/** 浏览器里分页时每页默认几条（底部「条/页」能换，见 本地页） */
const 默认每页 = 20;

const 列键 = <T,>(c: 列<T>) => String(c.key ?? c.dataIndex);

/**
 * 一行叫什么名字。列表页的行各有各的形状，但「这条记录叫什么」总在这几个字段里的一个。
 * 找不到就不登记这一行——上下文里放一个 id 没有意义。
 */
function 行名(r: object): string | null {
  const o = r as Record<string, unknown>;
  for (const k of ["name", "title", "subject", "customerName"]) if (typeof o[k] === "string" && o[k]) return o[k] as string;
  return null;
}

/** 取数中、原来又一行都没有时摆的占位（骨架行要有行可摆）。id 只给 rowKey 用 */
const 占位行 = [{ id: "skel-0" }, { id: "skel-1" }, { id: "skel-2" }] as never[];
/** 取数中每一格换成一条灰条：td 的属性（类名、固定列的位置）照留，只换里面的东西 */
const 骨架格 = {
  body: {
    cell: ({ children: _旧, ...td }: React.TdHTMLAttributes<HTMLTableCellElement> & { children?: React.ReactNode }) => (
      <td {...td}>
        <Skeleton 行={1} 静默 className="list-skel" />
      </td>
    ),
  },
};

/** 手机宽时钉在左边的名字列最多这么宽：390 / 375 宽减去勾选列、页边，中间还能完整露出 150 宽的号码列 */
const 手机名字宽 = 120;

export default function DataList<T extends { id: string }>({
  页, 列: 全部列, 行, 空库, 空态, 没对上, 筛选, 排序钮, 汇总, 替表格, 批量, 浮起操作条 = false, 加载中, 行链接, 行点击, 横向, 分页, 截断, 亮, 行类, 不可勾, 排序, 单行 = true, 展开, 回来还原 = false, 补宽列,
}: Props<T>) {
  const router = useRouter();
  /** 点一行进详情：等新页时顶上的条亮、这一行先高亮（lib/nav-pending.ts） */
  const 去页 = useNavGo();
  const [去的行, set去的行] = useState<string | null>(null);
  const 预取 = useHoverPrefetch();
  /** 真的只取了一部分：库里的总数比取回来的多（本地筛掉的不算，见 截断.取回） */
  const 取回 = 截断?.取回 ?? 行.length;
  const 真截断 = !!截断 && 截断.总数 > 取回;
  /*
    11-26：总数不再从旧数滚到新数。滚的那 0.4 秒里一路闪过 1512、1449、902……这些数哪个筛选都对不上（实操：选「客户来源 → 未填」
    从 1956 滚到 235），用户看到的就是「先闪一个不相干的数再变对」。筛选换了、新数还没回来时照旧留着旧数（rows / total 都是上一份），
    新数到了直接换上；等宽照旧（.list-total-n tabular-nums），换数时宽度不跳
  */
  const 总数 = (t: number) => <span className="list-total-n">{t}</span>;
  const [选中, set选中] = useState<string[]>([]);
  /*
    行一换就把看不见的勾选清掉。在渲染里比上一次的行来改（React 文档「props 变了调整 state」的写法），
    不放 effect：放 effect 会先用旧勾选画一帧「已选 3 条」再改。
    router.refresh() 之后行数组也会换一个，但 id 没变，只留当前行 原样返回，不会多设一次
  */
  const [上次的行, set上次的行] = useState(行);
  if (上次的行 !== 行) {
    set上次的行(行);
    // 只留眼前、而且现在还让勾的行：后退回来先用的是缓存里的旧行，新行到了有的变只读（改了上级），不能还勾着被算进批量（#381 实操）
    const 留 = 只留当前行(选中, (不可勾 ? 行.filter((r) => !不可勾(r)) : 行).map((r) => r.id));
    if (留 !== 选中) set选中(留);
  }
  const 选中行 = useMemo(() => {
    const 在 = new Set(选中);
    return 行.filter((r) => 在.has(r.id));
  }, [行, 选中]);

  /**
   * 刚出现的行亮两秒。**不用每个页面告诉我们它刚建了谁**——比一下 id 就知道。
   * 新建完 router.refresh()，这张表就多出一个没见过的 id，那一行就是答案：
   * 「我刚填的东西落在这儿」。原来新建完只有一句 message，人还要自己在列表里找。
   *
   * 一次冒出两个以上陌生 id 的不算：翻页、换筛选会一整页都是没见过的，
   * 那不是「刚建的」，把它们全点亮只会让人以为出了什么事。
   * 第一次挂载也不算——那时整页都是陌生的。
   */
  const 见过 = useRef<Set<string> | null>(null);
  const [新来的, set新来的] = useState<string[]>([]);
  /*
    把这一页上列着的名字登记给 AI 面板（lib/page-rows.ts）。每个列表页都走这里，
    所以不用每页手写；离开这一页时清空，免得渠道页的名单跟着人跑到客户页去。
  */
  useEffect(() => {
    登记页面行(行.map(行名).filter((n): n is string => n !== null));
    return () => 登记页面行([]);
  }, [行]);
  useEffect(() => {
    const ids = 行.map((r) => r.id);
    if (见过.current === null) {
      见过.current = new Set(ids);
      return;
    }
    const 新 = ids.filter((id) => !见过.current!.has(id));
    ids.forEach((id) => 见过.current!.add(id));
    if (新.length === 0 || 新.length > 2) return;
    set新来的(新);
    const t = setTimeout(() => set新来的([]), 2000);
    return () => clearTimeout(t);
  }, [行]);

  /*
    浏览器里分页（不给 分页）时第几页、每页几条记在这里（11-17 渠道页报上来：底部「条/页」换了没反应）。
    原来分页对象里写死 pageSize: 20，antd 把它当受控值，换了每页条数下一轮又被 20 盖回去。
    换每页条数回第一页：停在第 5 页换成 100 条/页，人要看的是从头开始的那一屏
  */
  const [本地页, set本地页] = useState({ 当前: 1, 每页: 默认每页 });
  const 换页 = (旧每页: number, 翻: (页: number, 每页: number) => void) => (页: number, 每页: number) => 翻(每页 !== 旧每页 ? 1 : 页, 每页);

  const [列单开着, set列单开着] = useState(false);
  const 可选的 = useMemo(() => 全部列.filter((c) => !c.常驻), [全部列]);
  /** 列设置里记的键（列键 ↔ 存键，没写 存键 的两边一样） */
  const 存键们 = useMemo(() => new Map(可选的.map((c) => [列键(c), c.存键 ?? 列键(c)])), [可选的]);
  const 默认可见 = useMemo(() => 可选的.filter((c) => c.默认 !== false).map((c) => c.存键 ?? 列键(c)), [可选的]);
  /** 列设置存在这台机器上，一页一份。丢了就回到默认那套，不影响用 */
  const [存的, 存列] = useLocalPref<string[] | null>(`list-cols:${页}`, null);

  /*
    存完之后新加的列：存的时候还不存在，按它自己的默认值补上，不然加了列的人永远看不到新列。
    藏起来的默认列记成「-键」，不然它也被当成新加的列补回来、永远藏不住（见 lib/list-select 的 算可见列）
  */
  const 锁定的 = useMemo(() => 可选的.filter((c) => c.锁定).map((c) => c.存键 ?? 列键(c)), [可选的]);
  /** 按存键算的可见（存的里认不出的老键原样带着，切列时照旧存回去）；可见 = 换回列键、只留眼下有的列 */
  const 可见存 = useMemo(() => {
    const 算 = 存的 ? 算可见列(可选的.map((c) => ({ 键: c.存键 ?? 列键(c), 默认显示: c.默认 !== false })), 存的) : 默认可见;
    return 锁定的.length ? [...new Set([...算, ...锁定的])] : 算;
  }, [存的, 默认可见, 可选的, 锁定的]);
  const 可见 = useMemo(() => {
    const 显示 = new Set(可见存);
    return 可选的.filter((c) => 显示.has(c.存键 ?? 列键(c))).map(列键);
  }, [可见存, 可选的]);

  function 切列(k: string, 显示: boolean) {
    const 键 = 存键们.get(k) ?? k;
    if (锁定的.includes(键)) return;
    存列(切换后存(可见存, 存的, 键, 显示));
    if (显示) 待露.current = k;
  }

  /**
   * 刚勾上的那一列挪进视野。1120 宽时默认几列加起来就比表格框宽（客户表 1012 对 804），
   * 新勾的列落在横滚区外面，表格看上去纹丝不动——教程「勾上签约金额」那一步录出来就是这样。
   * 只挪到刚好露出来，左右都要让开固定列：右边是操作列，左边是勾选框和名字列。
   * 算法在 lib/list-select.ts 的 露出这一列，单测钉着。
   */
  const 表框 = useRef<HTMLDivElement>(null);
  /*
    取数中（换筛选、翻页、排序：地址栏变了等服务端那一屏）先出骨架行（原型 cu.filter「先出骨架再换内容」），不再整表转圈：
    表头、行数、行高、分页都不动，每一格换成一条灰条（PR2 的 Skeleton）。行高量的是取数前那一屏的第一行，取数中按它撑住，
    骨架行比真行矮也不往上缩。原来就没有行（上一屏筛出 0 条）时摆三行占位
  */
  useLayoutEffect(() => {
    if (加载中) return;
    const 框 = 表框.current;
    const 行高 = 框?.querySelector<HTMLElement>(".ant-table-tbody > tr.ant-table-row")?.offsetHeight;
    if (框 && 行高) 框.style.setProperty("--list-row-h", `${行高}px`);
  });
  /*
    回来还原（29R）：勾选一变就记下；挂上之后（数据到了、不在骨架里）按这个地址读回一次勾选和横滚位置。
    「记」写在「读回」前面：两个 effect 按书写顺序跑，挂上那一轮还没读回，不能先拿空勾选把存的盖掉
  */
  const 还原键 = 回来还原 ? 页 : null;
  // 判「是不是回来」用 usePathname，不用 window.location（Next 提交阶段才改地址栏，#381 复审）
  const pathname = usePathname() ?? "";
  const 读回过 = useRef(false);
  /** 横滚正在还原：这时的 scroll 事件是还原自己设的、或左栏展开时被夹出来的，不记（#381 实操） */
  const 横滚还原中 = useRef(false);
  const 停横滚还原 = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!还原键 || !读回过.current) return;
    记勾选(还原键, 当前列表地址(), 选中);
  }, [还原键, 选中]);
  useEffect(() => {
    if (!还原键 || 读回过.current || 加载中) return;
    读回过.current = true;
    // 从左栏、首页点进来不还原（和地址栏里的筛选一样回默认）；之后勾的照常记。
    // 不还原时把这张表记的也清掉：不然接着一刷新（刷新算回来）旧勾选、横滚、本地页又冒出来，勾选还会被算进批量（#381 复审）
    if (!进来可还原(pathname)) return void 清勾选(还原键);
    const 记的 = 读勾选(还原键, 当前列表地址());
    if (!记的) return;
    // 这会儿不让勾的行（变成只读了）不还原成勾着，不然会被算进批量
    const 留 = 只留当前行(记的.ids, 行.filter((r) => !不可勾?.(r)).map((r) => r.id));
    // 不支持多选的表只还原横滚
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage 只有到了浏览器里才读得到（服务端那一版没有勾选），挂上只读这一次
    if (留.length && 批量) set选中(留);
    if (记的.本地 && 分页 === undefined) set本地页(记的.本地);
    /*
      还原的勾选是按手上这份（可能是路由缓存里的旧）数据过滤的：浏览器后退、60 秒内点「回到…」都直接用缓存那一屏，
      期间组织架构改了（改了上级，行变只读）也看不出来。有勾选还原出来就顺手要一份新的，新行到了上面「行一换」那段按可勾再滤一遍（#381 实操）
    */
    if (留.length && 批量) router.refresh();
    if (记的.x > 0) {
      /*
        横滚：从客户详情回来左栏正从图标窄栏展开、表格框在几帧里变窄，第一帧就设会被当时的最大值夹小、再被 scroll 事件记回去（#381 实操：1366 宽 120 → 0）。
        滚到目标、尺寸稳住才算完（lib/hscroll-restore.ts），完之前 scroll 事件不记；这时已经卸了就找不到框，什么也不做
      */
      横滚还原中.current = true;
      停横滚还原.current = 横滚回(
        () => 表框.current?.querySelector<HTMLElement>(".ant-table-content"),
        记的.x,
        (怎么停的) => {
          横滚还原中.current = false;
          停横滚还原.current = null;
          /*
            滚到头也没到目标（列少了、框变宽了，最长时长到了才停）：还原期间 scroll 事件不记，存的还是够不着的老值；
            把眼下实际停的位置记一次，之后刷新照这个还原（PR #384 审查）。人动了的不用补：收尾在人那一下的 scroll 事件之前，那一下照常记
          */
          if (怎么停的 !== "超时") return;
          const 框 = 表框.current?.querySelector<HTMLElement>(".ant-table-content");
          if (框) 记横滚(还原键, 当前列表地址(), 框.scrollLeft);
        },
      );
    }
    // 只在挂上、数据到了那一下读回；批量 是每次渲染新给的函数，不跟着它重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [还原键, 加载中, 行]);
  /*
    卸了就停（还原中的那一圈 rAF 不留着），也把「读回过」复位：开发版严格模式挂上 → 卸 → 再挂上，第一次挂上读回过、
    横滚还原被这里停掉，不复位的话再挂上那次以为读过了，横滚和勾选都不还原（PR #384 审查）。真卸了 ref 跟着没了，复位不碍事
  */
  useEffect(() => () => {
    停横滚还原.current?.();
    读回过.current = false;
  }, []);
  // 表格横着滚了就记位置（隔 150ms 写一次）。scroll 不冒泡，在外框上用捕获阶段听表格里那个横滚框
  useEffect(() => {
    const 框 = 表框.current;
    if (!还原键 || !框) return;
    let 定时: number | undefined;
    const 记 = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || !el.classList.contains("ant-table-content") || 定时 !== undefined || 横滚还原中.current) return;
      定时 = window.setTimeout(() => {
        定时 = undefined;
        if (横滚还原中.current) return;
        记横滚(还原键, 当前列表地址(), el.scrollLeft);
      }, 150);
    };
    框.addEventListener("scroll", 记, true);
    return () => {
      框.removeEventListener("scroll", 记, true);
      if (定时 !== undefined) window.clearTimeout(定时);
    };
  }, [还原键]);

  /** 刚勾上、等渲染出来再挪的那一列。放 ref 里、在下面的 effect 里挪：那时新列已经在 DOM 里了 */
  const 待露 = useRef<string | null>(null);
  function 挪到看得见(k: string) {
    const 框 = 表框.current?.querySelector<HTMLElement>(".ant-table-content");
    const th = 表框.current?.querySelector<HTMLElement>(`th.dl-col-${CSS.escape(k)}`);
    if (!框 || !th) return;
    // antd 6 的固定列叫 fix-start / fix-end（5 叫 fix-left / fix-right），都认
    const 宽 = (sel: string) => [...框.querySelectorAll<HTMLElement>(`thead th:is(${sel})`)].reduce((s2, x) => s2 + x.offsetWidth, 0);
    const 到 = 露出这一列({
      滚到: 框.scrollLeft,
      框宽: 框.clientWidth,
      列左: th.offsetLeft,
      列宽: th.offsetWidth,
      左固定: 宽(".ant-table-cell-fix-start, .ant-table-cell-fix-left"),
      右固定: 宽(".ant-table-cell-fix-end, .ant-table-cell-fix-right"),
    });
    // 直接跳过去，不做平滑滚动：表格随即还会重排一次，平滑那一下会被打断，停在原地
    if (到 !== null) 框.scrollLeft = 到;
  }

  /**
   * antd 勾选框自带的读屏名是英文「Select all / Select row」，念出来对不上是哪一行。
   * 换成「选中 + 这一行叫什么」，叫不出名字的念「选中这一行」（10-27 整合第 8 条）
   */
  const 勾选框标签 = {
    getTitleCheckboxProps: () => ({ "aria-label": "全选本页" }),
    getCheckboxProps: (r: T) => ({
      ...(不可勾?.(r) ? { disabled: true } : {}),
      "aria-label": 行名(r) ? `选中 ${行名(r)}` : "选中这一行",
    }),
  };

  const 屏 = Grid.useBreakpoint();
  /*
    手机宽（< 768，md 明确为 false 才算；服务端那一版还不知道多宽，照电脑画）：两边固定列把中间挤得只剩一条缝（#381 实操：390 宽客户列表
    左边勾选 + 客户名钉到 244px、右边操作列从 322px 起，中间 78px，150 宽的号码列怎么横滚都只露一截）。
    名字列收到 手机名字宽（一行省略、悬停看全照旧）；右边固定的列写了 手机不钉 的才不钉、跟着横滚到最后（要用滚到最右；点行进详情照旧）。
    没写的照钉：PR #384 第一版一律不钉，线索列表的操作列（分配按钮、批量自动分配的结果格）在 375 宽被推到 930–1068px，看不见
  */
  const 手机 = 屏.md === false;
  /** 补宽列多给的宽（见 补宽列）；量的时候要减掉它才是「不补时」的位置。没给补宽列、手机宽时不算 */
  const [量得补宽, set补宽] = useState(0);
  const 补宽 = 补宽列 && !手机 ? 量得补宽 : 0;
  const 显示的列 = useMemo(
    () =>
      全部列
        .filter((c) => c.常驻 || 可见.includes(列键(c)))
        .map((c, i) => ({
          ...c,
          // 第一列就是「这一行是谁」（客户 / 线索 / 商机 / 渠道 / 联系人的名字），钉在左边。
          // 只钉常驻的：能被收进「列」里的列不该当名字
          ...(i === 0 && c.常驻 && !c.fixed ? { fixed: "left" as const, ...(手机 && typeof c.width === "number" && c.width > 手机名字宽 ? { width: 手机名字宽 } : {}) } : {}),
          ...(手机 && c.手机不钉 && (c.fixed === "right" || c.fixed === "end") ? { fixed: undefined } : {}),
          ...(补宽 && 列键(c) === 补宽列 && typeof c.width === "number" ? { width: c.width + 补宽 } : {}),
          // 带上列键做类名，挪到看得见 靠它找表头
          // 折行：备注这类长文照旧折行；操作列（表头空）按钮不截
          className: [c.className, `dl-col-${列键(c)}`, c.折行 ? "dl-wrap" : "", c.title === "" ? "dl-act" : ""].filter(Boolean).join(" "),
          // 操作列表头是空的，读屏念到这一格只有「列标题」；看不见的「操作」两个字给读屏用（10-27 整合第 8 条）
          ...(c.title === "" ? { title: <span className="sr-only">操作</span> } : {}),
        })),
    [全部列, 可见, 手机, 补宽, 补宽列],
  );
  /*
    补宽列：量表头。表格坐标 = 相对 <table> 左沿（横滚了也一样）；钉住的操作列左沿 = 框宽 − 右钉住各格宽。
    框变宽变窄（拖窗口、左栏收起）重量一次；列变了（勾列、名字列跟数据变宽）也重量。
    ResizeObserver 一挂上就先回调一次，第一次量也走它。当前补了多少按表头实量（这一格的宽 − 列定义的宽），不靠记下来的值：
    手机宽 ↔ 电脑宽来回切时记的值会和画出来的对不上
  */
  useEffect(() => {
    if (!补宽列 || 手机) return;
    const 外 = 表框.current;
    if (!外) return;
    const 定宽 = 全部列.find((c) => 列键(c) === 补宽列)?.width;
    if (typeof 定宽 !== "number") return;
    const 算 = (): number | null => {
      const 框 = 外.querySelector<HTMLElement>(".ant-table-content");
      const 表 = 框?.querySelector<HTMLTableElement>(":scope > table");
      if (!框 || !表) return null;
      const 格们 = [...表.querySelectorAll<HTMLElement>(":scope > thead > tr > th")];
      const 起 = 格们.findIndex((th) => th.classList.contains(`dl-col-${补宽列}`));
      if (起 < 0) return 0;
      const 现 = Math.max(0, Math.round(格们[起].getBoundingClientRect().width - 定宽));
      // 不补时也没横滚（列加起来没框宽）：没有被压的，不补
      if (框.scrollWidth - 现 <= 框.clientWidth + 1) return 0;
      const 钉 = (th: HTMLElement) => th.classList.contains("ant-table-cell-fix-end") || th.classList.contains("ant-table-cell-fix-start");
      const 界 = 框.clientWidth - 格们.filter((th) => th.classList.contains("ant-table-cell-fix-end")).reduce((w, th) => w + th.getBoundingClientRect().width, 0);
      const 表左 = 表.getBoundingClientRect().left;
      const 字 = 格们.slice(起 + 1).filter((th) => !钉(th)).flatMap((th) => {
        const r = document.createRange();
        r.selectNodeContents(th.querySelector(".ant-table-column-title") ?? th);
        const b = r.getBoundingClientRect();
        return b.width > 0 ? [{ 左: b.left - 表左 - 现, 右: b.right - 表左 - 现 }] : [];
      });
      const 渐隐 = parseFloat(getComputedStyle(外).getPropertyValue("--edge-fade")) || 24;
      return 躲开钉住列补宽(字, 界, 渐隐, 160);
    };
    const 量 = () => { const d = 算(); if (d !== null) set补宽(d); };
    const 看 = new ResizeObserver(量);
    看.observe(外);
    return () => 看.disconnect();
  }, [补宽列, 手机, 全部列, 可见]);
  useEffect(() => {
    if (!待露.current) return;
    挪到看得见(待露.current);
    待露.current = null;
  });

  /**
   * 表格自己的最小宽度。不给就按显示中的列宽加起来算。
   * 必须有一个值：没有它，列一多就把**整页**撑出横向滚动条；
   * 有了它，超出的部分在表格自己的框里横滚，页面不动。
   * 带 responsive 的列在窄窗口下 antd 不画，这里也不算它的宽（10-27），不然收了列照样要左右拖
   */
  const x = 横向 ?? 显示的列
    .filter((c) => !c.responsive || c.responsive.some((bp) => 屏[bp]))
    .reduce((s2, c) => s2 + (typeof c.width === "number" ? c.width : 120), 0);

  return (
    <div className={[单行 ? "list dl-one-line" : "list", 加载中 ? "list-skel-on" : ""].filter(Boolean).join(" ")} ref={表框} aria-busy={加载中 || undefined}>
      {加载中 && <span className="sr-only" role="status">正在加载</span>}
      {/* 工具栏只有一条：搜索 + 筛选在左，列设置顶到最右（设计稿 10-17 的六张列表页都是这个形）。
          主动作（新建 / 记录）不在这儿，它在页头右上角——那是全站找它的地方，
          列表页不该把它藏在筛选中间。 */}
      {!空库 && (
        <div className="list-bar">
          {筛选}
          <span className="list-bar-gap" />
          {排序钮}
          {可选的.length > 0 && 替表格 === undefined && (
            /*
              勾一项**不关**这张单子：选列天然是连着点好几下的事，
              点一下关一次等于每改一列都要重新打开。
              antd 默认菜单项点完就收，所以这里受控：来源是 menu 的关闭一律不理，
              只认「再点一次按钮」和「点到外面」（那两种来源都是 trigger）。
            */
            <Dropdown
              trigger={["click"]}
              open={列单开着}
              onOpenChange={(开, info) => {
                if (!开 && info.source === "menu") return;
                set列单开着(开);
              }}
              menu={{
                // 常驻又锁定的（第一列「项目」）也列出来、灰着勾上：人一眼看得到哪几列是定死的
                items: 全部列.filter((c) => !c.常驻 || c.锁定).map((c) => {
                  const k = 列键(c);
                  return {
                    key: k,
                    label: (
                      <Checkbox checked={c.常驻 || 可见.includes(k)} disabled={c.锁定} onChange={(e) => 切列(k, e.target.checked)}>
                        {c.列名 ?? String(c.title)}
                      </Checkbox>
                    ),
                  };
                }),
              }}
            >
              <Button icon={<SettingOutlined />} aria-label="选择要显示的列">列</Button>
            </Dropdown>
          )}
        </div>
      )}

      {汇总}

      {替表格 !== undefined ? 替表格 : (<>
      {/* 批量工具条：勾了才出现，而且要说清「已选 N 条」——不说人对不上自己勾了几条 */}
      {批量 && !浮起操作条 && 选中.length > 0 && (
        <div className="list-sel">
          <b>已选 {选中.length} 条</b>
          {批量(选中, () => set选中([]), 选中行)}
          <button type="button" className="list-sel-x" onClick={() => set选中([])}>
            取消选择
          </button>
        </div>
      )}

      <Table<T>
        rowKey="id"
        size="middle"
        dataSource={加载中 && 行.length === 0 ? 占位行 : 行}
        columns={显示的列}
        components={加载中 ? 骨架格 : undefined}
        onChange={(_, __, sorter, extra) => {
          if (extra.action !== "sort" || !排序) return;
          const current = Array.isArray(sorter) ? sorter[0] : sorter;
          排序(String(current?.columnKey ?? ""), current?.order ?? null);
        }}
        loading={false}
        /*
          筛出 0 条 ≠ 空库（2026-10-02 排查 H5）：原来一律画空库引导「还没有… / 新建第一位 / 从 Excel 导入 / 演示数据」，
          人筛了一下就以为数据没了。在筛的时候只说没对上，指一条回去的路（筛选栏上的「重置」）
        */
        locale={{
          emptyText: 空库 ? <EmptyState {...空态} /> : (没对上 ?? <div className="list-none">没有符合条件的，换个条件或点「重置」看全部</div>),
        }}
        scroll={{ x }}
        expandable={展开}
        rowSelection={批量 ? { selectedRowKeys: 选中, onChange: (k) => set选中(k as string[]), fixed: true, ...勾选框标签 } : undefined}
        rowClassName={(r) => [新来的.includes(r.id) || 亮?.includes(r.id) ? "row-fresh" : "", 去页.pending && 去的行 === r.id ? "row-going" : "", 行类?.(r) ?? ""].filter(Boolean).join(" ")}
        onRow={
          行链接 || 行点击
            ? (r) => {
              // 行链接给了空串、又没有 行点击 的行：点不动（11-04 P-看-06 市场角色「只看进度」的行），不预取、不变手形
              const 链 = 行链接?.(r);
              if (链 === "" && !行点击) return {};
              return {
                onClick: (e) => {
                  // 点在按钮、链接、勾选框上时不算「点这一行」
                  if ((e.target as HTMLElement).closest("a, button, .ant-checkbox-wrapper, .ant-select, .ant-dropdown-trigger")) return;
                  // 行里弹出的下拉菜单挂在 body 上，点它的事件照样冒到这一行（React 传送门）：不在这一行里的点击不算
                  // （11-03 B2-10：公海行「⋯ → 分配给…」点二级菜单标题跳了客户页）
                  if (!e.currentTarget.contains(e.target as Node)) return;
                  const 去 = 行链接?.(r);
                  if (去) {
                    // 点的那一行立刻高亮，新页没到之前顶上的条亮（跳转优化 PR-A，lib/nav-pending.ts）
                    set去的行(r.id);
                    去页.push(去);
                  }
                  else 行点击?.(r);
                },
                // 停在哪一行就先把那一页整页取回来，点下去不用再等服务器（10-27，lib/prefetch-full）
                onMouseEnter: 链 ? () => 预取.进(链) : undefined,
                onMouseLeave: 链 ? 预取.出 : undefined,
                // 手机、平板：手指按下去就取（PR-B 11-25）
                onTouchStart: 链 ? (e) => 预取.触(链, e) : undefined,
                style: { cursor: "pointer" },
              };
            }
            : undefined
        }
        pagination={
          加载中 && 行.length === 0 ? false :
          /* 总数换了（筛选、翻页签）：新数回来前留旧数，回来直接换（11-26，不滚，见上面 总数） */
          分页 === false
            ? false
            : 分页
              ? {
                  current: 分页.当前页,
                  pageSize: 分页.每页,
                  total: 分页.总数,
                  showTotal: (t) => (分页.单位 ? 分页.单位(总数(t)) : <>共 {总数(t)} 条</>),
                  showSizeChanger: true,
                  onChange: 换页(分页.每页, 分页.翻页),
                }
              : {
                  current: 本地页.当前,
                  pageSize: 本地页.每页,
                  onChange: 换页(本地页.每页, (当前, 每页) => {
                    set本地页({ 当前, 每页 });
                    if (还原键) 记本地页(还原键, 当前列表地址(), 当前, 每页);
                  }),
                  // 截断时 `t` 是取回来的行数，不是库里的总数——别让它冒充总数
                  showTotal: (t) => (真截断 ? <>这里 {总数(t)} 条</> : <>共 {总数(t)} 条</>),
                  showSizeChanger: true,
                }
        }
      />
      {批量 && 浮起操作条 && 选中.length > 0 && (
        <div className="list-sel list-sel-float" role="toolbar" aria-label="批量操作">
          {/* 数字换了就换 key：重放一下跳动（.list-sel-n） */}
          <b><span key={选中.length} className="list-sel-n">{选中.length}</span> 位已选</b>
          {批量(选中, () => set选中([]), 选中行)}
          <button type="button" className="list-sel-x list-sel-float-x" aria-label="取消选择" title="取消选择" onClick={() => set选中([])}>
            ×
          </button>
        </div>
      )}
      </>)}
      {真截断 && (
        <div className="muted" style={{ fontSize: 13, marginTop: 8, textAlign: "right" }}>
          这里只有最近 {取回} 条，库里一共 {截断.总数} 条{截断.说明 ? `。${截断.说明}` : "——用上面的筛选缩小范围"}
        </div>
      )}
    </div>
  );
}
