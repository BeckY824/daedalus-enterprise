import { scheduleValue, scheduleOrder, earliestScheduled } from "@/lib/schedule-date";
import { notFound } from "next/navigation";
import { 收藏了吗 } from "@/lib/favorites";
import { prisma, defaultClient } from "@/lib/prisma";
import { 历史负责人of } from "@/lib/owner-log-db";
import { 企业版 } from "@/lib/enterprise/switch";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import { 拦原负责人 } from "@/lib/enterprise/pool-rules";
import { requireUser } from "@/lib/auth";
import RecordView from "./RecordView";
import { followHistoryInclude, followHistoryOrder, serializeFollowHistory } from "./follow-history-query";
import { 负责人候选 } from "@/lib/owners";
import { 可选渠道 } from "@/lib/options";
import { llmEnabled } from "@/lib/llm";
import { 号码脱敏器 } from "@/lib/shared-ws/current";
import { 带币种, 签约金额, 签约币种, 签约合计, 商机币种 } from "@/lib/money-db";
import { 客户报价记录 } from "@/lib/quote-db";
import { 报价明细 } from "@/lib/features";
import { 客户来源线索 } from "@/lib/customer-lead-origin";
import { 取档案 } from "@/lib/customer-extra-db";
import { 只读客户 } from "@/lib/team-scope";
import { 管全队客户 } from "@/lib/constants";
import { 附件个数, 联系人分类附件数 } from "@/lib/attachments";
import { 关联客户们, 号码种类表, 联系人号码们, 客户的联系人们, 联系人另挂 } from "@/lib/enterprise/customer-v2-db";
import { 可选项 } from "@/lib/enterprise/dict";
import { 企业版字典 } from "@/lib/project/nodes";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 字典of } from "@/lib/project/stage-dict";
import { 客户参与的项目 } from "@/lib/project/relate";
import { 客户沟通汇总, 跟进去处们 } from "@/lib/enterprise/customer-follow-feed";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ focus?: string }>;
}) {
  const me = await requireUser();
  const { id } = await params;
  /*
    从到点提醒点进来（?focus=plan:…）：记录页只摆一条计划（最早那条），叫你的那条若不是最早的，
    点进来就找不到它、也闪不了（2026-10-02 排查 3-3）。这时摆的是叫你的那一条
  */
  const 要看的计划 = /^plan:(.+)$/.exec((await searchParams).focus ?? "")?.[1] ?? null;

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
      extra: true,
      // 该学员自己推荐来的人，用于展示推荐链下游
      referrals: { select: { id: true, name: true, followStatus: true }, orderBy: { createdAt: "desc" } },
      contracts: {
        orderBy: { signedAt: "desc" },
        include: 带币种.签约,
      },
      // 企业版联系人的号码几行（定稿 P5 第 24 条）；别的版本这张子表里没有挂联系人的行，带上也是空
      contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], include: { contactMethods: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { kind: true, value: true } } } },
      opportunities: { orderBy: { createdAt: "desc" }, include: 带币种.商机 },
      tasks: { orderBy: [{ done: "asc" }, { dueAt: "asc" }] },
      plans: { where: { done: false, ...(要看的计划 ? { id: 要看的计划 } : {}) }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }] },
      followUps: { orderBy: followHistoryOrder, take: 51, include: followHistoryInclude },
    },
  });

  if (!customer) notFound();
  // 叫你的那条已经做完 / 删了：照旧摆最早那条没做完的
  if (要看的计划 && customer.plans.length === 0) {
    customer.plans = await prisma.followPlan.findMany({ where: { customerId: id, done: false }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }] });
  }

  customer.plans = earliestScheduled(customer.plans, p => scheduleOrder(p.plannedAt, p.plannedOn), 1);

  // 演示区是公开的，同一份数据所有访客共用：号码一律打码。
  // 自己部署的实例不受影响——销售要照着这个号打电话。
  const 号 = await 号码脱敏器();

  // 推荐人候选不再跟页面一起下来，客户表单打开时才取（CustomerForm 的 useReferrerCandidates，2026-10-20）
  const [users, channels] = await Promise.all([负责人候选(), 可选渠道()]);
  const 企 = 企业版();
  // 号码类的几种（手机、座机、WhatsApp）和电话一样过脱敏器；微信、邮箱、旺旺照旧（同联系人老三格的口径）
  const 打码种类 = new Set(["phone", "landline", "whatsapp"]);
  // 企业版联系人挂多位客户（P13 第 1 条）：挂到这位的别人家联系人排在自家的后面；自家的另外挂在哪也带上
  const 挂来的 = 企 ? await 客户的联系人们(customer.id) : [];
  const 另挂 = 企 ? await 联系人另挂(customer.contacts.map((c) => c.id)) : {};
  const 全部联系人id = [...customer.contacts.map((c) => c.id), ...挂来的.map((x) => x.contact.id)];
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

  /*
    企业版只用项目（P14）：时间线换成「沟通记录」——这位客户在我看得到的各项目里的跟进 + 不属于任何项目的老跟进，只读；
    「跟进」按钮列这些项目、点了跳过去（lib/enterprise/customer-follow-feed.ts，服务端按项目可见范围滤）
  */
  const 只项目 = await 企业版只用项目();
  const 汇总 = 只项目 ? await 客户沟通汇总(me, customer.id) : null;

  return (
    <RecordView
      key={customer.id}
      sourceLead={await 客户来源线索(customer.id)}
      users={users}
      channels={channels}
      aiEnabled={await llmEnabled()}
      已收藏={await 收藏了吗(me.id, id)}
      能放公海={管全队客户(me.role) || customer.salesOwnerId === me.id}
      原负责人领不回={!!customer.pool && customer.salesOwnerId === me.id && 拦原负责人()}
      // 历史负责人只企业版摆；记录不管开没开都记着（换负责人那一刻写，开了以后之前的也看得到）
      换负责人记录={企业版() ? await 历史负责人of(customer.id) : []}
      // 企业版：只记在联系方式子表里的旺旺 ID（建档时第一步选了旺旺，客户表和档案里都没有这一格），基本资料里摆出来
      旺旺们={企业版()
        ? (await prisma.contactMethod.findMany({ where: { customerId: customer.id, contactId: null, kind: "wangwang" }, orderBy: { createdAt: "asc" }, select: { value: true } })).map((m) => m.value)
        : []}
      // 企业版只用项目：商机一节换成这位名下的项目（10-26）
      项目们={(await 企业版只用项目())
        ? await prisma.project.findMany({
            where: { customerId: customer.id },
            orderBy: { updatedAt: "desc" },
            select: { id: true, name: true, phase: true, node: true, result: true, pooledAt: true, amount: true, currency: true },
          })
        : null}
      // 企业版项目关联（P17）：这位关联在哪些项目上、什么身份；只列看得到的项目（限定层），概览名称按后台改过的出口叫法叫
      参与项目们={(await 企业版只用项目()) ? await 客户参与的项目(customer.id, 字典of(true, (await 生效组织规则()).阶段.出口叫法)) : null}
      // 团队开了互看、这位是同事的：只能看和加跟进（lib/team-scope.ts）
      只读={await 只读客户(defaultClient, customer)}
      // 企业版联系人附件（10-28）：每位联系人挂了几张；附件表不分权限，能看到这位客户就能看到他联系人的附件
      // 企业版客户状态（字典 custStatus，10-28 去遗留 A1）：标签行一枚章点了能改
      客户状态选项={企业版() ? await 可选项("custStatus") : []}
      联系人分类附件数={企 ? await 联系人分类附件数(defaultClient, 全部联系人id) : null}
      // 企业版客户改版（定稿 P5）：关联客户卡片、联系人号码类型、分配方式
      关联们={企 ? await 关联客户们(customer.id) : null}
      号码种类={企 ? (await 号码种类表()).map((x) => ({ 名: x.名, kind: x.kind, active: x.active })) : undefined}
      分配方式选项={企 ? await 可选项("custAssign") : undefined}
      客户类型选项={企 ? await 可选项("custType") : undefined}
      // 客户页「新建项目」（待定 16）：线索阶段的节点、开了超时回收要不要填下一步时间（同建档向导 projects/new/screen.tsx）
      新建项目={企 && (await 企业版只用项目()) ? { 节点们: [...企业版字典.节点们.线索], 要下一步: (await 生效组织规则()).超时回收.开 } : null}
      联系人附件数={企业版() ? Object.fromEntries((await 附件个数(defaultClient, { contactIds: 全部联系人id })).联系人) : null}
      customer={{
        id: customer.id,
        name: customer.name,
        phone: 号(customer.phone),
        school: customer.school,
        grade: customer.grade,
        major: customer.major,
        followStatus: customer.followStatus,
        decisionStatus: customer.decisionStatus,
        custStatus: customer.custStatus,
        shortName: customer.shortName,
        addrCountry: customer.addrCountry,
        addrProvince: customer.addrProvince,
        addrCity: customer.addrCity,
        addrDistrict: customer.addrDistrict,
        addrDetail: customer.addrDetail,
        assignWay: customer.assignWay,
        customerType: customer.customerType,
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
        salesOwnerName: customer.salesOwner.name,
        signedAmount: customer.contracts.reduce((a, c) => a + 签约金额(c), 0),
        signedTotals: 签约合计(customer.contracts),
        pool: customer.pool ? { reason: customer.pool.reason } : null,
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
      报价记录={报价明细 ? await 客户报价记录(customer.id) : []}
      contracts={customer.contracts.map((c) => ({
        id: c.id,
        amount: 签约金额(c),
        currency: 签约币种(c),
        signedAt: c.signedAt.toISOString(),
        remark: c.remark,
      }))}
      opportunities={customer.opportunities.map((o) => ({
        id: o.id,
        name: o.name,
        amount: o.amount,
        currency: 商机币种(o),
        stage: o.stage,
        status: o.status,
        probability: o.probability,
        expectedDealAt: o.expectedDealAt?.toISOString() ?? null,
        createdAt: o.createdAt.toISOString(),
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
      跟进去处={只项目 ? await 跟进去处们(me, customer.id) : null}
      // 「跟进」菜单里的「转让」（P14 第 3 条）：同客户列表批量转让，选人后问原因（字典 transfer）
      转让原因={只项目 ? { 选项: await 可选项("transfer"), 自己: me.id } : undefined}
      // 待办里的跟进计划（P14 第 2 条）：这位客户所有没完成的（含项目判输时排的「潜客培育」），不止最早那一条
      待办计划={只项目
        ? (await prisma.followPlan.findMany({ where: { customerId: customer.id, done: false }, orderBy: [{ plannedAt: "asc" }, { id: "asc" }], take: 20 }))
            .map((p) => ({ id: p.id, subject: p.subject, plannedAt: scheduleValue(p.plannedAt, p.plannedOn), plannedHasTime: p.plannedHasTime }))
            .sort((a, b) => (a.plannedAt ?? "").localeCompare(b.plannedAt ?? ""))
        : undefined}
    />
  );
}
