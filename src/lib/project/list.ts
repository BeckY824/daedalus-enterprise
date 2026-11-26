import { prisma, defaultClient } from "@/lib/prisma";
import { 搜索词, 拆搜索词, 全半角写法, 客户号码条件, 号码藏着 } from "@/lib/search-keyword";
import { 负责人候选 } from "@/lib/owners";
import { 看板落列, 看板列键们, 未填标签, type 项目行, type 看板合计组, type 看板卡片 } from "./board";
import type { 阶段 } from "./nodes";
import { 看得到的客户, 露客户, 公海超时收回, 待我回的邀请, 项目回收日, 算超时要的, 超时成员线, 补回收起点留痕, type 回收起点留痕 } from "./db";
import { 即将回收 } from "./timeout";
import { 企业版 } from "@/lib/enterprise/switch";
import { 生效组织规则 } from "./org-rules-store";
import { dayjs } from "@/lib/utils";
import { 已立项天数 } from "./project-fields";
import { 回填一次 } from "./expected-deal";
import { 数收回次数, 合收回次数, 收回次数筛 } from "./recycle-count";
import { 认首页卡, 首页卡条件, 即将逾期, 即将逾期紧筛 } from "./home-cards";
import { 首页卡的人, 暂未跟进负责人们 } from "./home-cards-db";
import { 字典of, 阶段与进程, 阶段们, 结局们of, 同名们, 本套名, 归阶段的结局, type 阶段字典 } from "./stage-dict";
import { 本套位置 } from "./nodes";
import { 后售培育名, 后售条件, 潜客不含后售条件, 后售项目们 } from "./after-sale";
import type { Prisma } from "@/generated/prisma";
import { 待我复核的, 验证结果叫法, 实际待, 无效交给 } from "./lead-verify";
import { 看全部, 照限定, 客户读条件 } from "../team-scope";
import { 仅项目客户们 } from "@/lib/enterprise/project-only-customers";
import { 读市场身份 } from "@/lib/enterprise/market-view-db";
import { 市场项目条件, 只看进度, 部门市场无市场角色, 部门市场无市场角色该转向 } from "@/lib/enterprise/market-view";
import { 读市场成员们 } from "@/lib/enterprise/market-db";
import { 历史负责人们, 我回避的公海项目, 回避豁免 } from "./pool-owner";
import { 渠道筛选选项 } from "@/lib/enterprise/channel-options";
import { 企业级别 } from "@/lib/enterprise/customer-v2";
import { 未分级 } from "@/app/(app)/customers/query-shared";
import { 创建时间段, 是日期 } from "@/lib/custom-date-range";
import { 不算补建, 不进统计, 是重复咨询, 重复咨询来源, 仅记录用来源 } from "./system-created";
import { 看成客户编号严 } from "@/lib/customer-no";
import { 看已删 } from "@/lib/enterprise/soft-delete-core";
import { 读批次, 批次参数, 批次条件 } from "./import-batch";
import { 指定回复文字, 短时刻 } from "./time-fields";
import { 客户显名 } from "@/lib/enterprise/customer-title";
import { 待分配范围 } from "@/lib/enterprise/await-assign-scope";
import { 待分配筛, type 待分配数 } from "@/lib/enterprise/await-assign-core";
import { 能看项目, 权限项目选, 带已加入 } from "@/lib/enterprise/permissions";
import { 权限组织 } from "@/lib/enterprise/org";
import { 认来源筛选 } from "@/lib/enterprise/customer-source-filter";

/** 判了无效的三个叫法：列表上叫法后面跟原因摘要（客户 11-05（X-09）：「初验无效 · 原因」） */
const 带原因的叫法: ReadonlySet<验证结果叫法> = new Set<验证结果叫法>(["初验无效", "终验无效", "无效线索"]);
/** 验证结果格里那一行：判无效的叫法 · 无效原因；其余只写叫法。放不下由列表一行省略、悬停看全文 */
export function 验证摘要(叫法: 验证结果叫法, 无效原因: string | null): string {
  const 因 = 无效原因?.trim();
  return 带原因的叫法.has(叫法) && 因 ? `${叫法} · ${因}` : 叫法;
}

/** 每一步的叫法，和详情页线索验证时间线一致（projects/[id]/LeadVerifyPanel.tsx 步叫法） */
const 步叫法: Record<string, string> = {
  销售初判: "负责人初判", 市场复核: "管理员复核", 销售终验: "负责人确认", 总管理终判: "管理员最终确认", 销售认领: "负责人认领",
};
/** 一步在悬停全文里的那一行：哪天 谁 · 哪步 · 判定（无效原因：…；说明） */
export function 痕一行(l: { step: string; verdict: string; reason: string | null; note: string | null; 谁: string; at: Date }): string {
  const 头 = `${dayjs(l.at).format("YYYY-MM-DD")} ${l.谁} · ${步叫法[l.step] ?? l.step} · ${l.verdict}`;
  const 尾 = [l.reason?.trim() ? `无效原因：${l.reason.trim()}` : null, l.note?.trim() || null].filter(Boolean).join("；");
  return 尾 ? `${头}（${尾}）` : 头;
}

/**
 * 这一页项目的验证全过程（项目 id → 一步一行的全文）：痕一次取（projectId in）、经手人名字一次取。
 * 传进来的只是已经按列表范围筛过的项目，所以取痕不再套「谁在看」（复核的人多半看不到建的人，同 读线索验证）
 */
export async function 读验证痕们(projectIds: string[]): Promise<Map<string, string>> {
  const 全文 = new Map<string, string>();
  if (!projectIds.length) return 全文;
  const 痕 = await 看全部(() => prisma.entLeadVerifyLog.findMany({ where: { projectId: { in: projectIds } }, orderBy: { at: "asc" } }));
  if (!痕.length) return 全文;
  const 名 = new Map((await 看全部(() => prisma.user.findMany({ where: { id: { in: [...new Set(痕.map((l) => l.userId))] } }, select: { id: true, name: true } }))).map((u) => [u.id, u.name]));
  const 按项目 = new Map<string, string[]>();
  for (const l of 痕) {
    const 行 = 痕一行({ ...l, 谁: 名.get(l.userId) ?? "已不在的成员" });
    按项目.set(l.projectId, [...(按项目.get(l.projectId) ?? []), 行]);
  }
  for (const [id, 行们] of 按项目) 全文.set(id, 行们.join("\n"));
  return 全文;
}

/**
 * f：企业版首页四张指标卡点进来带的筛选（month-new / key / no-follow / due-soon，口径见 home-cards.ts）；
 * 或首页待办「待分配新线索」点进来的 await-assign（await-assign-core.ts，范围见 await-assign-scope.ts）
 */
export type 项目筛选 = { keyword?: string; ownerId?: string; pool?: string; recycled?: string; f?: string; phase?: string; node?: string; creator?: string; channelId?: string; level?: string;
  /** 项目标签（F-项目-14）：字典项名原样比；「未填标签」= 没填的 */
  projTag?: string;
  /** 数据来源（企业版）：只认「老客户重复咨询」（重复咨询来源）、「仅记录用」（X-147）= 只看带这个标记的项目，读 Project.source 不读项目名（客户 E-218）；别的值当没筛 */
  source?: string;
  /** 创建时间（11-11，渠道页点数字进来要按时间分）：两个日历日，两头都算，北京日界线（custom-date-range.ts 创建时间段） */
  createdFrom?: string; createdTo?: string;
  /**
   * onlyNew=1：从「新建」类的数点进来的（渠道看板 / 渠道列表分档，channel-stats.ts 带时段）：按创建时间筛时排掉补建的项目（project/system-created.ts），
   * 条数和卡上一致。自己在「更多筛选」里选创建时间的不带它，照旧不排
   */
  onlyNew?: string;
  /**
   * open=1：只看没结局的（审核 11-18 统计 P1-3）：渠道页「关联线索」（眼下还在线索阶段）点进来带它，和 phase 一起用，
   * 线索流失这些已结束的不列，条数和渠道页的数一致。不进筛选栏，同 onlyNew
   */
  open?: string;
  /** 「手机号」筛选（11-11）：项目的客户号码对得上的（同客户列表，lib/search-keyword.ts 客户号码SQL）；客户不露的不算 */
  phone?: string;
  /**
   * 导入批次（11-19，import-batch.ts）：batch=批次号 只看这一批、batch=-批次号 排掉这一批（importBatch 为空的留着）。
   * 数据页卡片点进来带的；列表页头挂一枚「导入批次：… ×」标签能清掉，不进筛选栏
   */
  batch?: string;
  /**
   * 客户页看板视图（11-12 第 3 批 C18）：先按客户页那一行筛出客户（customers/query.ts 客户筛选条件），再出这些客户名下的项目。
   * 只收窄：项目自己的可见范围照旧由限定层管。不是地址栏参数，服务端自己给
   */
  客户?: Prisma.CustomerWhereInput | null;
  /**
   * 客户页看板筛了客户时，「仅项目」客户（只负责项目的人，project-only-customers.ts）按这份白名单条件参与（仅项目安全条件）；
   * null / 不给 = 这类行不参与。和 客户 一样不是地址栏参数，服务端（customers/board-query.ts）给
   */
  仅项目客户?: Prisma.CustomerWhereInput | null;
  /** 服务端分页（11-11，同客户列表）：第几页、每页几条（10–100）、按哪列排（认项目排序；不给 = 最近改过在前） */
  page?: string; pageSize?: string; sort?: string };

/**
 * 按阶段、进程筛（10-30 用户：「项目页面没有关于进程，阶段的筛选选项」）。和列表上的显示同一套认法（阶段与进程）：
 * 有结局的按结局认阶段（线索流失归线索、丢单归商机…），进程选结局 = 筛这个结局，选节点 = 停在这个节点、还没结局的。
 * 认不出的值当没筛。库里存着旧节点名 / 旧结局的（企业版 10-31 改名）新旧名一起筛（同名们）。
 */
