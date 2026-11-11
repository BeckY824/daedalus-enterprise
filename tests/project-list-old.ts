/**
 * 对照实现（测试用，不进产品代码）：11-11 改服务端分页之前的 读项目列表（线上 8009b421（= 3258632c）原样，只改了引用路径）。
 * 取最近改过的前 500 条，再在内存里滤（客户不露的不算中、收回次数、3 天内回公海）。
 * tests/ent-project-list-paging.test.ts 拿它和新的分页版逐条对拍：≤ 500 条时两边的行（含顺序、每一格）一模一样
 */
import { prisma } from "@/lib/prisma";
import { 搜索词, 客户号码条件, 号码藏着 } from "@/lib/search-keyword";
import { 负责人候选 } from "@/lib/owners";
import type { 项目行 } from "@/lib/project/board";
import type { 阶段 } from "@/lib/project/nodes";
import { 看得到的客户, 露客户, 公海超时收回, 待我回的邀请, 项目回收日, 算超时要的, 超时成员线 } from "@/lib/project/db";
import { 即将回收 } from "@/lib/project/timeout";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { dayjs } from "@/lib/utils";
import { 已立项天数 } from "@/lib/project/project-fields";
import { 回填一次 } from "@/lib/project/expected-deal";
import { 数收回次数, 合收回次数, 收回次数筛 } from "@/lib/project/recycle-count";
import { 认首页卡, 首页卡条件, 即将逾期 } from "@/lib/project/home-cards";
import { 首页卡范围 } from "@/lib/project/home-cards-db";
import { 字典of } from "@/lib/project/stage-dict";
import { 本套位置 } from "@/lib/project/nodes";
import type { Prisma } from "@/generated/prisma";
import { 待我复核的, 验证结果叫法, 实际待, 无效交给 } from "@/lib/project/lead-verify";
import { 读市场身份 } from "@/lib/enterprise/market-view-db";
import { 市场项目条件, 只看进度 } from "@/lib/enterprise/market-view";
import { 历史负责人们, 我回避的公海项目, 回避豁免 } from "@/lib/project/pool-owner";
import { 渠道筛选选项 } from "@/lib/enterprise/channel-options";
import { 企业级别 } from "@/lib/enterprise/customer-v2";
import { 未分级 } from "@/app/(app)/customers/query-shared";
import { 创建时间段, 是日期 } from "@/lib/custom-date-range";
import { 阶段进程条件, 读验证痕们, 验证摘要, type 项目筛选 } from "@/lib/project/list";
const 项目上限 = 500;

/**
 * 项目页和企业版「新线索」页共用的取数：先跑超时回收，再按筛选取项目、拼成 项目行。
 * 只看阶段 = "线索" 时只取还在线索阶段的（含已线索流失的），企业版 /leads 用。
 */
