"use client";

/**
 * 企业版统一公海（2026-10-29，P7）：客户公海 + 项目公海一张表。
 * 上面一排：公海属性（全部 / 公海客户 / 公海商机 / 公海线索，带数）、快捷按钮（带数，再点一下取消）、排序、搜索。
 * 条件都在地址栏（useUrlFilters），服务端筛排分页；规矩见 lib/enterprise/unified-pool.ts
 */
import { useRouter } from "next/navigation";
import { App, Button, Popconfirm, Segmented, Select, Space, Tag } from "antd";
import { StopOutlined, UndoOutlined, UserAddOutlined } from "@ant-design/icons";
import DataList, { type 列 } from "@/components/DataList";
import ListSearch from "@/components/ListSearch";
import ResetFilters from "@/components/ResetFilters";
import { PageHead, RowLink } from "@/components/ui";
import { smartTime } from "@/lib/utils";
import { useUrlFilters } from "@/lib/url-filters";
import { 带走说法 } from "@/lib/carry-over";
import { 原负责人不能领回提示 } from "@/lib/enterprise/pool-rules";
import { 公海属性们, 快捷们, 排序们, 默认排序, 多次退回起, type 公海行, type 公海属性, type 快捷 } from "@/lib/enterprise/unified-pool";
import { 领取 } from "../customers/pool-actions";
import { 领取项目 } from "../projects/actions";
import { 标无效客户, 恢复有效客户 } from "./actions";

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
};

const 属性色: Record<公海属性, string> = { 公海客户: "default", 公海商机: "blue", 公海线索: "green" };

/** 快捷按钮悬停说明：「多次退回」的门槛是常量，跟着改 */
const 快捷说明: Record<快捷, string> = {
  超时回收: "太久没跟进，系统自动收回来的",
  首次退回: "被同事主动退回公海，累计第 1 次",
  二次退回: "被同事主动退回公海，累计第 2 次",
  三次退回: "被同事主动退回公海，累计第 3 次",
  多次退回: `被同事主动退回公海，累计 ${多次退回起} 次及以上`,
  无效客户: "老板或主管标了无效：领不了，老板能恢复",
};