export async function 阶段进程条件(sp: { phase?: string; node?: string; open?: string }, 字典: 阶段字典): Promise<{ 阶段: 阶段 | ""; 进程: string; where: Prisma.ProjectWhereInput[] }> {
  const { 阶段, where } = 阶段条件(sp, 字典);
  // 传旧名（老链接、老书签）先换成这套的新名再认
  const 名 = sp.node ? 本套名(sp.node, 字典) : "";
  const 是结局 = (结局们of(字典) as readonly string[]).includes(名);
  const 是节点 = 阶段们.some((s) => 字典.节点们[s].includes(名));
  // 后售培育（P-界面-63，after-sale.ts）：不是节点、是潜客培育的显示名，筛它 = 停在潜客培育且判成后售；
  // 筛潜客培育就排掉后售的（两份加起来 = 停在潜客培育，不重不漏）。这套没有潜客培育这一格的当没筛；
  // 只在企业版拆（同 拼项目行 只在企业版判 后售）：别的版本后售培育当没筛、潜客培育照旧整格
  const 企 = 企业版();
  const 是后售 = 企 && 名 === 后售培育名 && 字典.节点们.线索.includes("潜客培育");
  const 进程 = 是结局 || 是节点 || 是后售 ? 名 : "";
  if (是后售) where.push(await 后售条件());
  else if (企 && 进程 === "潜客培育" && !是结局) where.push(await 潜客不含后售条件());
  else if (进程) where.push(是结局 ? { result: { in: 同名们(进程) } } : { node: { in: 同名们(进程) }, result: null });
  return { 阶段, 进程, where };
}

/** 只按阶段 + open=1 筛（不看进程，同步；公海名单候选用）。阶段进程条件 先走这一段 */
function 阶段条件(sp: { phase?: string; open?: string }, 字典: 阶段字典): { 阶段: 阶段 | ""; where: Prisma.ProjectWhereInput[] } {
  const 阶段 = (阶段们 as readonly string[]).includes(sp.phase ?? "") ? (sp.phase as 阶段) : "";
  const where: Prisma.ProjectWhereInput[] = [];
  if (阶段) {
    // 和渠道统计同一句（stage-dict.ts 项目在阶段）：没结局看 phase，有结局看结局归哪个阶段
    where.push({ OR: [{ phase: 阶段, result: null }, { result: { in: 归阶段的结局(字典, 阶段) } }] });
  }
  // 渠道页「关联线索」点进来（open=1）：只看没结局的
  if (sp.open === "1") where.push({ result: null });
  return { 阶段, where };
}

/** 项目详情页中栏名单最多列这么多个项目（按最近改过排，读名单项目）；项目列表 11-11 起服务端分页，不再受它限 */
export const 项目上限 = 500;
/** 中栏名单先筛后截时最多往后取几批（每批 项目上限 个，最多扫 2000 行；读名单项目） */
export const 名单最多批 = 4;

/**
 * 企业版首页「有 N 条新线索」：还在线索阶段、没结局（没线索流失）、不在公海的项目。
 * 老的 Lead 表在企业版不再列，数它会说出一个点进 /leads 对不上的数（10-28 排查）。
 */
export function 数新线索() {
  return prisma.project.count({ where: { phase: "线索", result: null, pooledAt: null } });
}

/** 项目列表每页几条：同客户列表（customers/page.tsx），10–100，默认 20 */
export const 每页默认 = 20;
export function 认每页(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? Math.min(100, Math.max(10, n)) : 每页默认;
}
function 认页码(v: unknown): number {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 1;
}

/**
 * 项目列表能排的列（11-11 改服务端排，在全部筛选结果里排）：创建时间、预计成交（没填的总在最后）、负责人（按名字拼音）。
 * 不给 = 默认最近改过在前。每种都带主键做最后一道，翻页顺序稳定
 */
export const 项目排序们 = ["created-asc", "created-desc", "deal-asc", "deal-desc", "owner-asc", "owner-desc"] as const;
export type 项目排序 = (typeof 项目排序们)[number] | "";
export const 认项目排序 = (v: unknown): 项目排序 => ((项目排序们 as readonly unknown[]).includes(v) ? (v as 项目排序) : "");
const 默认序: Prisma.ProjectOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "desc" }];

/** 客户页看板的客户条件里一共带了多少个 in / notIn 的值（关键词、批次那几串编号名单）：超过 客户名单一次取全线 看板改一句取全（读项目列表） */
export function 绑定名单长度(w: unknown): number {
  if (Array.isArray(w)) return w.reduce((n: number, x) => n + 绑定名单长度(x), 0);
  if (!w || typeof w !== "object" || w instanceof Date) return 0;
  let n = 0;
  for (const [k, v] of Object.entries(w)) n += (k === "in" || k === "notIn") && Array.isArray(v) ? v.length : 绑定名单长度(v);
  return n;
}
/** 名单短于这个数（窄词）照原来的分列各取；测试里可以调小（设客户名单一次取全线） */
let 客户名单一次取全线 = 2000;
export function 设客户名单一次取全线(n: number) { 客户名单一次取全线 = n; }
function 排序of(排: 项目排序): Prisma.ProjectOrderByWithRelationInput[] {
  if (排 === "created-asc") return [{ createdAt: "asc" }, { id: "asc" }];
  if (排 === "created-desc") return [{ createdAt: "desc" }, { id: "desc" }];
  // 预计成交：没填的两头都在最后（同原来浏览器里的 按预计成交排）；同一天的照默认最近改过在前
  if (排 === "deal-asc" || 排 === "deal-desc") return [{ expectedDealAt: { sort: 排 === "deal-asc" ? "asc" : "desc", nulls: "last" } }, ...默认序];
  return 默认序;
}

/**
 * 「露客户」（db.ts 露客户）的库里写法：客户在我读客户的范围里，或项目不在公海、负责人是我。不限定（全看得到）= null。
 * 项目列表按客户名搜、按号码筛、按客户来源算渠道时，客户不露的不算中（不然拿名字 / 号码 / 渠道试得出同事客户挂着哪些项目）；
 * 原来取回 500 条后在内存里滤，11-11 挪进 where，count 和分页才对得上
 */
export async function 露客户条件(me: { id: string }): Promise<Prisma.ProjectWhereInput | null> {
  const 范围 = await 客户读条件(defaultClient);
  return 范围 ? { OR: [{ customer: 范围 as Prisma.CustomerWhereInput }, { pooledAt: null, ownerId: me.id }] } : null;
}

/**
 * 项目列表的条件（项目页、企业版新线索页、渠道页名单都用这一个）：筛选、可见范围以外的「列不列」全在 where 里，
 * 只剩两道库里写不出的（收回次数、3 天内回公海），由 读项目列表 取回候选后再滤（后筛）
 */