export async function 旧读项目列表(me: Parameters<typeof 公海超时收回>[0] & Parameters<typeof 待我回的邀请>[0] & { role: string }, sp: 项目筛选, 只看阶段?: 阶段) {
  // 企业版超时回收：先收再列，列表里看到的就是收完的样子
  await 公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e));
  await 回填一次();
  const 词 = 搜索词(sp.keyword);
  const 企 = 企业版();
  const 规则 = 企 ? await 生效组织规则() : null;
  const 今 = new Date();
  // 首页指标卡的筛选只在企业版认；条件和卡上 count 用的是同一份（home-cards.ts），数对得上
  const 卡 = 规则 ? 认首页卡(sp.f) : "";
  // 点卡进来的，和卡上的数同一圈（首页卡范围：按负责人，最下级只看自己，上级看自己 + 下属，总管理 / 管理员全看），数对得上
  const 卡的圈 = 卡 ? await 首页卡范围(me) : undefined;
  const 字典 = 字典of(企);
  const 阶进 = 阶段进程条件(sp, 字典);
  // 企业版市场视角（11-04 P-界面-05）：市场成员 = 自己负责的 ∪ 自己建的已分出去的；市场管理 = 本人 + 实线下属，可按创建人筛；公海的都不列
  const 市场 = 企 ? await 读市场身份(me.id) : null;
  const 创建人 = 市场?.视角 === "市场管理" && typeof sp.creator === "string" && 市场.圈.includes(sp.creator) ? sp.creator : "";
  // 自定义筛选（11-06）：渠道和列表上「渠道」一列同一条规则——项目自己选的优先，没选跟客户来源（channel-stats.ts 项目算哪个渠道）
  const 来源 = 企 && typeof sp.channelId === "string" ? sp.channelId : "";
  const 级别筛 = !企 ? "" : sp.level === 未分级 ? 未分级 : (企业级别(sp.level) ?? "");
  const 建于 = 创建时间段(sp.createdFrom, sp.createdTo);
  // 手机号（11-11）：先按号码找客户（电话藏着的人 = null，不筛），再取挂在这些客户上的项目；客户不露的下面再滤掉
  const 号码 = await 客户号码条件(sp.phone, me.id);
  const 并且: Prisma.ProjectWhereInput[] = [
    ...(建于 ? [{ createdAt: 建于 }] : []),
    ...(号码 ? [{ customer: 号码 }] : []),
    ...(来源 ? [{ OR: [{ channelId: 来源 }, { channelId: null, customer: { channelId: 来源 } }] }] : []),
    ...(级别筛 ? [{ level: 级别筛 === 未分级 ? null : 级别筛 }] : []),
    ...(卡 && 规则 ? [首页卡条件(卡, 规则, 字典of(企), 今), ...(卡的圈 ? [卡的圈] : [])] : []),
    ...阶进.where,
    ...(市场 ? [市场项目条件(me.id, 市场.圈, 创建人)] : []),
  ];
  // 企业版 C-01：公海里我是历史负责人的项目我看不到（总管理 / 管理员不算，lib/project/pool-owner.ts 回避豁免）
  const 回避 = (await 回避豁免(me)) ? [] : await 我回避的公海项目(prisma, me.id);
  const rows = await prisma.project.findMany({
    where: {
      ...(只看阶段 ? { phase: 只看阶段 } : {}),
      ...(回避.length ? { id: { notIn: 回避 } } : {}),
      ...(词 ? { OR: [{ name: { contains: 词 } }, { customer: { name: { contains: 词 } } }] } : {}),
      ...(typeof sp.ownerId === "string" && sp.ownerId ? { ownerId: sp.ownerId } : {}),
      // 企业版公海只有一处（/pool）：默认列表不列公海项目，不然同一个项目两边都有；团队版公海项目照旧混在列表里，页上有「在公海」标。
      // 点首页卡进来的不加：哪些算由卡的条件定（「本月新增」不管在不在推，含公海），和卡上的数对得上
      ...(sp.pool === "1" ? { pooledAt: { not: null } } : 企 && !卡 ? { pooledAt: null } : {}),
      // 卡的条件、阶段筛里也有 OR（即将逾期的粗筛、按结局认阶段），放进 AND 里不和搜索词的 OR 打架
      ...(并且.length ? { AND: 并且 } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 项目上限,
    include: {
      customer: { select: { name: true, lastFollowAt: true, channelId: true, pool: { select: { customerId: true } }, channel: { select: { name: true } } } },
      exceptionCategory: { select: { name: true } },
      channel: { select: { name: true } },
      logs: 算超时要的.logs,
      ...(市场 ? {
        entLeadVerify: { select: { verdict: true, pending: true, salesAck: true, invalidReason: true } },
        members: { where: { userId: me.id, inviteStatus: "JOINED" }, select: { userId: true } },
      } : {}),
    },
  });
  // 超时按项目业务线分内外贸天数（C7）：老项目没填业务线按负责人的线
  const 超时线们 = 规则 ? await 超时成员线(规则) : null;
  // 企业版「收回次数」：从留痕里数；按次数筛只在企业版的项目公海里生效
  const 收回筛 = 企 && sp.pool === "1" ? 收回次数筛(sp.recycled) : "";
  const 将收 = (p: (typeof rows)[number]) => {
    if (!规则 || p.pooledAt) return null;
    const 日 = 项目回收日(规则, p, 超时线们);
    return 即将回收(日, 今) ? 日 : null;
  };
  // 公海里的项目负责人一栏写原负责人（企业版库里已清空，从留痕取）
  const 原负责人 = await 历史负责人们(prisma, rows.filter((r) => r.pooledAt).map((r) => r.id));
  const 负责人of = (p: (typeof rows)[number]) => (p.pooledAt ? 原负责人.get(p.id) ?? p.ownerId : p.ownerId);
  const [人, users, 可见, 邀请, 收回, 待复核] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map(负责人of))] } }, select: { id: true, name: true } }),
    负责人候选(),
    看得到的客户(rows.map((r) => r.customerId)),
    待我回的邀请(me),
    企 ? 数收回次数(rows.map((r) => r.id), prisma) : Promise.resolve(null),
    企 ? 待我复核的(me) : Promise.resolve([]),
  ]);
  const 名字 = new Map(人.map((u) => [u.id, u.name]));
  // 市场视角：等我拍板的市场复核那几条照旧能进详情（复核要看来龙去脉）；验证结果的「待」按规则实际交给谁算（同详情页）
  const 我复核 = new Set(待复核.filter((r) => r.步 === "市场复核").map((r) => r.projectId));
  const 交给 = 市场 ? await 无效交给(市场.org) : "总管理终判";
  // 验证结果悬停看全过程（客户 11-05（X-09））：这一页的痕一次取、经手人名字一次取，不按行查
  const 痕们 = 市场 ? await 读验证痕们(rows.filter((r) => (r as { entLeadVerify?: unknown }).entLeadVerify).map((r) => r.id)) : new Map<string, string>();
  const 市场格 = (p: (typeof rows)[number]): Pick<项目行, "只看进度" | "验证结果" | "验证全文"> => {
    if (!市场) return {};
    const v = (p as { entLeadVerify?: { verdict: string; pending: string | null; salesAck: string | null; invalidReason: string | null } | null }).entLeadVerify;
    const 已加入 = ((p as { members?: { userId: string }[] }).members ?? []).map((m) => m.userId);
    const 叫法 = v ? 验证结果叫法({ 判定: v.verdict, 待: 实际待(v.pending, 交给), 终验: v.salesAck }) : null;
    return {
      只看进度: 只看进度(市场.圈, me.id, { ownerId: p.ownerId, 已加入 }, 我复核.has(p.id)),
      验证结果: 叫法 ? 验证摘要(叫法, v?.invalidReason ?? null) : p.phase === "线索" && !p.result ? "暂未验证" : null,
      验证全文: 痕们.get(p.id) ?? null,
    };
  };
  // 公海里同事客户的项目：不露客户名；按客户名搜也不该搜出它（否则等于拿名字试出来）
  const 露 = (p: (typeof rows)[number]) => 露客户(me, p, 可见);
  const 行: 项目行[] = rows.filter((p) => (!词 || p.name.toLowerCase().includes(词.toLowerCase()) || 露(p)) && 合收回次数(收回?.get(p.id) ?? 0, 收回筛) && (卡 !== "due-soon" || (!!规则 && 即将逾期(项目回收日(规则, p, 超时线们), 今)))
    // 客户不露时不拿客户的来源（同列上的「渠道」）：否则筛一下就试出同事客户从哪来
    && (!来源 || p.channelId === 来源 || 露(p))
    // 按号码筛中的是客户：客户不露的不列，不然拿号码试得出同事公海客户挂着哪些项目
    && (!号码 || 露(p))).map((p) => ({
    id: p.id, name: p.name, customerId: p.customerId, customerName: 露(p) ? p.customer.name : null,
    ownerId: p.ownerId, ownerName: 名字.get(负责人of(p)) ?? (负责人of(p) ? "已不在的成员" : "没人"),
    // 库里存着旧节点名 / 旧结局的按这套的新名给界面（企业版 10-31 改名）
    ...本套位置({ phase: p.phase, node: p.node, result: p.result }, 字典), exceptionCategory: p.exceptionCategory?.name ?? null, exceptionReason: p.exceptionReason,
    pooled: !!p.pooledAt,
    ...(企 && p.awaitAssignAt && !p.pooledAt ? { 待分配: true } : {}),
    ...(企 ? { 即将回收: 将收(p), 回收日: 规则 && !p.pooledAt ? 项目回收日(规则, p, 超时线们) : null, 下一步时间: p.nextStepAt ? dayjs(p.nextStepAt).format("YYYY-MM-DD") : null } : {}),
    // 项目来源和渠道统计同一条规则：项目自己选的优先，没选跟客户来源（lib/enterprise/channel-stats.ts 项目算哪个渠道）；客户不露时不拿客户的来源
    ...(企 ? { expectedDealAt: p.expectedDealAt ? dayjs(p.expectedDealAt).format("YYYY-MM-DD") : null, 已立项天数: 已立项天数(p.createdAt, 今), 项目来源: p.channel?.name ?? (露(p) ? p.customer.channel?.name : null) ?? null, level: p.level } : {}),
    ...(收回 ? { 收回次数: 收回.get(p.id) ?? 0 } : {}),
    ...市场格(p),
    amount: p.amount, currency: p.currency, updatedAt: p.updatedAt.toISOString(), createdAt: p.createdAt.toISOString(),
  }));
  return {
    行,
    取到上限: rows.length >= 项目上限,
    // 结局叫法跟着字典：企业版组织规则里改过的出口叫法
    企业版: 企,
    出口叫法: 规则?.阶段.出口叫法,
    // 「给老客户开项目」弹窗：开了超时回收，首条沟通要填下一步时间（同客户页 customers/[id]/page.tsx）
    要下一步: !!规则?.超时回收.开,
    users,
    邀请们: 邀请.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    // 企业版线索验证（P12）：等我复核 / 终验 / 认领的线索
    待复核们: 待复核.map((r) => ({ ...r, 更新于: r.更新于.toISOString() })),
    filters: { keyword: 词, ownerId: typeof sp.ownerId === "string" ? sp.ownerId : "", pool: sp.pool === "1" ? "1" : "", recycled: 收回筛, f: 卡, phase: 阶进.阶段, node: 阶进.进程, creator: 创建人, channelId: 来源, level: 级别筛,
      // 原样回给界面（选择器回显）；写错的那头 创建时间段 当没给
      createdFrom: 是日期(sp.createdFrom) ? sp.createdFrom : "", createdTo: 是日期(sp.createdTo) ? sp.createdTo : "",
      phone: 号码 ? 搜索词(sp.phone) : "" },
    // 电话藏着的人（字段权限 Y27）不摆「手机号」筛选
    能按号码筛: !(await 号码藏着(me.id)),
    // 自定义筛选「渠道」的候选；新线索页不摆
    渠道筛选项: 企 && !只看阶段 ? await 渠道筛选选项() : [],
    // 市场视角（null = 别的角色，界面照旧）；市场管理的「创建人」筛选候选 = 本人 + 实线下属
    市场: 市场 ? { 视角: 市场.视角, 创建人们: 市场.视角 === "市场管理" ? await prisma.user.findMany({ where: { id: { in: 市场.圈 } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [] } : null,
  };
}
