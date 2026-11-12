/**
 * 企业版统一公海（2026-10-29，P7）：客户公海和项目公海合成一页 /pool，按「公海属性」分开看。
 * 这里只放规矩和说法，浏览器和服务端共用（不引 prisma）；查库在 unified-pool-db.ts，页面在 app/(app)/pool/。
 *
 * 一行是什么：
 *   - 客户行：在客户公海里的客户（有 CustomerPool 那一行）。名下放在项目公海里的项目不另列一行——领客户即领项目（pool-link.ts）
 *   - 项目行：在项目公海里、客户却不在客户公海的项目（客户归别人、只是项目归他；名下有没结束的订单项目，客户没跟着进）。
 *     页面上同一位客户的项目行并成一行（客户池，11-11）：见 并客户池；领取、分配、撤销仍按项目做
 *
 * 公海属性（算出来的，不存），页面上的筛选是 全部 / 线索池 / 商机池 / 订单池 / 客户池，全部 = 四者之和（11-11 用户定，取消「其他」）。
 *   一行归哪个池只由 归池 一个纯函数定（11-11 用户定，以后改定义只改它）：
 *   线索池 / 商机池 / 订单池只放客户行（整个客户没人负责），按客户定的状态分（客户定状态，A-01 / M-公海-08 的两层，11-11 起每层「从低往高」）——
 *   - 名下有没结束的项目：取没结束的里阶段最低的那个（线索 → 商机 → 订单，先看有没有线索的）
 *   - 都结束了：取结局所在阶段最低的那个（线索流失归线索，丢单归商机，交付结清 / 异常状态归订单）
 *   状态在线索阶段（含线索流失）→ 线索池；在商机阶段（含丢单）→ 商机池；在订单阶段（含交付结清 / 异常状态）→ 订单池；
 *   名下一个项目都没有 → 线索池，「当前进程」按 没项目进程（线索-潜客培育）显示（只是显示和归池，不建项目）。
 *   订单池是给导入的旧数据用的（旧系统负责人离职没交接的已成交客户，导入时直接落客户公海）；新数据入池、放回的判定不变（M-公海-02 例外照旧）。
 *   客户池 = 项目行（客户有负责人、名下有项目放在项目公海给别人做），不按阶段分，按客户数（一位客户一行）。
 *   10-31 上午叫 公海线索 / 公海商机 / 公海客户，中午叫 线索 / 商机 / 其他，晚上定 线索池 / 商机池 / 其他，11-11 改四池；老链接里的 attr 由 规整公海属性 认回来
 *
 * 入池字段拆两个（M-公海-09）：
 *   - 入池方式（只作筛选，= 快捷）：超时回收 / 首次～三次退回 / 多次退回 / 无效客户；离职交接不算入池方式、筛选里不列（A-14 / P-转-14，11-10）
 *   - 入池原因（表里一列）：退回时选的回收原因（存成「回收原因：X」）；超时回收的写「超时回收」，离职交接的写「离职交接」，没选的「—」
 *
 * 会上可能改的都是常量：多次退回从几次起、入池方式叫法、快捷按钮。改这里，页面和查库跟着走
 */
import { 自动理由 } from "@/lib/pool";
import { 阶段们, 企业版字典, 阶段与进程 } from "@/lib/project/stage-dict";
import { 回收原因前缀 } from "@/lib/project/timeout";

export const 公海属性们 = ["线索池", "商机池", "订单池", "客户池"] as const;
export type 公海属性 = (typeof 公海属性们)[number];
/** 客户行落的三个池（按客户定状态分）；项目行一律客户池 */
export type 客户行属性 = Exclude<公海属性, "客户池">;

/** 第几次起算「多次退回」（含）：默认 4 次及以上，首次 / 二次 / 三次各一档 */
export const 多次退回起 = 4;

