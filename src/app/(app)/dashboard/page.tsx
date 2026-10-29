import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { 自动掉公海 } from "@/lib/pool-db";
import { 公海超时收回 } from "@/lib/project/db";
import { llmEnabled, listModelOptions } from "@/lib/llm";
import { 唯一负责人 } from "@/lib/owners";
import { dayjs } from "@/lib/utils";
import { getBusiness } from "@/lib/business";
import { statusLabel, 外贸订单 } from "@/lib/business-config";
import { loadWatchlistPage } from "@/lib/sentinel-data";
import HomeChat, { type Suggestion } from "./HomeChat";
import StartCard from "./StartCard";
import { 读对话 } from "./threads";
import { 数逾期跟进 } from "@/lib/overdue";
import { 带币种, 签约合计 } from "@/lib/money-db";
import { 取提醒项 } from "@/lib/reminders-db";
import { 算提醒 } from "@/lib/reminders";
import { multiTenant } from "@/lib/tenant/context";
import { 企业版 } from "@/lib/enterprise/switch";
import { 自定产品名 } from "@/lib/enterprise/brand";
import { 读满额提醒 } from "@/lib/enterprise/lead-full-notice";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import NoAiHome from "./NoAiHome";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 能导入导出 } from "@/lib/enterprise/import-perm";
import { 数新线索 } from "@/lib/project/list";
import { 项目一段 } from "../overview/project-stats";

export const dynamic = "force-dynamic";

/** 客户自己部署的服务器（企业版、自部署网页版）：空库那张「开始」卡不说「数据只在你的电脑上」 */
const 自己服务器 = () => !multiTenant();
/** 企业版能导入的人（import-perm.ts，和设置里「导入记录」同一个口径）：空库「开始」卡的主按钮是去企业版导入（企业版不给灌演示数据，见 demo-data.ts） */
const 去导入 = async (user: { id: string; role: string }) => 企业版() && !multiTenant() && (await 能导入导出(user));
/** 首页「有 N 条新线索」：企业版只用项目数线索阶段的项目（和 /leads 同一张表），其余照旧数 Lead 表 */
const 数线索 = (只用项目: boolean) => (只用项目 ? 数新线索() : prisma.lead.count());

