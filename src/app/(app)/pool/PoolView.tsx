"use client";

/**
 * 企业版统一公海（2026-10-29，P7）：客户公海 + 项目公海一张表。
 * 上面一排（10-31 晚定：入池方式、排序、搜索和属性放同一行）：公海属性（全部 / 线索池 / 商机池 / 其他，带数，全部 = 三者之和；
 * 属性块自己不折行，窄了横向滚）、入池方式下拉（带数和一行说明，M-公海-09 原「入池原因」改名）、排序、搜索；整排太窄才把后面几个挤到下一行
 * 表里「入池原因」一列 = 退回时选的原因（M-公海-09）；「当前进程」一列 = 节点 · 状态，「其他」类前面带阶段（U-公海-04）
 * 条件都在地址栏（useUrlFilters），服务端筛排分页；规矩见 lib/enterprise/unified-pool.ts
 *
 * 10-30 交互改版：领取、分配都带 6 秒撤销（规则 B）；老板、主管行内「⋯」和批量里有「分配给…」，业务员没有；
 * 领取灰着时原因写在按钮下面（规则 A）；持有上限开着时页头写「我手上 N / 上限 M」；批量有没领到的，提示条能展开看每一条为什么
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Dropdown, Segmented, Select, Space, Tag } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import DataList, { type 列 } from "@/components/DataList";
import ListSearch from "@/components/ListSearch";
import ResetFilters from "@/components/ResetFilters";
import { PageHead, RowLink } from "@/components/ui";
import { smartTime, 成员选项, type 可选成员 } from "@/lib/utils";
import { useUrlFilters } from "@/lib/url-filters";
import { 带走说法 } from "@/lib/carry-over";
import { 公海规则, 原负责人不能领回提示, 项目不能单独领提示 } from "@/lib/enterprise/pool-rules";
import { 公海属性们, 快捷们, 有数才出的快捷, 排序们, 默认排序, 多次退回起, 没原因, type 公海行, type 公海属性, type 快捷 } from "@/lib/enterprise/unified-pool";
import { 领取, 分配公海, 撤销公海, type 公海结果 } from "../customers/pool-actions";
import { 领取项目 } from "../projects/actions";
import { 标无效客户, 恢复有效客户, 分配公海项目, 撤销公海项目 } from "./actions";

type Props = {
  行: 公海行[];
  总数: number;
  当前页: number;
  pageSize: number;
  快捷数: Record<快捷, number>;
  属性数: Record<公海属性 | "全部", number>;
  截断: boolean;
  库里有: boolean;
  filters: { keyword: string; attr: string; quick: string; sort: string };
  /** 老板、主管 */
  能标无效: boolean;
  /** 只有老板 */
  能恢复: boolean;
  /** 老板、主管：行内和批量里有「分配给…」 */
  能分配: boolean;
  /** 分配给谁（能分配时才有） */
  users: 可选成员[];
  /** 持有上限开着、我不是不限：手上几个（同 超上限 的口径） / 上限几个；没开为 null */
  持有: { 有: number; 上限: number } | null;
};

/** 项目行操作列里的短说法（整句「项目不能单独领提示」在悬停里） */
const 项目不能单独领短说 = "要连客户一起领";

const 属性色: Record<公海属性, string> = { 线索池: "green", 商机池: "blue", 其他: "default" };

/** 入池方式下拉里每一项的一行说明（规则 C）：「多次退回」的门槛是常量，跟着改 */
const 快捷说明: Record<快捷, string> = {
  超时回收: "太久没跟进，系统自动收回来的",
  首次退回: "被同事主动放回公海，累计第 1 次",
  二次退回: "被同事主动放回公海，累计第 2 次",
  三次退回: "被同事主动放回公海，累计第 3 次",
  多次退回: `被同事主动放回公海，累计 ${多次退回起} 次及以上`,
  无效客户: "老板或主管标了无效：领不了，老板能恢复",
  离职交接: "成员停用时交接方式选了放进公海",
};

const 无效原因 = "标了无效，要老板先恢复";

const 行名 = (r: 公海行) => r.客户名 ?? r.项目名 ?? "这一行";

/** 领取 / 分配的提示条正文：没领到的能展开看每一条为什么 */
function ResultBar({ 文案, 没领到, 撤销 }: { 文案: string; 没领到: { 名: string; 原因: string }[]; 撤销?: () => void }) {
  const [展开, set展开] = useState(false);
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", textAlign: "start" }}>
      <span>
        {文案}
        {没领到.length > 0 && <Button type="link" size="small" onClick={() => set展开(!展开)}>{展开 ? "收起" : "看原因"}</Button>}
        {撤销 && <Button type="link" size="small" onClick={撤销}>撤销</Button>}
      </span>
      {展开 && (
        <ul style={{ margin: "4px 0 0", paddingInlineStart: 18, maxHeight: 220, overflowY: "auto" }}>
          {没领到.map((x, i) => <li key={i} className="muted">{x.名}：{x.原因}</li>)}
        </ul>
      )}
    </span>
  );
}