/**
 * 入池原因的四类。主动退回带「第几次」。
 * 「无效」只是代码里的类名（算出来的，看 Customer.poolInvalidAt，不存库），页面上叫「无效线索」（10-29 P16），见 入池类叫法
 */
export const 入池类们 = ["超时回收", "主动退回", "无效", "离职交接"] as const;
export type 入池类 = (typeof 入池类们)[number];

/** 入池方式（筛选，代码里叫「快捷」；顺序就是下拉里的顺序），每个带数。离职交接不算入池方式（A-14 / P-转-14），那些行不落进任何一档 */
export const 快捷们 = ["超时回收", "首次退回", "二次退回", "三次退回", "多次退回", "无效客户"] as const;
export type 快捷 = (typeof 快捷们)[number];

/** 排序：都是新的在前，没有的（没跟进过）排最后 */
export const 排序们 = [
  { value: "pooled", label: "入池时间" },
  { value: "follow", label: "跟进时间" },
  { value: "created", label: "创建时间" },
] as const;
export type 排序 = (typeof 排序们)[number]["value"];
export const 默认排序: 排序 = "pooled";

/** 离职交接放进来的那两句（lib/offboard-db.ts）。这里抄一份不引过来：那边引了 prisma，浏览器用不了 */
export const 离职理由们: readonly string[] = ["成员停用，放进公海", "成员停用，放回项目公海", "成员停用，从回收站恢复时放进公海"];
/** 超时回收在项目留痕里记的操作人（lib/project/timeout.ts 系统） */
export const 系统操作人 = "system";

const 是自动理由 = (reason: string) => /^\d+ 天没跟进，自动放进公海$/.test(reason) || reason === 自动理由(0);

type 项目状态片 = { phase: string; result: string | null };

/** 阶段排第几（线索 0 < 商机 1 < 订单 2）；不认识的阶段 −1，当最高（排在订单后面） */
const 阶段位 = (s: string) => (阶段们 as readonly string[]).indexOf(s);

/** 项目落在哪个阶段：有结局的按结局归（线索流失 → 线索、丢单 → 商机、交付 / 异常 → 订单，同 阶段与进程），没结局的看 phase */
export function 项目所在阶段(p: 项目状态片): string {
  if (!p.result) return p.phase;
  return 阶段与进程({ phase: p.phase, node: "", result: p.result }, 企业版字典).阶段;
}

/**
 * 给客户定一个状态（M-公海-08，11-11 改「从低往高」）：有没结束的项目，取没结束里阶段最低的；都结束了，取结局所在阶段最低的。
 * 返回定状态的那个项目（同一阶段有几个取排在前面的那个，查库按创建时间先后给）；没有项目 = null。
 * 只给公海用（归池、「当前进程」那一格写的就是它）；客户列表的客户状态另有一套（cust-status-auto.ts），不走这里
 */
export function 客户定状态<P extends 项目状态片>(projects: readonly P[]): { 项目: P | null; 阶段: string | null; 属性: 客户行属性 } {
  const 没结束 = projects.filter((p) => !p.result);
  const 候选 = 没结束.length ? 没结束 : projects;
  let 取: P | null = null;
  let 位 = Number.POSITIVE_INFINITY;
  for (const p of 候选) {
    const 原位 = 阶段位(项目所在阶段(p));
    const 这位 = 原位 < 0 ? 阶段们.length : 原位;
    if (这位 < 位) { 取 = p; 位 = 这位; }
  }
  const 阶段 = 取 ? 项目所在阶段(取) : null;
  return { 项目: 取, 阶段, 属性: 归池({ 种: "客户", 项目们: projects }) as 客户行属性 };
}

/**
 * 一行归哪个池（11-11 用户定，四池的定义只在这里，页面、查库、测试都走它）：
 *   种 = 项目（客户有负责人、项目在项目公海）→ 客户池，不按阶段分
 *   种 = 客户（整个客户在客户公海）：项目们 = 名下全部项目（不过范围层），按 客户定状态（从低往高）所在阶段：
 *     线索 → 线索池，商机 → 商机池，订单 → 订单池；名下一个项目都没有 → 线索池（「当前进程」写 没项目进程）
 */
