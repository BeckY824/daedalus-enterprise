import { scheduleValue, scheduleOrder, earliestScheduled } from "@/lib/schedule-date";
import { 负责人显示名 } from "@/lib/pool";
import { notFound } from "next/navigation";
import { 收藏了吗 } from "@/lib/favorites";
import { prisma, defaultClient } from "@/lib/prisma";
import { 历史负责人of, 我放出去的公海客户 } from "@/lib/owner-log-db";
import { 企业版 } from "@/lib/enterprise/switch";
import { 页面能改沟通, 页面能删沟通, 改客户挡of } from "@/lib/enterprise/follow-perm";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import { 拦原负责人 } from "@/lib/enterprise/pool-rules";
import { requireUser } from "@/lib/auth";
import CustomerDetail from "./CustomerDetail";
import RestrictedCustomerDetail from "./RestrictedCustomerDetail";
import { 读受限客户详情 } from "./restricted";
import { 读项目区, 客户页项目列表 } from "./project-zone";
import { 历史变更摘要 } from "./history-data";
import HistoryChanges from "./HistoryChanges";
import { 客户编号文字 } from "@/lib/customer-no";
import { 项目详情字典们 } from "../../projects/[id]/load";
import SameNumberBanner from "../../projects/[id]/SameNumberBanner";
import { followHistoryInclude, followHistoryOrder, serializeFollowHistory } from "./follow-history-query";
import { 负责人候选 } from "@/lib/owners";
import { 可选渠道 } from "@/lib/options";
import { llmEnabled } from "@/lib/llm";
import { 读最近背调 } from "@/lib/research/latest";
import { 号码脱敏器 } from "@/lib/enterprise/phone-mask";
import { 带币种, 签约金额, 签约币种, 签约合计 } from "@/lib/money-db";
import { 客户来源线索 } from "@/lib/customer-lead-origin";
import { 取档案 } from "@/lib/customer-extra-db";
import { 只读客户, 只读话, 组员的客户 } from "@/lib/team-scope";
import { 只读原因of, 只读横幅 } from "@/lib/enterprise/readonly-reason";
import { getBusiness } from "@/lib/business";
import { 权限组织 } from "@/lib/enterprise/org";
import { 字段权限of, 客户列字段 } from "@/lib/enterprise/field-perm";
import { 能管公海, 能转出自己的, 能放回客户公海, 只读角色, 能新建和领取, 转自己客户要申请, 能恢复, 能领公海, 能删除 } from "@/lib/enterprise/permissions";
import { 公海别线的 } from "@/lib/enterprise/pool-line-guard";
import { 恢复有效客户 } from "../../pool/actions";
import { 客户在市场手里 } from "@/lib/enterprise/market-transfer";
import { 页面可自动分配, 暂不分配项目of, 市场分配限指定 } from "@/lib/enterprise/cust-auto-assign";
import { 客户默认分配方向 } from "@/lib/enterprise/assign-direction-db";
import { 读组织 } from "@/lib/enterprise/org";
import { 要按方向指定, 指定方向候选表 } from "@/lib/enterprise/assign-direction-pick";
import { 可指定的人 } from "@/lib/enterprise/assign-eta";
import { 客户自动分配 } from "../../leads/assign-actions";
import { 附件个数, 联系人分类附件数 } from "@/lib/attachments";
import { 关联客户们, 页面号码种类表, 联系人号码们, 客户的联系人们, 联系人另挂 } from "@/lib/enterprise/customer-v2-db";
import { 页面可选项, 页面字典, 页面客户释义, 预读页面字典 } from "@/lib/enterprise/dict";
import { 客户状态色表 } from "@/lib/enterprise/cust-status-color";
import { 企业版字典, 本套位置 } from "@/lib/project/nodes";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 字典of } from "@/lib/project/stage-dict";
import { 客户参与的项目 } from "@/lib/project/relate";
import { 客户页沟通两样 } from "@/lib/enterprise/customer-follow-feed";
import { 抬头节点们, 只留看得见的项目名 } from "@/lib/enterprise/customer-title";
import { 页面看得到的客户 } from "@/lib/project/visible-customers";
import { 显示用客户状态 } from "@/lib/enterprise/cust-status-auto-db";
import { 读客户三态, 读冷项目 } from "@/lib/enterprise/tri-state-detail";
import { 三态开着 } from "@/lib/enterprise/tri-state-db";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string; project?: string }>;
}) {
  // 企业版只用项目（P14）：时间线走下面的「沟通记录」，老时间线那 51 条不取。和登录态一起读（互不依赖）
  const [me, { id }, sp, 只项目] = await Promise.all([requireUser(), params, searchParams, 企业版只用项目()]);
  /*
    从到点提醒点进来（?focus=plan:…）：记录页只摆一条计划（最早那条），叫你的那条若不是最早的，
    点进来就找不到它、也闪不了（2026-10-02 排查 3-3）。这时摆的是叫你的那一条
  */
  const 要看的计划 = /^plan:(.+)$/.exec(sp.focus ?? "")?.[1] ?? null;
  // 客户三态开着（设置缓存里判，不查库）：客户行顺手带上客户钟，状态条、冷项目不再另查
  const 三态开 = 只项目 && (await 三态开着());

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      salesOwner: { select: { id: true, name: true } },
      channelOwner: { select: { id: true, name: true } },
      channel: { select: { id: true, name: true } },
      referrerCustomer: { select: { id: true, name: true } },
      attributionChannel: { select: { name: true } },
      attributionCustomer: { select: { id: true, name: true } },
      pool: { select: { reason: true } },
      entClock: 三态开,
      extra: true,
      // 该学员自己推荐来的人，用于展示推荐链下游
      referrals: { select: { id: true, name: true, followStatus: true }, orderBy: { createdAt: "desc" } },
      contracts: {
        orderBy: { signedAt: "desc" },
        include: 带币种.签约,
      },
      // 企业版联系人的号码几行（定稿 P5 第 24 条）；别的版本这张子表里没有挂联系人的行，带上也是空
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }, { id: "asc" }], include: { contactMethods: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, value: true } } } },
      tasks: { orderBy: [{ done: "asc" }, { dueAt: "asc" }] },
      plans: { where: { done: false, ...(要看的计划 ? { id: 要看的计划 } : {}) }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }] },
      followUps: { orderBy: followHistoryOrder, take: 只项目 ? 0 : 51, include: followHistoryInclude },
    },
  });

  if (!customer) {
    // 只负责项目的人（用户 11-12 定）：客户看不到、名下有自己负责的项目 = 受限详情（只读卡 + 只有自己的项目）；别的照旧 404
    const 受限 = 只项目 ? await 读受限客户详情(me, id, sp.project ?? null) : null;
    if (!受限) notFound();
    return <RestrictedCustomerDetail key={id} 数据={受限} />;
  }
  // 叫你的那条已经做完 / 删了：照旧摆最早那条没做完的
  if (要看的计划 && customer.plans.length === 0) {
    customer.plans = await prisma.followPlan.findMany({ where: { customerId: id, done: false }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }] });
  }

  customer.plans = earliestScheduled(customer.plans, p => scheduleOrder(p.plannedAt, p.plannedOn), 1);

  const 企 = 企业版();
  // 字段权限里改不了的格（11-03 D5-1）：档案那几格不给点，免得打开编辑框存了才被拒（规则没开 = 全能改，不读库）
  const 只能看的格P = 企 ? 字段权限of(me.id).then((级) => Object.entries(客户列字段).flatMap(([列, 名]) => (级(名) === "改" ? [] : [列]))) : Promise.resolve([]);
  /*
    下面这些互不依赖（或只依赖上面那条客户），一次并起来取（10-29 提速）：原来 JSX 属性里一个个 await，
    客户页一屏是二十来次串着的往返。有先后的用 .then 接在各自的前一步后面，不另起一道墙
  */
  // 企业版联系人挂多位客户（P13 第 1 条）：挂到这位的别人家联系人排在自家的后面；自家的另外挂在哪也带上
  const 挂来的P = 企 ? 客户的联系人们(customer.id) : Promise.resolve([]);
  const 全部联系人idP = 挂来的P.then((挂来的) => [...customer.contacts.map((c) => c.id), ...挂来的.map((x) => x.contact.id)]);
  // 这一屏要读的字典先说一声，合成两句（客户层 7 类 + 项目区那几类，lib/enterprise/dict.ts 预读页面字典）
  // 记沟通表单的沟通方式、发起主体也一起（11-22 页面切换提速 C3：原来表单打开时各调一次 server action，和背调那次串着排队）
  if (企) 预读页面字典(["custStatus", "custType", "custAttr", "custAssign", "contactTitle", "contactKind", "transfer", "followMethod", "followInitiator", ...(只项目 ? 项目详情字典们 : [])]);
  const 规则P = 只项目 ? 生效组织规则() : null;
  // 企业版只用项目：商机一节换成这位名下的项目（10-26）；库里存着旧节点名 / 旧结局的按企业版的新名显示（10-31 改名）
  // 先摆成 promise：项目区（读项目区）挂在它后面和下面的大 Promise.all 并行（第 2 批审查 #4）
  const 项目们P = 只项目
    // 公海里我是历史负责人的项目不列（C-01）：和「历史变更」弹窗的项目块同一个函数（project-zone.ts 客户页项目列表）
    ? 客户页项目列表(me, customer.id).then((ps) => ps.map(({ updatedAt: _u, ...p }) => 本套位置(p, 企业版字典)))
    : null;
  // 客户详情合并（11-12 第 2 批）：企业版项目模式下右边是项目区，?project=<id> 选页签；按项目详情页同一个取数读当前项目
  // 右栏不摆「项目进程变更」卡（11-24 挪进「历史变更」弹窗）：当前项目不取那 200 条节点记录
  const 项目区P = 项目们P ? 项目们P.then((ps) => 读项目区(me, customer.id, ps, sp.project ?? null, { 不取留痕: true })) : Promise.resolve(null);
  const aiP = llmEnabled();
  const [
    号, users, channels, 挂来的, 另挂, 只项目几样,
    sourceLead, aiEnabled, 已收藏, 换负责人记录, 旺旺们, 项目们, 参与项目们, 只读, 客户状态选项,
    联系人分类附件, 关联们, 号码种类, 分配方式选项, 客户类型选项, 规则, 联系人附件数,
    可改沟通, 可删沟通, 客户状态字典, 职务选项, 客户属性选项, 字典释义, 项目区,
    三态, 抬头节点, 沟通方式们, 发起主体们, 上次背调, 历史摘要,
  ] = await Promise.all([
    // 演示区是公开的，同一份数据所有访客共用：号码一律打码。自己部署的实例不受影响——销售要照着这个号打电话。
    号码脱敏器(),
    // 推荐人候选不再跟页面一起下来，客户表单打开时才取（CustomerForm 的 useReferrerCandidates，2026-10-20）
    负责人候选(),
    可选渠道(),
    挂来的P,
    企 ? 联系人另挂(customer.contacts.map((c) => c.id)) : Promise.resolve({} as Awaited<ReturnType<typeof 联系人另挂>>),
    /*
      企业版只用项目（P14）：时间线换成「沟通记录」——这位客户在我看得到的各项目里的跟进 + 不属于任何项目的老跟进，只读；
      「跟进」按钮列这些项目、点了跳过去（lib/enterprise/customer-follow-feed.ts，服务端按项目可见范围滤）
    */
    只项目
      ? Promise.all([
          // 页面渲染：客户可见走请求内缓存（翻页的服务端动作照旧现读）；沟通汇总和「跟进」菜单共用一遍看得到的项目（原来各算一遍）
          客户页沟通两样(me, customer.id, 页面看得到的客户),
          页面可选项("transfer"),
          prisma.followPlan.findMany({ where: { customerId: customer.id, done: false }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }], take: 20 }),
        ])
      : null,
    客户来源线索(customer.id),
    aiP,
    收藏了吗(me.id, id),
    // 历史负责人只企业版摆；记录不管开没开都记着（换负责人那一刻写，开了以后之前的也看得到）
    企 ? 历史负责人of(customer.id) : [],
    // 企业版：只记在联系方式子表里的旺旺 ID（建档时第一步选了旺旺，客户表和档案里都没有这一格），基本资料里摆出来
    企
      ? prisma.contactMethod.findMany({ where: { customerId: customer.id, contactId: null, kind: "wangwang" }, orderBy: { createdAt: "asc" }, select: { value: true } }).then((ms) => ms.map((m) => m.value))
      : [],
    // 企业版只用项目：商机一节换成这位名下的项目（10-26）；库里存着旧节点名 / 旧结局的按企业版的新名显示（10-31 改名）
    项目们P,
    // 企业版项目关联（P17）：这位关联在哪些项目上、什么身份；只列看得到的项目（限定层），概览名称按后台改过的出口叫法叫
    规则P ? 规则P.then((r) => 客户参与的项目(customer.id, 字典of(true, r.阶段.出口叫法))) : null,
    // 团队开了互看、这位是同事的：只能看和加跟进（lib/team-scope.ts）
    只读客户(defaultClient, customer),
    // 企业版客户状态（字典 custStatus，10-28 去遗留 A1）：标签行一枚章点了能改
    企 ? 页面可选项("custStatus") : [],
    // 企业版联系人附件（10-28）：每位联系人挂了几张；附件表不分权限，能看到这位客户就能看到他联系人的附件
    企 ? 全部联系人idP.then((ids) => 联系人分类附件数(defaultClient, ids)) : null,
    // 企业版客户改版（定稿 P5）：关联客户卡片、联系人号码类型、分配方式
    企 ? 关联客户们(customer.id) : null,
    企 ? 页面号码种类表().then((t) => t.map((x) => ({ 名: x.名, kind: x.kind, active: x.active }))) : undefined,
    企 ? 页面可选项("custAssign") : undefined,
    企 ? 页面可选项("custType") : undefined,
    规则P,
    企 ? 全部联系人idP.then(async (ids) => Object.fromEntries((await 附件个数(defaultClient, { contactIds: ids })).联系人)) : null,
    // 下面这几样原来在 JSX 里一个个 await，各等一轮库（11-01 速度闸门：按组织看那组客户详情超 300ms），并进来一起取
    // 沟通（11-09 M-权限-09 原口径）：改 = 身为负责人的管理，删 = 系统管理员或身为负责人的管理（lib/enterprise/follow-perm.ts，服务端 saveFollowUp / deleteFollowUp 同样拦）
    企 ? 页面能改沟通(me, customer.id) : true,
    企 ? 页面能删沟通(me, customer.id) : true,
    企 ? 页面字典("custStatus") : null,
    企 ? 页面可选项("contactTitle") : undefined,
    企 ? 页面可选项("custAttr") : undefined,
    企 ? 页面客户释义() : undefined,
    项目区P,
    // 客户三态（P-界面-19，C10 / C11）：关着不查库；开着、活跃的客户只多冷项目一句 SQL（客户钟跟着客户行读）。
    // 状态留痕（C13）首屏不读，11-24 挪进「历史变更」弹窗点开才取。冷项目只在客户活跃时标（M-公海-22「客户还活跃」），所以接在状态后面
    三态开
      ? Promise.all([读客户三态(me, customer), 项目区P]).then(async ([t, z]) => ({
          条: t?.条 ?? null,
          冷: t?.活跃 && z ? await 读冷项目(z.页签们.map((x) => x.id)) : ({} as Record<string, number>),
        }))
      : null,
    // 页头抬头（11-17 客户抬头 PR-5，出口 2）：简称、全称、类型都空才要当前节点，一句（含公海项目、不按看的人算，U9）；别的不查。
    // 项目名（F-040）只给我看得见的项目：走限定层主键查一句，看不见的回到「编号|节点」（P-看-12）
    企 ? 抬头节点们(prisma, [customer]).then((m) => 只留看得见的项目名(m, (ids) => prisma.project.findMany({ where: { id: { in: ids } }, select: { id: true } }))).then((m) => m[customer.id] ?? null) : null,
    // 11-22 页面切换提速 C3：记沟通表单的两样下拉、上一次背调跟页面一起带下去（原来进页后客户端再调 3 次 server action，
    // server action 一次只走一个，排着队等）。下拉口径同 follow-method-actions.ts（启用项，空的给 null）；背调只在 AI 开着时有人要
    企 ? 页面可选项("followMethod").then((们) => (们.length ? 们 : null)) : undefined,
    企 ? 页面可选项("followInitiator").then((们) => (们.length ? 们 : null)) : undefined,
    aiP.then((开) => (开 ? 读最近背调(customer.id) : undefined)),
    // 客户名下那一行的「历史变更」小方框（11-24）：只数条数、取最近时刻（一句 SQL），明细点开才取（history-actions.ts）；项目按页签那几个算
    企 ? 项目区P.then((z) => 历史变更摘要(customer.id, z?.页签们.map((t) => t.id) ?? [])) : null,
  ]);
  const 冷项目 = 三态?.冷 ?? {};
  if (项目区) 项目区.页签们 = 项目区.页签们.map((t) => (冷项目[t.id] != null ? { ...t, 冷天数: 冷项目[t.id] } : t));
  const [[汇总, 跟进去处], 转让选项, 待办计划] = 只项目几样 ?? [[null, null], null, null];
  // 号码类的几种（手机、座机、WhatsApp、传真）和电话一样过脱敏器；微信、邮箱、旺旺照旧（同联系人老三格的口径）
  const 打码种类 = new Set(["phone", "landline", "whatsapp", "fax"]);
  const 联系人一行 = (c: (typeof customer.contacts)[number]) => ({
    id: c.id,
    name: c.name,
    position: c.position,
    phone: 号(c.phone),
    email: c.email,
    wechat: c.wechat,
    isPrimary: c.isPrimary,
    remark: c.remark,
    updatedAt: c.updatedAt.toISOString(),
    ...(企
      ? {
          gender: c.gender,
          birthday: c.birthday,
          hobby: c.hobby,
          address: c.address,
          号码们: 联系人号码们(c, c.contactMethods).map((x) => ({ kind: x.kind, value: 打码种类.has(x.kind) ? 号(x.value) : x.value })),
        }
      : {}),
  });

  // 客户转让框里「指定分配 / 自动分配」的选择（客户 11-17）：市场成员 + 暂不分配的客户才摆，判定和服务端 客户自动分配 同一份
  const 能自动分 = 企 && !customer.pool && !!customer.salesOwnerId && (await 页面可自动分配(me, { id: customer.id, salesOwnerId: customer.salesOwnerId, bizLine: customer.bizLine, pool: null }));
  // 市场成员指定分配也先定方向（P-转-26，11-18）：判定同服务端 assignSalesOwner 那道（assign-direction-pick.ts）
  const 定向项目 = 企 && !customer.pool && !!customer.salesOwnerId
    ? await 要按方向指定(me, (await 权限组织())!, { id: customer.id, salesOwnerId: customer.salesOwnerId, bizLine: customer.bizLine, pool: null })
    : null;
  const 指定定向 = 定向项目
    ? { 候选表: await 指定方向候选表(await 读组织()), 默认方向: await 客户默认分配方向(await 读组织(), customer.id, me.id, 定向项目) }
    : undefined;
  return (
    <CustomerDetail
      key={customer.id}
      项目数据={项目区}
      抬头节点={抬头节点}
      三态条={三态?.条 ?? null}
      // 同号再次录入的醒目条：项目详情顶上那条，客户详情也摆（11-03 B6-9）；只看这页列出来的项目（已滤掉我回避的公海项目）
      醒目条={只项目 && 项目们?.length ? <SameNumberBanner projectId={项目们.map((p) => p.id)} /> : null}
      历史变更={历史摘要 ? <HistoryChanges customerId={customer.id} 摘要={历史摘要} 当前项目={项目区?.当前?.p.id ?? null} 客户名={[customer.name.trim() || customer.shortName, 客户编号文字(customer.customerNo)].filter(Boolean).join(" · ")} /> : null}
      sourceLead={sourceLead}
      users={users}
      channels={channels}
      aiEnabled={aiEnabled}
      上次背调={上次背调}
      沟通选项={企 ? { 方式: 沟通方式们 ?? null, 主体: 发起主体们 ?? null } : undefined}
      已收藏={已收藏}
      // P-公海-05：和服务端 放进公海 同一个判定（能放回 = 能转让，P-公海-02）
      能放公海={能放回客户公海(me, { salesOwnerId: customer.salesOwnerId, 在公海: !!customer.pool }, await 权限组织())}
      能转让客户={!企 || 能管公海(me, await 权限组织()) || (customer.salesOwnerId === me.id && 能转出自己的(me, await 权限组织()))}
      // 负责人本人转自己的 = 申请移交（X4）；市场成员手里的转给销售照旧直接转（P-转-17），按钮不改说法，结果按服务端回的
      转让要申请={
        企 && !customer.pool && !!customer.salesOwnerId && customer.salesOwnerId === me.id && 转自己客户要申请(me, await 权限组织())
        && !客户在市场手里((await 权限组织())!, { salesOwnerId: customer.salesOwnerId, pool: null })
      }
      自动分配={能自动分 ? 客户自动分配 : undefined}
      指定定向={指定定向}
      // 分配方向的默认值（11-18）：客户区域 → 那条暂不分配项目的所在地 → 客户的号 → 我的事业部；框里可以改
      // 兼条线总管理 / 销售管理的不限（市场分配限指定，接手人按普通转让 P-转-01）
      自动指定候选={能自动分 && 市场分配限指定(await 读组织(), me.id) ? await 可指定的人(await 读组织()) : undefined}
      自动分配方向={能自动分 ? await 客户默认分配方向(await 读组织(), customer.id, me.id, await 暂不分配项目of({ id: customer.id, salesOwnerId: customer.salesOwnerId!, bizLine: customer.bizLine })) : undefined}
      原负责人领不回={!!customer.pool && 拦原负责人() && (await 我放出去的公海客户([{ id: customer.id, 在公海: true, salesOwnerId: customer.salesOwnerId }], me.id)).length > 0}
      换负责人记录={换负责人记录}
      旺旺们={旺旺们}
      项目们={项目们}
      参与项目们={参与项目们}
      只读={只读}
      只读话={只读 === "全" ? await 只读话(defaultClient) : undefined}
      // 企业版「全」只读：横幅按这位为什么看得到来说（虚线下属 / 下属 / 本线 / 因参与项目 / 判不出说中性的），见 lib/enterprise/readonly-reason.ts
      只读横幅={企 && 只读 === "全" ? await (async () => {
        const org = await 权限组织();
        if (!org) return undefined;
        const 组员 = (await prisma.customer.count({ where: { id: customer.id, ...组员的客户(me.id) } })) > 0;
        return 只读横幅(只读原因of(org, me.id, customer.salesOwnerId, 组员), 负责人显示名(customer.salesOwner.name), (await getBusiness()).customer, await 只读话(defaultClient));
      })() : undefined}
      只能看的格={await 只能看的格P}
      管理员只读={企 && 只读角色(me, await 权限组织())}
      // 资料格给不给点、摆不摆笔：和 patchCustomer / patchCustomerRegion 的 改客户挡 同一口径（PR #401 实操：总管理看别人的、公海客户原来有笔存不了）
      // 公海里改的入口不摆，删按删除挡另判（#403 审查）：删联系人 = deleteContact 的 删除挡（负责人本人或系统管理员）；删联系人附件 = access.ts 公海里只按系统管理员
      资料改挡={企 && !只读 ? await (async () => {
        const org = await 权限组织();
        const 话 = 改客户挡of(me, { salesOwnerId: customer.salesOwnerId, 在公海: !!customer.pool }, org);
        if (!话) return null;
        return customer.pool ? { 话, 公海: true, 公海删: { 联系人: 能删除(me, org, customer.salesOwnerId), 附件: 能删除(me, org, null) } } : { 话, 公海: false };
      })() : null}
      // 摆不摆可点的「领取」（含无效客户灰着的领取和「要先恢复」那句）：和服务端 领取 同一把尺（能领公海：市管、渠运、项目组员、只看某人的都不摆，审查 29A）
      能领={!企 || 能领公海(me, await 权限组织())}
      // 公海回收站里的无效客户：系统管理员、回收站副手在详情页也能「恢复」（同公海列表 P-界面-44）；设了业务线的副手只恢复本线的（P-公海-07，服务端另拦）
      恢复无效={企 && !!customer.pool && !!customer.poolInvalidAt && 能恢复(me, await 权限组织())
        && !(await 公海别线的(prisma, me, await 权限组织(), { 客户: [customer.id] })).客户.length ? 恢复有效客户 : undefined}
      能新建项目={!企 || 能新建和领取(me, await 权限组织())}
      能改沟通={可改沟通}
      能删沟通={可删沟通}
      客户状态选项={客户状态选项}
      // 客户状态按字典项上色；项目模式开着按项目自动算（10-30，lib/enterprise/cust-status-auto-db.ts），章只读
      客户状态色={客户状态字典 ? 客户状态色表(客户状态字典) : undefined}
      客户状态自动={只项目}
      联系人分类附件数={联系人分类附件}
      关联们={关联们}
      号码种类={号码种类}
      // 联系人「职务」下拉的候选（10-31，字典 contactTitle）；走请求内缓存
      职务选项={职务选项}
      分配方式选项={分配方式选项}
      客户类型选项={客户类型选项}
      客户属性选项={客户属性选项}
      // 下拉里客户状态、客户类型每项的灰字释义（10-30）；字典上面已读过，走请求内缓存
      字典释义={字典释义}
      // 客户页「新建项目」（待定 16）：线索阶段的节点、开了超时回收要不要填下一步时间（同建档向导 projects/new/wizard-data.ts）
      新建项目={企 && 规则 ? { 节点们: [...企业版字典.节点们.线索], 要下一步: 规则.超时回收.开 } : null}
      联系人附件数={联系人附件数}
      customer={{
        id: customer.id,
        name: customer.name,
        phone: 号(customer.phone),
        school: customer.school,
        grade: customer.grade,
        major: customer.major,
        followStatus: customer.followStatus,
        decisionStatus: customer.decisionStatus,
        // 项目模式自动算：库里还没算过的（种子 / 导入的老数据）按名下项目现算一个显示，别和下面「项目（n）」对不上（11-03 C1-4）
        custStatus: 只项目 ? await 显示用客户状态(customer.id, customer.custStatus) : customer.custStatus,
        shortName: customer.shortName,
        customerNo: customer.customerNo,
        addrCountry: customer.addrCountry,
        addrProvince: customer.addrProvince,
        addrCity: customer.addrCity,
        addrDistrict: customer.addrDistrict,
        addrDetail: customer.addrDetail,
        assignWay: customer.assignWay,
        customerType: customer.customerType,
        customerAttr: customer.customerAttr,
        bizLine: customer.bizLine,
        archiveTier: customer.archiveTier,
        touchpoint: customer.touchpoint,
        expectedSignAt: scheduleValue(customer.expectedSignAt, customer.expectedSignOn),
        lastFollowAt: customer.lastFollowAt?.toISOString() ?? null,
        remark: customer.remark,
        referrerCustomerId: customer.referrerCustomerId,
        channelId: customer.channelId,
    channelName: customer.channel?.name ?? null,
        referrerName: customer.referrerCustomer?.name ?? customer.channel?.name ?? null,
        attributionName: customer.attributionChannel?.name ?? customer.attributionCustomer?.name ?? null,
        channelOwnerId: customer.channelOwnerId,
        channelOwnerName: customer.channelOwner?.name ?? null,
        salesOwnerId: customer.salesOwnerId,
        salesOwnerName: 负责人显示名(customer.salesOwner.name),
        signedAmount: customer.contracts.reduce((a, c) => a + 签约金额(c), 0),
        signedTotals: 签约合计(customer.contracts),
        // 标了无效（公海回收站，P-公海-09）：详情页和公海列表一样摆「无效」标、领取灰着（M-权限-03 无效客户不能领）
        pool: customer.pool ? { reason: customer.pool.reason, ...(企 && customer.poolInvalidAt ? { 无效: true } : {}) } : null,
        // WhatsApp 也是号码：共享试用区和电话一样打码
        extra: (() => { const x = 取档案(customer.extra); return { ...x, whatsapp: x.whatsapp && 号(x.whatsapp) }; })(),
        updatedAt: customer.updatedAt.toISOString(),
      }}
      contacts={[
        ...customer.contacts.map((c) => ({ ...联系人一行(c), ...(另挂[c.id] ? { 另挂: 另挂[c.id] } : {}) })),
        // 挂来的：主要联系人说的是主客户那边的，在这位客户上不算
        ...挂来的.map((x) => ({
          ...联系人一行(x.contact),
          isPrimary: false,
          挂靠: { linkId: x.linkId, note: x.note, 主客户Id: x.主客户.id, 主客户名: x.主客户.name, 主客户看得到: x.主客户.看得到, 能改: x.主客户.能改 },
        })),
      ]}
      contracts={customer.contracts.map((c) => ({
        id: c.id,
        amount: 签约金额(c),
        currency: 签约币种(c),
        signedAt: c.signedAt.toISOString(),
        remark: c.remark,
      }))}
      tasks={customer.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueAt: scheduleValue(t.dueAt, t.dueOn),
        dueHasTime: t.dueHasTime,
        done: t.done,
      }))}
      plan={
        customer.plans[0]
          ? {
              id: customer.plans[0].id,
              subject: customer.plans[0].subject,
              plannedAt: scheduleValue(customer.plans[0].plannedAt, customer.plans[0].plannedOn)!,
              plannedHasTime: customer.plans[0].plannedHasTime,
              method: customer.plans[0].method,
              updatedAt: customer.plans[0].updatedAt.toISOString(),
            }
          : null
      }
      followUps={汇总 ? 汇总.rows : customer.followUps.slice(0, 50).map(serializeFollowHistory)}
      followUpsHasMore={汇总 ? 汇总.hasMore : customer.followUps.length > 50}
      跟进去处={跟进去处}
      // 「跟进」菜单里的「转让」（P14 第 3 条）：同客户列表批量转让，选人后问原因（字典 transfer）
      转让原因={转让选项 ? { 选项: 转让选项, 自己: me.id } : undefined}
      // 待办里的跟进计划（P14 第 2 条）：这位客户所有没完成的（含项目判输时排的「潜客培育」），不止最早那一条
      待办计划={待办计划
        ? 待办计划
            .map((p) => ({ id: p.id, subject: p.subject, plannedAt: scheduleValue(p.plannedAt, p.plannedOn), plannedHasTime: p.plannedHasTime }))
            .sort((a, b) => (a.plannedAt ?? "").localeCompare(b.plannedAt ?? ""))
        : undefined}
    />
  );
}
