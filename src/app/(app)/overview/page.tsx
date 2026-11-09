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
import { 复盘待办of, 复盘看板of } from "@/lib/project/board-todos-db";
import { 读页签, 读卡, 读页码, 读布局 } from "@/lib/project/board-todos";
import { 读卡点看板筛, 读沟通段, 读沟通方式 } from "@/lib/project/review-tabs";
import { 将回公海of, 缺沟通of, 复盘概况of, 客户分布of } from "@/lib/project/review-extras-db";
import { 复盘沟通of } from "@/lib/project/review-tabs-db";
import { 卡点看板, 卡点给界面 } from "@/lib/project/blocker";
import BoardBlockers from "./BoardBlockers";
import BoardTalks from "./BoardTalks";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 读日期段, 日期段界, 日期段粒度, 日期段叫法, type 日期段 } from "@/lib/custom-date-range";

export const dynamic = "force-dynamic";

type SP = Promise<{ view?: string; from?: string; to?: string; currency?: string; ownerId?: string; tab?: string; f?: string; kind?: string; t?: string; tf?: string; tt?: string; p?: string; lay?: string; m?: string; bm?: string; bo?: string; br?: string; bt?: string; bi?: string; bp?: string }>;

/**
 * 「数据」——看数的唯一入口。
 *
 * 以前有三处：首页那个看板、`/overview`、`/reports`，外加两个各自独立的问答框。
 * 新来的人分不清该去哪儿，老用户也记不住哪个数在哪一页。现在合成一页三视图：
 *   现在 —— 此刻的状态：指标、漏斗、业绩排行、盯盘
 *   本月 —— 这个月签了多少，按天铺开，按人和渠道拆
 *   本年 —— 今年的走势，按月铺开
 *   自定义 —— from= to= 两个日历日（两头都算），62 天以内按天铺、再长按月（V3.5.1 P-界面-10）
 * `/reports` 这条 URL 留着（有人存了书签、也有链接指过来），跳到「本年」。
 */
export default async function DataPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: 视图 = (视图们 as readonly string[]).includes(sp.view ?? "") ? (sp.view as 视图) : "现在";

  // 企业版只用项目：三个视图都按项目数（10-26 用户：「「数据」页改成按项目统计」）
  if (await 企业版只用项目()) return <项目数据 view={view} user={user} sp={sp} />;

  // 不按项目时的「现在」原来是老数据看板（Board），10-28 删了（企业版只用项目，到不了），落到「本月」
  const 业务 = await getBusiness();
  const 按 = 签约叫(业务) === "订单" ? "按订单确认日期算" : "按签约日期算";
  const 一段 = 这一段(view, sp);
  const 口径 = `${一段.口径}，${按}`;

  const 本位币 = 业务.currency;
  const [数, 唯一] = await Promise.all([
    加载复盘(一段.from, 一段.to, 一段.粒, { 想看: sp.currency?.toUpperCase(), 本位币 }),
    唯一负责人(),
  ]);
  const 只有一个人 = 唯一 !== null && [...数.bySales, ...数.byChannelOwner].every((r) => r.id === 唯一 || r.id === "__none__");
  return (
    <DataShell view={view} 段={一段.段}>
      <ReportsView {...数} 口径={口径} 单人={只有一个人} />
    </DataShell>
  );
}

/**
 * 按项目数的复盘页（P15）。四个页签（P7 U-复盘-01，10-31）：「任务」（默认，键 todo）｜「卡点」｜「沟通」｜「数据」，地址栏 tab= 记着；
 * 只取当前页签要的数——在「任务」不查图表，在「数据」不查待办，卡点、沟通各查各的。
 * 按成员看：管理层地址栏 ownerId 选人（下拉在 DataShell，页签上面、两个页签共用），业务员强制只看自己；
 * 只看某一个人时，图表、按负责人那张表（藏掉）和待办都只数他的。
 * 默认「全部」（10-29 定稿）：总管理 / 管理员 = 所有人；别的上级 = 自己 + 实线下属整条链 + 虚线下属（看板的人 的 谁，同项目列表的负责人范围），
 * 这一圈在服务端按负责人筛，地址栏塞别人的 id 也只回落到「全部」。
 */