export function 归池(行: { 种: "客户" | "项目"; 项目们: readonly 项目状态片[] }): 公海属性 {
  if (行.种 === "项目") return "客户池";
  const 没结束 = 行.项目们.filter((p) => !p.result);
  const 阶段们有 = new Set((没结束.length ? 没结束 : 行.项目们).map(项目所在阶段));
  if (!阶段们有.size || 阶段们有.has("线索")) return "线索池";
  if (阶段们有.has("商机")) return "商机池";
  return "订单池";
}

/**
 * 「当前进程」那一格显示哪个项目（11-11 跟进，用户定）：名下最新创建的那个（创建时间相同取 id 大的，稳定），不分结没结束，结束了的照旧带结局。
 * **故意和 归池 用的项目不同**：归池按 客户定状态 从低往高（决定落哪个池），进程格只写最新的那个，所以会有「在线索池、进程写订单-某节点」的行，用户要的，不加提示。
 * 客户池并成一行的不走这里（写最近进项目公海的那个，见 并客户池）；没有项目 = null（客户行另写 没项目进程）
 */
export function 进程显示项目<P extends { id: string; createdAt: Date | string }>(projects: readonly P[]): P | null {
  let 取: P | null = null;
  for (const p of projects) {
    if (!取) { 取 = p; continue; }
    const 差 = new Date(p.createdAt).getTime() - new Date(取.createdAt).getTime();
    if (差 > 0 || (差 === 0 && p.id > 取.id)) 取 = p;
  }
  return 取;
}

/** 客户名下的项目 → 公海属性（= 归池 客户行）。只数项目本身（有没有在项目公海不管） */
export function 客户公海属性(projects: readonly 项目状态片[]): 客户行属性 {
  return 归池({ 种: "客户", 项目们: projects }) as 客户行属性;
}

/** 项目行（= 归池 项目行）：一律客户池 */
export const 项目行属性 = 归池({ 种: "项目", 项目们: [] }) as "客户池";

/**
 * 「当前进程」那一格（U-公海-04）：三类同一格式「阶段-节点」（11-01 用户：「应该是阶段+进程名。例如线索-潜客培育」）。
 * 有结局的后面再带「 · 结局叫法」（线索-线索验证 · 线索流失），没结局的不写「进行中」
 */
export function 进程格(_属性: 公海属性, x: { 阶段: string; 节点: string; 结局: string | null }): string {
  const 阶段节点 = `${x.阶段}-${x.节点}`;
  return x.结局 ? `${阶段节点} · ${x.结局}` : 阶段节点;
}

/** 名下一个项目都没有的客户（归线索池）「当前进程」那一格：线索第一个节点（11-11）。只是显示，不建项目、不写库 */
export const 没项目进程 = 进程格("线索池", { 阶段: "线索", 节点: 企业版字典.节点们.线索[0], 结局: null });

/**
 * 客户行为什么在公海：看 CustomerPool 那一行。
 *   - 离职交接放进来的（停用成员选「放进公海」）
 *   - 没有操作人的（自动掉公海、项目超时回收带进来的）= 超时回收
 *   - 有操作人的（自己放进公海、放回项目时客户跟着进）= 主动退回
 * 无效不在这里判：标了无效的不管怎么进来的都算无效（见 入池原因）
 */
export function 客户入池类(pool: { reason: string; userId: string | null }): Exclude<入池类, "无效"> {
  if (离职理由们.includes(pool.reason)) return "离职交接";
  if (!pool.userId || 是自动理由(pool.reason)) return "超时回收";
  return "主动退回";
}

/** 项目行：看最近一条 pool-release 留痕。系统记的 = 超时回收；没有留痕的（老数据）按主动退回 */
export function 项目入池类(log: { userId: string; reason: string | null } | null): Exclude<入池类, "无效"> {
  if (log && 离职理由们.includes(log.reason ?? "")) return "离职交接";
  if (log && log.userId === 系统操作人) return "超时回收";
  return "主动退回";
}

