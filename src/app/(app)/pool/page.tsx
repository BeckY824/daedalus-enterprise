import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 管全队客户 } from "@/lib/constants";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 是公海属性, 是快捷, 规整排序 } from "@/lib/enterprise/unified-pool";
import PoolView from "./PoolView";

export const dynamic = "force-dynamic";

/**
 * 企业版统一公海（2026-10-29，P7）：客户公海 + 项目公海一页看，按「公海属性」分开。
 * 只在企业版、项目模式开着时有，别的版本 404（侧栏也没有入口）。规矩见 lib/enterprise/unified-pool.ts
 */
export default async function PoolPage({
  searchParams,
}: {
  /** attr：公海属性；quick：快捷按钮；sort：pooled / follow / created */
  searchParams: Promise<{ keyword?: string; attr?: string; quick?: string; sort?: string; page?: string; pageSize?: string }>;
}) {
  const me = await requireUser();
  if (!企业版() || (await getBusiness()).projectMode !== true) notFound();
  const sp = await searchParams;
  const 正整数 = (raw: string | undefined, fallback: number) => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const pageSize = Math.min(100, Math.max(10, 正整数(sp.pageSize, 20)));
  const 筛 = {
    keyword: (sp.keyword ?? "").trim(),
    attr: 是公海属性(sp.attr) ? sp.attr : "",
    quick: 是快捷(sp.quick) ? sp.quick : "",
    // 默认排序不写进地址：筛选栏的「重置」看得出没在筛
    sort: sp.sort && 规整排序(sp.sort) === sp.sort ? sp.sort : "",
  };
  const d = await 读公海页(me, { 属性: 筛.attr, 快捷: 筛.quick, 排序: 筛.sort, keyword: 筛.keyword }, 正整数(sp.page, 1), pageSize);
  return (
    <PoolView
      {...d}
      pageSize={pageSize}
      filters={筛}
      能标无效={管全队客户(me.role)}
      能恢复={me.role === "ADMIN"}
    />
  );
}
