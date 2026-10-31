import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 管全队客户 } from "@/lib/constants";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 规整公海属性, 是快捷, 规整排序 } from "@/lib/enterprise/unified-pool";
import { 负责人候选 } from "@/lib/owners";
import { 持有数 } from "@/lib/project/db";
import { 持有上限of } from "@/lib/project/org-rules";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
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
    attr: 规整公海属性(sp.attr),
    quick: 是快捷(sp.quick) ? sp.quick : "",
    // 默认排序不写进地址：筛选栏的「重置」看得出没在筛
    sort: sp.sort && 规整排序(sp.sort) === sp.sort ? sp.sort : "",
  };
  const 能分配 = 管全队客户(me.role);
  const [d, users, 规则, 有] = await Promise.all([
    读公海页(me, { 属性: 筛.attr, 快捷: 筛.quick, 排序: 筛.sort, keyword: 筛.keyword }, 正整数(sp.page, 1), pageSize),
    // 分配给谁：老板、主管才用得上，同客户页的负责人下拉
    能分配 ? 负责人候选() : Promise.resolve([]),
    生效组织规则(),
    持有数(prisma, me.id),
  ]);
  // 持有上限开着（且我不是不限）才在页头写「我手上 N / 上限 M」，领取按钮到上限时灰着写原因（交互规则 A、C）
  const 上限 = 持有上限of(规则, me.id);
  return (
    <PoolView
      {...d}
      pageSize={pageSize}
      filters={筛}
      能标无效={管全队客户(me.role)}
      能恢复={me.role === "ADMIN"}
      能分配={能分配}
      users={users}
      持有={上限 === null ? null : { 有, 上限 }}
    />
  );
}