/**
 * 首页。配了 AI 就是一个对话面（指标图表去了 /overview）；没配 AI 是「AI 还没配」那一屏（NoAiHome）。
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ q?: string; c?: string }> }) {
  const user = await requireUser();
  // 公海：开了「N 天没跟进自动放进公海」就一天扫一次（lib/pool-db.ts）。首页是每天第一眼，在这儿扫
  await 自动掉公海(user);
  // 企业版超时回收：项目在节点上超过处理时长没跟进，回到项目公海（lib/project/db.ts，没开不扫）
  if ((await getBusiness()).projectMode === true) await 公海超时收回(user).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e));
  /*
    地址上的 ?c= 指哪条对话。在服务端读，不在浏览器里再取一次：
    翻一条老对话时不该先看见一屏空白再看见内容。
    读不到（别人的、删掉的）就当没给——落到一屏新对话，不报错。
  */
  const sp0 = await searchParams;
  const 对话 = sp0.c ? await 读对话(sp0.c) : null;
  // 企业版自动分配因都已满额没分出去的提醒：首页顶部也摆一份，和线索页同一份数据，哪边关了两边都没了
  const 满额提醒们 = 企业版() ? await 读满额提醒(user.id) : [];
  // 企业版项目：首页只做对话（2026-10-26 用户定），数据只在「数据」页
  const 只用项目 = await 企业版只用项目();
  if (!(await llmEnabled())) {
    /*
      **一条业务数据都没有**的时候，第一次打开的人最需要的是一个起点——所以空库时不论配没配 AI，
      首页都是那张「开始」卡。配了 AI 的那条路在 HomeChat 里做同样的判断。
    */
    const 学员数 = await prisma.customer.count();
    if (学员数 === 0 && (await 数线索(只用项目)) === 0) {
      // StartCard 自带那句「欢迎使用 <产品名>」，这里不再叠一个页头
      return <StartCard 自己服务器={自己服务器()} 去导入={await 去导入(user)} 企业版={企业版()} 产品名={自定产品名() ?? undefined} />;
    }
    // 老的数据看板（Board / DashboardView）10-28 删了：企业版只用项目，没配 AI 的首页一律是这一屏
    return <NoAiHome 管理员={user.role === "ADMIN"} 满额提醒={满额提醒们} />;
  }

  const b = await getBusiness();
  const now = dayjs();
  const [提醒项, 没做完的待办, myPlans, myLast, mine, models, 逾期, 高意向, 本月签约, 学员数, 线索数] = await Promise.all([
    // 欢迎句「今天要跟 N 条」和左栏角标、Dock 同一个函数（lib/reminders）：计划 + 待办、逾期 + 今天（排查 C5）
    取提醒项(user.id),
    prisma.task.count({ where: { ownerId: user.id, done: false } }),
    prisma.followPlan.count({ where: { ownerId: user.id, done: false } }),
    prisma.followUp.findFirst({ where: { ownerId: user.id }, orderBy: { occurredAt: "desc" }, select: { customer: { select: { name: true } } } }),
    // 只看我名下的、先筛再排前 8（排查 C7）。原来先取全团队前 8 再按姓名筛，会数漏、重名会混
    loadWatchlistPage(now, { ownerId: user.id }),
    listModelOptions(),
    /*
      首页那一行信号。三个数都必须是**这一刻真查出来的**，而且每个都能点到
      一个能把它重新数一遍的页面去——首页上写死过一次数字（手工测试清单里记着），
      从那以后规矩是：算不出来就不显示，绝不摆一个看起来像那么回事的数。
    */
    // 计划 + 待办都算，和点进去的计划页「我的 · 逾期」、数据页那张卡同一个函数（lib/overdue.ts）
    数逾期跟进(prisma, { ownerId: user.id }),
    // 公海里的不算：点进去是客户列表的「客户」页签，那里不含公海（2026-10-13），数要对得上
    // 企业版只用项目时这一格换成客户状态「意向」（下面的企业信号），跟进状态不用数
    只用项目 ? 0 : prisma.customer.count({ where: { followStatus: "意向较高", pool: { is: null } } }),
    // 取行按币种合计（不换汇）：币种在 ContractMoney 上，aggregate 分不了。
    // 企业版只用项目时这一格换成「本月成交」（下面的企业信号，Signals 里整格替掉），合同不用查
    只用项目 ? [] : prisma.contract.findMany({ select: { amount: true, ...带币种.签约 }, where: { signedAt: { gte: now.startOf("month").toDate(), lt: now.add(1, "month").startOf("month").toDate(), lte: now.toDate() } } }),
    prisma.customer.count(),
    数线索(只用项目),
  ]);

  /*
    企业版只用项目（10-28 去遗留 A1 / A4）：「高意向」改数客户状态「意向」的（同样不含公海）；
    「本月签约」改「本月成交」，和数据页同一个函数（这个月转了订单或成功交付的项目，一个项目只数一次）
  */
  const 企业信号 = 只用项目
    ? {
        意向: await prisma.customer.count({ where: { custStatus: "意向", pool: { is: null } } }),
        本月成交: (await 项目一段(now.startOf("month").toDate(), now.endOf("month").toDate(), "day", b.currency)).成交,
      }
    : undefined;

  const 就我一个人 = (await 唯一负责人()) !== null;
  const parts: string[] = [];
  const 要跟 = 算提醒(提醒项);
  const 今天要跟 = 要跟.逾期 + 要跟.今天;
  const 没做完 = myPlans + 没做完的待办;
  parts.push(
    今天要跟 > 0
      ? `今天要跟 ${今天要跟} 条${要跟.逾期 ? `（${要跟.逾期} 条已逾期）` : ""}`
      : 没做完 > 0
        ? `有 ${没做完} 条没做完的计划和待办`
        : "今天没有要跟的",
  );
  if (mine.total > 0) parts.push(`${mine.total} 位${b.customer}正在被遗忘`);
  if (myLast?.customer.name) parts.push(`上次跟的是${myLast.customer.name}`);
  if (线索数 > 0) parts.push(`有 ${线索数} 条${只用项目 ? "新线索" : "线索"}`);

  /*
    输入框底下那排问题。设计稿要求 4-6 条，而且**每一条都要是具体的问题**，
    不是「试试问我点什么」这种。所以分两段：
      先放这个库里真有的东西——名下有计划就「准备下次跟进」，有正在被遗忘的人就点名问他；
      再用一组任何时候都问得出答案的兜底补到至少四条。
    兜底不是凑数：这四条问的都是真表真列（计划、签约、商机阶段、跟进记录），
    空库时首页压根不走这条路（走 StartCard），所以不存在「点了什么也答不出来」。
  */
  const suggestions: Suggestion[] = [];
  if (线索数 > 0) suggestions.push({label:"跟进手上的线索",question:"列出待跟进的线索，帮我确认接下来跟哪一条"});
  if (myPlans > 0) suggestions.push({ label: "准备下次跟进", question: "", kind: "prep" });
  if (myLast) suggestions.push({ label: "回顾上次沟通", question: "", kind: "recap" });
  for (const w of mine.items.slice(0, 2)) suggestions.push({ label: `${w.customerName}：${w.reason.replace(/^「[^」]*」的\S+?/, "")}`, question: `${w.customerName}这边该怎么接上？` });
  /*
    **一个人用的时候，团队类的问句是废话。**

    「这个月谁签得最多」在单人库里答案永远是「就你自己」——点一下，
    烧掉当天三次免费提问里的一次，换回一句他早就知道的话
    （只有开户那 30 次、一台电脑一份，用完不补，见 lib/tenant/credits.ts）。
    这和 0.40 之前注册页写着「送 30 次」是同一类毛病：**界面上说着一句在你这儿不成立的话**。

    判据用现成的 `唯一负责人()`——建档、导入、商机、渠道四处早就在用它决定
    「要不要问负责人」，这里是第五处，口径一致。
    单人那一套问的是「我」：我这周做了什么、谁被我落下了、我手上还剩多少。
  */
  /*
    企业版项目没有「商机」这张表的入口（2026-10-26 去掉了），AI 那边也还不认项目，
    所以问商机、问签约的两条换成问跟进的——问出来的东西用户点得进去
  */
  const 兜底: Suggestion[] = 只用项目
    ? [
        { label: `今天谁最需要跟进？`, question: `今天最该跟进的${b.customer}是谁，为什么` },
        { label: `哪些${b.customer}很久没碰了？`, question: `哪些${b.customer}很久没跟进了，该先找谁` },
        { label: "我这周做了什么？", question: "我这周做了什么" },
        // 企业版不问跟进状态（10-28 去遗留 A1：企业版用客户状态，AI 那边还不认它，问了答不上）
        { label: "帮我记一次电话", question: "帮我记一次电话沟通" },
      ]
    : 就我一个人
    ? [
        { label: "我这周做了什么？", question: "我这周做了什么" },
        { label: `哪些${b.customer}我很久没碰了？`, question: `哪些${b.customer}我很久没跟进了，该先找谁` },
        { label: "我手上还有哪些单子在谈？", question: "我手上进行中的商机有哪些，加起来多少钱" },
        { label: `各跟进状态各有多少${b.customer}？`, question: `各跟进状态各有多少${b.customer}` },
        { label: "帮我记一次电话", question: "帮我记一次电话沟通" },
      ]
    : [
        { label: `今天谁最需要跟进？`, question: `今天最该跟进的${b.customer}是谁，为什么` },
        外贸订单(b)
          ? { label: "这个月谁的订单最多？", question: "这个月哪个业务员的订单金额最多" }
          : { label: "这个月谁签得最多？", question: "这个月哪个销售的签约金额最多" },
        { label: "哪些商机可能延期？", question: "哪些进行中的商机已经很久没动了，可能延期" },
        { label: `各跟进状态各有多少${b.customer}？`, question: `各跟进状态各有多少${b.customer}` },
        { label: "帮我记一次电话", question: "帮我记一次电话沟通" },
      ];
  for (const x of 兜底) if (suggestions.length < 6) suggestions.push(x);


  return (
    <HomeChat
      会话={对话}
      userName={user.name}
      suggestions={suggestions.slice(0, 6)}
      context={parts.join("，") + "。"}
      models={models}
      /* 一条业务数据都没有：首页换成一张「开始」卡，不摆信号也不摆指标 */
      自己服务器={自己服务器()}
      去导入={await 去导入(user)}
      企业版={企业版()}
      满额提醒={满额提醒们}
      渠道名们={只用项目 ? (await prisma.channel.findMany({ where: { active: true }, select: { name: true }, orderBy: { name: "asc" } })).map((c) => c.name) : undefined}
      要下一步={只用项目 ? (await 生效组织规则()).超时回收.开 : false}
      空库={学员数 === 0 && 线索数 === 0 && mine.total === 0 && myPlans === 0 && 没做完的待办 === 0}
      信号={{
        逾期,
        高意向,
        本月签约: 签约合计(本月签约),
        高意向标签: statusLabel(b, "意向较高"),
        ...(企业信号 ? { 企业: 企业信号 } : {}),
      }}
    />
  );
}