/** 主动退回第几次：计数从迁移 080 起才有，之前退回的这一次至少算第 1 次 */
export const 第几次 = (累计: number) => Math.max(1, Math.floor(Number(累计) || 0));

/** 入池类在页面上的叫法：只改显示，类名照旧（快捷按钮「无效客户」是另一回事，不动） */
export const 入池类叫法: Readonly<Record<入池类, string>> = { 超时回收: "超时回收", 主动退回: "主动退回", 无效: "无效线索", 离职交接: "离职交接" };

/** 入池原因那一格没东西时写的 */
export const 没原因 = "—";
/** 企业版客户放回公海没选退回原因时的那句（pool-actions 放进公海） */
export const 要选退回原因提示 = "请先选退回原因";

/**
 * 退回时选的回收原因：库里存成「回收原因：X」（项目放回在 pool-release 留痕里，客户放回 / 客户跟着项目进公海在 CustomerPool.reason 里，
 * 后者前面可能还有一句说明，取最后一段）。没选的 = null
 */
export function 拆退回原因(reason: string | null | undefined): string | null {
  const s = reason ?? "";
  const i = s.lastIndexOf(回收原因前缀);
  if (i < 0) return null;
  return s.slice(i + 回收原因前缀.length).trim() || null;
}

/**
 * 入池原因那一列（M-公海-09）：超时回收的写「超时回收」，离职交接的写「离职交接」，主动退回的写退回原因，没选的「—」。
 * 类 = 怎么进来的（标了无效的传原来那类，无效另有标记）
 */
export function 入池原因文字(类: Exclude<入池类, "无效">, reason: string | null | undefined): string {
  if (类 === "超时回收" || 类 === "离职交接") return 入池类叫法[类];
  return 拆退回原因(reason) ?? 没原因;
}

/** 这一行落在哪个入池方式里（一行最多一个；离职交接放进来的不落）。无效优先：标了无效的不再算进退回几次 */
export function 归到快捷(r: { 类: 入池类; 累计: number }): 快捷 | null {
  if (r.类 === "无效") return "无效客户";
  if (r.类 === "超时回收") return "超时回收";
  if (r.类 === "离职交接") return null;
  const n = 第几次(r.累计);
  if (n >= 多次退回起) return "多次退回";
  return (["首次退回", "二次退回", "三次退回"] as const)[n - 1] ?? "多次退回";
}

/** 页面上的一行（服务端拼好，浏览器只管画） */
export type 公海行 = {
  /** 「c:客户 id」或「p:项目 id」：两种行混在一张表里，id 不能撞 */
  id: string;
  种: "客户" | "项目";
  customerId: string;
  /** 项目行 = 这个项目；客户行 = 名下只有一个项目时是它（领取不用它，只给链接） */
  projectId: string | null;
  /** null = 同事的客户，领了再看（同项目页 露客户） */
  客户名: string | null;
  /** 名下项目的名字，多个用「、」连；一个都没有为空 */
  项目名: string | null;
  /** 当前进程：定状态那个项目的「阶段-节点」，有结局再带「 · 结局」（进程格）；没有项目为空 */
  进程: string | null;
  /** 名下不止一个项目时，鼠标停上去看每个项目的进程（项目名：阶段-节点，有结局带「 · 结局」，「；」隔开） */
  进程明细: string | null;
  属性: 公海属性;
  最后跟进: string | null;
  入池时间: string;
  创建时间: string;
  类: 入池类;
  /** 这位客户累计主动退回几次（Customer.poolReturns） */
  累计: number;
  /** 入池原因那一列（入池原因文字）：退回原因 / 超时回收 / 离职交接 / — */
  入池原因: string;
  快捷: 快捷 | null;
  /** 原负责人是我：企业版原负责人领不回，领取按钮灰着（接口也拦） */
  原负责人是我: boolean;
  /**
   * 客户池里同一位客户有不止一个项目在项目公海（11-11）：这一行是并出来的（id「k:客户 id」、projectId 空），
   * 子 = 下面每个项目的项目行（入池时间新的在前），领取、分配按它们一个个做。只有一个项目的不并，就是那行项目行
   */
  子?: 公海行[];
  /** 号码不全（T10）：三态到期自动收回时查过号码、空的 / 不对的。只有客户行有，只用来筛 */
  号码不全?: boolean;
  /** 客户来源（渠道 id），只用来筛。项目行：项目自己选的优先，没选跟客户——客户不露（同事的客户）就当没有，不能筛一下试出同事客户从哪来 */
  来源id?: string | null;
};

