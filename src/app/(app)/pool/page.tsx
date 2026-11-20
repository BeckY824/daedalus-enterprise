import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能管公海, 能恢复, 能新建和领取 } from "@/lib/enterprise/permissions";
import { 读公海页 } from "@/lib/enterprise/unified-pool-db";
import { 渠道筛选选项 } from "@/lib/enterprise/channel-options";
import { 公海分配候选 } from "@/lib/owners";
import { 持有数, 各人持有数 } from "@/lib/project/db";
import { 可选项 } from "@/lib/enterprise/dict";
import { 持有上限of } from "@/lib/project/org-rules";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 公海别线的 } from "@/lib/enterprise/pool-line-guard";
import PoolView from "./PoolView";
import { 转走项目预览of } from "../customers/actions";
import { 读公海页筛, 按名单 as 按名单of, type 公海页地址 } from "./filters";

export const dynamic = "force-dynamic";

/**
 * 企业版统一公海（2026-10-29，P7）：客户公海 + 项目公海一页看，按「公海属性」分开（11-11 起四池：线索池 / 商机池 / 订单池 / 客户池）。
 * 只在企业版、项目模式开着时有，别的版本 404（侧栏也没有入口）。规矩见 lib/enterprise/unified-pool.ts
 */
export default async function PoolPage({
  searchParams,
}: {
  /** 地址栏各项见 filters.ts 公海页地址（attr 公海属性、quick 快捷按钮、sort 排序……） */
  searchParams: Promise<公海页地址>;
}) {
  const me = await requireUser();
  if (!企业版() || (await getBusiness()).projectMode !== true) notFound();
  const sp = await searchParams;
  const 正整数 = (raw: string | undefined, fallback: number) => {
    const n = Number.parseInt(raw ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const pageSize = Math.min(100, Math.max(10, 正整数(sp.pageSize, 20)));
  const 筛 = 读公海页筛(sp);
  const 按名单 = 按名单of(筛);
  const 权限org = await 权限组织();
  const 能分配 = 能管公海(me, 权限org);
  // 组织规则在设置缓存里读：客户三态关着时「号码不全」的标签、筛选都不出（P-界面-19 ⑦），地址栏带了也当没筛
  const 规则P = 生效组织规则();
  const [d, users, 规则, 有, 渠道筛选项, 无效原因选项] = await Promise.all([
    规则P.then((r) => 读公海页(me, { 属性: 筛.attr, 快捷: 筛.quick, 排序: 筛.sort, keyword: 筛.keyword, 来源: 筛.channelId, 号码不全: r.三态.开 ? 筛.phoneIncomplete : "" }, 正整数(sp.page, 1), pageSize, 按名单 ? { channelId: 筛.projChannel, phase: 筛.phase, createdFrom: 筛.createdFrom, createdTo: 筛.createdTo, onlyNew: 筛.onlyNew, open: 筛.open, batch: 筛.batch } : undefined, { 数号码不全: r.三态.开 })),
    // 分配给谁：老板、主管才用得上；只列能当负责人的，不限业务线（P-转-08）
    能分配 ? 公海分配候选(me) : Promise.resolve([]),
    规则P,
    持有数(prisma, me.id),
    渠道筛选选项(),
    // 标无效时选的原因（P-界面-42）：字典「无效原因」启用的那几项；不能标的不查
    能分配 ? 可选项("invalid") : Promise.resolve([] as string[]),
  ]);
  // 客户池并成一行的（11-11）：按里面每个项目认
  const 平 = d.行.flatMap((r) => r.子 ?? [r]);
  // 公海不按线分，谁都看得到别线的行：销管、条线总管理对别线的行不摆分配、标无效、恢复（P-公海-07，服务端各入口另拦）
  const 别 = 能分配 || 能恢复(me, 权限org)
    ? await 公海别线的(prisma, me, 权限org, { 客户: 平.filter((r) => r.种 === "客户").map((r) => r.customerId), 项目: 平.flatMap((r) => (r.种 === "项目" && r.projectId ? [r.projectId] : [])) })
    : { 客户: [], 项目: [] };
  // 按行 id 给（渠道名单里客户行按项目拆成几行，id 是 c:客户:项目；客户池并出来的那行 k:客户，里面全是别线的才算）
  const 别客户 = new Set(别.客户.map((x) => x.id));
  const 别项目 = new Set(别.项目.map((x) => x.id));
  const 是别线 = (r: (typeof 平)[number]) => (r.种 === "客户" ? 别客户.has(r.customerId) : !!r.projectId && 别项目.has(r.projectId));
  const 别线ids = [...平.filter(是别线), ...d.行.filter((r) => r.子?.every(是别线))].map((r) => r.id);
  // 持有上限开着（且我不是不限）才在页头写「我手上 N / 上限 M」，领取按钮到上限时灰着写原因（交互规则 A、C）
  const 上限 = 持有上限of(规则, me.id);
  // 分配选人框（P-界面-43）：每位候选按部门分组、写当前持有 / 上限，满了置灰。持有同 持有数 的口径；上限没开 / 不限的不写（只读查询）
  const 候选持有 = 能分配 && users.length && 规则.公海.持有上限开 ? await 各人持有数(prisma, users.map((u) => u.id)) : {};
  const 候选信息 = Object.fromEntries(users.map((u) => {
    const 部门 = 权限org?.成员.get(u.id)?.deptId;
    const 限 = 持有上限of(规则, u.id);
    const 部 = 部门 ? 权限org?.部门.get(部门) : undefined;
    return [u.id, { 组: 部?.name || "", 组序: 部?.sort ?? 0, 持有: 限 === null ? null : (候选持有[u.id] ?? 0), 上限: 限 }];
  }));
  return (
    <PoolView
      {...d}
      pageSize={pageSize}
      filters={筛}
      三态开={规则.三态.开}
      渠道筛选项={渠道筛选项}
      能标无效={能分配}
      能恢复={能恢复(me, 权限org)}
      能分配={能分配}
      别线ids={别线ids}
      users={users}
      候选信息={候选信息}
      无效原因选项={无效原因选项}
      // 行内领客户时列「会一起转走的项目」，和客户详情页领取前同一份数（服务端动作当参数递，界面测试不用桩）
      转走预览={转走项目预览of}
      持有={上限 === null ? null : { 有, 上限 }}
      // 只读管理员（B2-1）、没设业务角色的（11-03 D3-7 ④）：领取都不摆
      只读={!能新建和领取(me, 权限org)}
    />
  );
}
