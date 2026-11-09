import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { loadWatchlistPage } from "@/lib/sentinel-data";
import { KIND_LABEL } from "@/lib/sentinel";
import { getBusiness } from "@/lib/business";
import { 看得到的客户 } from "@/lib/project/db";
import { RowLink, PageHead } from "@/components/ui";
import { dayjs } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function WatchlistPage({ searchParams }: { searchParams: Promise<{ scope?: string; page?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const team = sp.scope === "team";
  const requested = Number(sp.page);
  const page = Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 1_000_000) : 1;
  const [result, b] = await Promise.all([
    loadWatchlistPage(dayjs(), team ? {} : { ownerId: me.id }, (page - 1) * 20, 20),
    getBusiness(),
  ]);
  // 逾期计划看得到、客户未必进得去（市场分出去后留下的，上级看下属留下的，P-转-10）：进不去的只写名字
  const 进得去 = await 看得到的客户(result.items.map((x) => x.customerId));
  const current = Math.floor(result.offset / 20) + 1;
  const pages = Math.max(1, Math.ceil(result.total / 20));
  const href = (p: number) => `/follow-ups/watchlist?scope=${team ? "team" : "mine"}&page=${p}`;
  return <>
    <PageHead title="盯盘清单" subtitle={`${team ? "当前权限内团队" : "我名下"} · 共 ${result.total} 位需要跟进的${b.customer}`} />
    <p><Link href="/follow-ups/watchlist?scope=mine">我的</Link> · <Link href="/follow-ups/watchlist?scope=team">当前可见团队</Link></p>
    <div className="card-soft" style={{ padding: 20 }}>
      {result.items.length === 0 ? <p className="muted">当前范围没有需要提醒的记录。</p> : result.items.map(item => <div key={item.customerId} style={{ padding: "12px 0", borderBottom: "1px solid var(--line-soft)", overflowWrap: "anywhere" /* 无空格长客户名伸出卡片（10-19 排版闸门） */ }}>
        {进得去.has(item.customerId) ? <RowLink href={`/customers/${item.customerId}`} className="link-strong">{item.customerName}</RowLink> : <strong>{item.customerName}</strong>}
        <span className="muted"> · {item.ownerName} · {KIND_LABEL[item.kind].replace("学员", b.customer)}</span>
        <p style={{ margin: "6px 0 0" }}>{item.reason}</p>
      </div>)}
      <nav aria-label="盯盘分页" style={{ display: "flex", gap: 16, marginTop: 16 }}>
        {current > 1 && <Link href={href(current - 1)}>上一页</Link>}
        <span>第 {current} / {pages} 页</span>
        {current < pages && <Link href={href(current + 1)}>下一页</Link>}
      </nav>
    </div>
  </>;
}