async function 列表条件(me: { id: string; role: string } & Parameters<typeof 回避豁免>[0], sp: 项目筛选, 只看阶段?: 阶段) {
  const 词 = 搜索词(sp.keyword);
  const 企 = 企业版();
  const 规则 = 企 ? await 生效组织规则() : null;
  const 今 = new Date();
  // 首页指标卡的筛选只在企业版认；条件和卡上 count 用的是同一份（home-cards.ts），数对得上
  const 卡 = 规则 ? 认首页卡(sp.f) : "";
  // 点卡进来的，和卡上的数同一圈（首页卡范围：按负责人，最下级只看自己，上级看自己 + 下属，总管理 / 管理员全看），数对得上
  const 卡的人 = 卡 ? await 首页卡的人(me) : undefined;
  const 卡的圈: Prisma.ProjectWhereInput | undefined = 卡的人 ? { ownerId: { in: [...卡的人] } } : undefined;
  // 暂未跟进按负责人一路一路筛（只认现负责人记的沟通，home-cards.ts），和卡上的数同一批负责人
  const 卡负责人们 = 卡 === "no-follow" ? await 暂未跟进负责人们(卡的人) : undefined;
  // 首页待办「待分配新线索」点进来（11-21）：和那一行的条数同一个条件（数待分配 也走这里）；没资格看 = 一条不列
  const 待分配筛中 = 企 && sp.f === 待分配筛;
  const 待分配 = 待分配筛中 ? await 待分配范围(me) : null;
  const 字典 = 字典of(企);
  const 阶进 = await 阶段进程条件(sp, 字典);
  // 企业版市场视角（11-04 P-界面-05）：市场成员 = 自己负责的 ∪ 自己建的已分出去的；市场管理 = 本人 + 实线下属，可按创建人筛；公海的都不列
  const 市场 = 企 ? await 读市场身份(me.id) : null;
  const 创建人 = 市场?.视角 === "市场管理" && typeof sp.creator === "string" && 市场.圈.includes(sp.creator) ? sp.creator : "";
  // 自定义筛选（11-06）：渠道和列表上「渠道」一列同一条规则——项目自己选的优先，没选跟客户来源（channel-stats.ts 项目算哪个渠道）
  // 只认渠道 id：客户列表那格的「未填」「触点:xx」（F-049，customer-source-filter.ts）是客户的口径，项目不带触点；
  // 市场角色从客户列表切「我分出去的」、或手改地址栏带过来的，当没筛（不然拿它当渠道 id 比，0 条、框里写原始值）
  const 来源f = 企 && typeof sp.channelId === "string" ? 认来源筛选(sp.channelId) : null;
  const 来源 = 来源f?.类 === "渠道" ? 来源f.id : "";
  const 级别筛 = !企 ? "" : sp.level === 未分级 ? 未分级 : (企业级别(sp.level) ?? "");
  const 标签筛 = 企 && typeof sp.projTag === "string" ? sp.projTag.trim().slice(0, 40) : "";
  // 仅记录用（X-147）也能筛：标了这个来源的都列（含已推进出潜客培育、照常统计的），读 Project.source
  const 来源筛 = 企 && (sp.source === 重复咨询来源 || sp.source === 仅记录用来源) ? sp.source : "";
  // 搜原始客户编号（客户 E-218「检索、统计、复盘都读字段」）：关键词里像客户编号的（NO.29792、29792）换成那位客户，
  // 命中 repeatOfCustomerId 是他的重复咨询线索——负责人改了项目名照样搜得到。只多一支 OR，看不看得到这条线索照旧由列表范围管
  const 编号客户 = 企 ? await 编号对客户(拆搜索词(词)) : new Map<string, string>();
  const 建于 = 创建时间段(sp.createdFrom, sp.createdTo);
  const 批 = 读批次(sp.batch);
  // 手机号（11-11）：先按号码找客户（电话藏着的人 = null，不筛），再取挂在这些客户上的项目，客户要露
  const 号码 = await 客户号码条件(sp.phone, me.id);
  // 客户条件只认服务端给的对象（客户页看板视图）；地址栏原样传进来的字符串（新线索页等直接把 searchParams 给进来）当没给
  const 客户 = sp.客户 && typeof sp.客户 === "object" ? sp.客户 : null;
  const 露 = 词 || 来源 || 号码 || 客户 ? await 露客户条件(me) : null;
  const 并露 = (w: Prisma.ProjectWhereInput): Prisma.ProjectWhereInput => (露 ? { AND: [w, 露] } : w);
  /*
    按客户的字段筛（客户页看板）：只算「客户看得到」那一支，不再对「自己负责的项目」放行（11-12 堵口子）——
    客户筛选的关键词会搜客户手机、备注、联系人电话，只负责项目的人输个号码看自己的卡留不留，就试得出看不到的客户的号码。
    他看不到的客户（仅项目，project-only-customers.ts）另并一支：只按白名单条件（名字 / 简称 / 公司、客户类型），筛了别的不参与
  */
  const 客户范围 = 客户 || 号码 || 来源 ? await 客户读条件(defaultClient) : null;
  const 看得到的 = (w: Prisma.ProjectWhereInput): Prisma.ProjectWhereInput => (客户范围 ? { AND: [w, { customer: 客户范围 as Prisma.CustomerWhereInput }] } : w);
  const 仅项目 = 客户 && sp.仅项目客户 && typeof sp.仅项目客户 === "object" ? sp.仅项目客户 : null;
  const 仅项目项目 = 仅项目 ? [...(await 仅项目客户们(me)).values()].flat() : [];
  const 按客户 = (c: Prisma.CustomerWhereInput): Prisma.ProjectWhereInput => (仅项目项目.length && 仅项目
    ? { OR: [看得到的({ customer: c }), { id: { in: 仅项目项目 }, ownerId: me.id, pooledAt: null, customer: 仅项目 }] }
    : 看得到的({ customer: c }));
  // 企业版「收回次数」：从留痕里数；按次数筛只在企业版的项目公海里生效
  const 收回筛 = 企 && sp.pool === "1" ? 收回次数筛(sp.recycled) : "";
  const 并且: Prisma.ProjectWhereInput[] = [
    ...(建于 ? [{ createdAt: 建于, ...(sp.onlyNew === "1" ? 不算补建 : {}) }] : []),
    ...(批 ? [批次条件(批)!] : []),
    /*
      按号码筛中的是客户：只算「客户看得到」的（11-12 堵口子）。原来按「露客户」算——自己负责的项目、客户不归我也算中，
      只负责项目的人（project-only-customers.ts）输个号码看自己的项目留不留，就试得出看不到的客户的电话、联系人电话。
      客户看得到的照旧；搜索框的关键词只比项目名和客户名（下面 词），不碰号码、备注
    */
    ...(号码 ? [看得到的({ customer: 号码 })] : []),
    // 客户看不到时不拿客户的来源（同列上的「渠道」，11-12 审查起和号码一样只认「客户看得到的」，自己负责的项目也不例外）：否则筛一下就试出客户从哪来
    ...(来源 ? [{ OR: [{ channelId: 来源 }, 看得到的({ channelId: null, customer: { channelId: 来源 } })] }] : []),
    ...(级别筛 ? [{ level: 级别筛 === 未分级 ? null : 级别筛 }] : []),
    ...(标签筛 ? [{ projTag: 标签筛 === 未填标签 ? null : 标签筛 }] : []),
    ...(来源筛 ? [{ source: 来源筛 }] : []),
    ...(卡 && 规则 ? [首页卡条件(卡, 规则, 字典of(企), 今, 卡负责人们), ...(卡的圈 ? [卡的圈] : [])] : []),
    // 3 天内回公海：粗筛之外再加紧筛（同首页卡的数，tests/ent-due-soon-prefilter.test.ts 两种筛对拍），候选少取一些；剩下的取回逐个算
    ...(卡 === "due-soon" && 规则 ? [即将逾期紧筛(规则, 字典of(企), 今) ?? { id: { in: [] } }] : []),
    ...(待分配筛中 ? [待分配 ?? { id: { in: [] } }] : []),
    ...阶进.where,
    // 按客户的字段筛：客户不露的不列（和按客户名搜同一条，不然拿筛选试得出同事公海客户挂着哪些项目）
    ...(客户 ? [按客户(客户)] : []),
    ...(市场 ? [市场项目条件(me.id, 市场.圈, 创建人)] : []),
    // 公海里同事客户的项目：不露客户名；按客户名搜也不该搜出它（否则等于拿名字试出来）。搜索词的 OR 放进 AND 里，不和别的 OR 打架
    // 关键词拆词（23D，同客户列表 2F：拆搜索词）：全角空格、多个空格归一，按空格、括号、逗号、顿号拆开，每个词都要中，
    // 各词可以一个中项目名、一个中客户名；像号码、客户编号、网址的整串不拆。全半角写法：库里存全角字母、人也敲全角的照旧中
    ...拆搜索词(词).map((w): Prisma.ProjectWhereInput => {
      const 名 = 全半角写法(w).map((x) => ({ name: { contains: x } }));
      const 原始客户 = 编号客户.get(w);
      return { OR: [...名, 并露({ customer: 名.length === 1 ? 名[0] : { OR: 名 } }), ...(原始客户 ? [{ repeatOfCustomerId: 原始客户 }] : [])] };
    }),
  ];
  // 企业版 C-01：公海里我是历史负责人的项目我看不到（总管理 / 管理员不算，lib/project/pool-owner.ts 回避豁免）
  const 回避 = (await 回避豁免(me)) ? [] : await 我回避的公海项目(prisma, me.id);
  const where: Prisma.ProjectWhereInput = {
    ...(只看阶段 ? { phase: 只看阶段 } : {}),
    ...(回避.length ? { id: { notIn: 回避 } } : {}),
    ...(typeof sp.ownerId === "string" && sp.ownerId ? { ownerId: sp.ownerId } : {}),
    // 企业版公海只有一处（/pool）：默认列表不列公海项目，不然同一个项目两边都有；团队版公海项目照旧混在列表里，页上有「在公海」标。
    // 点首页卡进来的不加：哪些算由卡的条件定（「本月新增」不管在不在推，含公海），和卡上的数对得上
    ...(sp.pool === "1" ? { pooledAt: { not: null } } : 企 && !卡 ? { pooledAt: null } : {}),
    ...(并且.length ? { AND: 并且 } : {}),
  };
  return { where, 词, 企, 规则, 今, 卡, 阶进, 市场, 创建人, 来源, 级别筛, 标签筛, 来源筛, 号码, 收回筛, 批, 待分配筛中, 待分配 };
}

/**
 * 关键词里像客户编号的词 → 那位客户的 id（按编号精确比，客户编号唯一；回收站里的客户也认，重复咨询线索还挂着他）。
 * 只拿来比 Project.repeatOfCustomerId，不回客户的任何字段。判法用更严的 看成客户编号严（带 NO. 或够 5 位纯数字）：「2024」不触发
 */
async function 编号对客户(词们: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const w of 词们) {
    const n = 看成客户编号严(w);
    if (!n) continue;
    const c = await 看全部(() => 看已删(() => prisma.customer.findUnique({ where: { customerNo: n }, select: { id: true } })));
    if (c) out.set(w, c.id);
  }
  return out;
}

/**
 * 首页待办「待分配新线索 N 条 · 最早 …」（11-21）：和新线索页 /leads?f=await-assign 同一个 列表条件（同一个范围、同一层可见限定），
 * 点进去的行数 = 这里的条数。没资格（待分配范围 为 null）、一条都没有 = null，不画
 */
export async function 数待分配(me: Parameters<typeof 列表条件>[0]): Promise<待分配数 | null> {
  if (!企业版()) return null;
  // 先问有没有资格（只读组织、开关，不查库）：没资格的（销售最多）不跑整套 列表条件（市场身份、公海回避那几句）。首页是压测盯着的页
  if (!(await 待分配范围(me))) return null;
  const c = await 列表条件(me, { f: 待分配筛 }, "线索");
  if (!c.待分配) return null;
  const [条数, 早] = await Promise.all([
    prisma.project.count({ where: c.where }),
    prisma.project.findFirst({ where: c.where, orderBy: { awaitAssignAt: "asc" }, select: { awaitAssignAt: true } }),
  ]);
  // 最早那条的时刻在服务端按北京墙钟写好（同 待回复客户 的 时）：浏览器在伦敦也不会和服务端渲染的对不上
  // 最早At：同一刻的 ISO 瞬间，首页拿它走 smartTime（浏览器用企业版业务钟 = 北京，layout.tsx BusinessProvider timeZone）
  return 条数 ? { 条数, 最早: 短时刻(早?.awaitAssignAt), 最早At: 早?.awaitAssignAt?.toISOString() ?? null } : null;
}