export default function PoolView({ 行, 总数, 当前页, pageSize, 快捷数, 属性数, 截断, 库里有, filters, 能标无效, 能恢复, 能分配, users, 持有 }: Props) {
  const router = useRouter();
  const { message, modal } = App.useApp();
  const { f, setF, apply, 翻页, reset, pending } = useUrlFilters("/pool", filters, pageSize);
  const 在筛 = !!(f.keyword || f.attr || f.quick || f.sort);
  const 到上限 = !!持有 && 持有.有 >= 持有.上限;
  const 分给谁 = 成员选项(users);

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
   * 领取 / 分配一行或几行：客户行一次交给 领取 / 分配公海，项目行逐个领（领取项目）或一次分（分配公海项目）。
   * 提示条说清领到几个、几个没领到（能展开看原因），带一次撤销：客户行走 撤销公海，项目行走 撤销公海项目
   */
  async function 动手(动作: "领取" | "分配", 们: 公海行[], 给?: string) {
    const 客户们 = 们.filter((r) => r.种 === "客户");
    const 项目们 = 们.filter((r) => r.种 === "项目" && r.projectId);
    const 没领到: { 名: string; 原因: string }[] = [];
    let 客户res: 公海结果 | null = null;
    if (客户们.length) {
      客户res = 动作 === "领取" ? await 领取(客户们.map((r) => r.customerId)) : await 分配公海(客户们.map((r) => r.customerId), 给!);
      const 到 = new Set(客户res.ok ? (客户res.原负责人 ?? []).map((x) => x.id) : []);
      for (const r of 客户们) {
        if (到.has(r.customerId)) continue;
        没领到.push({
          名: 行名(r),
          原因: !客户res.ok ? 客户res.error : r.类 === "无效" ? 无效原因 : 动作 === "领取" && r.原负责人是我 ? 原负责人不能领回提示 : "已经被别人领走了",
        });
      }
    }
    const 项目到: string[] = [];
    let 给谁: { id: string; name: string } | undefined = 客户res?.ok ? 客户res.给谁 : undefined;
    if (项目们.length && 动作 === "领取") {
      for (const r of 项目们) {
        const res = await 领取项目(r.projectId!);
        if (res.ok) 项目到.push(r.projectId!);
        else 没领到.push({ 名: 行名(r), 原因: res.error });
      }
    } else if (项目们.length) {
      const res = await 分配公海项目(项目们.map((r) => r.projectId!), 给!);
      if (res.ok) {
        给谁 = res.给谁;
        项目到.push(...res.分到);
        for (const x of res.没分到) 没领到.push({ 名: 行名(项目们.find((r) => r.projectId === x.id)!), 原因: x.原因 });
      } else for (const r of 项目们) 没领到.push({ 名: 行名(r), 原因: res.error });
    }
    router.refresh();
    const 客户到 = 客户res?.ok ? 客户res.updated : 0;
    const 到数 = 客户到 + 项目到.length;
    if (!到数) {
      if (们.length === 1) return void message.error(没领到[0]?.原因 ?? "没领到，刷新看看");
      return void message.error({ content: <ResultBar 文案={`${动作 === "领取" ? "一个都没领到" : "一个都没分出去"}`} 没领到={没领到} />, duration: 6 });
    }
    const 带走 = 客户res?.ok ? 带走说法(客户res.带走) : "";
    const 文案 = 动作 === "领取"
      ? (们.length === 1 ? `已领取「${行名(们[0])}」${带走}` : 没领到.length ? `领到 ${到数} 个，${没领到.length} 个没领到` : `已领取 ${到数} 个${带走}`)
      : (们.length === 1 ? `已把「${行名(们[0])}」分给 ${给谁?.name ?? "同事"}${带走}` : `已分给 ${给谁?.name ?? "同事"} ${到数} 个${没领到.length ? `，${没领到.length} 个没分出去` : ""}`);
    const key = `pool-${动作}-${们[0].id}-${们.length}`;
    const 撤销 = async () => {
      message.destroy(key);
      let 撤了 = 0;
      let 错: string | null = null;
      if (客户res?.ok && 客户到) {
        const r = await 撤销公海(动作, 客户res.原负责人 ?? [], 客户res.带过来, 客户res.给谁?.id, 客户res.公海项目);
        if (r.ok) 撤了 += r.updated; else 错 = r.error;
      }
      if (项目到.length) {
        const r = await 撤销公海项目(动作, 项目到, 给谁?.id);
        if (r.ok) 撤了 += r.updated; else 错 = r.error;
      }
      router.refresh();
      if (错) return void message.error(`没能撤销：${错}`);
      if (!撤了) return void message.info("没撤成：已经有人动过了");
      message.success(撤了 === 到数 ? "已撤销，放回公海了" : `已撤销 ${撤了} 个，其余已经有人动过了`);
    };
    message.open({ key, type: 没领到.length ? "warning" : "success", duration: 6, content: <ResultBar 文案={文案} 没领到={没领到} 撤销={撤销} /> });
  }

  function 标记(r: 公海行, 动作: "无效" | "恢复") {
    modal.confirm({
      title: 动作 === "无效" ? `把「${行名(r)}」标成无效客户？` : `把「${行名(r)}」恢复成有效客户？`,
      content: 动作 === "无效" ? "标了以后谁都领不了，只有老板能恢复" : "恢复后留在公海里，谁都能领",
      okText: 动作 === "无效" ? "标无效" : "恢复",
      cancelText: "取消",
      onOk: async () => {
        const res = 动作 === "无效" ? await 标无效客户([r.customerId]) : await 恢复有效客户([r.customerId]);
        router.refresh();
        if (!res.ok) return void message.error(res.error);
        if (!res.updated) return void message.info(动作 === "无效" ? "已经是无效客户，或者已被领走" : "已经恢复过了");
        message.success(动作 === "无效" ? `已把「${行名(r)}」标成无效客户` : `已恢复「${行名(r)}」，现在能领了`);
      },
    });
  }

  /** 行末「⋯」：分配给…（老板、主管）、标无效 / 恢复。都没有就不放 */
  function 更多(r: 公海行): MenuProps["items"] {
    const 无效 = r.类 === "无效";
    const items: NonNullable<MenuProps["items"]> = [];
    if (能分配 && !无效 && 分给谁.length) {
      items.push({
        key: "分配", label: "分配给…",
        children: 分给谁.map((o) => ({ key: `给-${o.value}`, label: o.label, onClick: () => void 动手("分配", [r], o.value) })),
      });
    }
    if (r.种 === "客户" && !无效 && 能标无效) items.push({ key: "无效", label: "标成无效客户", onClick: () => 标记(r, "无效") });
    if (r.种 === "客户" && 无效 && 能恢复) items.push({ key: "恢复", label: "恢复成有效客户", onClick: () => 标记(r, "恢复") });
    return items;
  }

  const 列们: 列<公海行>[] = [
    {
      title: "公海属性", key: "属性", width: 96, 常驻: true,
      render: (_, r) => <Tag color={属性色[r.属性]} style={{ marginInlineEnd: 0 }}>{r.属性}</Tag>,
    },
    {
      title: "客户名称", key: "客户", width: 168,
      render: (_, r) => r.客户名
        ? <RowLink href={`/customers/${r.customerId}`} className="link-strong fulltext" title={r.客户名}>{r.客户名}</RowLink>
        : <span className="muted">领取后可见</span>,
    },
    {
      title: "项目名称", key: "项目", width: 168,
      render: (_, r) => r.项目名
        ? (r.projectId && r.种 === "项目"
          ? <RowLink href={`/projects/${r.projectId}`} className="fulltext" title={r.项目名}>{r.项目名}</RowLink>
          : <span className="fulltext" title={r.项目名}>{r.项目名}</span>)
        : <span className="muted">还没有项目</span>,
    },
    {
      title: "当前进程", key: "进程", width: 150,
      // 名下不止一个项目的客户：格子里是定状态用的那个，悬停看每个项目
      render: (_, r) => r.进程 ? <span className="clamp" title={r.进程明细 ?? r.进程}>{r.进程}</span> : <span className="muted">—</span>,
    },
    {
      title: "最后跟进", key: "跟进", width: 104, responsive: ["xl"],
      render: (_, r) => r.最后跟进 ? <span className="nowrap" title={new Date(r.最后跟进).toLocaleString()}>{smartTime(r.最后跟进)}</span> : <span className="muted">没跟进过</span>,
    },
    {
      title: "入池时间", key: "入池", width: 104,
      render: (_, r) => <span className="nowrap" title={new Date(r.入池时间).toLocaleString()}>{smartTime(r.入池时间)}</span>,
    },
    {
      title: "入池原因", key: "原因", width: 140,
      // 退回原因（M-公海-09）；标了无效的前面多一个红标，原因照旧写（无效是入池方式，不是原因）
      render: (_, r) => (
        <span className="clamp" title={r.类 === "无效" ? `无效客户：${r.入池原因}` : r.入池原因}>
          {r.类 === "无效" && <Tag color="red" style={{ marginInlineEnd: 4 }}>无效</Tag>}
          <span className={r.入池原因 === 没原因 ? "muted" : undefined}>{r.入池原因}</span>
        </span>
      ),
    },
    {
      title: "操作", key: "操作", width: 136, 常驻: true, fixed: "right",
      render: (_, r) => {
        const 因 = 领不了(r);
        const 菜单 = 更多(r);
        return (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0 }}>
            <Space size={2}>
              <Button className="row-act" aria-label={`领取 ${行名(r)}`} disabled={!!因} size="small"
                onClick={(e) => { e.stopPropagation(); void 动手("领取", [r]); }}>
                领取
              </Button>
              {!!菜单?.length && (
                <Dropdown trigger={["click"]} menu={{ items: 菜单, onClick: ({ domEvent }) => domEvent.stopPropagation() }}>
                  <Button className="row-act" aria-label={`更多操作 ${行名(r)}`} type="text" size="small" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
                </Dropdown>
              )}
            </Space>
            {/* 操作列只有 136 宽：长的那句（项目不能单独领）行内写短的，整句放悬停里 */}
            {因 && <span className="muted nowrap" style={{ fontSize: 12, lineHeight: "18px" }} title={因}>{因 === 项目不能单独领提示 ? 项目不能单独领短说 : 因}</span>}
          </div>
        );
      },
    },
  ];

  const 筛选 = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 8px", minWidth: 0 }}>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <Segmented
          aria-label="公海属性"
          style={{ whiteSpace: "nowrap" }}
          value={f.attr || "全部"}
          onChange={(v) => apply({ attr: v === "全部" ? "" : String(v) })}
          options={(["全部", ...公海属性们] as const).map((k) => ({ value: k, label: `${k} ${属性数[k]}` }))}
        />
      </div>
      <Select style={{ width: 150 }} aria-label="入池方式" placeholder="入池方式" allowClear
        popupMatchSelectWidth={260}
        value={f.quick || undefined}
        onChange={(v) => apply({ quick: v ?? "" })}
        // 离职交接只在有这种数据（或正选着）时出（A-14）
        options={快捷们.filter((k) => !有数才出的快捷.includes(k) || 快捷数[k] > 0 || f.quick === k).map((k) => ({ value: k, label: `${k} ${快捷数[k]}` }))}
        optionRender={(o) => (
          <div>
            <div>{o.label}</div>
            <div className="muted" style={{ fontSize: 12, whiteSpace: "normal" }}>{快捷说明[o.value as 快捷]}</div>
          </div>
        )}
      />
      <Select style={{ width: 132 }} aria-label="排序"
        value={f.sort || 默认排序}
        onChange={(v) => apply({ sort: v === 默认排序 ? "" : v })}
        options={排序们.map((o) => ({ value: o.value, label: `按${o.label}` }))}
      />
      <ListSearch
        value={f.keyword}
        onChange={(v) => setF({ ...f, keyword: v })}
        onSearch={(v) => apply({ keyword: v })}
        placeholder="搜客户名 / 项目名"
        width={200}
      />
      <ResetFilters 显示={在筛} onClick={reset} />
    </div>
  );

  return (
    <>
      <PageHead
        title="公海"
        subtitle="没人负责的客户和项目都在这里：领了就归你"
        extra={持有 ? <span className={到上限 ? "nowrap" : "muted nowrap"} style={到上限 ? { color: "var(--warning-text)" } : undefined}>我手上 {持有.有} / 上限 {持有.上限}</span> : undefined}
      />
      <DataList<公海行>
        页="pool"
        列={列们}
        行={行}
        空库={!库里有 && !在筛}
        空态={{ title: "公海是空的", hint: "超时没跟进、被退回的客户和项目会出现在这里", demo: false }}
        筛选={筛选}
        汇总={截断 ? <div className="muted" style={{ fontSize: 12 }}>公海里太多了，这里只列最近入池的一批；更早的请用搜索找</div> : undefined}
        批量={(选中, 清空, 选中行) => (
          <Space size={6} wrap>
            <Button size="small" onClick={async () => { await 动手("领取", 选中行); 清空(); }}>领取</Button>
            {能分配 && 分给谁.length > 0 && (
              <Dropdown trigger={["click"]} menu={{ items: 分给谁.map((o) => ({ key: o.value, label: o.label, onClick: async () => { await 动手("分配", 选中行, o.value); 清空(); } })) }}>
                <Button size="small">分配给…</Button>
              </Dropdown>
            )}
          </Space>
        )}
        加载中={pending}
        行链接={(r) => (r.种 === "项目" ? `/projects/${r.projectId}` : `/customers/${r.customerId}`)}
        行类={(r) => (r.类 === "无效" ? "row-off" : undefined)}
        分页={{ 当前页, 每页: pageSize, 总数, 翻页 }}
      />
    </>
  );
}