export default function PoolView({ 行, 总数, 当前页, pageSize, 快捷数, 属性数, 截断, 库里有, filters, 能标无效, 能恢复 }: Props) {
  const router = useRouter();
  const { message } = App.useApp();
  const { f, setF, apply, 翻页, reset, pending } = useUrlFilters("/pool", filters, pageSize);
  const 在筛 = !!(f.keyword || f.attr || f.quick || f.sort);

  async function 领这行(r: 公海行) {
    if (r.种 === "客户") {
      const res = await 领取([r.customerId]);
      router.refresh();
      if (!res.ok) return void message.error(res.error);
      if (!res.updated) return void message.info("已经被别人领走了，或者领不了");
      return void message.success(`已领取「${r.客户名 ?? "这位客户"}」${带走说法(res.带走)}`);
    }
    const res = await 领取项目(r.projectId!);
    router.refresh();
    if (!res.ok) return void message.error(res.error);
    message.success(`已领取项目「${r.项目名 ?? ""}」`);
  }

  async function 标记(r: 公海行, 动作: "无效" | "恢复") {
    const res = 动作 === "无效" ? await 标无效客户([r.customerId]) : await 恢复有效客户([r.customerId]);
    router.refresh();
    if (!res.ok) return void message.error(res.error);
    if (!res.updated) return void message.info(动作 === "无效" ? "已经是无效客户，或者已被领走" : "已经恢复过了");
    message.success(动作 === "无效" ? `已把「${r.客户名 ?? "这位客户"}」标成无效客户` : `已恢复「${r.客户名 ?? "这位客户"}」，现在能领了`);
  }

  const 列们: 列<公海行>[] = [
    {
      title: "公海属性", key: "属性", width: 96, 常驻: true,
      render: (_, r) => <Tag color={属性色[r.属性]} style={{ marginInlineEnd: 0 }}>{r.属性}</Tag>,
    },
    {
      title: "客户名称", key: "客户", width: 180,
      render: (_, r) => r.客户名
        ? <RowLink href={`/customers/${r.customerId}`} className="link-strong clamp" title={r.客户名}>{r.客户名}</RowLink>
        : <span className="muted" title="同事的客户，领了项目再看">领了再看</span>,
    },
    {
      title: "项目名称", key: "项目", width: 180,
      render: (_, r) => r.项目名
        ? (r.projectId && r.种 === "项目"
          ? <RowLink href={`/projects/${r.projectId}`} className="clamp" title={r.项目名}>{r.项目名}</RowLink>
          : <span className="clamp" title={r.项目名}>{r.项目名}</span>)
        : <span className="muted">还没有项目</span>,
    },
    {
      title: "当前进程", key: "进程", width: 150,
      render: (_, r) => r.进程 ? <span className="clamp" title={r.进程}>{r.进程}</span> : <span className="muted">—</span>,
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
      render: (_, r) => <span className={r.类 === "无效" ? "clamp" : "clamp muted"} style={r.类 === "无效" ? { color: "var(--danger-text)" } : undefined} title={r.入池原因}>{r.入池原因}</span>,
    },
    {
      title: "操作", key: "操作", width: 116, 常驻: true, fixed: "right",
      render: (_, r) => {
        const 无效 = r.类 === "无效";
        const 灰 = 无效 || r.原负责人是我;
        const 灰因 = 无效 ? "标了无效的客户不能领取，要老板先恢复" : r.原负责人是我 ? 原负责人不能领回提示 : r.种 === "客户" ? "领取：负责人改成我，名下项目一起领" : "领取这个项目：负责人改成我";
        return (
          <Space size={2}>
            <Button aria-label={`领取 ${r.客户名 ?? r.项目名 ?? ""}`} title={灰因} disabled={灰} type="text" size="small" icon={<UserAddOutlined />}
              onClick={(e) => { e.stopPropagation(); void 领这行(r); }}>
              领取
            </Button>
            {r.种 === "客户" && !无效 && 能标无效 && (
              <Popconfirm title="标成无效客户？" description="标了以后谁都领不了，只有老板能恢复" okText="标无效" cancelText="取消"
                onConfirm={() => 标记(r, "无效")} onPopupClick={(e) => e.stopPropagation()}>
                <Button aria-label={`标无效 ${r.客户名 ?? ""}`} title="标成无效客户" type="text" size="small" icon={<StopOutlined />} onClick={(e) => e.stopPropagation()} />
              </Popconfirm>
            )}
            {r.种 === "客户" && 无效 && 能恢复 && (
              <Popconfirm title="恢复成有效客户？" description="恢复后留在公海里，谁都能领" okText="恢复" cancelText="取消"
                onConfirm={() => 标记(r, "恢复")} onPopupClick={(e) => e.stopPropagation()}>
                <Button aria-label={`恢复 ${r.客户名 ?? ""}`} title="恢复成有效客户" type="text" size="small" icon={<UndoOutlined />} onClick={(e) => e.stopPropagation()} />
              </Popconfirm>
            )}
          </Space>
        );
      },
    },
  ];

  const 筛选 = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ overflowX: "auto", maxWidth: "100%" }}>
        <Segmented
          value={f.attr || "全部"}
          onChange={(v) => apply({ attr: v === "全部" ? "" : String(v) })}
          options={(["全部", ...公海属性们] as const).map((k) => ({ value: k, label: `${k} ${属性数[k]}` }))}
        />
      </div>
      <Space wrap size={[6, 6]}>
        {快捷们.map((k) => (
          <Button key={k} size="small" type={f.quick === k ? "primary" : "default"} title={快捷说明[k]} aria-pressed={f.quick === k}
            onClick={() => apply({ quick: f.quick === k ? "" : k })}>
            {k} {快捷数[k]}
          </Button>
        ))}
        <Select size="small" style={{ width: 132 }} aria-label="排序"
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
      </Space>
    </div>
  );

  return (
    <>
      <PageHead title="公海" subtitle="没人负责的客户和项目都在这里：领了就归你" />
      <DataList<公海行>
        页="pool"
        列={列们}
        行={行}
        空库={!库里有 && !在筛}
        空态={{ title: "公海是空的", hint: "超时没跟进、被退回的客户和项目会出现在这里", demo: false }}
        筛选={筛选}
        汇总={截断 ? <div className="muted" style={{ fontSize: 12 }}>公海里太多了，这里只列最近入池的一批；更早的请用搜索找</div> : undefined}
        加载中={pending}
        行链接={(r) => (r.种 === "项目" ? `/projects/${r.projectId}` : `/customers/${r.customerId}`)}
        行类={(r) => (r.类 === "无效" ? "row-off" : undefined)}
        分页={{ 当前页, 每页: pageSize, 总数, 翻页 }}
      />
    </>
  );
}
