import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma";
import type { SessionUser } from "@/lib/auth";
import { 看板分列 } from "@/lib/project/board";
import { 字典of } from "@/lib/project/stage-dict";
import { 读项目列表 } from "@/lib/project/list";
import { 企业版 } from "@/lib/enterprise/switch";
import { 我的卡点, 卡点给界面 } from "@/lib/project/blocker";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 读组织 } from "@/lib/enterprise/org";
import { 能管公海 } from "@/lib/enterprise/permissions";
import { 能分配 } from "@/lib/enterprise/lead-assign";
import { 离职交接入口 } from "@/lib/enterprise/offboard-handover";
import { 看板三态点 } from "@/lib/project/board-tri-dots";
import ProjectsView from "./ProjectsView";
import { 项目页筛选 } from "./page-query";

/** 项目页（看板 / 列表）认的地址栏参数 */
export type 项目页参数 = { keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string; phase?: string; node?: string; creator?: string; channelId?: string; level?: string; createdFrom?: string; createdTo?: string; phone?: string; page?: string; pageSize?: string; sort?: string; q?: string; hl?: string };


/**
 * 项目页的取数和画法：/projects 和企业版客户页的「看板」视图（11-12 客户详情合并第 3 批）共用这一份，取数、可见范围、
 * 批量分配、项目组邀请、线索复核、我的卡点都一样。
 * 客户页：只画看板那一块（页头、筛选行是客户页的，C17 / C18），项目按客户页那一行筛出来的客户收窄（客户 = null 是没筛客户）。
 * 落在：整页画在别的地址上（X-107：市场角色的客户页就是这一整页，筛选、翻页留在 /customers，页头叫客户）
 */
export async function 项目页(me: SessionUser, 原: 项目页参数, 客户页?: { 客户: Prisma.CustomerWhereInput | null; 仅项目客户: Prisma.CustomerWhereInput | null }, 落在?: { 基址: string; 标题: string; 换回客户列表?: boolean; 能新建客户?: boolean }) {
  // 落在.能新建客户 = 能新建和领取：市场角色客户页「新建 ▾」两项（新建客户、新建项目）服务端都按这一条拒，两项共用
  // 地址栏 → 条件：和看板列底「再看」同一份（page-query.ts）
  const { sp, hl } = 项目页筛选(原);
  // 企业版：项目公海统一在 /pool（P7），?pool=1 的老链接（含页签、带 recycled 收回次数筛的）转过去，关键词带上
  if (企业版() && sp.pool === "1") redirect(sp.keyword ? `/pool?${new URLSearchParams({ keyword: sp.keyword })}` : "/pool");
  // 企业版阶段筛到「线索」：分配入口也摆在项目列表（11-01 会议 §5），谁能分照新线索页（leads/page.tsx）同一个口径
  const 筛线索 = 企业版() && sp.phase === "线索";
  const 线索分配开着 = 筛线索 && (await 规则开着("线索分配"));
  const 能自动分配 = 线索分配开着 && 能分配(await 读组织(), me);
  /*
    看板每列各自取数（11-12 用户：「如果有的话为什么不安排在首页？」→「按建议改，每列各自取数」）：每列按最近改过各取前 20，
    列底「再看 20 个」接着取（客户页 customers/board-actions.ts，别处 projects/board-actions.ts）。
    客户页看板服务端知道画的是看板：整页共用的那一页只在能「分配」时取（分配会临时切到项目列表，ProjectsView 去分配）。
    /projects、市场角色「我分出去的」的看板 / 列表是浏览器里切的，服务端不知道画哪个：两份都取，列表视图照旧
  */
  // 先读列表（里面先跑超时回收），再取「我的卡点」，看到的是收完的样子
  const d = await 读项目列表(me, 客户页 ? { ...sp, 客户: 客户页.客户, 仅项目客户: 客户页.仅项目客户 } : sp, undefined, { 每列: true, 要列表页: !客户页 || 能自动分配 });
  const 卡点们 = 企业版() ? await 我的卡点(me) : [];
  // 客户页看板（C5，P-界面-19 ②）：卡片客户名后的三态色点，这一屏看得到的卡片（每列的 + 列表页的）一次取钟；三态关着、不是客户页不取
  const 三态点 = 客户页 ? await 看板三态点([...d.行, ...Object.values(d.每列 ?? {}).flat()]) : undefined;
  return <ProjectsView 三态点={三态点} {...d} 列={看板分列(d.行, 企业版() ? 字典of(true, d.出口叫法) : undefined, sp.phase, d.看板合计, d.每列)} 卡点们={卡点们.map(卡点给界面)} 线索分配开着={线索分配开着} 能自动分配={能自动分配} 能分公海客户项目={能自动分配 && 能管公海(me, await 读组织())} 待交接={企业版() && !客户页 ? await 离职交接入口(me) : null} 高亮={typeof hl === "string" && hl ? hl : undefined} 客户页={!!客户页} 基址={落在?.基址} 标题={落在?.标题} 换回客户列表={!!落在?.换回客户列表} 能新建客户={!!落在?.能新建客户} 能新建={落在?.换回客户列表 ? !!落在.能新建客户 : undefined} />;
}
