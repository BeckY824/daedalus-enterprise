/**
 * 企业版统一公海（2026-10-29，P7）：客户公海和项目公海合成一页 /pool，按「公海属性」分开看。
 * 这里只放规矩和说法，浏览器和服务端共用（不引 prisma）；查库在 unified-pool-db.ts，页面在 app/(app)/pool/。
 *
 * 一行是什么：
 *   - 客户行：在客户公海里的客户（有 CustomerPool 那一行）。名下放在项目公海里的项目不另列一行——领客户即领项目（pool-link.ts）
 *   - 项目行：在项目公海里、客户却不在客户公海的项目（客户归别人、只是项目归他；名下有没结束的订单项目，客户没跟着进）
 *
 * 公海属性（算出来的，不存），页面上的筛选是 全部 / 线索 / 商机 / 其他，全部 = 线索 + 商机 + 其他：
 *   - 线索：客户名下正好 1 个项目，在线索阶段、没结局
 *   - 商机：客户名下正好 1 个项目，在商机阶段、没结局
 *   - 其他：其余（订单阶段、已有结局（线索流失 / 丢单 / 成功交付 / 异常）、多个项目、一个项目都没有）
 *   项目行按它自己的阶段算（线索 → 线索，商机 → 商机，别的 → 其他）
 *   10-31 前叫 公海线索 / 公海商机 / 公海客户，老链接里的 attr 由 规整公海属性 认回来
 *
 * 会上可能改的都是常量：多次退回从几次起、入池原因叫法、快捷按钮。改这里，页面和查库跟着走
 */
import { 自动理由 } from "@/lib/pool";

export const 公海属性们 = ["线索", "商机", "其他"] as const;
export type 公海属性 = (typeof 公海属性们)[number];

/** 第几次起算「多次退回」（含）：默认 4 次及以上，首次 / 二次 / 三次各一档 */
export const 多次退回起 = 4;

/**
 * 入池原因的四类。主动退回带「第几次」。
 * 「无效」只是代码里的类名（算出来的，看 Customer.poolInvalidAt，不存库），页面上叫「无效线索」（10-29 P16），见 入池类叫法
 */
export const 入池类们 = ["超时回收", "主动退回", "无效", "离职交接"] as const;
export type 入池类 = (typeof 入池类们)[number];

/** 快捷按钮（顺序就是页面上的顺序），每个带数 */
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
export const 离职理由们: readonly string[] = ["成员停用，放进公海", "成员停用，放回项目公海"];
/** 超时回收在项目留痕里记的操作人（lib/project/timeout.ts 系统） */
export const 系统操作人 = "system";

const 是自动理由 = (reason: string) => /^\d+ 天没跟进，自动放进公海$/.test(reason) || reason === 自动理由(0);

/**
 * 客户名下的项目 → 公海属性。只数项目本身（有没有在项目公海不管）：
 * 正好一个、没结局、在线索 / 商机阶段才是线索 / 商机，其余一律其他
 */
export function 客户公海属性(projects: readonly { phase: string; result: string | null }[]): 公海属性 {
  if (projects.length !== 1) return "其他";
  const [p] = projects;
  if (p.result) return "其他";
  if (p.phase === "线索") return "线索";
  if (p.phase === "商机") return "商机";
  return "其他";
}

/** 项目行：按它自己的阶段（只有线索 / 商机能进项目公海，别的兜成其他） */
export function 项目公海属性(p: { phase: string; result: string | null }): 公海属性 {
  return 客户公海属性([p]);
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

/** 入池原因那一格的字 */
export function 入池原因文字(类: 入池类, 累计: number): string {
  return 类 === "主动退回" ? `主动退回（第 ${第几次(累计)} 次）` : 入池类叫法[类];
}

/** 这一行落在哪个快捷按钮里（一行最多一个）。无效优先：标了无效的不再算进退回几次 */
export function 归到快捷(r: { 类: 入池类; 累计: number }): 快捷 | null {
  if (r.类 === "无效") return "无效客户";
  if (r.类 === "超时回收") return "超时回收";
  if (r.类 !== "主动退回") return null;
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
  /** 当前进程：阶段 · 节点（多个项目各写一段），有结局的写结局 */
  进程: string | null;
  属性: 公海属性;
  最后跟进: string | null;
  入池时间: string;
  创建时间: string;
  类: 入池类;
  /** 这位客户累计主动退回几次（Customer.poolReturns） */
  累计: number;
  入池原因: string;
  快捷: 快捷 | null;
  /** 原负责人是我：企业版原负责人领不回，领取按钮灰着（接口也拦） */
  原负责人是我: boolean;
};

export type 公海筛选 = { 属性?: string; 快捷?: string; 排序?: string; keyword?: string };

export const 是公海属性 = (v: unknown): v is 公海属性 => typeof v === "string" && (公海属性们 as readonly string[]).includes(v);
/** 10-31 前的叫法（收藏的老链接 ?attr=公海客户 之类）→ 现在的 */
const 旧属性: Readonly<Record<string, 公海属性>> = { 公海线索: "线索", 公海商机: "商机", 公海客户: "其他" };
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
  const 属性数 = { 全部: 搜.length, 线索: 0, 商机: 0, 其他: 0 } as Record<公海属性 | "全部", number>;
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
