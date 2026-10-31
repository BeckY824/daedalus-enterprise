/**
 * 企业版统一公海（2026-10-29，P7）：客户公海和项目公海合成一页 /pool，按「公海属性」分开看。
 * 这里只放规矩和说法，浏览器和服务端共用（不引 prisma）；查库在 unified-pool-db.ts，页面在 app/(app)/pool/。
 *
 * 一行是什么：
 *   - 客户行：在客户公海里的客户（有 CustomerPool 那一行）。名下放在项目公海里的项目不另列一行——领客户即领项目（pool-link.ts）
 *   - 项目行：在项目公海里、客户却不在客户公海的项目（客户归别人、只是项目归他；名下有没结束的订单项目，客户没跟着进）
 *
 * 公海属性（算出来的，不存），页面上的筛选是 全部 / 线索池 / 商机池 / 其他，全部 = 线索池 + 商机池 + 其他。
 * 按阶段分（10-31 晚会议定，A-01 / M-公海-08）：先给客户定一个状态（客户定状态）——
 *   - 名下有没结束的项目：取没结束的里阶段最高的那个（订单 > 商机 > 线索）
 *   - 都结束了：取结局所在阶段最高的那个（交付结清 / 异常状态归订单，丢单归商机，线索流失归线索）
 *   状态在线索阶段（含线索流失）→ 线索池；在商机阶段（含丢单）→ 商机池；其余（订单阶段、没有项目）→ 其他。
 *   项目行按它自己算（同一条规矩，只有它一个）
 *   10-31 上午叫 公海线索 / 公海商机 / 公海客户，中午叫 线索 / 商机 / 其他，晚上定 线索池 / 商机池 / 其他；老链接里的 attr 由 规整公海属性 认回来
 *
 * 入池字段拆两个（M-公海-09）：
 *   - 入池方式（只作筛选，= 快捷）：超时回收 / 首次～三次退回 / 多次退回 / 无效客户，另留 离职交接（A-14，只在有这种数据时出）
 *   - 入池原因（表里一列）：退回时选的回收原因（存成「回收原因：X」）；超时回收的写「超时回收」，离职交接的写「离职交接」，没选的「—」
 *
 * 会上可能改的都是常量：多次退回从几次起、入池方式叫法、快捷按钮。改这里，页面和查库跟着走
 */
import { 自动理由 } from "@/lib/pool";
import { 阶段们, 企业版字典, 阶段与进程 } from "@/lib/project/stage-dict";
import { 回收原因前缀 } from "@/lib/project/timeout";

export const 公海属性们 = ["线索池", "商机池", "其他"] as const;
export type 公海属性 = (typeof 公海属性们)[number];

/** 第几次起算「多次退回」（含）：默认 4 次及以上，首次 / 二次 / 三次各一档 */
export const 多次退回起 = 4;

/**
 * 入池原因的四类。主动退回带「第几次」。
 * 「无效」只是代码里的类名（算出来的，看 Customer.poolInvalidAt，不存库），页面上叫「无效线索」（10-29 P16），见 入池类叫法
 */
export const 入池类们 = ["超时回收", "主动退回", "无效", "离职交接"] as const;
export type 入池类 = (typeof 入池类们)[number];

/** 入池方式（筛选，代码里叫「快捷」；顺序就是下拉里的顺序），每个带数。离职交接排最后、没有这种数据时下拉里不出（A-14） */
export const 快捷们 = ["超时回收", "首次退回", "二次退回", "三次退回", "多次退回", "无效客户", "离职交接"] as const;
/** 没有这种数据时下拉里不出的入池方式 */
export const 有数才出的快捷: readonly 快捷[] = ["离职交接"];
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
export const 离职理由们: readonly string[] = ["成员停用，放进公海", "成员停用，放回项目公海"];
/** 超时回收在项目留痕里记的操作人（lib/project/timeout.ts 系统） */
export const 系统操作人 = "system";

const 是自动理由 = (reason: string) => /^\d+ 天没跟进，自动放进公海$/.test(reason) || reason === 自动理由(0);

type 项目状态片 = { phase: string; result: string | null };

/** 阶段排第几（订单 2 > 商机 1 > 线索 0）；不认识的阶段 −1 */
const 阶段位 = (s: string) => (阶段们 as readonly string[]).indexOf(s);

/** 项目落在哪个阶段：有结局的按结局归（线索流失 → 线索、丢单 → 商机、交付 / 异常 → 订单，同 阶段与进程），没结局的看 phase */
export function 项目所在阶段(p: 项目状态片): string {
  if (!p.result) return p.phase;
  return 阶段与进程({ phase: p.phase, node: "", result: p.result }, 企业版字典).阶段;
}

const 属性of = (阶段: string | null): 公海属性 => (阶段 === "线索" ? "线索池" : 阶段 === "商机" ? "商机池" : "其他");