/** 号码不全 = "1" 只看打了「号码不全」的（T10，界面筛选项以后做） */
export type 公海筛选 = { 属性?: string; 快捷?: string; 排序?: string; keyword?: string; 来源?: string; 号码不全?: string };

export const 是公海属性 = (v: unknown): v is 公海属性 => typeof v === "string" && (公海属性们 as readonly string[]).includes(v);
/**
 * 以前的叫法（收藏的老链接 ?attr=公海客户、?attr=线索 之类）→ 现在的。
 * 「其他」（10-31 晚～11-11）和更早的「公海客户」装的是订单阶段 + 没有项目的客户，11-11 拆进订单池和线索池，一个池对不上 → 认回全部（不写在这里，落到 ""）
 */
const 旧属性: Readonly<Record<string, 公海属性>> = { 公海线索: "线索池", 公海商机: "商机池", 线索: "线索池", 商机: "商机池", 订单: "订单池" };
/** 地址栏里的 attr → 公海属性；认不出的（含老的「其他」「公海客户」）是 ""（= 全部） */
export const 规整公海属性 = (v: unknown): 公海属性 | "" => (是公海属性(v) ? v : typeof v === "string" && 旧属性[v] ? 旧属性[v] : "");
export const 是快捷 = (v: unknown): v is 快捷 => typeof v === "string" && (快捷们 as readonly string[]).includes(v);
export const 规整排序 = (v: unknown): 排序 => (排序们.some((o) => o.value === v) ? (v as 排序) : 默认排序);

/** 快捷按钮上的数：在当前属性 + 关键词下数（不受快捷本身影响，点哪个都看得到别的几个有多少） */
export function 数快捷(行: readonly Pick<公海行, "快捷">[]): Record<快捷, number> {
  const 数 = Object.fromEntries(快捷们.map((k) => [k, 0])) as Record<快捷, number>;
  for (const r of 行) if (r.快捷) 数[r.快捷]++;
  return 数;
}

const 时 = (v: string | null) => (v ? new Date(v).getTime() : Number.NEGATIVE_INFINITY);

const 比id = (a: 公海行, b: 公海行) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * 客户池同一位客户的几行项目行并成一行（11-11）：「当前进程」、项目名、入池时间、入池原因认最近进项目公海的那个
 * （入池时间 = 项目的 pooledAt，项目行都有；同一刻的按 id 定），悬停明细列出每个项目，「共 N 个项目」看 子 的个数。
 * 客户名取露出来的那个（各项目露不露客户是同一位客户，补这一页 补完再并一次）；创建时间取最新的；原负责人是我 = 每个都是
 */
export function 并客户池(子们: readonly 公海行[]): 公海行 {
  const 序 = [...子们].sort((a, b) => 时(b.入池时间) - 时(a.入池时间) || 比id(a, b));
  const 新 = 序[0];
  if (序.length === 1) return 新;
  return {
    ...新,
    id: `k:${新.customerId}`,
    projectId: null,
    客户名: 序.find((x) => x.客户名)?.客户名 ?? null,
    进程明细: 序.map((x) => `${x.项目名 ?? "项目"}：${x.进程 ?? 没原因}`).join("；"),
    创建时间: 序.reduce((m, x) => (时(x.创建时间) > 时(m) ? x.创建时间 : m), 新.创建时间),
    原负责人是我: 序.every((x) => x.原负责人是我),
    子: 序,
  };
}