/**
 * 「待分配」提醒发给谁（11-21，P-转-38 / X-79「提醒能分配的人（开关关着只提醒系统管理员）」）：候选人里，
 * 各人首页「待分配新线索」那一行（数待分配，同一个 列表条件、按他的身份限定）数得到这批里的哪几条。回 人 → 他数得到的项目 id；数不到的人不在里面。
 * 收到提醒点进去（/leads?f=await-assign）就看得到，不会「收到了、列表里没有」。外面包了 看全部 也照样按各人限定（照限定）
 */
export async function 待分配看得到的(人们: readonly string[], projectIds: readonly string[]): Promise<Map<string, string[]>> {
  const 出 = new Map<string, string[]>();
  if (!企业版() || !人们.length || !projectIds.length) return 出;
  const { 以谁的身份 } = await import("@/lib/enterprise/visibility");
  const users = await 看全部(() => prisma.user.findMany({ where: { id: { in: [...人们] }, active: true }, select: { id: true, role: true, name: true } }));
  for (const u of users) {
    if (!(await 待分配范围(u))) continue;
    const ids = await 照限定(() => 以谁的身份(u.id, async () => {
      const c = await 列表条件(u, { f: 待分配筛 }, "线索");
      if (!c.待分配) return [];
      return (await prisma.project.findMany({ where: { AND: [c.where, { id: { in: [...projectIds] } }] }, select: { id: true } })).map((r) => r.id);
    }));
    if (ids.length) 出.set(u.id, ids);
  }
  return 出;
}

/**
 * 分页取回的一行（include 和原来一页 500 条时一样）。最近一条留痕（超时回收日要的 logs take 1）不在 include 里：
 * Prisma 对一对多的 take 1 是把这些项目的留痕整批取回再在内存里截（11-12 实测：20 个项目各 50 条留痕，那一句回 1000 行），
 * 改成 补回收起点留痕（db.ts）一句 groupBy 取每个项目最近一条的时间
 */
function 行include(市场: boolean, meId: string) {
  return {
    customer: { select: { name: true, shortName: true, customerNo: true, lastFollowAt: true, channelId: true, pool: { select: { customerId: true } }, channel: { select: { name: true } } } },
    exceptionCategory: { select: { name: true } },
    channel: { select: { name: true } },
    ...(市场 ? {
      entLeadVerify: { select: { verdict: true, pending: true, salesAck: true, invalidReason: true } },
      members: { where: { userId: meId, inviteStatus: "JOINED" }, select: { userId: true } },
    } : {}),
  } satisfies Prisma.ProjectInclude;
}


