import { 规整公海属性, 是快捷, 规整排序 } from "@/lib/enterprise/unified-pool";
import { 阶段们 } from "@/lib/project/stage-dict";
import { 是日期 } from "@/lib/custom-date-range";
import { 读批次, 批次参数 } from "@/lib/project/import-batch";

/** 公海页地址栏（page.tsx 的 searchParams）：attr 公海属性、quick 快捷按钮、sort pooled / follow / created，其余见各字段 */
export type 公海页地址 = { keyword?: string; attr?: string; quick?: string; sort?: string; channelId?: string; page?: string; pageSize?: string;
  /** 渠道名单（渠道页「另 M 条在公海」点进来，11-11）：项目来源渠道（项目没填跟客户来源）+ 同口径的阶段；按项目一条一行 */
  projChannel?: string; phase?: string;
  /** 项目创建时间（渠道看板 TOP5 点进来带时间段，11-11）：两个日历日，北京日，和项目列表同名同读法；带了也按项目一条一行 */
  createdFrom?: string; createdTo?: string;
  /** =1：渠道分档点进来的，按创建时间筛时排掉补建的项目（同项目列表 onlyNew） */
  onlyNew?: string;
  /** =1：渠道页「关联线索」、数据页「公海里还有 N 个」点进来的，只看没结局的（同项目列表 open） */
  open?: string;
  /** 号码不全（三态 T10）：=1 只看三态自动收回时打了「号码不全」的客户 */
  phoneIncomplete?: string;
  /** 导入批次（11-19，lib/project/import-batch.ts）：数据页「公海里还有 N 个」点进来带的；带了按项目一条一行，同项目列表 batch */
  batch?: string };

/**
 * 公海页认地址栏，读成筛选（服务端取数用，也原样回给界面当 filters）。
 * open / onlyNew 不进筛选栏、不算「在筛」，但要跟着 filters 回给界面：界面翻页、换池、改筛选都按 filters 重拼地址（url-filters.ts），
 * 不回显就在第一次翻页时丢了，名单里混进已结束的项目，条数和点进来的那张卡对不上（审查 #368）
 */
export function 读公海页筛(sp: 公海页地址) {
  return {
    keyword: (sp.keyword ?? "").trim(),
    attr: 规整公海属性(sp.attr),
    quick: 是快捷(sp.quick) ? sp.quick : "",
    // 默认排序不写进地址：筛选栏的「重置」看得出没在筛
    sort: sp.sort && 规整排序(sp.sort) === sp.sort ? sp.sort : "",
    channelId: (sp.channelId ?? "").trim(),
    projChannel: (sp.projChannel ?? "").trim(),
    // 阶段只认三个，认不出的当没筛（同项目列表 阶段进程条件）
    phase: 阶段们.includes(sp.phase as never) ? sp.phase! : "",
    // 写错的那头当没给（custom-date-range.ts 创建时间段 同样认）
    createdFrom: 是日期(sp.createdFrom) ? sp.createdFrom : "",
    createdTo: 是日期(sp.createdTo) ? sp.createdTo : "",
    phoneIncomplete: sp.phoneIncomplete === "1" ? "1" : "",
    // 认不出的当没筛
    batch: 批次参数(读批次(sp.batch)),
    onlyNew: sp.onlyNew === "1" ? "1" : "",
    open: sp.open === "1" ? "1" : "",
  };
}
export type 公海页筛 = ReturnType<typeof 读公海页筛>;

/** 按项目一条一行（渠道名单 / 创建时间 / 导入批次）：这几样有一样就是 */
export const 按名单 = (f: Pick<公海页筛, "projChannel" | "createdFrom" | "createdTo" | "batch">) => !!(f.projChannel || f.createdFrom || f.createdTo || f.batch);