/** 项目行按客户并（客户行原样）；先后照进来的顺序，并出来的那行占它第一行的位置 */
function 并项目行(行: readonly 公海行[]): 公海行[] {
  const 组 = new Map<string, 公海行[]>();
  const 出: (公海行 | string)[] = [];
  for (const r of 行) {
    if (r.种 !== "项目") { 出.push(r); continue; }
    const 有 = 组.get(r.customerId);
    if (有) 有.push(r);
    else { 组.set(r.customerId, [r]); 出.push(r.customerId); }
  }
  return 出.map((x) => (typeof x === "string" ? 并客户池(组.get(x)!) : x));
}

/**
 * 筛、数、排：关键词、客户来源 → 属性 → （数快捷）→ 快捷 → 并客户池 → 排序。同一刻的按 id 定序，翻页不跳。
 * 关键词、来源、快捷都按项目行逐个筛（并出来的那行只留对上的项目），数按并完的行数：客户池一位客户算一个。
 * 按项目（渠道名单、按创建时间筛，一条一行和渠道页对数）：不并
 */
export function 筛排(全部: readonly 公海行[], sp: 公海筛选, 选: { 按项目?: boolean } = {}): { 行: 公海行[]; 快捷数: Record<快捷, number>; 属性数: Record<公海属性 | "全部", number> } {
  const 并 = 选.按项目 ? (x: 公海行[]) => x : 并项目行;
  const 词 = (sp.keyword ?? "").trim().toLowerCase();
  const 搜到 = 词 ? 全部.filter((r) => (r.客户名 ?? "").toLowerCase().includes(词) || (r.项目名 ?? "").toLowerCase().includes(词)) : [...全部];
  // 客户来源和关键词一样算在所有计数前面：属性、入池方式后面的数都是「这个来源里的」
  const 按来源 = sp.来源 ? 搜到.filter((r) => r.来源id === sp.来源) : 搜到;
  // 号码不全（T10）同来源，算在所有计数前面；按客户认（打了标的客户下的项目子行一起留着，并完再看）
  const 不全客户 = sp.号码不全 === "1" ? new Set(全部.filter((r) => r.号码不全).map((r) => r.customerId)) : null;
  const 搜 = 不全客户 ? 按来源.filter((r) => 不全客户.has(r.customerId)) : 按来源;
  const 搜并 = 并(搜);
  const 属性数 = { 全部: 搜并.length, 线索池: 0, 商机池: 0, 订单池: 0, 客户池: 0 } as Record<公海属性 | "全部", number>;
  for (const r of 搜并) 属性数[r.属性]++;
  const 属性 = 规整公海属性(sp.属性);
  const 按属性 = 属性 ? 搜.filter((r) => r.属性 === 属性) : 搜;
  // 快捷按钮上的数也按并完的行：一位客户池客户下有两个项目都是超时回收，算一个
  const 快捷数 = 数快捷(选.按项目 ? 按属性 : 并项目行(按属性).flatMap((r) => (r.子 ? [...new Set(r.子.map((x) => x.快捷))].map((快捷) => ({ 快捷 })) : [r])));
  const 按快捷 = 并(是快捷(sp.快捷) ? 按属性.filter((r) => r.快捷 === sp.快捷) : 按属性);
  const 键 = 规整排序(sp.排序);
  const 取 = (r: 公海行) => 时(键 === "follow" ? r.最后跟进 : 键 === "created" ? r.创建时间 : r.入池时间);
  按快捷.sort((a, b) => 取(b) - 取(a) || 比id(a, b));
  return { 行: 按快捷, 快捷数, 属性数 };
}