/** 负责人一列排序用的名字：同列上显示的（没了的人写「已不在的成员」，空写「没人」）；拼音序，同名按 id */
async function 负责人顺序(ownerIds: string[], 降: boolean): Promise<string[]> {
  const 名 = new Map((await prisma.user.findMany({ where: { id: { in: ownerIds.filter(Boolean) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const 叫 = (id: string) => 名.get(id) ?? (id ? "已不在的成员" : "没人");
  const 序 = [...ownerIds].sort((a, b) => 叫(a).localeCompare(叫(b), "zh-CN") || (a < b ? -1 : a > b ? 1 : 0));
  return 降 ? 序.reverse() : 序;
}

type 列表条件包 = Awaited<ReturnType<typeof 列表条件>>;
type 行带include = Prisma.ProjectGetPayload<{ include: ReturnType<typeof 行include> }> & 回收起点留痕;

/**
 * 收回次数、3 天内回公海（后筛）：库里写不出，取回全部候选（只要几列）逐个算，按序排好（按负责人排时按名字拼音、同一位照默认序）。
 * 候选本来就窄：收回次数只在企业版项目公海（/projects?pool=1 已转去 /pool），3 天内回公海先过紧筛
 */
async function 后筛候选(c: 列表条件包, 排: 项目排序, 超时线们: Awaited<ReturnType<typeof 超时成员线>> | null) {
  const 按负责人 = 排 === "owner-asc" || 排 === "owner-desc";
  const 候选 = await 补回收起点留痕(await prisma.project.findMany({
    where: c.where,
    orderBy: 排序of(按负责人 ? "" : 排),
    select: { ...算超时要的, amount: true, currency: true },
  }), prisma, c.今);
  const 收回 = c.收回筛 ? await 数收回次数(候选.map((r) => r.id), prisma) : null;
  let 剩 = 候选.filter((p) => 合收回次数(收回?.get(p.id) ?? 0, c.收回筛) && (c.卡 !== "due-soon" || (!!c.规则 && 即将逾期(项目回收日(c.规则, p, 超时线们), c.今))));
  if (按负责人) {
    const 位 = new Map((await 负责人顺序([...new Set(剩.map((r) => r.ownerId))], 排 === "owner-desc")).map((id, i) => [id, i]));
    剩 = 剩.map((r, i) => ({ r, i })).sort((a, b) => 位.get(a.r.ownerId)! - 位.get(b.r.ownerId)! || a.i - b.i).map((x) => x.r);
  }
  return 剩;
}

/** 看板每列首屏几张、「再看」一次几张（11-12 用户「按建议改，每列各自取数」） */
export const 每列条数 = 20;
/** 「再看」动作一次最多取几张、偏移最大多少（服务端兜底，界面一次只要 每列条数） */
export const 每列一次最多 = 100;
const 每列偏移上限 = 100_000;

/** 看板分列用的字典：和项目页画看板时同一份（board-page.tsx：企业版带组织规则改过的出口叫法） */
const 看板字典of = (c: Pick<列表条件包, "企" | "规则">) => (c.企 ? 字典of(true, c.规则?.阶段.出口叫法) : undefined);

/**
 * 一列在库里的条件：落在这一列的那几组 阶段 / 进程 / 结局（取自 groupBy 的分组，和列头的数同一份）。
 * 不另写一套「哪个进程算哪列」：旧节点名、认不出的进程落本阶段第一列这些，都按 看板落列 认过的组来
 */
function 列条件(组们: readonly { phase: string; node: string; result: string | null }[], 列: string, 落: (r: { phase: string; node: string; result: string | null }) => string): Prisma.ProjectWhereInput | null {
  const 三 = new Map<string, { phase: string; node: string; result: string | null }>();
  for (const g of 组们) if (落(g) === 列) 三.set(JSON.stringify([g.phase, g.node, g.result]), { phase: g.phase, node: g.node, result: g.result });
  return 三.size ? { OR: [...三.values()].map((g) => ({ phase: g.phase, node: g.node, result: g.result })) } : null;
}

/** 按负责人排（名字拼音）时第 偏移+1 起 条数 个落在哪几位名下：每位从第几个起、取几个 */
export function 负责人段们(序: readonly string[], 数: ReadonlyMap<string, number>, 偏移: number, 条数: number): { ownerId: string; 起: number; 取: number }[] {
  const 段: { ownerId: string; 起: number; 取: number }[] = [];
  let 起 = 偏移;
  let 要 = 条数;
  for (const id of 序) {
    if (要 <= 0) break;
    const n = 数.get(id) ?? 0;
    if (!n) continue;
    if (起 >= n) { 起 -= n; continue; }
    const 取 = Math.min(n - 起, 要);
    段.push({ ownerId: id, 起, 取 });
    要 -= 取;
    起 = 0;
  }
  return 段;
}

/**
 * 按负责人排的一段 id，最多 3 句、不随人数涨：头一位 skip / take；中间那几位整位都要（合起来不超过 条数 个）并成一句 ownerId in，
 * 取回在内存里按名字拼音的位次排（同一位照默认序）；末一位 take。每句都走 ownerId 索引
 */
async function 按负责人取ids(w: Prisma.ProjectWhereInput, 序: readonly string[], 数: ReadonlyMap<string, number>, 偏移: number, 条数: number): Promise<string[]> {
  const 段 = 负责人段们(序, 数, 偏移, 条数);
  if (!段.length) return [];
  const 取段 = (x: { ownerId: string; 起: number; 取: number }) =>
    prisma.project.findMany({ where: { AND: [w, { ownerId: x.ownerId }] }, orderBy: 默认序, skip: x.起, take: x.取, select: { id: true } });
  const 中 = 段.slice(1, -1);
  const [头, 中行, 尾] = await Promise.all([
    取段(段[0]),
    // take 兜底：这几位应取的条数之和（计数之后又有人进来也不多取）
    中.length ? prisma.project.findMany({ where: { AND: [w, { ownerId: { in: 中.map((x) => x.ownerId) } }] }, orderBy: 默认序, take: 中.reduce((n, x) => n + x.取, 0), select: { id: true, ownerId: true } }) : Promise.resolve([]),
    段.length > 1 ? 取段(段[段.length - 1]) : Promise.resolve([]),
  ]);
  const 位 = new Map(中.map((x, i) => [x.ownerId, i]));
  const 中排 = 中行.map((r, i) => ({ r, i })).sort((a, b) => 位.get(a.r.ownerId)! - 位.get(b.r.ownerId)! || a.i - b.i).map((x) => x.r.id);
  return [...头.map((r) => r.id), ...中排, ...尾.map((r) => r.id)];
}

/** 一列里按 排 的第 偏移+1 起 条数 个项目的 id（只取 id，卡片再一次 include）；按负责人排给这一列每位负责人几个 */
async function 列里一段(where: Prisma.ProjectWhereInput, 条: Prisma.ProjectWhereInput, 排: 项目排序, 偏移: number, 条数: number, 人?: { 序: string[]; 数: Map<string, number> }): Promise<string[]> {
  const w: Prisma.ProjectWhereInput = { AND: [where, 条] };
  if (!人) return (await prisma.project.findMany({ where: w, orderBy: 排序of(排), skip: 偏移, take: 条数, select: { id: true } })).map((r) => r.id);
  return 按负责人取ids(w, 人.序, 人.数, 偏移, 条数);
}

/** 按 id 一次取回卡片要的（include 同列表，最近留痕另一句），照 ids 的序；今 = 同一请求的 列表条件.今（最近留痕「不晚于今」和回收日、即将回收同一刻） */
async function 按序取行(ids: string[], include: ReturnType<typeof 行include>, 今: Date): Promise<行带include[]> {
  if (!ids.length) return [];
  const 取 = new Map((await 补回收起点留痕(await prisma.project.findMany({ where: { id: { in: ids } }, include }), prisma, 今)).map((r) => [r.id, r]));
  return ids.flatMap((id) => (取.has(id) ? [取.get(id)!] : []));
}

/**
 * 看板「再看 N 个」（11-12）：这一列从第 偏移+1 个起再取 条数 个，拼成卡片。
 * 条件就是首屏那一份（列表条件：筛选、可见范围、市场范围、公海 / 回避、首页卡都在里面）再并上这一列的节点条件，不另写可见范围；
 * 列键不在这一屏看板的列里（白名单，看板列键们）、偏移 / 条数不对 = null。只读：不跑超时回收、不回填。
 * 看板列里恒按默认序（最近改过在前，同改动前的看板）：调用方（board-actions.ts）不传 sort；这里仍认各种 sort，给以后 / 临时列表用
 */
export async function 读看板一列(me: Parameters<typeof 公海超时收回>[0] & Parameters<typeof 待我回的邀请>[0] & { role: string }, sp: 项目筛选, 列: string, 偏移: number, 条数: number = 每列条数): Promise<{ 行: 项目行[]; 总: number } | null> {
  if (typeof 列 !== "string" || !Number.isSafeInteger(偏移) || 偏移 < 0 || 偏移 > 每列偏移上限) return null;
  if (!Number.isSafeInteger(条数) || 条数 < 1 || 条数 > 每列一次最多) return null;
  const c = await 列表条件(me, sp);
  const 字典 = 看板字典of(c);
  if (!看板列键们(字典, sp.phase).includes(列)) return null;
  const 落 = 看板落列(字典);
  const 排 = 认项目排序(sp.sort);
  const 按负责人 = 排 === "owner-asc" || 排 === "owner-desc";
  const 超时线们 = c.规则 ? await 超时成员线(c.规则) : null;
  let 总: number;
  let ids: string[];
  if (!!c.收回筛 || c.卡 === "due-soon") {
    const 这列 = (await 后筛候选(c, 排, 超时线们)).filter((r) => 落(r) === 列);
    总 = 这列.length;
    ids = 这列.slice(偏移, 偏移 + 条数).map((r) => r.id);
  } else {
    const 组 = await prisma.project.groupBy({ by: ["phase", "node", "result"], where: c.where, _count: { _all: true } });
    const 条 = 列条件(组, 列, 落);
    总 = 组.filter((g) => 落(g) === 列).reduce((n, g) => n + g._count._all, 0);
    if (!条 || 偏移 >= 总) ids = [];
    else if (按负责人) {
      const 按人 = await prisma.project.groupBy({ by: ["ownerId"], where: { AND: [c.where, 条] }, _count: { _all: true } });
      const 数 = new Map(按人.map((g) => [g.ownerId, g._count._all]));
      ids = await 列里一段(c.where, 条, 排, 偏移, 条数, { 序: await 负责人顺序([...数.keys()], 排 === "owner-desc"), 数 });
    } else ids = await 列里一段(c.where, 条, 排, 偏移, 条数);
  }
  const rows = await 按序取行(ids, 行include(!!c.市场, me.id), c.今);
  return { 行: await 拼项目行(me, rows, { ...c, 超时线们 }), 总 };
}

/**
 * 按部门认的市场成员、没有市场角色（P-看-17 / X-165）：这一批里点进去会被 projects/[id]/load.ts 市场去向 转回客户页这一行的那几条（同一个判定：
 * 部门市场无市场角色该转向，且 能看项目 不过）。列表上照市场视角标「只看进度」、点不进，不然点了跳回同一页像没反应。只改能不能点，行照旧。
 * 先按项目本身筛（自己建的、分给别人、不在公海），绝大多数销售不多读市场成员设置
 */
async function 部门市场无市场角色转向行(me: Parameters<typeof 能看项目>[0], rows: 行带include[]): Promise<Set<string>> {
  const 候选 = rows.filter((p) => p.creatorId === me.id && p.ownerId && p.ownerId !== me.id && !p.pooledAt);
  if (!候选.length) return new Set();
  const org = await 权限组织();
  if (!org) return new Set();
  const 成员集 = await 读市场成员们(org);
  if (!部门市场无市场角色(org, me.id, 成员集)) return new Set();
  const 进组 = new Set((await 看全部(() => prisma.projectMember.findMany({
    where: { userId: me.id, inviteStatus: "JOINED", projectId: { in: 候选.map((p) => p.id) } }, select: { projectId: true },
  }))).map((m) => m.projectId));
  return new Set(候选.filter((p) => {
    const 带 = { ...p, 已加入: 进组.has(p.id) ? [me.id] : [] };
    return 部门市场无市场角色该转向(org, me.id, 成员集, 带) && !能看项目(me, 带, org);
  }).map((p) => p.id));
}

/**
 * 一批取回的项目拼成 项目行（列表、看板、「再看」共用）：负责人名字、客户露不露、收回次数、市场视角的验证结果都按这一批一次取，不按行查。
 * 待复核：调用方已经取过（项目页要拿它给页上的待复核清单）就传进来，不再取一遍
 */
async function 拼项目行(
  me: Parameters<typeof 待我回的邀请>[0] & { id: string },
  rows: 行带include[],
  c: Pick<列表条件包, "企" | "规则" | "今" | "市场"> & { 超时线们: Awaited<ReturnType<typeof 超时成员线>> | null; 待复核?: Awaited<ReturnType<typeof 待我复核的>> },
): Promise<项目行[]> {
  const { 企, 规则, 今, 市场, 超时线们 } = c;
  const 将收 = (p: 行带include) => {
    if (!规则 || p.pooledAt) return null;
    const 日 = 项目回收日(规则, p, 超时线们);
    return 即将回收(日, 今) ? 日 : null;
  };
  // 公海里的项目负责人一栏写原负责人（企业版库里已清空，从留痕取）
  const 原负责人 = await 历史负责人们(prisma, rows.filter((r) => r.pooledAt).map((r) => r.id));
  const 负责人of = (p: 行带include) => (p.pooledAt ? 原负责人.get(p.id) ?? p.ownerId : p.ownerId);
  const [人, 可见, 收回, 待复核, 后售们] = await Promise.all([
    // 定时分配的接手人（PR3）一并取名字
    prisma.user.findMany({ where: { id: { in: [...new Set([...rows.map(负责人of), ...rows.flatMap((r) => (r.scheduledAssignTo ? [r.scheduledAssignTo] : []))])] } }, select: { id: true, name: true } }),
    看得到的客户(rows.map((r) => r.customerId)),
    企 ? 数收回次数(rows.map((r) => r.id), prisma) : Promise.resolve(null),
    c.待复核 ? Promise.resolve(c.待复核) : 企 ? 待我复核的(me) : Promise.resolve([]),
    // 后售培育（P-界面-63）：这一页一次判完（后售项目们，一句查交付结清），不逐行查
    企 ? 后售项目们(rows) : Promise.resolve(new Set<string>()),
  ]);
  const 名字 = new Map(人.map((u) => [u.id, u.name]));
  // 市场视角：等我拍板的市场复核那几条照旧能进详情（复核要看来龙去脉）；验证结果的「待」按规则实际交给谁算（同详情页）
  const 我复核 = new Set(待复核.filter((r) => r.步 === "市场复核").map((r) => r.projectId));
  const 交给 = 市场 ? await 无效交给(市场.org) : "总管理终判";
  // 验证结果悬停看全过程（客户 11-05（X-09））：这一页的痕一次取、经手人名字一次取，不按行查
  const 痕们 = 市场 ? await 读验证痕们(rows.filter((r) => (r as { entLeadVerify?: unknown }).entLeadVerify).map((r) => r.id)) : new Map<string, string>();
  const 转向行 = 企 && !市场 ? await 部门市场无市场角色转向行(me, rows) : new Set<string>();
  const 市场格 = (p: 行带include): Pick<项目行, "只看进度" | "验证结果" | "验证全文"> => {
    if (!市场) return 转向行.has(p.id) ? { 只看进度: true } : {};
    const v = (p as { entLeadVerify?: { verdict: string; pending: string | null; salesAck: string | null; invalidReason: string | null } | null }).entLeadVerify;
    const 已加入 = ((p as { members?: { userId: string }[] }).members ?? []).map((m) => m.userId);
    const 叫法 = v ? 验证结果叫法({ 判定: v.verdict, 待: 实际待(v.pending, 交给), 终验: v.salesAck }) : null;
    return {
      只看进度: 只看进度(市场.圈, me.id, { ownerId: p.ownerId, 已加入 }, 我复核.has(p.id)),
      验证结果: 叫法 ? 验证摘要(叫法, v?.invalidReason ?? null) : p.phase === "线索" && !p.result ? "暂未验证" : null,
      验证全文: 痕们.get(p.id) ?? null,
    };
  };
  // 公海里同事客户的项目：不露客户名（按客户名搜、按号码筛、按客户来源算渠道的「客户要露」已在 where 里，列表条件）
  const 露 = (p: 行带include) => 露客户(me, p, 可见);
  // 只负责项目的人（仅项目，project-only-customers.ts）：客户看不到，但点得进受限客户详情，不标「进不了」
  const 仅项目 = 企 && rows.some((p) => !可见.has(p.customerId) && p.ownerId === me.id) ? new Set([...(await 仅项目客户们(me)).values()].flat()) : new Set<string>();
  return rows.map((p) => ({
    id: p.id, name: p.name, customerId: p.customerId, customerName: 露(p) ? 客户显名({ id: p.customerId, ...p.customer }) : null, ...(企 && !可见.has(p.customerId) && !仅项目.has(p.id) ? { 进不了客户详情: true } : {}),
    ownerId: p.ownerId, ownerName: 名字.get(负责人of(p)) ?? (负责人of(p) ? "已不在的成员" : "没人"),
    // 库里存着旧节点名 / 旧结局的按这套的新名给界面（企业版 10-31 改名）
    ...本套位置({ phase: p.phase, node: p.node, result: p.result }, 字典of(企)), ...(后售们.has(p.id) ? { 后售: true as const } : {}), exceptionCategory: p.exceptionCategory?.name ?? null, exceptionReason: p.exceptionReason,
    pooled: !!p.pooledAt,
    ...(企 && p.customer.pool ? { 客户在公海: true } : {}),
    ...(企 && p.awaitAssignAt && !p.pooledAt ? { 待分配: true } : {}),
    // 老客户重复咨询（重复咨询第一步）：项目名旁一枚小标签
    ...(企 && 是重复咨询(p) ? { 重复咨询: true as const } : {}),
    // 指定分配时间（PR3）：还没到点的定时，负责人那格写「定时 11-20 15:00」，悬停看分给谁
    ...(企 && p.awaitAssignAt && !p.pooledAt && p.scheduledAssignAt ? { 定时分配: { 时: 短时刻(p.scheduledAssignAt, 今) ?? "", 给谁: p.scheduledAssignTo ? 名字.get(p.scheduledAssignTo) ?? "已不在的成员" : null } } : {}),
    ...(企 ? { 即将回收: 将收(p), 回收日: 规则 && !p.pooledAt ? 项目回收日(规则, p, 超时线们) : null, 下一步时间: p.nextStepAt ? dayjs(p.nextStepAt).format("YYYY-MM-DD") : null, 指定回复: p.replyStartAt || p.replyEndAt ? 指定回复文字(p.replyStartAt, p.replyEndAt, 今) : null } : {}),
    // 项目来源和渠道统计同一条规则：项目自己选的优先，没选跟客户来源（lib/enterprise/channel-stats.ts 项目算哪个渠道）；客户不露时不拿客户的来源
    ...(企 ? { expectedDealAt: p.expectedDealAt ? dayjs(p.expectedDealAt).format("YYYY-MM-DD") : null, 已立项天数: 已立项天数(p.createdAt, 今), 项目来源: p.channel?.name ?? (可见.has(p.customerId) ? p.customer.channel?.name : null) ?? null, level: p.level, 项目标签: p.projTag, 备货状态: p.stockStatus, 物流状态: p.logisticsStatus, 物流单号: p.trackingNo } : {}),
    ...(收回 ? { 收回次数: 收回.get(p.id) ?? 0 } : {}),
    ...市场格(p),
    amount: p.amount, currency: p.currency, updatedAt: p.updatedAt.toISOString(), createdAt: p.createdAt.toISOString(),
  }));
}

/**
 * 项目页和企业版「新线索」页共用的取数：先跑超时回收，再按筛选取这一页项目、拼成 项目行（11-11 起服务端分页，同客户列表）。
 * 总数 = 全部符合条件的条数；筛选、排序都在库里对全部结果做；看板列头的数和金额也按全部算（看板合计）。
 * 只看阶段 = "线索" 时只取还在线索阶段的（含已线索流失的），企业版 /leads 用。
 */
/**
 * 看板卡片版（11-15 列表页瘦身）：卡片（ProjectsView 看板、客户页看板视图）只画客户名、项目名、进程 / 结局 / 异常、金额、负责人、
 * 公海 / 即将回收、只看进度；列表才有的几列（回公海日、下一步时间、收回次数、预计成交、已立项天数、渠道、级别、验证结果、创建时间）不给。
 * 首屏一屏看板约 200 张卡片，这几样占卡片 JSON 的三四成。updatedAt 留着（不带 每列 时 看板分列 按它排）
 */
export function 看板卡片版(r: 项目行): 看板卡片 {
  const { 回收日: _a, 下一步时间: _b, 收回次数: _c, expectedDealAt: _d, 已立项天数: _e, 项目来源: _f, level: _g, 项目标签: _k, 备货状态: _l, 物流状态: _m, 物流单号: _n, 验证结果: _h, 验证全文: _i, createdAt: _j, ...卡 } = r;
  return 卡;
}

export async function 读项目列表(
  me: Parameters<typeof 公海超时收回>[0] & Parameters<typeof 待我回的邀请>[0] & { role: string },
  sp: 项目筛选,
  只看阶段?: 阶段,
  /**
   * 看板每列各自取数（11-12）：每列按默认序（最近改过在前，同改动前的看板；sort 只管列表）各取前 每列条数 个，
   * 放在返回的 每列 里（列键 → 卡片），列底「再看」走 读看板一列。
   * 要列表页 = false：不取整页共用的那一页（行 是空的，页 = 1）——客户页看板（服务端知道画的是看板）且不能「分配」时；
   * /projects、市场角色「我分出去的」看板 / 列表在浏览器里切，两份都取
   */
  看板?: { 每列: true; 要列表页: boolean },
) {
  // 企业版超时回收：先收再列，列表里看到的就是收完的样子
  await 公海超时收回(me).catch((e) => console.error("[超时回收] 扫的时候出错，这次先不收", e));
  await 回填一次();
  const 条件 = await 列表条件(me, sp, 只看阶段);
  const { where, 词, 企, 规则, 卡, 阶进, 市场, 创建人, 来源, 级别筛, 标签筛, 号码, 收回筛, 批 } = 条件;
  const 排 = 认项目排序(sp.sort);
  const 每页 = 认每页(sp.pageSize);
  const 要页 = 认页码(sp.page);
  const 按负责人 = 排 === "owner-asc" || 排 === "owner-desc";
  const 要列表页 = !看板 || 看板.要列表页;
  // 超时按项目业务线分内外贸天数（C7）：老项目没填业务线按负责人的线
  const 超时线们 = 规则 ? await 超时成员线(规则) : null;
  const include = 行include(!!市场, me.id);
  const 字典 = 看板字典of(条件);
  const 落 = 看板落列(字典);
  const 列键们 = 看板 ? 看板列键们(字典, sp.phase) : [];

  let 总数: number;
  let 页: number;
  let 看板合计: 看板合计组[];
  /** 列表页那几行的 id（照页里的序）；看板每列的卡片和它们一起一次 include（按序取行） */
  let 列表ids: string[];
  /** 直接带 include 取回的（不带看板的列表页、全是小列的看板：原来的一句，不多一步只取 id） */
  let 直接取: 行带include[] | null = null;
  /** 每列首屏要的 id（照列里的序）；不是看板每列 = 不给 */
  let 列ids: Map<string, string[]> | null = null;
  const 分到列 = (序: readonly { id: string; phase: string; node: string; result: string | null }[]) => {
    const m = new Map(列键们.map((k) => [k, [] as string[]]));
    for (const r of 序) {
      const 这列 = m.get(落(r));
      if (这列 && 这列.length < 每列条数) 这列.push(r.id);
    }
    return m;
  };
  // 收回次数、3 天内回公海：库里写不出，取回全部候选（只要几列）逐个算，再按序切这一页（后筛候选）
  const 后筛 = !!收回筛 || 卡 === "due-soon";
  if (后筛) {
    const 剩 = await 后筛候选(条件, 排, 超时线们);
    总数 = 剩.length;
    页 = 要列表页 ? Math.min(要页, Math.max(1, Math.ceil(总数 / 每页))) : 1;
    列表ids = 要列表页 ? 剩.slice((页 - 1) * 每页, 页 * 每页).map((r) => r.id) : [];
    // 看板列里按默认序：列表按别的排时另取一遍候选（后筛本来就窄）
    if (看板) 列ids = 分到列(排 ? await 后筛候选(条件, "", 超时线们) : 剩);
    const 组 = new Map<string, 看板合计组>();
    for (const r of 剩) {
      const k = JSON.stringify([r.phase, r.node, r.result, r.currency]);
      const g = 组.get(k) ?? { phase: r.phase, node: r.node, result: r.result, currency: r.currency, amount: 0, 数: 0 };
      g.amount += r.amount;
      g.数 += 1;
      组.set(k, g);
    }
    看板合计 = [...组.values()];
  } else if (看板 && 绑定名单长度(sp.客户) > 客户名单一次取全线) {
    /*
      客户页看板筛的客户带着一长串编号（宽关键词，customers/board-query.ts → 客户关键词条件 的编号名单，11-26）：
      下面那条路 groupBy、每个大列、带 include 的各一句，每句都把这串编号重新绑一遍（上万个参数、每句一两百 ms）。
      这里一句按默认序只取分列要的几列，列头的数、每列前 每列条数 个都在内存里算（和下面那条路同一个序、同一个落列），
      卡片另按 id 一句取（按序取行，只几十个 id）；列表页那几行（能分配时）照下面那条路的写法取
    */
    const 全 = await prisma.project.findMany({ where, orderBy: 默认序, select: { id: true, phase: true, node: true, result: true, currency: true, amount: true } });
    const 组 = new Map<string, 看板合计组>();
    for (const r of 全) {
      const k = JSON.stringify([r.phase, r.node, r.result, r.currency]);
      const g = 组.get(k) ?? { phase: r.phase, node: r.node, result: r.result, currency: r.currency, amount: 0, 数: 0 };
      g.amount += r.amount;
      g.数 += 1;
      组.set(k, g);
    }
    看板合计 = [...组.values()];
    总数 = 全.length;
    页 = 要列表页 ? Math.min(要页, Math.max(1, Math.ceil(总数 / 每页))) : 1;
    if (!要列表页 || !总数) 列表ids = [];
    else if (按负责人) {
      const 数 = new Map((await prisma.project.groupBy({ by: ["ownerId"], where, _count: { _all: true } })).map((g) => [g.ownerId, g._count._all]));
      列表ids = await 按负责人取ids(where, await 负责人顺序([...数.keys()], 排 === "owner-desc"), 数, (页 - 1) * 每页, 每页);
    } else if (!排) 列表ids = 全.slice((页 - 1) * 每页, 页 * 每页).map((r) => r.id);
    else 列表ids = (await prisma.project.findMany({ where, orderBy: 排序of(排), skip: (页 - 1) * 每页, take: 每页, select: { id: true } })).map((r) => r.id);
    列ids = 分到列(全);
  } else {
    // 一句 groupBy 出总数（各组相加）和看板列头；按负责人排时再按负责人数一遍，用来定这一页落在哪几位名下
    const [分组, 按人] = await Promise.all([
      prisma.project.groupBy({ by: ["phase", "node", "result", "currency"], where, _count: { _all: true }, _sum: { amount: true } }),
      按负责人 && 要列表页 ? prisma.project.groupBy({ by: ["ownerId"], where, _count: { _all: true } }) : Promise.resolve(null),
    ]);
    看板合计 = 分组.map((g) => ({ phase: g.phase, node: g.node, result: g.result, currency: g.currency, amount: g._sum.amount ?? 0, 数: g._count._all }));
    总数 = 看板合计.reduce((n, g) => n + g.数, 0);
    页 = 要列表页 ? Math.min(要页, Math.max(1, Math.ceil(总数 / 每页))) : 1;
    if (!要列表页 || !总数) 列表ids = [];
    else if (按人) {
      // 负责人按名字拼音排（库里只会按编码排汉字）：先按人数定这一页落在哪几位名下，再最多 3 句取（按负责人取ids），不随人数涨
      const 数 = new Map(按人.map((g) => [g.ownerId, g._count._all]));
      列表ids = await 按负责人取ids(where, await 负责人顺序([...数.keys()], 排 === "owner-desc"), 数, (页 - 1) * 每页, 每页);
    } else if (!看板) {
      直接取 = await 补回收起点留痕(await prisma.project.findMany({ where, orderBy: 排序of(排), skip: (页 - 1) * 每页, take: 每页, include }), prisma, 条件.今);
      列表ids = 直接取.map((r) => r.id);
    } else {
      列表ids = (await prisma.project.findMany({ where, orderBy: 排序of(排), skip: (页 - 1) * 每页, take: 每页, select: { id: true } })).map((r) => r.id);
    }
    if (看板) {
      /*
        每列各取前 每列条数 个（默认序），查询数不随卡片、行数涨：
        ① 超过的列（大列）一列一句只取 id（take 每列条数）；
        ② 不超过 每列条数 的列（小列）整列都要，条件并进 ③ 那一句、不设 take；
        ③ 卡片（小列整列 + 大列那几个 id + 列表页那几行）一句带 include 取回，最近留痕一句（补回收起点留痕）。
        首屏 = 每个大列一句 + include 一句（+ 最近留痕一句）；全是小列、不要列表页时和原来取一页一样多；要列表页时列表页那句只取 id，多 1 句
      */
      const 列数 = new Map(列键们.map((k) => [k, 0]));
      for (const g of 看板合计) { const k = 落(g); if (列数.has(k)) 列数.set(k, 列数.get(k)! + g.数); }
      const 大列 = 列键们.filter((k) => 列数.get(k)! > 每列条数);
      const 小条们 = 列键们.filter((k) => 列数.get(k)! > 0 && 列数.get(k)! <= 每列条数).flatMap((k) => { const 条 = 列条件(看板合计, k, 落); return 条 ? [条] : []; });
      const 大ids = await Promise.all(大列.map((k) => 列里一段(where, 列条件(看板合计, k, 落)!, "", 0, 每列条数)));
      // 小列整列、大列那几个 id、列表页那几行：一句带 include 取回（外面再套一层列表条件），最近留痕再一句
      const 按id = [...大ids.flat(), ...列表ids];
      const 或: Prisma.ProjectWhereInput[] = [...小条们, ...(按id.length ? [{ id: { in: 按id } }] : [])];
      直接取 = 或.length ? await 补回收起点留痕(await prisma.project.findMany({ where: { AND: [where, { OR: 或 }] }, orderBy: 默认序, include }), prisma, 条件.今) : [];
      // 小列按默认序分；大列就是那一句 take 20 取的 id（列表页的行落在大列里、又不在前 20 的不算进列）
      列ids = 分到列(直接取);
      大列.forEach((k, i) => 列ids!.set(k, 大ids[i]));
    }
  }
  // 列表页的行 + 看板每列的卡片：同一个项目只取一次
  const 要的ids = [...new Set([...列表ids, ...(列ids ? [...列ids.values()].flat() : [])])];
  const rows: 行带include[] = 直接取 ?? (await 按序取行(要的ids, include, 条件.今));

  const [users, 邀请, 待复核] = await Promise.all([
    负责人候选(),
    待我回的邀请(me),
    企 ? 待我复核的(me) : Promise.resolve([]),
  ]);
  const 全部行 = await 拼项目行(me, rows, { ...条件, 超时线们, 待复核 });
  const 按id = new Map(全部行.map((r) => [r.id, r]));
  // 先定 id、再带 include 取行是两句：两句之间项目离开了 where（并发的超时回收收进公海、被转让、被删）就取不回，跳过，不塞 undefined
  const 取得到 = (ids: string[]) => ids.flatMap((id) => { const r = 按id.get(id); return r ? [r] : []; });
  const 行 = 取得到(列表ids);
  // 只在看板卡片上的（不在列表页那几行里）：只给卡片画得到的字段（看板卡片版）；也在列表页的照旧同一个对象（RSC 只传一次）
  const 列表里的 = new Set(列表ids);
  const 每列 = 列ids ? Object.fromEntries([...列ids].map(([k, ids]) => [k, 取得到(ids).map((r) => (列表里的.has(r.id) ? r : 看板卡片版(r)))])) : undefined;
  return {
    行,
    /** 全部符合条件的条数（各页相加 = 它）；页 = 实际给的这一页（要的页越界时落到最后一页），每页 = 认过的每页条数 */
    总数,
    页,
    每页,
    /** 要的页码原样（地址栏上越界时界面把它改成实际的页，同客户列表） */
    // 不取列表页（客户页看板）时页码不归这里管，不给，界面就不会把地址栏上客户列表的页码改掉
    要的页: 要列表页 && typeof sp.page === "string" ? sp.page : undefined,
    排序: 排,
    /** 看板列头按全部算（看板分列 的 全部） */
    看板合计,
    /** 看板每列各自取数时：列键 → 这一列按当前排序的前 每列条数 张卡片（看板分列 的 每列）；不是 = 不给 */
    每列,
    // 结局叫法跟着字典：企业版组织规则里改过的出口叫法
    企业版: 企,
    出口叫法: 规则?.阶段.出口叫法,
    // 「给老客户开项目」弹窗：开了超时回收，首条沟通要填下一步时间（同客户页 customers/[id]/page.tsx）
    要下一步: !!规则?.超时回收.开,
    users,
    邀请们: 邀请.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    // 企业版线索验证（P12）：等我复核 / 终验 / 认领的线索
    待复核们: 待复核.map((r) => ({ ...r, 更新于: r.更新于.toISOString() })),
    filters: { keyword: 词, ownerId: typeof sp.ownerId === "string" ? sp.ownerId : "", pool: sp.pool === "1" ? "1" : "", recycled: 收回筛, f: 卡 || (条件.待分配筛中 ? 待分配筛 : ""), phase: 阶进.阶段, node: 阶进.进程, creator: 创建人, channelId: 来源, level: 级别筛, projTag: 标签筛, source: 条件.来源筛,
      // 原样回给界面（选择器回显）；写错的那头 创建时间段 当没给
      createdFrom: 是日期(sp.createdFrom) ? sp.createdFrom : "", createdTo: 是日期(sp.createdTo) ? sp.createdTo : "",
      phone: 号码 ? 搜索词(sp.phone) : "",
      // 导入批次：认得出的原样回给界面（页头标签），认不出的当没筛
      batch: 批次参数(批) },
    // 电话藏着的人（字段权限 Y27）不摆「手机号」筛选
    能按号码筛: !(await 号码藏着(me.id)),
    // 自定义筛选「渠道」的候选；新线索页不摆
    渠道筛选项: 企 && !只看阶段 ? await 渠道筛选选项() : [],
    // 市场视角（null = 别的角色，界面照旧）；市场管理的「创建人」筛选候选 = 本人 + 实线下属
    市场: 市场 ? { 视角: 市场.视角, 创建人们: 市场.视角 === "市场管理" ? await prisma.user.findMany({ where: { id: { in: 市场.圈 } }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [] } : null,
  };
}

/**
 * 渠道页「点数字看名单」（11-11）：一批候选项目里，哪些会出现在这个人的项目列表上——按渠道筛、不搜、没点首页卡时
 * 读项目列表 的条件（列表条件：企业版不列公海的、市场视角只列市场圈的、原负责人回避）原样并上；
 * 项目自己没填来源、跟客户来源算渠道的，客户不露时不算进这个渠道（同列表按渠道筛的那条 露客户条件）。
 * 两边同一个 列表条件，不会一边改了一边没改；名单数 = 点进去项目列表的服务端总数（tests/ent-channel-drilldown.test.ts 对拍）
 */
export async function 列表里的项目(me: { id: string; role?: string }, 候选: Prisma.ProjectWhereInput): Promise<Set<string>> {
  const { where } = await 列表条件({ role: "", ...me }, {});
  const 露 = await 露客户条件(me);
  const 行 = await prisma.project.findMany({
    where: { AND: [候选, where, ...(露 ? [{ OR: [{ channelId: { not: null } }, 露] }] : [])] },
    select: { id: true },
  });
  return new Set(行.map((r) => r.id));
}

/**
 * 渠道页「另 M 条在公海」（11-11）：一批候选项目里，在公海、并且会出现在公海页「渠道名单」里的那些（P-看-03 公海只在公海页出现，不放进项目列表）。
 * 和项目列表按渠道筛同一条归属规则：项目自己选了来源的照算；没选、跟客户来源算的，客户要露（露客户条件；公海里的项目只认客户看不看得到）。
 * 可见范围（含原负责人回避）由限定层管，这里不另放宽。公海页渠道名单（unified-pool-db.ts 读公海页 的 名单）用同一句，条数对得上
 */
export async function 公海名单条件(me: { id: string }, 候选: Prisma.ProjectWhereInput): Promise<Prisma.ProjectWhereInput> {
  const 露 = await 露客户条件(me);
  return { AND: [候选, { pooledAt: { not: null } }, ...(露 ? [{ OR: [{ channelId: { not: null } }, 露] }] : [])] };
}

/** 公海页按项目一条一行时的筛选（地址栏 projChannel / phase / createdFrom / createdTo / batch / open）；空的那项不筛 */
export type 公海名单筛 = { channelId?: string; phase?: string; createdFrom?: string; createdTo?: string; /** 同 项目筛选.onlyNew */ onlyNew?: string; /** 同 项目筛选.open */ open?: string;
  /** 同 项目筛选.batch（数据页「线索池」点进来带的，11-19）：只看 / 排掉某一批；带了也按项目一条一行 */
  batch?: string };

/**
 * 公海页渠道名单的候选：这个渠道（项目来源优先，没填跟客户来源）+ 同口径的阶段（阶段进程条件）+ 项目创建时间段
 * （北京日，和项目列表 createdFrom / createdTo 同一个 创建时间段）。哪项都没有 = null（不按名单列）
 */
export function 公海名单候选(f: 公海名单筛): Prisma.ProjectWhereInput | null {
  const 建于 = 创建时间段(f.createdFrom, f.createdTo);
  const 批 = 读批次(f.batch);
  const 并: Prisma.ProjectWhereInput[] = [
    // 渠道名单不列历史分析回填的、仅记录用的（渠道页数的 渠道项目条件 不算它们，点进来条数要对得上；X-147 不进统计）
    ...(f.channelId ? [{ OR: [{ channelId: f.channelId }, { channelId: null, customer: { channelId: f.channelId } }], ...不进统计 }] : []),
    ...(建于 ? [{ createdAt: 建于, ...(f.onlyNew === "1" ? 不算补建 : {}) }] : []),
    // 导入批次：数据页的线索池数不算历史分析回填的，点进来同样排掉，条数对得上
    ...(批 ? [批次条件(批)!, 不进统计] : []),
    // 只带 open=1（数据页没选导入批次时「公海里还有 N 个 ›」点进来，3703 实操）：公海里没结局的项目一个一行，
    // 同 项目现在 的「公海」那个数——不算历史分析回填的，条数对得上；open 跟着渠道 / 时间段 / 批次来的照旧只是附加条件
    ...(f.open === "1" && !f.channelId && !建于 && !批 ? [不进统计] : []),
  ];
  if (!并.length) return null;
  return { AND: [...并, ...(f.phase || f.open ? 阶段条件({ phase: f.phase, open: f.open }, 字典of(企业版())).where : [])] };
}

/**
 * 项目详情页中栏名单的一行（P11，照客户记录页的名单）：名字、在哪个阶段 / 进程、最近一次沟通。
 * 客户名和沟通内容只在露客户时给（公海里同事客户的项目不露，lib/project/db.ts 露客户），不露时这几格都是 null
 */
export type 名单项目 = {
  id: string;
  name: string;
  阶段: string;
  进程: string;
  结局: string | null;
  pooled: boolean;
  customerName: string | null;
  /** 最近一次沟通的方式（FOLLOW_TYPE_MAP 的键）和时间 */
  lastType: string | null;
  /** 企业版沟通方式（10-31） */
  lastMethod: string | null;
  lastAt: string | null;
  lastNote: string | null;
  /** 项目的下一步日期：「本周要跟」和右下角圆点看它（计划是挂在客户上的，按项目只有这一格）；有结局或在公海就不算 */
  nextAt: string | null;
  /** 项目的下一步做什么（10-29，一句话）；老数据、有结局或在公海是空 */
  nextText: string | null;
  /** 点这一行去哪：项目页会跳去的最终地址（@pane/roster-data.ts 项目名单数据 补的，customer-detail-direct.ts 项目链接们）；没给 = /projects/<id>，项目页自己判 */
  项目去?: string;
};

/**
 * 企业版项目详情页的中栏名单（P11）：和项目页同一个范围——同一个按可见范围筛过的 prisma、同样按最近改过排、同样最多 项目上限 个，
 * 不另开权限口子。不跑超时回收（那是项目页列表的事，详情页每点一个都扫一遍太重）
 */
export async function 读名单项目(me: { id: string; role?: string }, 字典: 阶段字典): Promise<{ rows: 名单项目[]; 取到上限: boolean }> {
  // 市场视角：名单和项目页同一圈，但「只看进度」的那些点不进详情，名单里就不列（market-view.ts）
  const 市场 = 企业版() ? await 读市场身份(me.id) : null;
  // 公海项目不进名单（企业版公海只在 /pool，和项目页默认列表一样）；历史负责人回避的都在公海里，也就不用另外排
  const where = 市场 ? { AND: [{ pooledAt: null }, 市场项目条件(me.id, 市场.圈), { OR: [{ ownerId: { in: 市场.圈 } }, { members: { some: { userId: me.id, inviteStatus: "JOINED" } } }] }] } : { pooledAt: null };
  const 取一批 = (批: number) => prisma.project.findMany({
    where,
    // 分批往后取要排得稳：同一时刻改过的按 id 再排一道，批和批之间不重不漏
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    skip: 批 * 项目上限,
    take: 项目上限,
    select: {
      id: true, name: true, node: true, customerId: true, nextStepAt: true, nextStepText: true, ...权限项目选,
      customer: { select: { name: true, shortName: true, customerNo: true } },
      followUps: { orderBy: { followUp: { occurredAt: "desc" } }, take: 1, select: { followUp: { select: { type: true, method: true, content: true, occurredAt: true } } } },
    },
  });
  // 名单只列点得进详情的（11-24）：这里的「能看项目」只是兜底筛选——数据层组员条件已只认本人（11-24 ②，管理者不再带出下属进组的），
  // 剩下数据层比详情宽的（按部门认的市场成员、没有市场角色的，P-看-17 / X-165 定：列表放开、详情进不去，自己建的分给同事的那行跳市场视角页）点进去进不了详情，照详情同一个判断再筛一遍不让进名单
  // （P-看-02 销售看自己负责的 + 公海；P-看-12 同客户下同事的项目看不到）
  // 先筛后截（11-24 审查后改）：原来取前 项目上限 个再筛，筛掉的占了名额，后面本该看到的补不上来（实测 500 → 493）。
  // 改成按同一排序一批 项目上限 个往后取，筛后够数或取完就停；最多取 名单最多批 批（扫 2000 行封顶），筛不够也不再往后翻
  const org = 企业版() ? await 权限组织() : null;
  type 行 = Awaited<ReturnType<typeof 取一批>>[number];
  const 进得去: 行[] = [];
  let 后面还有 = false;
  for (let 批 = 0; 批 < 名单最多批 && 进得去.length < 项目上限; 批++) {
    const 这批 = await 取一批(批);
    进得去.push(...(org ? 这批.filter((r) => 能看项目(me, 带已加入(r), org)) : 这批));
    后面还有 = 这批.length >= 项目上限;
    if (!后面还有) break;
  }
  const 列 = 进得去.slice(0, 项目上限);
  // 后售培育（P-界面-63）：名单这一批一次判完（后售项目们），进程那格写后售培育
  const [可见, 后售们] = await Promise.all([看得到的客户(列.map((r) => r.customerId)), org ? 后售项目们(列) : Promise.resolve(new Set<string>())]);
  return {
    // 筛后超了上限被截掉，或封顶时后面还没取完：提示「这里只有最近改过的 N 个」（N = 筛后列出的条数）
    取到上限: 进得去.length > 项目上限 || 后面还有,
    rows: 列.map((r) => {
      const 露 = 露客户(me, r, 可见);
      const f = 露 ? r.followUps[0]?.followUp : undefined;
      return {
        id: r.id, name: r.name, ...阶段与进程(r, 字典, 后售们.has(r.id)), pooled: !!r.pooledAt,
        // 全称选填（11-19）：没全称的叫显名（简称 → 客户编号）
        customerName: 露 ? 客户显名({ id: r.customerId, ...r.customer }) : null,
        lastType: f?.type ?? null,
        lastMethod: f?.method ?? null,
        lastAt: f ? f.occurredAt.toISOString() : null,
        lastNote: f?.content?.trim().slice(0, 60) || null,
        nextAt: r.nextStepAt && !r.result && !r.pooledAt ? dayjs(r.nextStepAt).format("YYYY-MM-DD") : null,
        nextText: !r.result && !r.pooledAt ? r.nextStepText : null,
      };
    }),
  };
}