/**
 * 给客户定一个状态（M-公海-08）：有没结束的项目，取没结束里阶段最高的；都结束了，取结局所在阶段最高的。
 * 返回定状态的那个项目（同一阶段有几个取排在前面的那个，查库按创建时间先后给）和公海属性；没有项目 = null / 其他
 */
export function 客户定状态<P extends 项目状态片>(projects: readonly P[]): { 项目: P | null; 阶段: string | null; 属性: 公海属性 } {
  const 没结束 = projects.filter((p) => !p.result);
  const 候选 = 没结束.length ? 没结束 : projects;
  let 取: P | null = null;
  let 位 = -2;
  for (const p of 候选) {
    const 这位 = 阶段位(项目所在阶段(p));
    if (这位 > 位) { 取 = p; 位 = 这位; }
  }
  const 阶段 = 取 ? 项目所在阶段(取) : null;
  return { 项目: 取, 阶段, 属性: 属性of(阶段) };
}

/** 客户名下的项目 → 公海属性（见 客户定状态）。只数项目本身（有没有在项目公海不管） */
export function 客户公海属性(projects: readonly 项目状态片[]): 公海属性 {
  return 客户定状态(projects).属性;
}

/** 项目行：按它自己（同一条规矩，只有它一个） */
export function 项目公海属性(p: 项目状态片): 公海属性 {
  return 客户公海属性([p]);
}

/** 没结局的项目在「当前进程」那一格里的状态 */
export const 进行中 = "进行中";

/**
 * 「当前进程」那一格（U-公海-04）：三类同一格式「节点 · 状态」，状态 = 结局叫法 / 进行中。
 * 线索池 / 商机池前面已有属性标记，不再写阶段；其他没有前置标记，前面带上阶段（订单 · 节点 · 状态）
 */
export function 进程格(属性: 公海属性, x: { 阶段: string; 节点: string; 结局: string | null }): string {
  const 节点状态 = `${x.节点} · ${x.结局 ?? 进行中}`;
  return 属性 === "其他" ? `${x.阶段} · ${节点状态}` : 节点状态;
}

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

/** 这一行落在哪个入池方式里（一行最多一个）。无效优先：标了无效的不再算进退回几次 */
export function 归到快捷(r: { 类: 入池类; 累计: number }): 快捷 | null {
  if (r.类 === "无效") return "无效客户";
  if (r.类 === "超时回收") return "超时回收";
  if (r.类 === "离职交接") return "离职交接";
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
  /** 当前进程：定状态那个项目的「节点 · 状态」，属性是其他的前面带阶段（进程格）；没有项目为空 */
  进程: string | null;
  /** 名下不止一个项目时，鼠标停上去看每个项目的进程（项目名：阶段 · 节点 · 状态，「；」隔开） */
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
};

export type 公海筛选 = { 属性?: string; 快捷?: string; 排序?: string; keyword?: string };

export const 是公海属性 = (v: unknown): v is 公海属性 => typeof v === "string" && (公海属性们 as readonly string[]).includes(v);
/** 以前的叫法（收藏的老链接 ?attr=公海客户、?attr=线索 之类）→ 现在的 */
const 旧属性: Readonly<Record<string, 公海属性>> = { 公海线索: "线索池", 公海商机: "商机池", 公海客户: "其他", 线索: "线索池", 商机: "商机池" };
/** 地址栏里的 attr → 公海属性；认不出的是 ""（= 全部） */
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

/** 筛、数、排：属性 → 关键词 → （数快捷）→ 快捷 → 排序。同一刻的按 id 定序，翻页不跳 */
export function 筛排(全部: readonly 公海行[], sp: 公海筛选): { 行: 公海行[]; 快捷数: Record<快捷, number>; 属性数: Record<公海属性 | "全部", number> } {
  const 词 = (sp.keyword ?? "").trim().toLowerCase();
  const 搜 = 词 ? 全部.filter((r) => (r.客户名 ?? "").toLowerCase().includes(词) || (r.项目名 ?? "").toLowerCase().includes(词)) : [...全部];
  const 属性数 = { 全部: 搜.length, 线索池: 0, 商机池: 0, 其他: 0 } as Record<公海属性 | "全部", number>;
  for (const r of 搜) 属性数[r.属性]++;
  const 属性 = 规整公海属性(sp.属性);
  const 按属性 = 属性 ? 搜.filter((r) => r.属性 === 属性) : 搜;
  const 快捷数 = 数快捷(按属性);
  const 按快捷 = 是快捷(sp.快捷) ? 按属性.filter((r) => r.快捷 === sp.快捷) : 按属性;
  const 键 = 规整排序(sp.排序);
  const 取 = (r: 公海行) => 时(键 === "follow" ? r.最后跟进 : 键 === "created" ? r.创建时间 : r.入池时间);
  按快捷.sort((a, b) => 取(b) - 取(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { 行: 按快捷, 快捷数, 属性数 };
}