async function 项目数据({ view, user, sp }: { view: 视图; user: { id: string; role: string }; sp: Awaited<SP> }) {
  const 人 = await 看板的人(user, sp.ownerId);
  const 只看 = 人.只看;
  const 范围 = 只看 ?? 人.谁;
  // 我 = 「我的 / 团队」快捷分段用（只是下拉的快捷键，范围还是 看板的人 定）
  const 选人 = 人.选项 ? { 选项: 人.选项, 当前: 只看 ?? "", 我: user.id } : undefined;
  const 页签 = 读页签(sp.tab, sp.view);

  if (页签 === "todo") {
    const 卡 = 读卡(sp.f);
      // 「全部待办」默认三列看板（lay=list 回到表格）；四张卡筛的时候照旧是表格（首页链接 f=today 落表格）
    const 布局 = 卡 === "all" ? 读布局(sp.lay) : "list";
    const [d, 板, 回公海] = await Promise.all([
      布局 === "list" ? 复盘待办of(范围, { 卡, 页: 读页码(sp.p), 我id: user.id }) : undefined,
      布局 === "board" ? 复盘看板of(范围, { 我id: user.id }) : undefined,
      将回公海of(范围),
    ]);
    return (
      <DataShell view={view} 项目 选人={选人} 页签="todo">
        <BoardTodos 数={d} 看板={板} 布局={布局} 回收={回公海.提醒} 卡={卡} 只看自己={只看 === user.id} 看全员={只看 !== user.id} />
      </DataShell>
    );
  }

  // 卡点、沟通：范围同上，用 看板的人 的 谁（选了人 = [他]；总管理、管理员看全部 = 不限）
  const 谁 = 只看 ? [只看] : 人.谁;
  // 卡点（11-01 B15）：三栏看板，谁看得到按卡点的角色开关（只看自己 / 可看全部），不跟上面的人员选择走
  if (页签 === "block") {
    const 筛 = 读卡点看板筛(sp);
    const d = await 卡点看板(user, 筛);
    return (
      <DataShell view={view} 项目 页签="block">
        <BoardBlockers
          开={d.开}
          全部={d.全部}
          栏={{ 待接受: d.栏.待接受.map(卡点给界面), 处理中: d.栏.处理中.map(卡点给界面), 已解决: d.栏.已解决.map(卡点给界面) }}
          已解决共={d.已解决共}
          统计={d.统计}
          项目们={d.项目们}
          原因们={d.原因们}
          筛={筛}
        />
      </DataShell>
    );
  }
  if (页签 === "talk") {
    const 段 = 读沟通段(sp.t);
    // 自定义（t=custom）：tf= tt= 两头都算，缺 / 错 = 本月 1 号到今天
    const 区间 = 段 === "custom" ? 读日期段(sp.tf, sp.tt) : undefined;
    const 方式 = 读沟通方式(sp.m);
    const [d, 缺] = await Promise.all([复盘沟通of(谁, { 段, 区间, 方式, 页: 读页码(sp.p) }), 缺沟通of(范围)]);
    return (
      <DataShell view={view} 项目 选人={选人} 页签="talk">
        <BoardTalks 数={d} 段={段} 区间={区间} 方式={方式} 缺={缺} 只看自己={只看 === user.id} />
      </DataShell>
    );
  }

  const 业务 = await getBusiness();
  const 本位币 = 业务.currency;
  if (view === "现在") {
    const [数, 唯一, 概况, 规则, 客户] = await Promise.all([项目现在(本位币, 范围), 唯一负责人(), 复盘概况of(范围, user, 本位币), 生效组织规则(), 客户分布of(范围)]);
    return (
      <DataShell view={view} 项目 选人={选人} 页签="data">
        <ProjectNowView 数={数} 本位币={本位币} 概况={概况} 客户={客户} 出口叫法={规则.阶段.出口叫法} 单人={!!只看 || (唯一 !== null && 数.按人.every((r) => r.id === 唯一))} />
      </DataShell>
    );
  }
  const 一段 = 这一段(view, sp);
  const [数, 唯一, 规则] = await Promise.all([项目一段(一段.from, 一段.to, 一段.粒, 本位币, 范围), 唯一负责人(), 生效组织规则()]);
  return (
    <DataShell view={view} 项目 选人={选人} 页签="data" 段={一段.段}>
      <ProjectPeriodView 数={数} 本位币={本位币} 口径={一段.口径} 出口叫法={规则.阶段.出口叫法} 单人={!!只看 || (唯一 !== null && 数.按人.every((r) => r.id === 唯一))} />
    </DataShell>
  );
}

/**
 * 「本月」「本年」「自定义」看哪一段（「现在」不走这里；不按项目时「现在」落到本月）。
 * 自定义的 段 给 DataShell 回显在 RangePicker 上（地址栏缺 / 错时回显的是落到的默认那段）
 */
function 这一段(view: 视图, sp: { from?: string; to?: string }): { from: Date; to: Date; 粒: "day" | "month"; 口径: string; 段?: 日期段 } {
  if (view === "自定义") {
    const 段 = 读日期段(sp.from, sp.to);
    return { ...日期段界(段), 粒: 日期段粒度(段), 口径: 日期段叫法(段), 段 };
  }
  const now = dayjs();
  const 本年 = view === "本年";
  return {
    from: (本年 ? now.startOf("year") : now.startOf("month")).toDate(),
    to: (本年 ? now.endOf("year") : now.endOf("month")).toDate(),
    粒: 本年 ? "month" : "day",
    口径: 本年 ? `${now.year()} 年` : now.format("YYYY 年 M 月"),
  };
}
