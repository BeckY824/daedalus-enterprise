import { 签约叫 } from "@/lib/business-config";
import { requireUser } from "@/lib/auth";
import { dayjs } from "@/lib/utils";
import ReportsView from "../reports/ReportsView";
import { 加载复盘 } from "./data";
import { 视图们, type 视图 } from "./views";
import DataShell from "./DataShell";
import { 唯一负责人 } from "@/lib/owners";
import { getBusiness } from "@/lib/business";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";
import { 项目现在, 项目一段 } from "./project-stats";
import { ProjectNowView, ProjectPeriodView } from "./ProjectStatsView";
import BoardTodos from "./BoardTodos";
import { 看板的人 } from "@/lib/project/board-member";
import { 复盘待办of } from "@/lib/project/board-todos-db";
import { 读页签, 读卡, 读类型, 读页码 } from "@/lib/project/board-todos";

export const dynamic = "force-dynamic";

type SP = Promise<{ view?: string; currency?: string; ownerId?: string; tab?: string; f?: string; kind?: string; p?: string }>;

/**
 * 「数据」——看数的唯一入口。
 *
 * 以前有三处：首页那个看板、`/overview`、`/reports`，外加两个各自独立的问答框。
 * 新来的人分不清该去哪儿，老用户也记不住哪个数在哪一页。现在合成一页三视图：
 *   现在 —— 此刻的状态：指标、漏斗、业绩排行、盯盘
 *   本月 —— 这个月签了多少，按天铺开，按人和渠道拆
 *   本年 —— 今年的走势，按月铺开
 * `/reports` 这条 URL 留着（有人存了书签、也有链接指过来），跳到「本年」。
 */
export default async function DataPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: 视图 = (视图们 as readonly string[]).includes(sp.view ?? "") ? (sp.view as 视图) : "现在";

  // 企业版只用项目：三个视图都按项目数（10-26 用户：「「数据」页改成按项目统计」）
  if (await 企业版只用项目()) return <项目数据 view={view} user={user} sp={sp} />;

  // 不按项目时的「现在」原来是老数据看板（Board），10-28 删了（企业版只用项目，到不了），落到「本月」
  const now = dayjs();
  const 本月 = view !== "本年";
  const from = (本月 ? now.startOf("month") : now.startOf("year")).toDate();
  const to = (本月 ? now.endOf("month") : now.endOf("year")).toDate();
  const 业务 = await getBusiness();
  const 按 = 签约叫(业务) === "订单" ? "按订单确认日期算" : "按签约日期算";
  const 口径 = 本月 ? `${now.format("YYYY 年 M 月")}，${按}` : `${now.year()} 年，${按}`;

  const 本位币 = 业务.currency;
  const [数, 唯一] = await Promise.all([
    加载复盘(from, to, 本月 ? "day" : "month", { 想看: sp.currency?.toUpperCase(), 本位币 }),
    唯一负责人(),
  ]);
  const 只有一个人 = 唯一 !== null && [...数.bySales, ...数.byChannelOwner].every((r) => r.id === 唯一 || r.id === "__none__");
  return (
    <DataShell view={view}>
      <ReportsView {...数} 口径={口径} 单人={只有一个人} />
    </DataShell>
  );
}

/**
 * 按项目数的复盘页（P15）。两个页签（10-29 用户定）：「待办」（默认）｜「数据」，地址栏 tab= 记着；
 * 只取当前页签要的数——在「待办」不查图表，在「数据」不查待办。
 * 按成员看：管理层地址栏 ownerId 选人（下拉在 DataShell，页签上面、两个页签共用），业务员强制只看自己；
 * 只看某一个人时，图表、按负责人那张表（藏掉）和待办都只数他的。
 */
async function 项目数据({ view, user, sp }: { view: 视图; user: { id: string; role: string }; sp: Awaited<SP> }) {
  const 人 = await 看板的人(user, sp.ownerId);
  const 只看 = 人.只看;
  const 选人 = 人.选项 ? { 选项: 人.选项, 当前: 只看 ?? "" } : undefined;
  const 页签 = 读页签(sp.tab, sp.view);

  if (页签 === "todo") {
    const 卡 = 读卡(sp.f);
    const 类型 = 读类型(sp.kind);
    const d = await 复盘待办of(只看, { 卡, 类型, 页: 读页码(sp.p) });
    return (
      <DataShell view={view} 项目 选人={选人} 页签="todo">
        <BoardTodos 数={d} 卡={卡} 类型={类型} 只看自己={只看 === user.id} 看全员={只看 !== user.id} />
      </DataShell>
    );
  }

  const 业务 = await getBusiness();
  const 本位币 = 业务.currency;
  if (view === "现在") {
    const [数, 唯一] = await Promise.all([项目现在(本位币, 只看), 唯一负责人()]);
    return (
      <DataShell view={view} 项目 选人={选人} 页签="data">
        <ProjectNowView 数={数} 本位币={本位币} 单人={!!只看 || (唯一 !== null && 数.按人.every((r) => r.id === 唯一))} />
      </DataShell>
    );
  }
  const now = dayjs();
  const 本月 = view === "本月";
  const from = (本月 ? now.startOf("month") : now.startOf("year")).toDate();
  const to = (本月 ? now.endOf("month") : now.endOf("year")).toDate();
  const 口径 = 本月 ? now.format("YYYY 年 M 月") : `${now.year()} 年`;
  const [数, 唯一] = await Promise.all([项目一段(from, to, 本月 ? "day" : "month", 本位币, 只看), 唯一负责人()]);
  return (
    <DataShell view={view} 项目 选人={选人} 页签="data">
      <ProjectPeriodView 数={数} 本位币={本位币} 口径={口径} 单人={!!只看 || (唯一 !== null && 数.按人.every((r) => r.id === 唯一))} />
    </DataShell>
  );
}
