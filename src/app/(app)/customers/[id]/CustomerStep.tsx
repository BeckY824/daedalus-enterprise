"use client";

/**
 * 客户详情「上一条 / 下一条」（E-332）：「← 回到客户列表」那一行右端两颗箭头，顺序和进来前那张客户列表一样（筛选、排序、页签、范围、跨页）。
 *   - 只认从客户列表点进来的（和按箭头换过来的、刷新 / 后退回来的），判定在 lib/list-return.ts 定详情来源；别处进来不摆
 *   - 相邻两位由服务端按列表同一份查询算（adjacent-actions.ts，可见范围走限定层），这里只拿 id
 *   - 到头那颗灰着；算出来之前不摆（这一行固定 24 高，箭头冒出来不推版面）
 *   - 换人用 replace：浏览器后退 / 手机返回手势直接回列表，列表照旧还原筛选、排序和滚动位置（components/ListReturn.tsx）
 * 由客户详情页（page.tsx）画好当 换人箭头 递给 RecordView，RecordView 不直接引服务端动作
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DownOutlined, UpOutlined } from "@ant-design/icons";
import { LinkPending } from "@/components/NavProgress";
import { 地址快照, 定详情来源, 解析地址们, 记详情来源, 读详情来源, 清详情来源, 进来的前一页, type 详情来源 } from "@/lib/list-return";
import { 相邻客户 } from "./adjacent-actions";
import type { 相邻 } from "./adjacent";

/** 算好的那一位（id 对不上 = 换了人、旧结果不用） */
type 态 = { id: string; 来源: 详情来源; 邻: 相邻 };

export default function CustomerStep({ customerId }: { customerId: string }) {
  const pathname = usePathname() ?? "";
  const [态, set态] = useState<态 | null>(null);

  useEffect(() => {
    const 来源 = 定详情来源(customerId, 进来的前一页(pathname), 读详情来源(), 解析地址们(地址快照()));
    if (!来源) {
      清详情来源();
      return;
    }
    记详情来源(来源);
    let 停 = false;
    相邻客户({ href: 来源.href, page: 来源.位[customerId] ?? 1 }, customerId).then(
      // 这一位不在那一页里（数据变了）：当不是从列表进来的，不摆
      (邻) => { if (!停) set态(邻 ? { id: customerId, 来源, 邻 } : null); },
      () => { if (!停) set态(null); },
    );
    return () => { 停 = true; };
  }, [customerId, pathname]);

  if (!态 || 态.id !== customerId) return null;
  const { 来源, 邻 } = 态;
  const 一颗 = (方向: "上" | "下") => {
    const 到 = 邻[方向];
    const 名 = 方向 === "上" ? "上一条" : "下一条";
    const testid = 方向 === "上" ? "rec-step-prev" : "rec-step-next";
    const 图 = 方向 === "上" ? <UpOutlined aria-hidden /> : <DownOutlined aria-hidden />;
    if (!到) {
      const 话 = 方向 === "上" ? "已是第一条" : "已是最后一条";
      return <button type="button" className="rec-step-b" disabled aria-label={话} title={话} data-testid={testid}>{图}</button>;
    }
    return (
      <Link
        href={`/customers/${encodeURIComponent(到.id)}`}
        replace
        className="rec-step-b"
        aria-label={`${名}客户`}
        title={名}
        data-testid={testid}
        // 记下换到的这位在第几页：到了那边（含刷新）照样认得是从这张列表来的
        onClick={() => 记详情来源({ href: 来源.href, 位: { ...来源.位, [到.id]: 到.page } })}
      >
        {图}
        <LinkPending />
      </Link>
    );
  };
  return (
    <nav className="rec-step" aria-label="按列表顺序换客户" data-testid="rec-step">
      {一颗("上")}
      {一颗("下")}
    </nav>
  );
}
