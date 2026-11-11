import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能管公海, 能恢复, 能新建和领取 } from "@/lib/enterprise/permissions";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 规整公海属性, 是快捷, 规整排序 } from "@/lib/enterprise/unified-pool";
import { 渠道筛选选项 } from "@/lib/enterprise/channel-options";
import { 公海分配候选 } from "@/lib/owners";
import { 持有数 } from "@/lib/project/db";
import { 持有上限of } from "@/lib/project/org-rules";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 公海别线的 } from "@/lib/enterprise/pool-line-guard";
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
  searchParams: Promise<{ keyword?: string; attr?: string; quick?: string; sort?: string; channelId?: string; page?: string; pageSize?: string }>;
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
    channelId: (sp.channelId ?? "").trim(),
  };
  const 权限org = await 权限组织();
  const 能分配 = 能管公海(me, 权限org);
  const [d, users, 规则, 有, 渠道筛选项] = await Promise.all([
    读公海页(me, { 属性: 筛.attr, 快捷: 筛.quick, 排序: 筛.sort, keyword: 筛.keyword, 来源: 筛.channelId }, 正整数(sp.page, 1), pageSize),
    // 分配给谁：老板、主管才用得上；只列能当负责人的，不是系统管理员只列同业务线的（11-03 B2-7）
    能分配 ? 公海分配候选(me) : Promise.resolve([]),
    生效组织规则(),
    持有数(prisma, me.id),
    渠道筛选选项(),
  ]);
  // 公海不按线分，谁都看得到别线的行：销管、条线总管理对别线的行不摆分配、标无效、恢复（P-公海-07，服务端各入口另拦）
  const 别 = 能分配 || 能恢复(me, 权限org)
    ? await 公海别线的(prisma, me, 权限org, { 客户: d.行.filter((r) => r.种 === "客户").map((r) => r.customerId), 项目: d.行.flatMap((r) => (r.种 === "项目" && r.projectId ? [r.projectId] : [])) })
    : { 客户: [], 项目: [] };
  const 别线ids = [...别.客户.map((x) => `c:${x.id}`), ...别.项目.map((x) => `p:${x.id}`)];
  // 持有上限开着（且我不是不限）才在页头写「我手上 N / 上限 M」，领取按钮到上限时灰着写原因（交互规则 A、C）
  const 上限 = 持有上限of(规则, me.id);
  return (
    <PoolView
      {...d}
      pageSize={pageSize}
      filters={筛}
      渠道筛选项={渠道筛选项}
      能标无效={能分配}
      能恢复={能恢复(me, 权限org)}
      能分配={能分配}
      别线ids={别线ids}
      users={users}
      持有={上限 === null ? null : { 有, 上限 }}
      // 只读管理员（B2-1）、没设业务角色的（11-03 D3-7 ④）：领取都不摆
      只读={!能新建和领取(me, 权限org)}
    />
  );
}
