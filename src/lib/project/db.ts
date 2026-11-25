/**
 * 团队版项目模式 1a 的读写（2026-10-23，D-31）。取值规矩在 lib/project/nodes.ts，界面的写在 app/(app)/projects/actions.ts。
 * 这里不管登录、不管开关，只管「谁能改」和「改了留什么痕」，方便单测直接调。
 */
import { 能往项目记沟通, 沟通项目在公海话, 沟通项目已结束话, 沟通不是组员话 } from "./follow-needs-project";
import { 项目退回前查联系方式, 退回号码种类表 } from "@/lib/enterprise/return-contact-check";
import { Prisma, type Project } from "@/generated/prisma";
import { prisma, defaultClient } from "../prisma";
import { 不能当负责人 } from "../owners";
import { 查完再写 } from "../check-then-write";
import { 作废补位 } from "@/lib/enterprise/invalid-makeup";
import { 改节点问题, 原因上限, 要写原因, 终止结局, 下一步, 节点序号, 字典of, 本套位置, 本套名, 同名们, 是交付, 结局叫法, type 位置 } from "./nodes";
import { 还差, 必填叫法, 节点推进生效, 项目按必填走, 节点推进管, 只管新建之后, 节点必填, 有效线索判定, 有效沟通还差, type 必填数据 } from "./required";
import { 规整项目, 规整沟通, type 向导项目, type 向导跟进 } from "./wizard";
import { 持有上限of, 负责人可推, type 组织规则 } from "./org-rules";
import { 企业版推进关, 记沟通阶段问题, 记沟通标记, 有效线索节点, 缺本节点沟通 } from "./stage-gates";
import { 记必填拦截, type 拦截入口, type 拦截种类 } from "./required-block";
import { 等复核拦, 复核判死拦, 验证中不能改派, 进公海清验证 } from "./lead-verify-guard";
import { 企业版 } from "@/lib/enterprise/switch";
import { 同号标题问题 } from "@/lib/enterprise/same-number-mark";
import { 落到渠道 } from "@/lib/enterprise/channel-main";
import { 是主渠道入口, 渠道启用 } from "@/lib/enterprise/channel-main-core";
import { parseDateInput } from "@/lib/date-input";
import { 直属上级of, 权限组织, 读组织, 负责人和上级, type 组织 } from "@/lib/enterprise/org";
import { 能编辑项目, 能转让项目, 能放回公海 as 能放回公海判, 是总管理, 是经理, 能删除, 能删一些, 没设业务角色, 没业务角色不能领话, 不能领公海话, 能领公海, 只读角色, 只读话of, 有业务角色, 是系统管理员, 只看的人, 只看某人话 } from "@/lib/enterprise/permissions";
import { 公海按线拦 } from "@/lib/enterprise/pool-line-guard";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 软删一条 } from "@/lib/enterprise/soft-delete";
import { 按主键取没删的 } from "@/lib/enterprise/soft-delete-core";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 挡改设置 } from "@/lib/enterprise/edit-perm";
import { 选的原因, 认跟进方式, 已签收物流状态, type 已签收认法结果 } from "@/lib/enterprise/dict";
import { 去不填 } from "@/lib/enterprise/dict-kinds";
import { 生效组织规则 } from "./org-rules-store";
import { 超时回收日, 已超时, 即将回收, 将回收提醒, 将回收提醒头, 超时理由, 超时起点, 系统, 回收原因前缀, 算回收起点的留痕 } from "./timeout";
import { getSetting, setSetting } from "../settings";
import { recordAudit } from "../audit";
import { 读团队 } from "../sync/client";
import { dayjs } from "../utils";
import { 看全部, 只读身份中, 系统写 } from "../team-scope";
import { FOLLOW_RECORD_STATUSES } from "../constants";
import { 记沟通编号 } from "./followup-meta";
import { 下一步文字上限 } from "./project-fields";
import { 节点变了的提成 } from "./commission-db";
import { 公海规则, 原负责人不能领回提示, 拦单独领项目, 项目不能单独领提示, 拦客户公海里的项目, 客户在公海项目不单领提示, 无效客户项目不能转提示 } from "@/lib/enterprise/pool-rules";
import { 单项目客户跟进公海, 单项目客户跟着领, 领项目连带超上限 } from "@/lib/enterprise/pool-link";
import { 交接中的客户 } from "@/lib/enterprise/handover-db";
import { 字段权限of, 改不了的话, 项目列字段 } from "@/lib/enterprise/field-perm";
import { 项目级别和地址改成, 项目成交钱改成, 读产品需求, type 项目级别和地址, type 项目成交钱 } from "./profile-rules";
import { 项目新字段改成, 备货单号改成, type 项目新字段, type 备货单号 } from "./proj-fields";
import { 客户状态自动, 跟着项目重算, 项目变了重算, 进出公海重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 读客户状态, 项目的客户们, 原状态记到出公海痕 } from "@/lib/enterprise/cust-status-undo";
import { 视图中跳过 } from "@/lib/enterprise/view-as";
import { notify } from "@/lib/enterprise/notify";
import { 项目业务线, 认业务线, 业务线不认得, 业务线必填, type 成员线查 } from "@/lib/enterprise/assign-line";
import { 进公海后负责人, 历史负责人, 进公海关待办, 一批id数, 进公海清组员, 进公海关主题, 放弃没发出的录音 } from "./pool-owner";
import { 卡点随项目换人, 公海领走接手理由, 转让接手理由, 移出组员接手理由 } from "./blocker";
import { 换负责人待办, 待办痕, 手动转让痕 } from "./carry-tasks";
import { 换负责人 } from "@/lib/project/owner-write";
import { 待分配占位, 待分配不能动 } from "@/lib/enterprise/await-assign";
import { 规整指定回复, 时刻转北京墙钟, 回复键们 } from "./time-fields";

type 谁 = { id: string; role: string };
type 结果 = { ok: true } | { ok: false; error: string };

/** 组员角色字典的默认 4 个。字典空着时第一次读顺手建上（迁移只建表、不写数据） */
export const 默认角色们 = ["产品研发", "售后", "商务方案", "项目经理"] as const;
/** 默认 4 个角色的固定 id：每台机器建出来的一样，团队版同步（1b）按 id 对得上 */
export const 默认角色id: Record<(typeof 默认角色们)[number], string> = { 产品研发: "rd", 售后: "after-sales", 商务方案: "solution", 项目经理: "pm" };
/** 企业版的默认 6 个（10-26 用户：「可以，后续也可以自定义角色即可」）：管理员在后台照样能加、改名 */
export const 企业版默认角色们 = ["项目组长", "产品顾问", "研发顾问", "项目顾问", "项目助理", "售后支撑"] as const;
export const 企业版默认角色id: Record<(typeof 企业版默认角色们)[number], string> = {
  项目组长: "ent-lead", 产品顾问: "ent-product", 研发顾问: "ent-rd", 项目顾问: "ent-consult", 项目助理: "ent-assist", 售后支撑: "ent-after-sales",
};
export const 角色名上限 = 20;

/**
 * 能改这个项目的内容（节点、尾款 / 验收、字段、沟通、组员）：权限在 lib/enterprise/permissions.ts 能编辑项目。
 * 企业版（11-01 只认业务角色）= 负责人本人且是销售 / 销售管理；总管理、上级只能看、转让（C2）。
 * 不是企业版照旧：负责人本人、老板、业务主管。在公海里的项目要改先领取。org 用 权限组织() 读（事务外）
 */
export function 能管项目(me: 谁, p: { ownerId: string; pooledAt?: Date | null }, org: 组织 | null): boolean {
  return 能编辑项目(me, p, org);
}
/**
 * 能改组员（换角色、移出、拉人）：能管项目的人；企业版公海里的项目再加上系统管理员（X-72、P-组员-01，公海项目没负责人、能管项目都是 false）
 */
export function 能改组员(me: 谁, p: { ownerId: string; pooledAt?: Date | null }, org: 组织 | null): boolean {
  return 能管项目(me, p, org) || (企业版() && !!p.pooledAt && 是系统管理员(me, org));
}
/**
 * 能往项目组里加人（V3.5.1）：能管项目的人；企业版再加上已进组的项目组员（project_ops，不是负责人也能拉人），公海里的不算。
 * 组员拉的人照旧发邀请、对方同意才进组，并通知负责人
 */
export function 能加组员(me: 谁, p: { ownerId: string; pooledAt?: Date | null }, org: 组织 | null, 我在组里: boolean): boolean {
  if (能改组员(me, p, org)) return true;
  return 企业版() && !!org && 我在组里 && !p.pooledAt && 有业务角色(me, org, "project_ops") && !只读角色(me, org) && !只看的人(org, me.id);
}
/** 节点这一块和别的内容一个口径（11-01 起直属上级、总管理不再代推，C2） */
export const 能改节点 = 能管项目;
export const 只有负责人改进程 = "只有项目负责人或系统管理员能改进程（上级、条线总管理只能看、转让）";

/**
 * 企业版 D-37：负责人有直属上级时，手动往前推节点只给这位直属上级、老板和组织里的总管理员；负责人本人、隔级上级、
 * 虚线上级（D-39 只读）都不行，本人填齐必填照样自动推。往后退、点结局、进异常不归这条管。
 * 负责人没设直属上级（组织还没配）照旧，免得谁都推不动。org = null（不是企业版）→ 不拦。
 * 返回拦下的话，null = 能推
 */
/**
 * 「直属才能推」跟「按组织架构看客户」开关走（F10，10-25 实测）：开关关着就是团队版，谁的项目谁推，
 * 往前推不给 拿到 null。直属上级能改节点、能代管必填（能改节点 / 代管节点）不跟这个开关，照旧给
 */
export async function 直属才推(org: 组织 | null): Promise<组织 | null> {
  return org && (await 规则开着("按组织看客户")) ? org : null;
}

/**
 * 往前推这一步拦不拦（只管「推进权限」这条规则，谁能改节点另由 能改节点 / 上级只推 管，两样都过才推得动）：
 *   - 负责人可推（组织规则 阶段.推进权限，10-26 决定 #18，默认）：负责人本人往前推；系统管理员能改节点也能推。
 *     11-01 C2 起直属上级只看、只转让——这里对上级、总管理返回 null 只是不在这一步拦，能改节点 已经不给上级
 *   - 仅上级推：负责人有直属上级时只给直属上级（上级只推）和总管理往前推
 */
export function 往前推不给(me: 谁, ownerId: string, org: 组织 | null, 负责人可推 = false): string | null {
  if (!org || (负责人可推 && me.id === ownerId)) return null;
  const 上级 = 直属上级of(org, ownerId);
  if (!上级 || me.id === 上级 || 是总管理(me, org)) return null;
  return me.id === ownerId ? "往前推进程要由你的直属上级来推" : 负责人可推 ? "只有负责人能往前推进程" : "只有负责人的直属上级能往前推进程";
}

/** 企业版「仅上级推」：没在公海、我是负责人的直属上级 → 这一步能往前推（只往前推，改节点里另拦往后退、点结局） */
export function 上级只推(me: 谁, p: { ownerId: string; pooledAt?: Date | null }, 推的组织: 组织 | null, 规则: 组织规则): boolean {
  return 企业版() && !!推的组织 && !负责人可推(规则) && !p.pooledAt && 直属上级of(推的组织, p.ownerId) === me.id && !只看的人(推的组织, me.id);
}

/**
 * 需求状态补全期（组织规则 阶段.需求补全期，M-权限-07，默认关）：开着时只有销售管理、总管理能往前推进程；
 * 负责人本人、直属上级（销售账号）都不给。只管往前推：往回退、终止进程、记沟通、改字段照常
 */
export const 补全期提示 = "需求状态补全期：只有销售管理、总管理能往前推进程，沟通照常记";
export function 补全期不给(me: 谁, org: 组织 | null, 规则: 组织规则): string | null {
  if (!规则.阶段.需求补全期 || 是经理(me, org)) return null;
  return 补全期提示;
}

/**
 * 项目公海里的项目谁都看得到（才能领），但客户可能是同事的：客户名、公司、联系人、沟通内容这时都不给，
 * 领了（成了负责人）再看（质量审 10-23）。看得到这位客户（自己的、客户公海里的、老板 / 主管、开了互看）照常给
 */
export function 露客户(me: { id: string }, p: { customerId: string; ownerId: string; pooledAt?: Date | null }, 看得到的: ReadonlySet<string>): boolean {
  return 看得到的.has(p.customerId) || (!p.pooledAt && p.ownerId === me.id);
}

/**
 * 这批客户里当前这位看得到哪几个：走带限定的客户端查一遍，限定层说了算，这里不另写一套规矩。
 * 限定层的条件带否定，名单过 999 个 Prisma 拆不了批（P2029），所以自己一批一批查；db 可能是事务，不并行。
 * 按主键取（11-14 体验优化）：带着顶层 deletedAt IS NULL 时，id 超过 4 个 SQLite 放着主键不走、顺 deletedAt 索引扫 8.5 万位
 * （跟进计划页销售管理那句 180–445 ms），「没删」挪到内存里滤，限定层照样加，见 按主键取没删的；统一公海 unified-pool-db 同一写法
 */
export async function 看得到的客户(customerIds: string[], db: Pick<Prisma.TransactionClient, "customer"> = prisma): Promise<Set<string>> {
  const ids = [...new Set(customerIds)];
  const 看得到 = new Set<string>();
  for (let i = 0; i < ids.length; i += 一批id数) {
    const rows = await 按主键取没删的(() => db.customer.findMany({ where: { id: { in: ids.slice(i, i + 一批id数) } }, select: { id: true, deletedAt: true } }));
    for (const r of rows) 看得到.add(r.id);
  }
  return 看得到;
}

/** 组员角色字典：按排序列出（停用的也列，界面自己挑），空着就先建默认的（企业版 6 个，别的版本 4 个） */
export async function 角色字典(db: Prisma.TransactionClient = prisma) {
  // 先取列表，有行就直接用（11-12 客户详情速度：原来每次先数一遍再取，两句）；空着才建默认、再取
  const 有 = await db.projectRole.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  if (有.length) return 有;
  // 两个窗口同时第一次读：按名字 upsert，后到的那个什么都不改
  const 种子: [string, string][] = 企业版()
    ? 企业版默认角色们.map((n) => [企业版默认角色id[n], n])
    : 默认角色们.map((n) => [默认角色id[n], n]);
  // 切换视图（只读预览）：不落库，内存里给默认的
  if (await 视图中跳过()) return 种子.map(([id, name], sort) => ({ id, name, sort, active: true, createdAt: new Date(0) }));
  // 系统写：管理员（admin，只读）打开页面时也得建得上
  await 系统写(async () => {
    for (const [i, [id, name]] of 种子.entries()) {
      await db.projectRole.upsert({ where: { name }, update: {}, create: { id, name, sort: i } });
    }
  });
  return db.projectRole.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
}

/**
 * 两本字典谁能改：不是企业版只有老板（和项目模式开关同一条规矩）；
 * 企业版按「后台设置谁能改」的「异常类别、组员角色、企业选项字典」一行，默认老板和总管理员（B2 第 6 条，10-26）
 */
async function 挡字典(me: 谁, 叫法: string): Promise<string | null> {
  const 挡 = await 挡改设置(me, "字典");
  return 挡 && `${叫法}${挡}`;
}

function 规整角色名(name: unknown): string | { error: string } {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return { error: "角色名不能空着" };
  if (n.length > 角色名上限) return { error: `角色名请控制在 ${角色名上限} 字以内` };
  return n;
}

/** 加一个角色，排在最后。谁能改见 挡字典 */
export async function 加角色(me: 谁, name: unknown): Promise<结果 & { id?: string }> {
  const 挡 = await 挡字典(me, "组员角色");
  if (挡) return { ok: false, error: 挡 };
  const n = 规整角色名(name);
  if (typeof n !== "string") return { ok: false, ...n };
  return 查完再写(async (tx) => {
    const 有 = await tx.projectRole.findUnique({ where: { name: n } });
    // 停用过的同名角色：重新启用，已经用它的组员接着认
    if (有) {
      if (有.active) return { ok: false as const, error: `已经有「${n}」这个角色了` };
      await tx.projectRole.update({ where: { id: 有.id }, data: { active: true } });
      return { ok: true as const, id: 有.id };
    }
    const 末 = await tx.projectRole.aggregate({ _max: { sort: true } });
    const r = await tx.projectRole.create({ data: { name: n, sort: (末._max.sort ?? -1) + 1 } });
    return { ok: true as const, id: r.id };
  });
}

/** 改角色名 / 停用 / 启用。不删：删了的只停用，已经用它的组员不丢 */
export async function 改角色(me: 谁, id: string, patch: { name?: unknown; active?: boolean }): Promise<结果> {
  const 挡 = await 挡字典(me, "组员角色");
  if (挡) return { ok: false, error: 挡 };
  const data: { name?: string; active?: boolean } = {};
  if (patch.name !== undefined) {
    const n = 规整角色名(patch.name);
    if (typeof n !== "string") return { ok: false, ...n };
    data.name = n;
  }
  if (patch.active !== undefined) data.active = patch.active === true;
  return 查完再写(async (tx) => {
    const r = await tx.projectRole.findUnique({ where: { id: String(id ?? "") } });
    if (!r) return { ok: false as const, error: "这个角色已经不在了，刷新看看" };
    if (data.name && data.name !== r.name && (await tx.projectRole.findUnique({ where: { name: data.name } }))) {
      return { ok: false as const, error: `已经有「${data.name}」这个角色了` };
    }
    await tx.projectRole.update({ where: { id: r.id }, data });
    return { ok: true as const };
  });
}

/** 异常类别字典的默认 2 个，固定 id 同角色字典（团队版同步按 id 对得上）。字典空着时第一次读顺手建上 */
export const 默认异常类别们 = ["纠纷取消", "项目停滞"] as const;
export const 默认异常类别id: Record<(typeof 默认异常类别们)[number], string> = { 纠纷取消: "dispute-cancel", 项目停滞: "stalled" };

/** 异常类别字典：按排序列出（停用的也列，界面自己挑），空着就先建默认 2 个 */
export async function 异常类别字典(db: Prisma.TransactionClient = prisma) {
  // 同 角色字典：有行直接用，空着才建默认再取
  const 有 = await db.projectExceptionCategory.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
  if (有.length) return 有;
  if (await 视图中跳过()) return 默认异常类别们.map((name, sort) => ({ id: 默认异常类别id[name], name, sort, active: true, createdAt: new Date(0) }));
  await 系统写(async () => {
    for (const [i, name] of 默认异常类别们.entries()) {
      await db.projectExceptionCategory.upsert({ where: { name }, update: {}, create: { id: 默认异常类别id[name], name, sort: i } });
    }
  });
  return db.projectExceptionCategory.findMany({ orderBy: [{ sort: "asc" }, { createdAt: "asc" }] });
}

function 规整类别名(name: unknown): string | { error: string } {
  const n = typeof name === "string" ? name.trim() : "";
  if (!n) return { error: "类别名不能空着" };
  if (n.length > 角色名上限) return { error: `类别名请控制在 ${角色名上限} 字以内` };
  return n;
}

/** 加一个异常类别，排在最后。谁能改见 挡字典；停用过的同名类别重新启用 */
export async function 加异常类别(me: 谁, name: unknown): Promise<结果 & { id?: string }> {
  const 挡 = await 挡字典(me, "异常类别");
  if (挡) return { ok: false, error: 挡 };
  const n = 规整类别名(name);
  if (typeof n !== "string") return { ok: false, ...n };
  return 查完再写(async (tx) => {
    const 有 = await tx.projectExceptionCategory.findUnique({ where: { name: n } });
    if (有) {
      if (有.active) return { ok: false as const, error: `已经有「${n}」这个类别了` };
      await tx.projectExceptionCategory.update({ where: { id: 有.id }, data: { active: true } });
      return { ok: true as const, id: 有.id };
    }
    const 末 = await tx.projectExceptionCategory.aggregate({ _max: { sort: true } });
    const r = await tx.projectExceptionCategory.create({ data: { name: n, sort: (末._max.sort ?? -1) + 1 } });
    return { ok: true as const, id: r.id };
  });
}

/** 改类别名 / 停用 / 启用。不删：停用的不能再选，已经在用它的项目不丢 */
export async function 改异常类别(me: 谁, id: string, patch: { name?: unknown; active?: boolean }): Promise<结果> {
  const 挡 = await 挡字典(me, "异常类别");
  if (挡) return { ok: false, error: 挡 };
  const data: { name?: string; active?: boolean } = {};
  if (patch.name !== undefined) {
    const n = 规整类别名(patch.name);
    if (typeof n !== "string") return { ok: false, ...n };
    data.name = n;
  }
  if (patch.active !== undefined) data.active = patch.active === true;
  return 查完再写(async (tx) => {
    const r = await tx.projectExceptionCategory.findUnique({ where: { id: String(id ?? "") } });
    if (!r) return { ok: false as const, error: "这个类别已经不在了，刷新看看" };
    if (data.name && data.name !== r.name && (await tx.projectExceptionCategory.findUnique({ where: { name: data.name } }))) {
      return { ok: false as const, error: `已经有「${data.name}」这个类别了` };
    }
    await tx.projectExceptionCategory.update({ where: { id: r.id }, data });
    return { ok: true as const };
  });
}

/** 自动推进了才带上 自动推到（没推的返回和原来一模一样） */
export const 带推进 = (到: string[]) => (到.length ? { 自动推到: 到 } : {});

/**
 * 改节点：往前只能一步一步走，往后随便退（nodes.ts 改节点问题；企业版按企业版字典，跨阶段不能退），点结局也走这里。每改一次记一行 ProjectNodeLog。
 * 有结局记下 closedAt，回到进行中（= 从异常状态恢复、从丢单捡回来）清掉。
 * 进异常状态要选一个在用的异常类别，备注可空；类别和备注只在异常状态时留在项目上，节点变更里永远留着。
 * 企业版点线索流失、丢单要写原因（第四个参数的 备注），只记在节点变更里
 */
export async function 改节点(
  me: 谁, projectId: string, 到: 位置, 异常?: { categoryId?: string | null; 备注?: string | null },
  选项?: {
    验证放行?: boolean;
    /** 撤销（11-20 审查）：项目现在应该在的那一格（= 刚推到的）；对不上 = 推完又被人改过，不撤，说一句 */
    期望在?: 位置;
    /** 撤销时带回推之前的下一步（推进 / 完成节点清掉的那一份）；只和 期望在 一起认 */
    恢复下一步?: { 文字?: string | null; 时间?: string | null } | null;
    /** 回 原（改之前在哪、下一步是什么）：项目页撤销条要（改项目节点 带上），别的调用方不要 */
    回原?: boolean;
    /** 被缺必填拦下时记哪个入口（lib/project/required-block.ts）；不给记「其他」 */
    入口?: 拦截入口;
  },
): Promise<结果 & { 变了?: boolean; 自动推到?: string[]; 原?: 推前 & { result: string | null } }> {
  const 规则 = await 生效组织规则();
  const org = await 权限组织();
  const 推的组织 = await 直属才推(org);
  // 企业版字段权限（规则没开 = 全能改，不读库）：「阶段 / 节点」只能看的角色改不了节点和结局
  const 级别 = await 字段权限of(me.id);
  // 企业版客户状态跟着项目算（cust-status-auto-db.ts）：开关事务外读
  const 状态开 = await 客户状态自动();
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    // 「仅上级推」开着（企业版组织规则）：负责人自己推不动，直属上级只给往前推这一步，别的照旧只给负责人（11-01 闭环）
    const 上级代推 = !能改节点(me, p, org) && 上级只推(me, p, 推的组织, 规则);
    if (!能改节点(me, p, org) && !上级代推) return { ok: false as const, error: p.pooledAt ? "这个项目在公海里，先领取再改" : 企业版() ? 只有负责人改进程 : "只有项目负责人、老板或主管能改进程" };
    // 待分配期间占着负责人一格的建的人不能推进、退回、点结局（P-转-21、X-68）：节点、结局都不给动，字段照改
    if (待分配占位(me, p)) return { ok: false as const, error: 待分配不能动 };
    // 企业版线索验证（P12）在等复核 / 等销售处理：别从这里绕过去（lead-verify.ts 带 验证放行 进来）
    const 等着 = 选项?.验证放行 ? null : await 等复核拦(tx, p.id);
    if (等着) return { ok: false as const, error: 等着 };
    const 字典 = 字典of(企业版(), 企业版() ? 规则.阶段.出口叫法 : null);
    // 旧客户端交上来的旧名（企业版 验收交付、成功交付）按新名存；库里存着旧名的项目也先对到新名再比变没变（企业版 10-31 改名）
    到 = 本套位置({ ...到, result: 到.result || null }, 字典);
    const result = 到.result || null;
    const 现 = 本套位置(p, 字典);
    if (选项?.期望在) {
      const 期 = 本套位置({ ...选项.期望在, result: 选项.期望在.result || null }, 字典);
      if (期.phase !== 现.phase || 期.node !== 现.node || (期.result || null) !== (现.result || null)) {
        return { ok: false as const, error: `项目进程已经被改过（现在在 ${现.phase}·${现.node}${现.result ? `（${现.result}）` : ""}），没有撤销；要改请在进程上手动改` };
      }
    }
    // 企业版点交付结清：验收认「验收通过」勾或项目附件「验收报告」里有一份（M-必填-11），数一下那一格
    const 有验收报告 = 企业版() && !!result && 是交付(result) && !p.acceptancePassed
      ? (await tx.attachment.count({ where: { projectId: p.id, tag: "验收报告" } })) > 0
      : false;
    // 交付结清只在尾款结算（客户 11-19 定稿）：跟「节点推进」开关一起生效（11-19 定；节点推进管 = 开着、且这个项目在管的范围里）；
    // 项目页 load.ts 交付只在尾款 用同一个判断
    const 问题 = 改节点问题({ ...到, result }, { ...p, 有验收报告 }, 异常, 企业版(), 字典, 企业版() && 节点推进管(规则, p));
    if (问题) return { ok: false as const, error: 问题 };
    const 挡 = 到.phase !== 现.phase || 到.node !== 现.node || result !== 现.result ? 改不了的话(级别, ["商机阶段"]) : null;
    if (挡) return { ok: false as const, error: 挡 };
    // 有结局的改回进行中也按节点比：改回到后面的节点同样算往前推，必填门、推进关照拦（11-03 测试 A5-1：终止再改回绕过必填和线索验证）
    const 往前 = !result && 节点序号(到, 字典) > 节点序号(p, 字典);
    if (p.result && !result) {
      const 判死 = await 复核判死拦(tx, p.id);
      if (判死) return { ok: false as const, error: 判死 };
    }
    if (上级代推 && !往前) return { ok: false as const, error: 只有负责人改进程 };
    const 不给 = 往前
      ? (企业版() ? 补全期不给(me, org, 规则) : null) ?? 往前推不给(me, p.ownerId, 推的组织, 负责人可推(规则))
      : null;
    if (不给) return { ok: false as const, error: 不给 };
    // 缺必填被拦下记一行（必填拦截记录，客户 11-23）：入口、代推跟着记；没权限那几种上面已经回了，不记
    const 记拦 = (种: 拦截种类, 缺: readonly string[]) =>
      记必填拦截(tx, { userId: me.id, p: { id: p.id, customerId: p.customerId, phase: 现.phase, node: 现.node }, 到, 种, 缺, 入口: 选项?.入口 ?? "其他", 代推: 上级代推 });
    if (往前) {
      // 推进关要的「还差」读一遍留着：拦下时记缺哪几项，不再读第二遍
      let 差记: string[] | null = null;
      const 差fn = 有效沟通差of(tx, p, 规则);
      const 关 = await 企业版推进关(tx, p, 到, 规则, async () => (差记 = await 差fn()));
      if (关) {
        const 节 = 现.node;
        await (关 === 缺本节点沟通(节) ? 记拦("本节点沟通", [`${节}的沟通`]) : 记拦("线索验证", 差记 ?? ["需求状态"]));
        return { ok: false as const, error: 关 };
      }
    }
    // 企业版节点必填（D-37）：配了必填的节点，缺着必填谁都不能往前推（客户 11-19 定稿「必须全员统一规则必须填齐」：
    // 原来总管理、销售管理能留空先推，去掉了；首页 AI、看板拖动、项目页都走这里）；填齐了（占位值不算填了）点「完成节点」照样能推（M-节点-05/09）
    // 节点推进管的项目才拦（项目按必填走）：默认全部项目，存量也要补齐（客户 11-19）；设置成只管新建的时，生效时刻之前建的照手动推
    if (往前 && 项目按必填走(规则, p)) {
      const 数据 = await 读必填数据(tx, p, 规则);
      // 线索核验判有效（lead-verify.ts 带 验证放行 进来）：先推进程、推成了才写判定，这一步的「线索验证结果」按判了有效算
      const 差 = 还差(规则, 选项?.验证放行 ? { ...数据, 线索验证: { verdict: 有效线索判定, finalResult: 有效线索判定, pending: null } } : 数据);
      if (差.length) {
        await 记拦("节点必填", 差.map(必填叫法));
        return { ok: false as const, error: `「${现.node}」还差必填：${差.map(必填叫法).join("、")}；补齐再推` };
      }
    }
    let 类别: string | null = null;
    let 备注: string | null = null;
    if (result === "异常状态") {
      类别 = String(异常?.categoryId);
      // 已经在用的类别停用了也能留着（只改备注）；换成的得是在用的
      if (类别 !== p.exceptionCategoryId) {
        const c = await tx.projectExceptionCategory.findUnique({ where: { id: 类别 } });
        if (!c) return { ok: false as const, error: "这个异常类别已经不在了，刷新看看" };
        if (!c.active) return { ok: false as const, error: `「${c.name}」已经停用了，换一个` };
      }
      备注 = (异常?.备注 ?? "").trim().slice(0, 原因上限) || null;
    }
    // 线索流失、丢单的原因只记在节点变更里，项目上的 exceptionReason 是异常状态专用
    const 原因 = 企业版() && 要写原因(result) ? (异常?.备注 ?? "").trim().slice(0, 原因上限) || null : 备注;
    if (现.phase === 到.phase && 现.node === 到.node && 现.result === result && p.exceptionCategoryId === 类别 && (p.exceptionReason ?? null) === 备注) {
      return { ok: true as const, 变了: false };
    }
    // 企业版换了节点：下一步计划 / 时间只算当前节点的，清掉，老值记进这次节点变更（换下一步）。
    // 撤销（带 期望在）且带回了推之前的下一步：换成那一份，不清（11-20 审查：撤销 = 回到原样）。
    // 只认往回退、且是能改节点的人自己撤（11-20 复审）：「仅上级推」时直属上级代推只许往前推，带 期望在 + 任意下一步往前推
    // 会把下属项目的下一步写成上级传的；往前推、上级代推带来的一律不认，照旧清掉
    const 清下一步 = 企业版() && (到.phase !== 现.phase || 到.node !== 现.node);
    const 往回 = !result && !现.result && 节点序号(到, 字典) < 节点序号(p, 字典);
    const 恢 = 选项?.期望在 && 往回 && !上级代推 && 选项.恢复下一步 && typeof 选项.恢复下一步 === "object" ? 选项.恢复下一步 : null;
    const 恢时 = 恢 && typeof 恢.时间 === "string" && 恢.时间 ? new Date(恢.时间) : null;
    const 换下一步 = 恢
      ? { nextStepText: typeof 恢.文字 === "string" ? 恢.文字.trim().slice(0, 下一步文字上限) || null : null, nextStepAt: 恢时 && !Number.isNaN(恢时.getTime()) ? 恢时 : null }
      : 清掉的下一步;
    await tx.project.update({
      where: { id: p.id },
      data: {
        phase: 到.phase, node: 到.node, result, exceptionCategoryId: 类别, exceptionReason: 备注,
        closedAt: result ? (现.result === result ? p.closedAt : new Date()) : null,
        ...(清下一步 ? 换下一步 : {}),
      },
    });
    // 企业版提成：进订单（赢单）固定实际提成（lib/project/commission-db.ts）。企业版进了订单不能退回商机（改节点问题 里拦）
    await 节点变了的提成(tx, p.id, p.phase, 到.phase);
    // 判无效的线索被恢复（线索流失 → 回到进行中）：判无效时记的待补没用掉的作废（invalid-makeup.ts，11-20），已用掉的不回收
    if (企业版() && 现.result === "线索流失" && result !== "线索流失") await 作废补位(tx, p.id);
    await tx.projectNodeLog.create({
      data: {
        projectId: p.id, userId: me.id,
        fromPhase: 现.phase, fromNode: 现.node, fromResult: 现.result,
        toPhase: 到.phase, toNode: 到.node, toResult: result, categoryId: 类别, reason: 清下一步 ? 拼备注(原因, 原下一步备注(p)) : 原因,
      },
    });
    // 手动往前推本身就是这次的一格（客户 11-19 定稿：一次只推一格）：推到的节点就算也齐了，也不接着自动推，等下一次保存或再点「完成节点」
    await 跟着项目重算(tx, 状态开, [p.customerId]);
    // 原 = 改之前在哪、下一步是什么：撤销条按它回去（不按页面上可能过时的那份，11-20 审查）
    return { ok: true as const, 变了: true, ...(选项?.回原 ? { 原: { phase: 现.phase, node: 现.node, result: 现.result || null, 下一步文字: p.nextStepText ?? null, 下一步时间: p.nextStepAt ? p.nextStepAt.toISOString() : null } } : {}) };
  });
}

/**
 * 企业版「终止进程」（M-节点-04）：按项目现在所在的阶段落到「没走成」的结局——线索→线索流失、商机→丢单、订单→异常状态，
 * 节点停在现在这个。线索流失、丢单要写原因（附.备注），异常状态要选在用的异常类别（附.categoryId，备注可空）。
 * 权限、校验、节点变更、提成、客户状态都走 改节点（结局不算往前推，补全期也照样能终止）
 */
export async function 终止进程(
  me: 谁, projectId: string, 附?: { categoryId?: string | null; 备注?: string | null },
): Promise<结果 & { 变了?: boolean; 到?: 位置 }> {
  if (!企业版()) return { ok: false, error: "终止进程只在企业版有" };
  const p = await prisma.project.findUnique({ where: { id: String(projectId ?? "") }, select: { phase: true, node: true, result: true } });
  if (!p) return { ok: false, error: "这个项目已经不在了，刷新看看" };
  if (p.result) return { ok: false, error: "项目已经有结局了，不用再终止" };
  const 规则 = await 生效组织规则();
  const 字典 = 字典of(true, 规则.阶段.出口叫法);
  const 结局 = 终止结局(p, 字典);
  if (!结局) return { ok: false, error: "认不出项目在哪个阶段，刷新看看" };
  const 到: 位置 = { ...本套位置({ phase: p.phase, node: p.node }, 字典), result: 结局 };
  const r = await 改节点(me, projectId, 到, { categoryId: 附?.categoryId ?? null, 备注: 附?.备注 ?? null });
  return r.ok ? { ...r, 到 } : r;
}

export const 交付项们 = { balanceSettled: "尾款结清", acceptancePassed: "验收通过" } as const;
export type 交付项 = keyof typeof 交付项们;

/** 勾 / 取消尾款结清、验收通过，记谁、何时。已经成功交付的不让取消（先把节点改回去） */
export async function 勾交付(me: 谁, projectId: string, 项: 交付项, 勾: boolean): Promise<结果 & { 变了?: boolean; 自动推到?: string[] }> {
  if (!(项 in 交付项们)) return { ok: false, error: "没有这一项" };
  const 规则 = await 生效组织规则();
  const 状态开 = await 客户状态自动();
  const org = await 权限组织();
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (!能管项目(me, p, org)) return { ok: false as const, error: "只有项目负责人能勾" };
    if (p[项] === 勾) return { ok: true as const, 变了: false };
    if (!勾 && 是交付(p.result)) return { ok: false as const, error: `已经${结局叫法(p.result!, 字典of(企业版()))}了；要取消「${交付项们[项]}」，先把进程改回去` };
    const 谁勾 = 项 === "balanceSettled" ? { balanceSettledById: 勾 ? me.id : null, balanceSettledAt: 勾 ? new Date() : null } : { acceptancePassedById: 勾 ? me.id : null, acceptancePassedAt: 勾 ? new Date() : null };
    await tx.project.update({ where: { id: p.id }, data: { [项]: 勾, ...谁勾 } });
    const 推进 = await 按必填推进(tx, 规则, me, p.id);
    if (推进.length) await 跟着项目重算(tx, 状态开, [p.customerId]);
    return { ok: true as const, 变了: true, ...带推进(推进) };
  });
}

/** 企业版（V3.5.1）：项目负责人本人或系统管理员能删（进回收站）；别人不再跟进就终止进程 */
export const 项目不能删提示 = "只有项目负责人本人或系统管理员能删除；不再跟进请终止进程";

/**
 * 删项目：负责人、老板、主管。节点变更、组员、跟进挂的节点随项目级联；跟进本身留在客户下。
 * 删客户前要先删光它的项目（customers/actions 删除依赖错误）
 * 企业版（V3.5.1，11-03）：系统管理员，或项目负责人本人（销售、销管、渠运，项目不在公海）能删，删了进回收站（软删，能恢复）；
 * 别人（条线总管理、组员、管理员 admin）一律拒，不存在的 id 对非系统管理员也回同一句（不先露「不在了」）
 */
export async function 删项目(me: 谁, projectId: string): Promise<结果 & { name?: string; customerId?: string; ownerId?: string }> {
  const 状态开 = await 客户状态自动();
  const org = await 权限组织();
  if (企业版()) {
    if (!能删一些(me, org)) return { ok: false, error: 项目不能删提示 };
    return 查完再写(async (tx) => {
      const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") }, select: { id: true, name: true, customerId: true, ownerId: true, pooledAt: true, awaitAssignAt: true } });
      if (!p) return { ok: false as const, error: 能删除(me, org, null) ? "这个项目已经不在了，刷新看看" : 项目不能删提示 };
      if (!能删除(me, org, p.pooledAt ? null : p.ownerId)) return { ok: false as const, error: 项目不能删提示 };
      // 待分配期间占着负责人一格的建的人不能删（P-转-21、X-68）；系统管理员照删
      if (待分配占位(me, p)) return { ok: false as const, error: 待分配不能动 };
      // 状态拦（X-74、P-删-10）：交接中客户的项目、验证中的线索不能删；客户只剩这一个项目不能单删（M-公海-14 不再有零项目客户）
      if ((await 看全部(() => 交接中的客户([p.customerId], tx))).size) return { ok: false as const, error: "这个项目的客户正在转让交接中，先撤回交接或等接手人确认再删" };
      const 验 = await 看全部(() => tx.entLeadVerify.findUnique({ where: { projectId: p.id }, select: { pending: true } }));
      if (验?.pending) return { ok: false as const, error: `这条线索在验证中（等${验.pending}），不能删；验证走完再删` };
      if (!(await 看全部(() => tx.project.count({ where: { customerId: p.customerId, id: { not: p.id } } })))) return { ok: false as const, error: "这是客户名下最后一个项目，不能单删；要删就删客户" };
      await 软删一条(tx, "Project", p.id);
      // 录音点评（PR6）：进回收站的项目上没发出的录音一起放弃（文件、通知清理一轮接着做）
      await 放弃没发出的录音(tx, [p.id]);
      // 进了回收站的项目不算进客户状态
      await 跟着项目重算(tx, 状态开, [p.customerId]);
      // P-删-10：删的时候谁负责（项目公海里的没有），删除入口据此通知负责人
      return { ok: true as const, name: p.name, customerId: p.customerId, ownerId: p.pooledAt ? "" : p.ownerId };
    }).then((r) => { if (r.ok) 忘掉企业版范围(); return r; }); // 组员看得到的客户名单跟着项目算
  }
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") }, select: { id: true, name: true, ownerId: true, pooledAt: true, customerId: true } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (!能管项目(me, p, org)) return { ok: false as const, error: "只有项目负责人、老板或主管能删项目" };
    await tx.project.delete({ where: { id: p.id } });
    // 删掉的项目不算进客户状态（删光了 = 清空）
    await 跟着项目重算(tx, 状态开, [p.customerId]);
    return { ok: true as const, name: p.name, customerId: p.customerId };
  });
}

/** 这位客户名下还有几个项目（删客户前问：有项目的先删项目） */
export async function 客户的项目数(customerIds: string[], db: Prisma.TransactionClient = prisma): Promise<Map<string, number>> {
  if (!customerIds.length) return new Map();
  const rows = await db.project.groupBy({ by: ["customerId"], where: { customerId: { in: customerIds } }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.customerId, r._count._all]));
}

/**
 * 转让负责人留一行痕：和改节点同一张表，kind = transfer；节点没动，from / to 节点照抄当时的。
 * 手动转让（改项目）和客户转让带着走（carry-over-db）都走这里；放回公海、从公海领取也走这里，kind 换成 pool-release / pool-claim。
 * 有从有到（不是放回公海）时原负责人没完成的卡点认领行一起给到的人（B5，卡点随项目换人；不是企业版什么都不做）
 */
export async function 记转让(
  tx: Prisma.TransactionClient,
  p: { id: string; phase: string; node: string; result: string | null },
  操作人: string, 从: string | null, 到: string | null,
  kind: "transfer" | "pool-release" | "pool-claim" = "transfer",
  reason: string | null = null,
  at?: Date,
) {
  await tx.projectNodeLog.create({ data: 转让痕(p, 操作人, 从, 到, kind, reason, at) });
  if (kind !== "pool-release" && 从 && 到 && 从 !== 到) {
    await 卡点随项目换人(tx, p.id, 从, 到, 操作人, kind === "pool-claim" ? 公海领走接手理由 : 转让接手理由);
  }
}

/**
 * 记转让 写的那一行；一次转很多个（停用成员）时拼好用 createMany 一起写。
 * at 不传按库里默认（现在）；进公海传 pooledAt 那一刻，和关待办的 doneAt 对得上（出公海按这个认那一批，carry-tasks.ts）
 */
export function 转让痕(
  p: { id: string; phase: string; node: string; result: string | null },
  操作人: string, 从: string | null, 到: string | null,
  kind: "transfer" | "pool-release" | "pool-claim" = "transfer",
  reason: string | null = null,
  at?: Date,
) {
  // 节点、结局写新名（企业版 10-31 改名：库里存着旧名的项目按 本套位置 对上）
  const 现 = 本套位置(p, 字典of(企业版()));
  return {
    projectId: p.id, userId: 操作人, kind, fromOwnerId: 从, toOwnerId: 到, reason, ...(at ? { at } : {}),
    fromPhase: 现.phase, fromNode: 现.node, fromResult: 现.result ?? null,
    toPhase: 现.phase, toNode: 现.node, toResult: 现.result ?? null,
  };
}

/** 负责人、上级、组员都得是在职成员 */
async function 在职(tx: Prisma.TransactionClient, userId: string) {
  return (await tx.user.findUnique({ where: { id: userId }, select: { active: true } }))?.active === true;
}

/**
 * 编辑项目：名称、负责人、金额 + 币种、备注、主联系人，企业版还有预计成交日期、项目来源、项目级别、项目标签、所在地（地址四格 + 详细地址）。
 * 项目标签（迁移 153，F-项目-14）和级别是两列、各自填：选字典 projTag 里启用着的一项，没换（含停用了还留着的那项）原样留，见 字典格改成（物流状态同样）。
 * 规矩同向导第四步（规整项目）；级别和所在地见 profile-rules.ts 项目级别和地址改成，成交需求 / 合同金额 / 定金金额见 项目成交钱改成，
 * 痛点标注 / 合同状态见 proj-fields.ts 项目新字段改成，备货状态 / 物流单号见 备货单号改成、物流状态对字典 projLogistics（迁移 154），业务线（11-02）三选一、不给清空、改了不重新自动分配（都是不是企业版传了也不动）；
 * 负责人得在职，主联系人得是这位客户的。节点、交付两项不走这里。
 * 换负责人 = 转让：能转让项目的人（企业版 = 总管理、负责人的实线上级、负责人本人；不是企业版 = 负责人本人、老板、主管）能转，
 * 只改这一个项目，记谁、何时、从谁到谁；别的字段 = 编辑内容，只给 能管项目 的人（企业版 C2：总管理、上级能转不能改）。
 * 带待办（企业版 C-06，转让弹窗的勾）：原负责人在这个项目上没做完的待办带给新负责人 / 关掉，没传不碰（lib/project/carry-tasks.ts）。
 * 公海里的项目能转让的人指了新负责人 = 出公海。建档人（creatorId）不在这里、哪里都不给改。
 * 没传的 = 不动（11-02 卡片就地改一次只交一格）：名称、负责人、金额、币种、备注也按「传了才改」，
 * 别拿打开页面时的旧值把别人刚改的盖回去，也不会因为顺手带了只能看的金额被字段权限拦
 */
export type 编辑项目改动 = Partial<向导项目> & { contactId?: string | null; expectedDealAt?: string | null; projTag?: string | null; logisticsStatus?: string | null } & Partial<Record<keyof 项目级别和地址, string | null>>
  & Partial<{ [K in keyof 项目成交钱]: 项目成交钱[K] }> & Partial<项目新字段> & Partial<备货单号>;
export async function 改项目(me: 谁, projectId: string, patch: 编辑项目改动, 带待办?: boolean): Promise<结果 & { 变了?: string[]; 自动推到?: string[] }> {
  if (!patch || typeof patch !== "object") return { ok: false, error: "要改什么？" };
  // 项目来源补的是「只有主渠道」的占位：先看这人改不改得了这个项目，再落成子渠道名留空的那条渠道（channel-main.ts 落到渠道，在事务外）
  if (企业版() && 是主渠道入口(patch.channelId)) {
    const 现 = await prisma.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!现) return { ok: false, error: "这个项目已经不在了，刷新看看" };
    if (!能管项目(me, 现, await 权限组织())) return { ok: false, error: 现.pooledAt ? "这个项目在公海里，先领取再改" : "只有项目负责人能改" };
    if (现.channelId) return { ok: false, error: 项目来源不能改 };
    const 落 = await 落到渠道(patch.channelId, me);
    if (!落.ok) return { ok: false, error: 落.error };
    patch = { ...patch, channelId: 落.id };
  }
  // 项目标签、物流状态（企业版）：对字典要读库，放在事务外（同 改项目画像）
  const 标签 = 企业版() && patch.projTag !== undefined ? await 字典格改成(String(projectId ?? ""), "projTag", patch.projTag) : null;
  if (标签 && !标签.ok) return 标签;
  const 物流 = 企业版() && patch.logisticsStatus !== undefined ? await 字典格改成(String(projectId ?? ""), "logisticsStatus", patch.logisticsStatus) : null;
  if (物流 && !物流.ok) return 物流;
  const 规则 = await 生效组织规则();
  const 级别 = await 字段权限of(me.id);
  const 状态开 = await 客户状态自动();
  const org = await 权限组织();
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    const 能改 = 能管项目(me, p, org);
    const 能转 = 能转让项目(me, p, org);
    // 指定回复时间（11-17）：定时 / 待分配期间录入人也能改（方案「谁能改」；市场管理当负责人也不能编辑 P-判定-02 不因此放开别的格）
    const 录入人改回复 = 企业版() && !!p.awaitAssignAt && !p.pooledAt && p.creatorId === me.id;
    if (!能改 && !能转 && !录入人改回复) return { ok: false as const, error: p.pooledAt ? "这个项目在公海里，先领取再改" : "只有项目负责人能改" };
    // 只校验、只写这次传了的格子（11-02 就地改）：老项目名称、备注超长或带首尾空白，改别的格子不报错，也不被顺手规整掉
    const 传 = 传了的(patch);
    const 好 = 规整项目({ ...项目现值(p), name: "未传", remark: null, ...传 }, p.ownerId);
    if ("error" in 好) return { ok: false as const, error: 好.error };
    if (好.ownerId !== p.ownerId && !(await 在职(tx, 好.ownerId))) return { ok: false as const, error: "项目负责人不存在或已停用，请选一位在职成员" };
    if (好.ownerId !== p.ownerId) {
      const 不行 = await 不能当负责人(好.ownerId);
      if (不行) return { ok: false as const, error: 不行 };
    }
    const contactId = patch.contactId === undefined ? p.contactId : patch.contactId || null;
    if (contactId && contactId !== p.contactId) {
      const c = await tx.contact.findUnique({ where: { id: contactId }, select: { customerId: true } });
      if (c?.customerId !== p.customerId) return { ok: false as const, error: "这位联系人不在这个客户下，刷新看看" };
    }
    const 日 = 预计成交日(patch.expectedDealAt, p.expectedDealAt);
    if (日 === undefined) return { ok: false as const, error: "预计成交日期格式不对，请选一个日期" };
    const 来源 = 项目来源改成(patch.channelId, p.channelId);
    // 项目来源有值就锁住（P-删-03，和客户来源同一条）：不给换、不给清空；空着的可以补一次。界面锁住只是辅助，这里是防线
    if (p.channelId && 来源 !== p.channelId) return { ok: false as const, error: 来源 ? 项目来源不能改 : 项目来源不能清空 };
    if (来源 !== p.channelId && 来源) {
      // 停用按 渠道启用（P-渠道-13）：主渠道停了的子渠道同样不收
      const 渠道 = await tx.channel.findUnique({ where: { id: 来源 }, select: { active: true, main: { select: { active: true } } } });
      if (!渠道 || !渠道启用(渠道)) return { ok: false as const, error: "项目来源这个渠道不存在或已停用，换一个" };
    }
    const 位置 = 企业版() ? 项目级别和地址改成(patch, p) : null;
    if (位置 && !位置.ok) return { ok: false as const, error: 位置.error };
    const 钱 = 企业版() ? 项目成交钱改成(patch, p) : null;
    if (钱 && !钱.ok) return { ok: false as const, error: 钱.error };
    const 新字段 = 企业版() ? 项目新字段改成(patch, p) : null;
    if (新字段 && !新字段.ok) return { ok: false as const, error: 新字段.error };
    // 备货状态、物流单号（迁移 154，客户 11-19）：传了才比，规矩见 proj-fields.ts 备货单号改成
    const 备货 = 企业版() ? 备货单号改成(patch, p) : null;
    if (备货 && !备货.ok) return { ok: false as const, error: 备货.error };
    // 业务线（11-02，企业版）：传了才比；三选一，不给清空。改了只换线，不重新自动分配（所在地给的建议由界面提示、人点了才改）
    const 改线 = 企业版() && patch.业务线 !== undefined;
    const 线 = 改线 ? 认业务线(patch.业务线) : null;
    if (改线 && 线 === undefined) return { ok: false as const, error: 业务线不认得 };
    if (改线 && !线) return { ok: false as const, error: 业务线必填 };
    // 指定回复时间（11-17，企业版）：传了哪格改哪格，没传的照库里的；两格一起校验（结束不早于开始）
    const 改回复 = 企业版() && (patch.指定回复开始 !== undefined || patch.指定回复结束 !== undefined);
    const 回复 = 改回复
      ? 规整指定回复(patch.指定回复开始 !== undefined ? patch.指定回复开始 : 时刻转北京墙钟(p.replyStartAt), patch.指定回复结束 !== undefined ? patch.指定回复结束 : 时刻转北京墙钟(p.replyEndAt))
      : null;
    if (回复 && !回复.ok) return { ok: false as const, error: 回复.error };
    const 回复改了 = 回复?.ok ? 回复键们.filter((k) => (回复.值[k]?.getTime() ?? null) !== (p[k]?.getTime() ?? null)) : [];
    const 新 = { ...好, ...(传.name === undefined ? { name: p.name } : {}), ...(传.remark === undefined ? { remark: p.remark } : {}), contactId, channelId: 来源, ...(位置?.ok ? 位置.值 : {}), ...(钱?.ok ? 钱.值 : {}), ...(新字段?.ok ? 新字段.值 : {}), ...(备货?.ok ? 备货.值 : {}), ...(标签?.ok ? { projTag: 标签.值 } : {}), ...(物流?.ok ? { logisticsStatus: 物流.值 } : {}), ...(改线 && 线 ? { bizLine: 线 } : {}) };
    const 变了: string[] = (Object.keys(新) as (keyof typeof 新)[]).filter((k) => 新[k] !== p[k]);
    const 日变了 = (日?.getTime() ?? null) !== (p.expectedDealAt?.getTime() ?? null);
    if (日变了) 变了.push("expectedDealAt");
    变了.push(...回复改了);
    if (!变了.length) return { ok: true as const, 变了 };
    // 改负责人 = 转让，要 能转让项目；别的字段 = 编辑内容，要 能管项目（11-01：总管理、上级能转不能改；11-02：负责人本人能改，也能把自己的转出去）
    if (变了.includes("ownerId") && !能转) return { ok: false as const, error: "只有负责人本人、直属上级、条线总管理或系统管理员能转让这个项目" };
    if (变了.some((k) => k !== "ownerId" && !(录入人改回复 && (回复键们 as readonly string[]).includes(k))) && !能改) return { ok: false as const, error: p.pooledAt ? "这个项目在公海里，先领取再改" : "只能转让负责人，项目内容只有负责人能改" };
    // 企业版字段权限：动了「只能看」的金额（含合同金额、定金金额、成交需求）/ 负责人 / 预计成交日期 / 痛点标注 / 合同状态就拒（名称、备注、联系人不在表里，照旧能改）
    const 挡 = 改不了的话(级别, 变了.flatMap((k) => (项目列字段[k] ? [项目列字段[k]] : [])));
    if (挡) return { ok: false as const, error: 挡 };
    const 换人 = 新.ownerId !== p.ownerId;
    if (换人) {
      // 客户在客户公海里的，项目随整包，不能转出去（M-公海-06、X-13）；放在事务里，弹框开着时客户刚进公海也拦。线索公海（客户不在公海）照转。
      // 标了无效的先拦、话说准（M-权限-03、X-42，同 领取项目 / 分配公海项目 的「c.pool && c.poolInvalidAt」）：
      // 不随 领项目带走单项目客户 开关放行，能管公海的人也不能经改项目把无效客户的项目分出去
      const 客 = 企业版() ? await 看全部(() => tx.customer.findUnique({ where: { id: p.customerId }, select: { poolInvalidAt: true, pool: { select: { customerId: true } } } })) : null;
      if (客?.pool && 客.poolInvalidAt) return { ok: false as const, error: 无效客户项目不能转提示 };
      if (拦客户公海里的项目(!!客?.pool)) return { ok: false as const, error: 客户在公海项目不单领提示 };
      // 公海里的项目改负责人 = 公海分配：销管、条线总管理只能分本业务线的（P-公海-07；能转让项目 按负责人判线，公海里负责人清空了判不出）
      if (p.pooledAt) {
        const 别线 = await 公海按线拦(tx, me, org, { 项目: [p.id] }, "分配");
        if (别线) return { ok: false as const, error: 别线 };
      }
      // 验证中（等复核、等销售）的线索不能改负责人（X-77）
      const 验证中 = await 验证中不能改派(tx, p.id);
      if (验证中) return { ok: false as const, error: 验证中 };
      // 这里改不了阶段和结局（规整项目只出名称、负责人、金额、备注），p 的阶段 / 结局就是改完的
      const 超 = await 超上限(tx, 规则, 新.ownerId, p);
      if (超) return { ok: false as const, error: 超 };
    }
    // 换了人：企业版下一步（时间 + 文字）跟着项目走、不清（11-03 A2-3）；超时回收照样从接手那天重新算（转让留痕），
    // 下一步时间不影响回收日（11-18 起只提醒、不收回）。不是企业版照旧清掉
    await tx.project.update({ where: { id: p.id }, data: { ...新, ...(日变了 ? { expectedDealAt: 日 } : {}), ...(回复改了.length && 回复?.ok ? 回复.值 : {}), ...(换人 && !企业版() ? { nextStepAt: null, nextStepText: null } : {}), ...(换人 && p.pooledAt ? { pooledAt: null } : {}), ...(换人 ? 换负责人(新.ownerId) : {}) } });
    // 公海里的项目 ownerId 是空的（企业版进公海清负责人）：从谁 记留痕里的历史负责人
    if (换人) {
      const 原 = p.pooledAt ? (await 历史负责人(tx, p.id)) ?? (p.ownerId || null) : p.ownerId;
      await 将回收提醒跟着换人(tx, p, 原, 新.ownerId);
      // 原负责人的待办（C-06）：勾着带给新负责人，不勾关掉；碰了几条写进这行留痕
      const 几条 = await 换负责人待办(tx, p, 原, 新.ownerId, 带待办);
      // 没碰待办（换负责人带待办关着、没传勾）记「手动转让」：超时未跟进自动转靠原因认手动转让（carry-tasks.ts 待办痕头）
      await 记转让(tx, p, me.id, 原, 新.ownerId, "transfer", 待办痕(带待办, 几条) ?? 手动转让痕);
      await 勾掉将回收提醒(tx, 规则, { ...p, ownerId: 新.ownerId }, new Date());
    }
    const 推进 = await 按必填推进(tx, 规则, me, p.id);
    // 公海里的项目改负责人 = 分出公海、又在推（换人 && p.pooledAt 上面清了 pooledAt）：同推进一样重算客户状态
    if (推进.length || (换人 && p.pooledAt)) await 跟着项目重算(tx, 状态开, [p.customerId]);
    return { ok: true as const, 变了, ...带推进(推进) };
  });
}

/** 存字典项名的两格：列 → 字典种类、叫法 */
const 字典格们 = {
  projTag: { 种类: "projTag", 名: "项目标签" },
  // 物流状态（迁移 154，客户 11-19）：同项目标签的规矩
  logisticsStatus: { 种类: "projLogistics", 名: "物流状态" },
} as const;

/**
 * 项目标签（企业版，迁移 153，F-项目-14）、物流状态（迁移 154）：传了才调。空 / 「—」= 清掉；和库里现在的一样（含停用了还留着的那项）原样留、不再对字典；
 * 换成别的要是字典里启用着的一项（选的原因，「其他：…」同别的字典）。项目标签和项目级别不相干，谁也不顶替谁
 */
async function 字典格改成(id: string, 列: keyof typeof 字典格们, v: unknown): Promise<{ ok: true; 值: string | null } | { ok: false; error: string }> {
  const { 种类, 名 } = 字典格们[列];
  if (v != null && typeof v !== "string") return { ok: false, error: `${名}要选列表里的项` };
  const t = 去不填(typeof v === "string" ? v.trim() : null) ?? "";
  if (!t) return { ok: true, 值: null };
  const 原 = await prisma.project.findUnique({ where: { id }, select: { projTag: true, logisticsStatus: true } });
  if (原?.[列] === t) return { ok: true, 值: t };
  return 选的原因(种类, t);
}

/** 改项目 规整前的底子：没传的格子用库里现在的值 */
const 项目现值 = (p: { name: string; ownerId: string; amount: number; currency: string; remark: string | null }) =>
  ({ name: p.name, ownerId: p.ownerId, amount: p.amount, currency: p.currency, remark: p.remark });

/** 把值是 undefined 的键去掉（server action 序列化后本来就没有，直接调的时候 { remark: undefined } 不能把底子盖掉）；null = 明说清空，留着 */
function 传了的(patch: 编辑项目改动): 编辑项目改动 {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as 编辑项目改动;
}

/**
 * 预计成交日期（企业版，10-27 从客户挪到项目）：没传 = 不动；空 = 清掉；认不出 = undefined（报错）。
 * 不是企业版界面上没有这格，传了也不动
 */
function 预计成交日(v: string | null | undefined, 原: Date | null): Date | null | undefined {
  if (v === undefined || !企业版()) return 原;
  if (v === null || (typeof v === "string" && !v.trim())) return null;
  return parseDateInput(v) ?? undefined;
}

/**
 * 项目来源（企业版，迁移 077）：没传 = 不动；传了就算出要存的值（空 = null），调用方查渠道在不在、启用没。
 * 11-10 起（P-删-03）有值就锁：调用方拿结果和原值比，原来有值又不一样（换了或清空）一律拒；原来空着的可以补一次。
 * 不是企业版界面上没有这格，传了也不动
 */
export const 项目来源不能改 = "项目来源记的是这一单从哪个渠道来，建好之后不能改";
export const 项目来源不能清空 = "项目来源建好之后不能清空";
function 项目来源改成(v: string | null | undefined, 原: string | null): string | null {
  if (v === undefined || !企业版()) return 原;
  return (typeof v === "string" && v.trim()) || null;
}

/** 能进公海的阶段：线索、商机；订单阶段不能放 */
export const 能进公海的阶段 = ["线索", "商机"] as const;

/**
 * 手上的项目数（企业版持有上限按这个算）：线索 / 商机阶段、还在走（没结局）、不在公海。
 * 不管怎么到手的——自己建的、领的、被指派的、自动分配的——都算；待分配（awaitAssignAt 有值，建的人只是占着负责人那一格）的不算
 */
/** 算持有的项目（同 超上限 的口径）：还在跟、不在公海、不是待分配、线索 / 商机阶段 */
const 算持有 = { pooledAt: null, result: null, awaitAssignAt: null, phase: { in: [...能进公海的阶段] } };

export async function 持有数(db: Pick<Prisma.TransactionClient, "project">, userId: string): Promise<number> {
  // 数的是 userId 手上真有几个，不按谁在看限定（11-03 A3-1：市场管理分配时看不到别人名下的，少数了、突破上限）
  return 看全部(() => db.project.count({ where: { ownerId: userId, ...算持有 } }));
}

/** 几个人各自持有几个（同 持有数 的口径，一次查完）：公海「分配给同事」选人框写「n / 上限」、满了置灰用（只读） */
export async function 各人持有数(db: Pick<Prisma.TransactionClient, "project">, userIds: readonly string[]): Promise<Record<string, number>> {
  const 们 = [...new Set(userIds)];
  const 数: Record<string, number> = Object.fromEntries(们.map((id) => [id, 0]));
  if (!们.length) return 数;
  const 组 = await 看全部(() => db.project.groupBy({ by: ["ownerId"], where: { ownerId: { in: 们 }, ...算持有 }, _count: { _all: true } }));
  for (const g of 组) if (g.ownerId) 数[g.ownerId] = g._count._all;
  return 数;
}

/**
 * 再把这个项目给 userId 会不会超持有上限：超了返回一句报错，没超 / 不是企业版 / 没开上限 / 这个项目不算持有（订单阶段、有结局）返回 null。
 * 拦领取、拦指派（改负责人、建档时负责人选别人）、自动分配也调这个；自己建档、直接转客户时原负责人自己的项目跟着走、直接离职不拦。
 * 一次进好几个的（领多项目的公海客户、确认交接、接待分配）走 超上限n（M-公海-18）。
 * 规则在进事务前读好传进来：事务占着库的唯一连接，事务里再走 getSetting 会等到超时
 */
export async function 超上限(
  db: Pick<Prisma.TransactionClient, "project" | "user">,
  规则: 组织规则,
  userId: string,
  p: { phase: string; result: string | null },
): Promise<string | null> {
  if (!企业版()) return null;
  if (p.result || !(能进公海的阶段 as readonly string[]).includes(p.phase)) return null;
  return 超上限n(db, 规则, userId, 1);
}

/** 算持有的项目条件（同 持有数 去掉 ownerId / awaitAssignAt）：线索 / 商机阶段、没结局 */
export const 算持有的项目 = { result: null, phase: { in: [...能进公海的阶段] as string[] } };

/**
 * 一次再给 userId 进 进 个算持有的项目，会不会超持有上限（同 超上限 的算法，进 = 1 时报错一字不差）。
 * 11-09 M-公海-18：领多项目的公海客户、确认交接、接待分配（客户换人带走同事待分配的项目）这三处一次进好几个，用这个拦
 */
export async function 超上限n(
  db: Pick<Prisma.TransactionClient, "project" | "user">,
  规则: 组织规则,
  userId: string,
  进: number,
): Promise<string | null> {
  if (!企业版() || 进 <= 0) return null;
  const 上限 = 持有上限of(规则, userId);
  if (上限 === null) return null;
  const 有 = await 持有数(db, userId);
  if (有 + 进 <= 上限) return null;
  const 谁 = (await db.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? "这位成员";
  if (进 === 1) return `${谁}手上已经有 ${有} 个线索 / 商机阶段的项目，到持有上限（${上限} 个）了，先推进或放回一些再接`;
  return `${谁}手上已经有 ${有} 个线索 / 商机阶段的项目，再接这 ${进} 个就超持有上限（${上限} 个）了，先推进或放回一些再接`;
}

/**
 * 一次领 / 分好几个（批量领公海、批量分公海、客户带着几个项目）超了持有上限就整批不做（M-公海-18，11-10 用户定）：
 * 在同一个事务里，动手前 持有上限起点 记下名下原有几个，全部写完再 整批核上限 数一遍：比原来多了、又超了上限就抛 整批超上限，
 * 整个事务回滚，一个都没进手。并发的两次领取：SQLite 写事务一个接一个跑（check-then-write.ts），后到的那次数的时候先到的已经写完，整批失败。
 * 写完再数而不是先估：带过来几个（客户名下公海项目、连带的、同事待分配的）以真改了的为准，不会估多估少
 */
export class 整批超上限 extends Error {
  constructor(readonly 话: string) {
    super(话);
  }
}

/** 动手前记下：上限、名下原有几个。不是企业版 / 没开上限 / 这位不限 = null（不核） */
export async function 持有上限起点(
  db: Pick<Prisma.TransactionClient, "project">, 规则: 组织规则, userId: string,
): Promise<{ userId: string; 上限: number; 有: number } | null> {
  if (!企业版()) return null;
  const 上限 = 持有上限of(规则, userId);
  if (上限 === null) return null;
  return { userId, 上限, 有: await 持有数(db, userId) };
}

/** 整批超上限那句里的动词：领（自己领）、接（分给他）、分配（接待分配、建项目指派）、交接（确认交接、离职交接看板） */
export type 整批动作 = "领" | "接" | "分配" | "交接";

/**
 * 超了持有上限整批没做的那句：上限多少、现在名下多少、这次要进多少、最多还能进多少。
 * 尾：「超了上限，」后面那半句（这次什么没做、接下来怎么办），不给 = 「这一批一个都没X，先推进或放回一些，或者少选几个再X」
 */
export function 整批超上限话(谁: string, 起: { 上限: number; 有: number }, 要: number, 动作: 整批动作 = "接", 尾?: string): string {
  const 剩 = Math.max(0, 起.上限 - 起.有);
  return `${谁}名下现在有 ${起.有} 个线索 / 商机阶段的项目，持有上限 ${起.上限} 个，这次要${动作} ${要} 个，最多还能${动作} ${剩} 个；超了上限，${尾 ?? `这一批一个都没${动作}，先推进或放回一些，或者少选几个再${动作}`}`;
}

async function 抛整批超上限(
  tx: Pick<Prisma.TransactionClient, "user">, 起: { userId: string; 上限: number; 有: number }, 要: number, 动作: 整批动作, 尾?: string,
): Promise<never> {
  const 谁 = (await tx.user.findUnique({ where: { id: 起.userId }, select: { name: true } }))?.name ?? "这位成员";
  throw new 整批超上限(整批超上限话(谁, 起, 要, 动作, 尾));
}

/** 全部写完再数（同一个事务里）：比原来多了、又超了上限就抛 整批超上限（调用方让事务回滚、回这句话） */
export async function 整批核上限(
  tx: Pick<Prisma.TransactionClient, "project" | "user">, 起: { userId: string; 上限: number; 有: number } | null, 动作: 整批动作 = "接", 尾?: string,
): Promise<void> {
  if (!起) return;
  const 现 = await 持有数(tx, 起.userId);
  if (现 <= 起.有 || 现 <= 起.上限) return;
  await 抛整批超上限(tx, 起, 现 - 起.有, 动作, 尾);
}

/**
 * 写之前在同一个事务里核（M-公海-18）：给只算一部分进手项目的地方用——接待分配只数同事待分配的、建项目指派只数新建的 1 个 + 市场转客户带的同事待分配的，
 * 原负责人自己的项目跟着客户走照旧不拦，写完再数会把那些也算进去、拦多了。进 由调用方在同一个事务里、写之前数好；
 * 事务一个接一个跑，数的时候并发的那次要么还没开始、要么已经写完，不会两次都过
 */
export async function 写前核上限(
  tx: Pick<Prisma.TransactionClient, "user">, 起: { userId: string; 上限: number; 有: number } | null, 进: number, 动作: 整批动作, 尾?: string,
): Promise<void> {
  if (!起 || 进 <= 0 || 起.有 + 进 <= 起.上限) return;
  await 抛整批超上限(tx, 起, 进, 动作, 尾);
}

/** 跑一段整批的事务：超了上限（整批超上限）回 { 超: 话 }，别的错照抛 */
export async function 整批或不做<T>(跑: () => Promise<T>): Promise<{ ok: true; 值: T } | { ok: false; 超: string }> {
  try {
    return { ok: true, 值: await 跑() };
  } catch (e) {
    if (e instanceof 整批超上限) return { ok: false, 超: e.话 };
    throw e;
  }
}

/**
 * 谁能把项目放回公海（11-01 用户「项目详情页没有退回公海」）：权限在 permissions.ts 能放回公海——
 * 企业版 = 能编辑的负责人，或能转让的总管理 / 实线上级；不是企业版 = 负责人本人、老板、业务主管。阶段另核
 */
export function 能放回公海(me: 谁, p: { ownerId: string; pooledAt?: Date | null }, org: 组织 | null): boolean {
  return 能放回公海判(me, p, org);
}

/**
 * 放回公海：负责人本人、上级、总管理能放（见 能放回公海），线索 / 商机阶段才行。企业版清空负责人（ownerId 写空串，pool-owner.ts），放回去的人只记在留痕里（他就是「历史负责人」，原负责人不能自己领回，企业版和别的版本一样，见 lib/enterprise/pool-rules.ts）；没做完的待办关掉，
 * 记一行 pool-release。项目组、节点、交付两项都不动。
 * 选项.分配放行：建项目向导选了「公海捞取」，分配方式已由 定分配方式 按业务角色核过（建的人不一定是负责人能放的角色），
 * 这里不再按 能放回公海 拦；阶段、复核照样核
 */
export async function 放回公海(me: 谁, projectId: string, 原因?: unknown, 选项?: { 验证放行?: boolean; 分配放行?: boolean }): Promise<结果> {
  // 企业版可选「回收原因」（字典），事务外先核；记在 pool-release 那行的 reason
  const 选 = await 选的原因("recycle", 原因);
  if (!选.ok) return 选;
  const reason = 选.值 ? `${回收原因前缀}${选.值}` : null;
  const org = await 权限组织();
  // M-公海-15（11-05 用户）：手动退回先查联系方式；建项目向导「公海捞取」（分配放行）不是退回，不查
  const 号码表 = 企业版() && !选项?.分配放行 ? await 退回号码种类表() : null;
  let 客户也进了: string | null = null;
  const r: 结果 = await 查完再写(async (tx) => {
    客户也进了 = null;
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (p.pooledAt) return { ok: false as const, error: "这个项目已经在公海里了" };
    if (!选项?.分配放行 && !能放回公海(me, p, org)) return { ok: false as const, error: "只有项目负责人、上级或总管理能放回公海" };
    if (!(能进公海的阶段 as readonly string[]).includes(p.phase)) return { ok: false as const, error: "订单阶段的项目不能放回公海" };
    // 已结束的项目（有结局）不能单独放回公海（X-70、P-公海-02）；客户整体进公海时连带进去的不在这里（M-公海-02）
    if (企业版() && p.result) return { ok: false as const, error: `这个项目已经结束（${p.result}），不能单独放回公海` };
    // 客户正在转让交接中（11-03 完成度 C3-2）：项目跟着客户走，这时放了，接手人确认后拿不到。别人发起的交接也算
    if (企业版() && (await 看全部(() => 交接中的客户([p.customerId], tx))).size) return { ok: false as const, error: "这个项目的客户正在转让交接中，先撤回交接再放回公海" };
    if (号码表) {
      const 错 = await 看全部(() => 项目退回前查联系方式(tx, p.id, 号码表));
      if (错) return { ok: false as const, error: 错 };
    }
    const 等着 = 选项?.验证放行 ? null : await 等复核拦(tx, p.id);
    if (等着) return { ok: false as const, error: 等着 };
    const 现在 = new Date();
    // 企业版进公海清空负责人（pool-owner.ts），原负责人记在这行 pool-release 的 from 上
    await tx.project.update({ where: { id: p.id }, data: { ...换负责人(进公海后负责人(p.ownerId)), pooledAt: 现在, nextStepAt: null, nextStepText: null } });
    await 进公海清组员(tx, [p.id], me.id);
    await 进公海清验证(tx, [p.id], me.id);
    await 进公海关主题(tx, [p.id], me.id, 现在);
    await 记转让(tx, p, me.id, p.ownerId, null, "pool-release", reason, 现在);
    // 企业版项目退回只进线索公海，客户不动（M-公海-02；开关 单项目客户跟着进公海 关着，pool-link.ts）；p 是改之前查的，ownerId 还是原负责人
    if (await 单项目客户跟进公海(tx, p, me.id, 现在, reason)) 客户也进了 = p.customerId;
    await 进公海关待办(tx, p, p.ownerId, 现在);
    // 进了公海不再算在推：客户状态按剩下的项目重算（cust-status-auto-db.ts 进出公海重算）
    await 进出公海重算(tx, [p.customerId]);
    // 企业版统一公海（P7，迁移 080）：客户累计主动退回 +1（超时回收、离职交接不走这里，不算）。裸 SQL 不顶 updatedAt
    if (企业版()) await tx.$executeRaw(Prisma.sql`UPDATE "Customer" SET "poolReturns" = "poolReturns" + 1 WHERE "id" = ${p.customerId}`);
    return { ok: true as const };
  });
  // 原负责人回避名单变了（11-03），这一下就要看不到，不等范围缓存的 10 秒
  if (r.ok) 忘掉企业版范围();
  // 客户跟着进了客户公海：关掉的挂靠申请事务提交了再通知申请人（P-挂靠-01 / 02）
  if (r.ok && 客户也进了) await 进公海挂靠通知了([客户也进了]);
  return r;
}

const 领走了 = { ok: false as const, error: "这个项目已经被人领走了，刷新看看" };

/**
 * 从公海领取：除了原负责人谁都能领（企业版 10-26 定稿「非原负责人均可领取」，别的版本本来就不能自己领回）。领了就是新负责人，记一行 pool-claim。
 * 开了持有上限的，到上限了领不了。带待办（C-06）：进公海时关掉的那批待办重新打开给我，没传不碰
 */
export async function 领取公海项目(me: 谁, projectId: string, 带待办?: boolean): Promise<结果> {
  const 备 = await 领公海项目准备(me, [projectId], 带待办);
  if (!备.ok) return 备;
  const r = await 查完再写(async (tx) => {
    // 动手前记下客户存的状态，末尾记到这一下的 pool-claim 上，撤销公海项目 原样还回（同 在事务里领公海项目们，cust-status-undo.ts）
    const 动手时 = new Date();
    const 原状态 = await 读客户状态(tx, await 项目的客户们(tx, [String(projectId ?? "")]));
    const x = await 领一个公海项目(tx, me, String(projectId ?? ""), 备.上下文, true);
    if (x.ok) {
      // 领出公海 = 又在推：客户状态按在推项目优先重算（cust-status-auto-db.ts 进出公海重算）
      await 进出公海重算(tx, [x.customerId]);
      await 原状态记到出公海痕(tx, 原状态, 动手时);
    }
    return x;
  });
  if (!r.ok) return r;
  if (r.同事待分配.length) await (await import("@/lib/enterprise/notice-sources")).同事待分配随客户通知(me.id, me.id, r.同事待分配);
  return { ok: true };
}

/**
 * 批量领公海项目（公海页勾了几行项目一起领）：一个事务里逐个领，领不了的（被人领走、原负责人、已结束……）各说各的原因、不拦别的；
 * 持有上限整批核（M-公海-18，11-10）：这一批领完会超上限就一个都不领，回 超 那句话。客户行一起勾了的走 pool-actions 领取（带 项目ids），同一个事务
 */
export async function 领取公海项目们(me: 谁, projectIds: string[], 带待办?: boolean): Promise<{ ok: true; 领到: string[]; 没领到: { id: string; 原因: string }[] } | { ok: false; error: string }> {
  const ids = [...new Set(projectIds.filter((x) => typeof x === "string" && x))];
  if (!ids.length) return { ok: true, 领到: [], 没领到: [] };
  const 备 = await 领公海项目准备(me, ids, 带待办);
  if (!备.ok) return 备;
  const r = await 整批或不做(() => 查完再写(async (tx) => {
    const 起 = await 持有上限起点(tx, 备.上下文.规则, me.id);
    const 结果 = await 在事务里领公海项目们(tx, me, ids, 备.上下文);
    await 整批核上限(tx, 起, "领");
    return 结果;
  }));
  if (!r.ok) return { ok: false, error: r.超 };
  if (r.值.同事待分配.length) await (await import("@/lib/enterprise/notice-sources")).同事待分配随客户通知(me.id, me.id, r.值.同事待分配);
  return { ok: true, 领到: r.值.领到, 没领到: r.值.没领到 };
}

/**
 * 同一个事务里逐个领（不核上限，调用方整批核）。
 * 领到的项目各自客户动手前存的客户状态（领完会重算）记到这一下的 pool-claim 上，撤销公海项目 原样还回（cust-status-undo.ts）
 */
export async function 在事务里领公海项目们(
  tx: Prisma.TransactionClient, me: 谁, ids: string[], 上下文: 领项目上下文,
): Promise<{ 领到: string[]; 没领到: { id: string; 原因: string }[]; 同事待分配: 同事待分配们 }> {
  const 领到: string[] = [];
  const 没领到: { id: string; 原因: string }[] = [];
  const 同事待分配: 同事待分配们 = [];
  const 出了的客户 = new Set<string>();
  const 动手时 = new Date();
  const 原状态 = await 读客户状态(tx, await 项目的客户们(tx, ids));
  for (const id of ids) {
    const x = await 领一个公海项目(tx, me, id, 上下文, false);
    if (x.ok) {
      领到.push(id);
      同事待分配.push(...x.同事待分配);
      出了的客户.add(x.customerId);
    } else 没领到.push({ id, 原因: x.error });
  }
  // 整批领完攒齐客户一次重算客户状态（同 领取公海项目），不逐个项目算
  await 进出公海重算(tx, 出了的客户);
  await 原状态记到出公海痕(tx, 原状态, 动手时);
  return { 领到, 没领到, 同事待分配 };
}

/** 领公海项目事务外先备好的：规则、市场转客户那一套（动态引）、带不带待办 */
export type 领项目上下文 = {
  规则: 组织规则;
  市场: typeof import("@/lib/enterprise/market-transfer") | null;
  org: 组织 | null;
  way: string;
  带待办?: boolean;
};
type 同事待分配们 = Awaited<ReturnType<typeof import("@/lib/enterprise/market-transfer")["转客户给销售"]>>["同事待分配"];

/**
 * 领公海项目（单个、批量都走）事务外那一段：进门（业务角色、只读、能不能领）、读规则；
 * 客户创建人、负责人都是市场的，销售领了公海项目客户也给他（P-公海-11、X-60）：老签约要在事务外、换负责人之前钉住；分配方式记「公海捞取」
 */
export async function 领公海项目准备(me: 谁, projectIds: string[], 带待办?: boolean): Promise<{ ok: true; 上下文: 领项目上下文 } | { ok: false; error: string }> {
  // 没设业务角色的不能领（11-03 用户定）：权限只认业务角色。分配（别人分给他）不走这里
  // 停用的人业务角色已清，先说停用，话才准
  if (企业版() && 没设业务角色(await 权限组织(), me.id)) return { ok: false, error: (await 在职(prisma, me.id)) ? 没业务角色不能领话 : "账号已停用" };
  // 只读管理员先说只读（11-03 B2-1：原来落到「项目不能单独领」，同领客户 pool-actions 领取）
  if (企业版() && 只读角色(me, await 权限组织())) return { ok: false, error: 只读话of(me, await 权限组织()) };
  // 角色不领公海的（市管、渠运、项目组员、只看某人的，V3.5.1）
  if (企业版() && !能领公海(me, await 权限组织())) return { ok: false, error: 不能领公海话 };
  const 规则 = await 生效组织规则();
  // 动态引：market-transfer → carry-over-db → 本文件
  const 市场 = 企业版() ? await import("@/lib/enterprise/market-transfer") : null;
  const org = 市场 ? await 权限组织() : null;
  if (市场 && org) {
    let 钉 = false;
    for (const id of projectIds) {
      const p0 = await 看全部(() => prisma.project.findUnique({ where: { id: String(id ?? "") }, select: { id: true, customerId: true } }));
      if (p0 && (await 市场.公海项目市场转(prisma, org, p0, me.id, true))) 钉 = true;
    }
    if (钉) await (await import("@/lib/contract-owner")).钉住老签约();
  }
  const way = 市场 ? await (await import("@/lib/enterprise/dict")).分配方式叫法(2) : "";
  return { ok: true, 上下文: { 规则, 市场, org, way, 带待办 } };
}

/**
 * 在事务里领一个公海项目。查上限 = true：这一个自己核持有上限（单个领）；批量领传 false，整批写完由调用方 整批核上限 一次核（M-公海-18，11-10 超了整批不领）
 */
export async function 领一个公海项目(
  tx: Prisma.TransactionClient, me: 谁, id: string, 上下文: 领项目上下文, 查上限: boolean,
): Promise<{ ok: true; 同事待分配: 同事待分配们; customerId: string } | { ok: false; error: string }> {
  const { 规则, 市场, org, way, 带待办 } = 上下文;
  const p = await tx.project.findUnique({ where: { id } });
  // 两人同时领：先进来的领走了，项目就落到后进来那位的范围外（业务员只看自己的 + 公海），带限定查是空的；
  // 不带限定再看一眼，还在就是被人领走了，不是删了（D-35）
  if (!p) {
    const 真 = await 看全部(() => tx.project.findUnique({ where: { id }, select: { id: true, pooledAt: true } }));
    if (!真) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    // 还在公海、只是我看不到：是我放回的（原负责人回避），话说准（11-03 完成度 B4-3）
    if (真.pooledAt && 企业版() && !公海规则.原负责人能领回 && (await 历史负责人(tx, id)) === me.id) return { ok: false as const, error: 原负责人不能领回提示 };
    return 领走了;
  }
  if (!p.pooledAt) return 领走了;
  if (!(await 在职(tx, me.id))) return { ok: false as const, error: "账号已停用" };
  // 已结束的项目不能单独领（X-70、P-公海-02）：老数据里已在公海、又有结局的，要领走客户整包
  if (企业版() && p.result) return { ok: false as const, error: `这个项目已经结束（${p.result}），不能单独领取` };
  // 企业版统一公海（P7，迁移 079）：客户在客户公海里且标了无效，项目也领不了
  if (企业版()) {
    const c = await 看全部(() => tx.customer.findUnique({ where: { id: p.customerId }, select: { poolInvalidAt: true, pool: { select: { customerId: true } } } }));
    if (c?.pool && c.poolInvalidAt) return { ok: false as const, error: "这位客户已标成无效客户，领不了，要系统管理员先恢复" };
  }
  // 原负责人领不回：企业版看 公海规则（10-26 定稿「非原负责人均可领取」），别的版本照旧。
  // 原负责人 = 留痕里最后一次进公海前的负责人（企业版进公海清了 ownerId，pool-owner.ts）
  const 原 = (await 历史负责人(tx, p.id)) ?? (p.ownerId || null);
  if (me.id === 原 && !(企业版() && 公海规则.原负责人能领回)) return { ok: false as const, error: 企业版() ? 原负责人不能领回提示 : "自己放回公海的项目不能自己领回" };
  // 规则关着时项目不单独领（无效客户、原负责人先说更具体的原因）；11-09 起开着（M-公海-06）
  if (拦单独领项目()) return { ok: false as const, error: 项目不能单独领提示 };
  // 客户在客户公海里的，项目随整包（M-公海-06），要领客户
  if (拦客户公海里的项目(!!(await 看全部(() => tx.customerPool.findUnique({ where: { customerId: p.customerId }, select: { customerId: true } }))))) return { ok: false as const, error: 客户在公海项目不单领提示 };
  // 开关 领项目带走单项目客户 开着时客户名下别的公海项目一起来，一起数（M-公海-18）
  // 市场转客户时客户上同事待分配的项目随客户一起进手，一起数（同 分配线索，M-公海-18）
  const 转 = 市场 && org ? await 市场.公海项目市场转(tx, org, p, me.id, true) : null;
  if (查上限) {
    const 超 = await 领项目连带超上限(tx, 规则, me.id, p, 转?.另进 ?? 0);
    if (超) return { ok: false as const, error: 超 };
  }
  await tx.project.update({ where: { id: p.id }, data: { ...换负责人(me.id), pooledAt: null } });
  // 进公海时关掉的那批待办（C-06）：勾着重新打开给我；市场转客户的待办计划还归市场（P-转-10），勾不算数
  const 带 = 转 ? undefined : 带待办;
  const 几条 = await 换负责人待办(tx, p, 原, me.id, 带);
  await 记转让(tx, p, me.id, 原, me.id, "pool-claim", 待办痕(带, 几条));
  // 企业版线索公海的项目单独领，客户负责人不变（M-公海-06；开关 领项目带走单项目客户 关着，pool-link.ts）
  await 单项目客户跟着领(tx, p.customerId, me.id, me.id, 带);
  // 例外：客户创建人、负责人都是市场 → 客户整体给领的销售，记「分配」不算转客户（P-公海-11、X-60）
  // 推节点 false：销售自己领，不是市场分配，带过来的不推进线索验证（审核 11-18）
  const 同事待分配 = 转 && 市场 ? (await 看全部(() => 市场.转客户给销售(tx, p.customerId, 转.原, me.id, me.id, way, false))).同事待分配 : [];
  return { ok: true as const, 同事待分配, customerId: p.customerId };
}

/** 本机记的「今天按这份规则扫过了」：值 = 日期 + 规则，老板改了时长当天再扫一遍 */
const 超时扫过键 = "projectTimeoutSweptOn";

/** 算回收日要的项目列。最近一条留痕不在这里取：用 补回收起点留痕 另取（见下） */
export const 算超时要的 = {
  id: true, name: true, phase: true, node: true, result: true, pooledAt: true, nextStepAt: true, ownerId: true, customerId: true, createdAt: true, bizLine: true,
  customer: { select: { lastFollowAt: true, pool: { select: { customerId: true } } } },
} satisfies Prisma.ProjectSelect;
/** 算回收起点认的最近一条留痕（最近一条在前，只要时间；没有 = 空） */
export type 回收起点留痕 = { logs: { at: Date }[] };
type 待查项目 = Prisma.ProjectGetPayload<{ select: typeof 算超时要的 }> & 回收起点留痕;

/** 补回收起点留痕 一句查几个项目：IN 里的参数加上条件里的几个，压在 SQLite 一句参数上限（999）以下 */
const 留痕每批 = 500;

/**
 * 一批项目各自算回收起点认的最近一条留痕：超时自动转那行不算（客户 11-19 第 14 题 B，timeout.ts 算回收起点的留痕），
 * 一句 groupBy（projectId, MAX(at)）走 (projectId, at) 索引，每个项目只回一行。
 * 不写成 select 里 logs 的 where：条件里有「不等于 / 不含」（否定条件），项目一多 Prisma 要把 IN 拆成几句时会直接报错
 * （Query parameter limit exceeded … negation filters … prevent the query from being split），所以这里自己按 留痕每批 拆。
 * 传进来的项目都已按范围取过，取留痕不再套「谁在看」；db 传 tx 时在事务里读
 */
export async function 补回收起点留痕<T extends { id: string }>(rows: T[], db: Pick<Prisma.TransactionClient, "projectNodeLog"> = prisma): Promise<(T & 回收起点留痕)[]> {
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((r) => r.id))];
  const 最近 = new Map<string, Date | null>();
  for (let i = 0; i < ids.length; i += 留痕每批) {
    const 批 = ids.slice(i, i + 留痕每批);
    const 们 = await 看全部(() => db.projectNodeLog.groupBy({ by: ["projectId"], where: { projectId: { in: 批 }, ...算回收起点的留痕 }, _max: { at: true } }));
    for (const g of 们) 最近.set(g.projectId, g._max.at);
  }
  return rows.map((r) => { const at = 最近.get(r.id); return { ...r, logs: at ? [{ at }] : [] }; });
}

/**
 * 超时按项目业务线分两套天数（企业版 11-01 清单 C7）要的成员业务线：老项目没填业务线时按负责人的线（assign-line.ts 项目业务线）。
 * 外贸那套一个节点都没单设 = 线不影响天数，不查库，返回 null；不是企业版也 null
 */
export async function 超时成员线(规则: 组织规则): Promise<成员线查 | null> {
  if (!企业版() || !Object.keys(规则.超时回收.外贸节点天数 ?? {}).length) return null;
  const 们 = await prisma.entMember.findMany({ select: { userId: true, line: true } });
  return new Map(们.map((m) => [m.userId, { line: m.line }]));
}

/** 超时按哪条线的天数算：企业版 = 项目业务线（填了按填的，老项目按负责人的线，再没有 = 内贸）；别的版本不分线 */
export function 超时线(p: { bizLine?: string | null; ownerId?: string | null }, 成员?: 成员线查 | null): string | null {
  return 企业版() ? 项目业务线(p, 成员) : null;
}

/**
 * 起点 = 最近一次有人管：建项目、最后一行节点变更 / 转让 / 领取（超时自动转那行不算）、客户上最后一次跟进，取最晚的（timeout.ts）。
 * 客户在客户公海里的不收（企业版第四节）：项目跟着客户，谁领客户谁带走；先收进项目公海就和客户拆开了。
 * 成员 = 超时成员线(规则) 读的（老项目没填业务线按负责人的线）；不传 = 没填的按内贸
 */
export function 项目回收日(规则: 组织规则, p: 待查项目, 成员?: 成员线查 | null): string | null {
  if (p.customer.pool) return null;
  return 超时回收日(规则, p, 超时起点(p.createdAt, p.logs[0]?.at, p.customer.lastFollowAt), 字典of(企业版()), 超时线(p, 成员));
}

function 超时了(规则: 组织规则, p: 待查项目, 今: Date, 成员: 成员线查 | null): boolean {
  return 已超时(项目回收日(规则, p, 成员), 今);
}

/** 按这份规则现在超时的项目（还在线索 / 商机、没结局、不在公海、节点设了时长；企业版没设的按默认 7 天） */
async function 超时的项目(规则: 组织规则, 今: Date, 成员: 成员线查 | null, ownerId?: string): Promise<待查项目[]> {
  return (await 会收的项目(规则, 成员, ownerId)).filter((p) => 超时了(规则, p, 今, 成员));
}

/** 验证中（等复核 / 等销售……）的线索不收、也不发「明天收回」、不算即将逾期（X-78 → M-线索-02，三态上线前的过渡期）。不是企业版 {} */
export function 验证中不收(): Prisma.ProjectWhereInput {
  return 企业版() ? { NOT: { entLeadVerify: { is: { pending: { not: null } } } } } : {};
}

/** 按这份规则会被收回的项目（不管哪天收） */
async function 会收的项目(规则: 组织规则, 成员: 成员线查 | null, ownerId?: string): Promise<待查项目[]> {
  const 节点 = [...new Set([...Object.keys(规则.超时回收.节点天数), ...Object.keys(规则.超时回收.外贸节点天数 ?? {})])];
  const 有默认 = !!字典of(企业版()).默认超时天数;
  if (!规则.超时回收.开 || (!节点.length && !有默认)) return [];
  const 们 = await 补回收起点留痕(await prisma.project.findMany({
    where: {
      pooledAt: null, result: null, phase: { in: [...能进公海的阶段] }, ...(有默认 ? {} : { node: { in: 节点 } }), customer: { pool: { is: null } }, ...(ownerId ? { ownerId } : {}),
      ...验证中不收(),
    },
    select: 算超时要的,
  }));
  // 客户在申请移交 / 转让交接里、还没确认的：名下项目不收（X-38 → P-转-05，挂到对方确认为止），也不发「明天收回」提醒
  const 中 = 企业版() && 们.length ? await 交接中的客户([...new Set(们.map((p) => p.customerId))]) : new Set<string>();
  return 们.filter((p) => !中.has(p.customerId) && !!项目回收日(规则, p, 成员));
}

/** 老板改时长前先看：按这份规则现在会有几个项目回到公海（不分谁的，全看） */
export async function 超时预览(规则: 组织规则, 今: Date = new Date()): Promise<number> {
  return 看全部(async () => (await 超时的项目(规则, 今, await 超时成员线(规则))).length);
}

/**
 * 超时回收（企业版，D-34）：线索 / 商机阶段的项目在节点上超过处理时长没人管，自动回到项目公海，
 * 负责人收到一条待办提醒；留痕和放回公海一样（pool-release），理由写明是超时。没开 / 没设时长什么都不做。
 * 项目列表、首页加载时调，一天按同一份规则最多扫一次；老板刚改了时长也直接调一次。
 * 团队模式下每台只扫自己名下的（和客户公海 自动掉公海 一个道理：别人的跟进本机可能还没拉到）。
 * 「今天扫过了」的记号只管扫过的那一片（Y18）：只扫了某人名下的，记在这个人的号上，不挡全公司扫、也不挡别人。
 * 扫、收都包在 看全部() 里：企业版网页上是谁打开页面就带着谁的范围（按组织看客户），低权限的人先触发时
 * 只查得到自己 + 下属的项目，却记成全公司扫过（质量 3700 复测）。扫多大一片只看上面的 只扫。
 * me 只用来定团队模式下扫谁名下的；留痕、操作日志一律记在「系统」名下（QA #16）
 */
/** 超时收回提醒的标题结尾。这条提醒是给原负责人的：客户跟着换人时不跟着转（carry-over-db 带走一位） */
/** 客户跟着进了客户公海时关掉的挂靠申请，事务提交后通知申请人。动态引：attach-approval 那条引用链不往本文件里拉 */
async function 进公海挂靠通知了(customerIds: string[]): Promise<void> {
  await (await import("@/lib/enterprise/attach-approval")).进公海挂靠通知(customerIds);
}

export const 收回提醒尾 = "已回到线索公海";
/** 改名前写进库的待办标题还是这个尾巴（只读着认，不再写） */
export const 旧收回提醒尾 = "已回到项目公海";

export async function 公海超时收回(me: { id: string; name: string }, 今: Date = new Date()): Promise<number> {
  return (await 公海超时收回明细(me, 今)).收回;
}

/**
 * 一遍扫下来的明细（夜扫的补跑日志用，10c）。
 * 上次扫 = 这一遍之前「扫过了」的记号里的日期；漏扫天数 = 上次扫和今天之间有几个整天没扫（服务停着）。
 * 停机漏了「回收前一天」提醒（11-10 新口径）：到了回收日、但这一轮的提醒没发过的项目，这一遍不收，先补发那条提醒（说明服务停过、提醒晚了、明天收），
 * 宽限一天，下一遍（次日）照常收。只宽限一次：认「这一轮提醒发过没有」= 负责人名下这位客户、这个项目这个节点开头的提醒，日期不早于回收日前一天
 * （正常那条是回收日前一天发的，补发那条是补发当天）；补发当天再扫不重发也不收，次日认得到那条就收。宽限这天记了跟进，回收日往后推，自然不收。
 * 补提醒 = 这一遍补发了几条。没停过（漏扫天数 = 0）的照旧：到了回收日就收
 */
export type 超时收回明细 = { 收回: number; 将回收提醒: number; 上次扫: string | null; 漏扫天数: number; 补提醒: number };
const 没扫 = (): 超时收回明细 => ({ 收回: 0, 将回收提醒: 0, 上次扫: null, 漏扫天数: 0, 补提醒: 0 });
/** 停机漏了「回收前一天」提醒、补发的那条提醒标题后面接的说明 */
export const 补提醒说明 = "（服务停过，这条提醒晚了，宽限一天）";

export async function 公海超时收回明细(me: { id: string; name: string }, 今: Date = new Date()): Promise<超时收回明细> {
  // 总管理员切换视图（只读预览，M-权限-08）期间、管理员（admin，只读）打开页面时不扫：渲染时顺手写库会被拒
  if (企业版() && ((await 视图中跳过()) || (await 只读身份中(defaultClient)))) return 没扫();
  return 看全部(() => 按规则收回(me, 今));
}

async function 按规则收回(me: { id: string; name: string }, 今: Date): Promise<超时收回明细> {
  const 规则 = await 生效组织规则();
  // 客户三态开着时不再按项目超时回收（三态落地计划 P4：钟挂在客户身上，唯一的自动动作是待回收期满进客户公海，见 enterprise/tri-state-db.ts）
  if (!规则.超时回收.开 || (企业版() && 规则.三态.开)) return 没扫();
  const 只扫 = 读团队() ? me.id : undefined;
  const 键 = 只扫 ? `${超时扫过键}:${只扫}` : 超时扫过键;
  const 今天 = dayjs(今).format("YYYY-MM-DD");
  const 记号 = `${今天} ${JSON.stringify(规则.超时回收)}`;
  const 旧记号 = await getSetting<string>(键);
  if (旧记号 === 记号) return 没扫();
  const 上次扫 = typeof 旧记号 === "string" && /^\d{4}-\d{2}-\d{2} /.test(旧记号) ? 旧记号.slice(0, 10) : null;
  const 漏扫天数 = 上次扫 ? Math.max(0, dayjs(今天).diff(dayjs(上次扫), "day") - 1) : 0;
  let 补提醒 = 0;

  const 成员 = await 超时成员线(规则);
  // 候选只取一遍，收回和「明天收」提醒共用（原来各取一遍，正式库快照上整遍 1.4 秒里一半是第二遍）：
  // 这一遍收走的、宽限一天的都是已超时的，提醒那边本来就跳过；提醒建之前在事务里按现在的库再算一次回收日
  const 候选 = await 会收的项目(规则, 成员, 只扫);
  const 们 = 候选.filter((p) => 超时了(规则, p, 今, 成员));
  const 查收件人 = 回收通知收件人();
  const 收了: string[] = [];
  const 客户也进了 = new Set<string>();
  for (const p of 们) {
    // 这一轮「回收前一天」提醒发过没有（收回、勾掉时标题会接一句，所以按开头找）：正常那条 dueOn = 回收日前一天，补发那条 dueOn = 补发当天
    const 节点名 = 本套名(p.node, 字典of(企业版()));
    const 回收日 = 项目回收日(规则, p, 成员);
    const 提醒过 = 回收日
      ? await prisma.task.findFirst({
          where: { ownerId: p.ownerId, customerId: p.customerId, title: { startsWith: 将回收提醒头(p.name, 节点名) }, dueOn: { gte: dayjs(回收日).subtract(1, "day").format("YYYY-MM-DD") } },
          orderBy: { dueOn: "desc" },
          select: { dueOn: true, title: true },
        })
      : null;
    // 今天补发过（停机补发的那条）：宽限到明天，同一天再扫（老板改了时长等）不收、不重发
    if (提醒过 && 提醒过.dueOn === 今天 && 提醒过.title.includes(补提醒说明)) continue;
    // 停过机、这一轮的提醒没发出去：先补发，宽限一天
    if (!提醒过 && 漏扫天数 > 0) {
      const 明天 = dayjs(今天).add(1, "day").format("YYYY-MM-DD");
      const title = `${将回收提醒(p.name, 节点名, 明天)}${补提醒说明}`;
      // 查和建放进同一笔写事务：页面打开也会触发这一遍，几个进程同时扫时只建一条（审核 11-18 通知 P2-5）
      const 建了 = await 查完再写(async (tx) => {
        if (await tx.task.findFirst({ where: { ownerId: p.ownerId, title, dueOn: 今天 }, select: { id: true } })) return false;
        await tx.task.create({ data: { title, dueAt: 今, dueOn: 今天, dueHasTime: false, customerId: p.customerId, ownerId: p.ownerId } });
        return true;
      });
      if (!建了) continue;
      const 发给 = await 查收件人(p.ownerId);
      await notify(发给.人们, { kind: "将回收", title, body: 发给.说明, link: `/projects/${p.id}`, key: `due-soon:${p.id}:${今天}` });
      补提醒++;
      continue;
    }
    // 逐个一笔事务：查出来到写下去之间有人刚推了节点、领了、记了沟通，就不收
    const 收 = await 查完再写(async (tx) => {
      const 现0 = await tx.project.findUnique({ where: { id: p.id }, select: 算超时要的 });
      const 现 = 现0 && (await 补回收起点留痕([现0], tx))[0];
      if (!现 || 现.ownerId !== p.ownerId || !超时了(规则, 现, 今, 成员)) return false;
      if (企业版() && (await 交接中的客户([p.customerId], tx)).size) return false;
      if (await 验证中不能改派(tx, p.id)) return false; // 查完到写之间刚提交了验证（X-78）
      await tx.project.update({ where: { id: p.id }, data: { ...换负责人(进公海后负责人(p.ownerId)), pooledAt: 今, nextStepAt: null, nextStepText: null } });
      await 进公海清组员(tx, [p.id], 系统.id);
      await 进公海清验证(tx, [p.id], 系统.id);
      await 进公海关主题(tx, [p.id], 系统.id, 今);
      // 是系统收的，不记在谁碰巧打开了页面的名下（QA #16）
      await 记转让(tx, p, 系统.id, p.ownerId, null, "pool-release", 超时理由, 今);
      if (await 单项目客户跟进公海(tx, p, null, 今)) 客户也进了.add(p.customerId);
      // 先关他手上这个项目的待办，再给他发收回提醒（提醒留着不关）
      await 进公海关待办(tx, p, p.ownerId, 今);
      // 同 放回公海：超时回到公海的不再算在推，客户状态重算
      await 进出公海重算(tx, [p.customerId]);
      await tx.task.create({
        data: {
          title: `项目「${p.name}」在「${本套名(p.node, 字典of(企业版()))}」超过处理时长没跟进，${收回提醒尾}`,
          dueAt: 今, dueOn: dayjs(今).format("YYYY-MM-DD"), dueHasTime: false,
          customerId: p.customerId, ownerId: p.ownerId,
        },
      });
      return true;
    });
    if (收) 收了.push(p.id);
    if (收) {
      const 发给 = await 查收件人(p.ownerId);
      await notify(发给.人们, { kind: "回收", title: `项目「${p.name}」在「${本套名(p.node, 字典of(企业版()))}」超过处理时长没跟进，${收回提醒尾}`, body: 发给.说明, link: "/projects", key: `recall:${p.id}:${今天}` });
    }
  }
  if (客户也进了.size) await 进公海挂靠通知了([...客户也进了]);
  if (收了.length) {
    忘掉企业版范围(); // 超时回到公海的也算他退的（pool-release 留痕），回避名单变了
    await recordAudit({
      user: 系统, action: "pool", entity: "Project",
      summary: `${收了.length} 个项目超过进程处理时长没跟进，自动回到线索公海`,
      detail: { ids: 收了, 节点天数: 规则.超时回收.节点天数, 外贸节点天数: 规则.超时回收.外贸节点天数 ?? {} },
    });
  }
  const 将回收提醒数 = await 提醒明天收(规则, 今, 成员, 查收件人, 候选);
  await setSetting(键, 记号);
  return { 收回: 收了.length, 将回收提醒: 将回收提醒数, 上次扫, 漏扫天数, 补提醒 };
}

type 回收收件人查 = (ownerId: string) => Promise<{ 人们: string[]; 说明: string }>;

/**
 * 回收、将回收的铃铛发给谁（11-02）：负责人 + 他的直属上级（上级看得出是谁的：说明里写负责人）。
 * 一遍扫只读一次组织，没东西要发就不读；读出错只发负责人，通知不能连累回收。待办提醒还是只给负责人
 */
function 回收通知收件人(): 回收收件人查 {
  let 底: Promise<{ org: 组织; 名: Map<string, string> } | null> | undefined;
  const 读 = async () => {
    const [org, 人们] = await Promise.all([读组织(), prisma.user.findMany({ select: { id: true, name: true } })]);
    return { org, 名: new Map(人们.map((u) => [u.id, u.name])) };
  };
  return async (ownerId) => {
    if (!企业版()) return { 人们: [ownerId], 说明: "" };
    底 ??= 读().catch((e) => {
      console.warn("[通知] 读组织失败，回收提醒只发负责人：", e instanceof Error ? e.message : e);
      return null;
    });
    const d = await 底;
    if (!d) return { 人们: [ownerId], 说明: "" };
    const 名 = d.名.get(ownerId);
    return { 人们: 负责人和上级(d.org, ownerId), 说明: 名 ? `负责人：${名}` : "" };
  };
}

/**
 * 回收前一天（10-27）：明天就要收回的项目，给负责人一条待办提醒（和收回那条同一个地方：首页待办、提醒），铃铛同时告诉他的直属上级。
 * 跟着超时扫走（夜里 00:05 或白天第一次打开页面），同一天同一个项目只提醒一次：老板当天改了时长再扫也不重复
 */
async function 提醒明天收(规则: 组织规则, 今: Date, 成员: 成员线查 | null, 查收件人: 回收收件人查, 候选: readonly 待查项目[]): Promise<number> {
  const 今天 = dayjs(今).format("YYYY-MM-DD");
  let 发了 = 0;
  for (const p of 候选) {
    const 日 = 项目回收日(规则, p, 成员);
    if (!日 || 已超时(日, 今) || !即将回收(日, 今)) continue;
    const title = 将回收提醒(p.name, 本套名(p.node, 字典of(企业版())), 日);
    // 查和建在同一笔写事务里（审核 11-18 通知 P2-5）：「今天扫过」的记号整遍扫完才写，首页、项目列表、公海页在几个进程里同时触发时，
    // 原来先查再建会各建一条
    const 建了 = await 查完再写(async (tx) => {
      // 候选是这一遍开头取的：中间被收走、领走、换了人、记了沟通（回收日变了）的不提醒
      const 现0 = await tx.project.findUnique({ where: { id: p.id }, select: 算超时要的 });
      const 现 = 现0 && (await 补回收起点留痕([现0], tx))[0];
      if (!现 || 现.pooledAt || 现.result || 现.ownerId !== p.ownerId || 项目回收日(规则, 现, 成员) !== 日) return false;
      if (await tx.task.findFirst({ where: { ownerId: p.ownerId, title, dueOn: 今天 }, select: { id: true } })) return false;
      await tx.task.create({ data: { title, dueAt: 今, dueOn: 今天, dueHasTime: false, customerId: p.customerId, ownerId: p.ownerId } });
      return true;
    });
    if (!建了) continue;
    const 发给 = await 查收件人(p.ownerId);
    await notify(发给.人们, { kind: "将回收", title, body: 发给.说明, link: `/projects/${p.id}`, key: `due-soon:${p.id}:${今天}` });
    发了++;
  }
  return 发了;
}

/**
 * 在项目上记一条沟通：负责人、老板、主管、项目组成员能记；在公海里的先领取。
 * 开了超时回收、项目在线索 / 商机阶段（还没结局）时必须填下一步时间。
 * 跟进挂在客户上（客户页也看得到）+ 挂上项目当时的节点；客户的最近跟进往后推；填了下一步（文字 / 时间）写到项目上。
 * 要下一步文字 = 项目详情「记一条」那条路（10-29）：下一步做什么必填一句话
 */
export async function 记项目沟通(
  me: 谁, projectId: string, input: 向导跟进, now: Date = new Date(),
  /** 无意义：调用方判好的无意义沟通那句（F-052，meaningless-follow.ts 沟通无意义挡）；核完项目、权限后才拦（那几句更准） */
  opt: { 要下一步文字?: boolean; 无意义?: string | null } = {},
): Promise<结果 & { followUpId?: string; 自动推到?: string[]; 推前?: 推前; 写了下一步?: boolean; 无意义?: true }> {
  if (!input || typeof input !== "object") return { ok: false, error: "要记什么？" };
  const 认 = await 认跟进方式(input);
  if ("error" in 认) return { ok: false, error: 认.error };
  input = 认;
  const 规则 = await 生效组织规则();
  const 状态开 = await 客户状态自动();
  const org = await 权限组织();
  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (p.pooledAt) return { ok: false as const, error: 企业版() ? 沟通项目在公海话 : "这个项目在公海里，先领取再记" };
    // 沟通必须挂在推项目（11-17 客户定）：已结束的项目不再记沟通
    if (企业版() && p.result) return { ok: false as const, error: 沟通项目已结束话 };
    const 能管 = 能管项目(me, p, org);
    if (!能管) {
      const 组员 = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: p.id, userId: me.id } }, select: { inviteStatus: true } });
      // 企业版（11-17 客户定，改 11-01 规则 6）：已进组的项目组员也能把沟通记到别人名下的项目上，记录上是谁记的就是谁，负责人不变
      // 设了「只看某人」的进了组也只能看（P-看-19 只放开看），说只读那句
      if (企业版() && 只看的人(org, me.id)) return { ok: false as const, error: 只看某人话 };
      if (企业版() && !能往项目记沟通(me, p, org, 组员?.inviteStatus)) return { ok: false as const, error: 沟通不是组员话 };
      if (组员?.inviteStatus !== "JOINED") return { ok: false as const, error: "只有项目负责人、项目组成员、老板或主管能记沟通" };
    }
    if (opt.无意义) return { ok: false as const, error: opt.无意义, 无意义: true as const };
    /*
      企业版组员（11-17 客户定）：上面核过「已进组、在推、有业务角色」，这条沟通该记。组员看客户是连带只读的（P-看-08，限定层把这位客户
      记在「只能看」里，在下面新建沟通会被拦），这一笔按全部写：只写这条沟通和它连带的几样（挂项目、编号、标记、项目下一步、客户最近跟进和跟着算的状态），
      客户资料、项目负责人不动
    */
    const 写 = 企业版() && !能管 ? <T,>(f: () => Promise<T>) => 看全部(f) : <T,>(f: () => Promise<T>) => f();
    return 写(async () => {
      /*
        组员记（11-19 客户答复；P-沟通-04「只能新记沟通」）：下一步是项目上的格、归负责人管——组员交来的下一步不认、不要求，
        不写项目的下一步文字 / 时间，也不跑按必填推进
      */
      const 组员记 = 企业版() && !能管;
      const 要下一步 = !组员记 && 规则.超时回收.开 && !p.result && (能进公海的阶段 as readonly string[]).includes(p.phase);
      const 好 = 规整沟通(组员记 ? { ...input, 下一步: null, 下一步时间: null } : input, { 要下一步, now, 要下一步文字: !组员记 && opt.要下一步文字 });
      if ("error" in 好) return { ok: false as const, error: 好.error };
      const 阶段问题 = 记沟通阶段问题(input, p);
      if (阶段问题) return { ok: false as const, error: 阶段问题 };
      const 额外 = await 认沟通额外(tx, input.额外, p.customerId);
      if ("error" in 额外) return { ok: false as const, error: 额外.error };
      const 跟进 = await tx.followUp.create({
        data: { type: 好.type, method: 好.method, initiator: 好.initiator, content: 好.content, occurredAt: 好.occurredAt, title: 额外.title, status: 额外.status, duration: 额外.duration, participants: 额外.participants, customerId: p.customerId, contactId: 额外.contactId === undefined ? p.contactId : 额外.contactId, ownerId: me.id },
      });
      // 挂的节点写新名（库里存着旧名的企业版项目按 本套名 对上）
      await tx.followUpProject.create({ data: { followUpId: 跟进.id, projectId: p.id, node: 本套名(p.node, 字典of(企业版())) } });
      await 记沟通编号(tx, 跟进.id, p.id, 好.nextStepAt, now);
      await 记沟通标记(tx, 跟进.id, p.id, p.phase, false);
      // 企业版组员不一定看得到这位客户（客户是负责人的）：最近跟进时间只是跟着记一笔，不按范围拦
      const c = await 看全部(() => tx.customer.findUnique({ where: { id: p.customerId }, select: { lastFollowAt: true } }));
      if (!c?.lastFollowAt || c.lastFollowAt < 好.occurredAt) await 看全部(() => tx.customer.update({ where: { id: p.customerId }, data: { lastFollowAt: 好.occurredAt } }));
      // 下一步：写了文字就文字 + 时间一起换（时间可空，空就清掉上一次的时间）；老入口只给时间，照旧只改时间、文字不动
      if (好.nextStepText) await tx.project.update({ where: { id: p.id }, data: { nextStepText: 好.nextStepText, nextStepAt: 好.nextStepAt } });
      else if (好.nextStepAt) await tx.project.update({ where: { id: p.id }, data: { nextStepAt: 好.nextStepAt } });
      // 这次写了下一步：自动推进不清它（按必填推进详 留下一步，11-20 审查）；推前 回给前端，撤销回到这一格、带回这份下一步
      const 写了下一步 = !!(好.nextStepText || 好.nextStepAt);
      const 推 = 组员记 ? { 到: [] as string[] } : await 按必填推进详(tx, 规则, me, p.id, { 留下一步: 写了下一步 });
      if (推.到.length) await 跟着项目重算(tx, 状态开, [p.customerId]);
      await 勾掉将回收提醒(tx, 规则, p, now);
      // 写了项目上的下一步（文字或时间）：调用方在「记了一条沟通」日志里打标记，30 分钟内改这条时下一步才跟着改（follow-perm 下一步跟着改of）
      return { ok: true as const, followUpId: 跟进.id, 写了下一步, ...带推进(推.到), ...(推.推前 ? { 推前: 推.推前 } : {}) };
    });
  });
}

/**
 * 记项目沟通带的额外格子（客户页选了关联项目，10-31）：标题、联系人、状态、时长、参与人。
 * 联系人只认这位客户名下的；没传联系人 = undefined（用项目的联系人）
 */
async function 认沟通额外(
  tx: Prisma.TransactionClient,
  x: 向导跟进["额外"],
  customerId: string,
): Promise<{ title: string; status: string; duration: number | null; participants: string | null; contactId: string | null | undefined } | { error: string }> {
  const 空 = { title: "", status: "已完成", duration: null, participants: null, contactId: undefined };
  if (x == null) return 空;
  if (typeof x !== "object") return { error: "沟通信息格式不正确" };
  const title = typeof x.title === "string" ? x.title.trim().slice(0, 200) : "";
  // 标题不许冒充同号再次录入的系统留痕（same-number-mark.ts：三态、最近跟进按标题排除它）；这里只新记，没有「改留痕本身」的情形
  const 标题问题 = 同号标题问题(title);
  if (标题问题) return { error: 标题问题 };
  const status = x.status == null || x.status === "" ? "已完成" : x.status;
  if (!(FOLLOW_RECORD_STATUSES as readonly string[]).includes(status)) return { error: `记录状态「${status}」不是合法取值` };
  const 分 = x.durationMinutes;
  if (分 != null && !(typeof 分 === "number" && Number.isFinite(分) && 分 >= 0)) return { error: "通话时长不能为负数" };
  const participants = typeof x.participants === "string" && x.participants.trim() ? x.participants.trim().slice(0, 500) : null;
  let contactId: string | null | undefined = undefined;
  if (typeof x.contactId === "string" && x.contactId) {
    const c = await 看全部(() => tx.contact.findFirst({ where: { id: x.contactId!, customerId }, select: { id: true } }));
    if (!c) return { error: "选的联系人不在这位客户名下，刷新看看" };
    contactId = c.id;
  }
  return { title, status, duration: 分 ? Math.round(分 * 60) : null, participants, contactId };
}

/**
 * 企业版（11-03 B3-1）：客户上记了跟进（不挂项目）也续了回收时钟（超时起点取客户最近跟进），
 * 名下还在推的项目照 勾掉将回收提醒 再算一遍：回收日推到明天以后的，那条「再不跟进」的提醒跟着勾掉（同项目上记沟通）
 */
export async function 客户跟进后勾掉将回收提醒(customerId: string, now: Date = new Date()): Promise<void> {
  if (!企业版()) return;
  const 规则 = await 生效组织规则();
  const 们 = await 看全部(() => prisma.project.findMany({ where: { customerId, pooledAt: null, result: null }, select: { id: true, name: true, node: true, ownerId: true, customerId: true } }));
  if (!们.length) return;
  await 查完再写(async (tx) => { for (const p of 们) await 勾掉将回收提醒(tx, 规则, p, now); });
}

/**
 * 企业版（10-27）：记了沟通，回收日往后推了、不再是明天以内，负责人那条「再不跟进」的提醒跟着勾掉。
 * 回收日还在明天以内（如补记一条比起点早的沟通）就不勾：明天那条提醒照样作数；下一步时间不影响回收日（11-18）。按记沟通前的项目名 + 节点找（自动推进可能换了节点）。
 * 换负责人（11-03 A2-3）也调：将回收提醒跟着换人 把提醒交给新负责人、记完转让痕以后按新负责人再算一遍
 */
export async function 勾掉将回收提醒(tx: Prisma.TransactionClient, 规则: 组织规则, p: { id: string; name: string; node: string; ownerId: string; customerId: string }, now: Date): Promise<void> {
  if (!企业版()) return;
  const 现0 = await 看全部(() => tx.project.findUnique({ where: { id: p.id }, select: 算超时要的 }));
  const 现 = 现0 && (await 补回收起点留痕([现0], tx))[0];
  // 没填业务线的按负责人的线算天数（同 超时成员线；外贸没单设天数时不查。事务里用 tx 读，审核 11-18 统计 P2-1）
  const 成员: 成员线查 | null = 现 && Object.keys(规则.超时回收.外贸节点天数 ?? {}).length
    ? new Map([[现.ownerId, { line: (await tx.entMember.findUnique({ where: { userId: 现.ownerId }, select: { line: true } }))?.line ?? null }]])
    : null;
  const 日 = 现 && 项目回收日(规则, 现, 成员);
  if (日 && 即将回收(日, now)) return;
  await 看全部(() => tx.task.updateMany({
    where: { ownerId: p.ownerId, customerId: p.customerId, done: false, OR: 同名们(p.node).map((n) => ({ title: { startsWith: 将回收提醒头(p.name, n) } })) },
    data: { done: true, doneAt: now },
  }));
}

/**
 * 企业版（11-03 A2-3）：项目换负责人，原负责人那条「再不跟进，X 日会自动回到项目公海」的提醒（自救任务）跟着项目给新负责人，
 * 不留在原负责人那、也不被「不带待办」关掉——所以在 换负责人待办 之前调。认法同 勾掉将回收提醒（项目名 + 节点开头、挂这位客户、没勾）。
 * 回收日还在不在明天以内，调用方记完转让痕以后用 勾掉将回收提醒 再算（事务里读不了规则的，如 转项目，只交不算）
 */
export async function 将回收提醒跟着换人(tx: Prisma.TransactionClient, p: { name: string; node: string; customerId: string }, 原: string | null, 新: string): Promise<number> {
  if (!企业版() || !原 || 原 === 新) return 0;
  const r = await 看全部(() => tx.task.updateMany({
    where: { ownerId: 原, customerId: p.customerId, done: false, OR: 同名们(p.node).map((n) => ({ title: { startsWith: 将回收提醒头(p.name, n) } })) },
    data: { ownerId: 新 },
  }));
  return r.count;
}

/**
 * 加组员：能管项目的人拉，1a 直接进组（inviteStatus = JOINED）。
 * 企业版（10-26）= 发邀请（INVITED），对方在自己那边点同意才进组，同意前不算组员、看不到项目；
 * 拒绝过的（DECLINED）可以再邀一次；拉自己直接进组。组长 = 项目负责人。
 * 角色可空；停用的角色不让新选，已经用它的组员不动
 */
export async function 加组员(me: 谁, projectId: string, userId: string, roleId?: string | null): Promise<结果> {
  const org = await 权限组织();
  let 组员拉: { 项目: string; 名: string; 负责人: string; 谁: string } | null = null;
  const r = await 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id: String(projectId ?? "") }, select: { id: true, name: true, ownerId: true, pooledAt: true } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    const 负责人拉 = 能改组员(me, p, org);
    if (!负责人拉) {
      const 我 = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: p.id, userId: me.id } }, select: { inviteStatus: true } });
      if (!能加组员(me, p, org, 我?.inviteStatus === "JOINED")) return { ok: false as const, error: "只有项目负责人和项目组员能加组员" };
    }
    const uid = String(userId ?? "");
    if (!(await 在职(tx, uid))) return { ok: false as const, error: "这位成员不存在或已停用" };
    const 角色 = await 可用角色(tx, roleId);
    if (typeof 角色 === "object" && 角色) return 角色;
    const 发邀请 = 企业版() && uid !== me.id;
    const 有 = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId: p.id, userId: uid } } });
    if (有 && 发邀请 && 有.inviteStatus === "DECLINED") {
      await tx.projectMember.update({ where: { id: 有.id }, data: { roleId: 角色, inviteStatus: "INVITED", invitedById: me.id } });
      return { ok: true as const };
    }
    if (有) return { ok: false as const, error: 有.inviteStatus === "INVITED" ? "已经邀请过这位了，等对方同意" : "这位已经在项目组里了" };
    await tx.projectMember.create({ data: { projectId: p.id, userId: uid, roleId: 角色, inviteStatus: 发邀请 ? "INVITED" : "JOINED", invitedById: me.id } });
    if (!负责人拉) 组员拉 = { 项目: p.id, 名: p.name, 负责人: p.ownerId, 谁: uid };
    return { ok: true as const };
  });
  if (r.ok) 忘掉企业版范围(); // 自己加自己直接进组，组员看得到的客户名单变了
  // 组员拉人（V3.5.1）：留痕 + 告诉负责人。事务外写，不和上面的写锁抢
  const 拉 = 组员拉 as { 项目: string; 名: string; 负责人: string; 谁: string } | null;
  if (r.ok && 拉) {
    const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [me.id, 拉.谁] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 话 = `${名.get(me.id)} 邀请 ${名.get(拉.谁)} 加入项目「${拉.名}」`;
    await recordAudit({ user: { id: me.id, name: 名.get(me.id) ?? "" }, action: "update", entity: "Project", entityId: 拉.项目, summary: 话 });
    await notify([拉.负责人], { kind: "项目组", title: 话, link: `/projects/${拉.项目}` });
  }
  return r;
}

/** 企业版：被邀请的人回邀请。只有本人能回、只回还在等的；同意 = 进组（JOINED），拒绝 = DECLINED（负责人那边看得到「没接受」，能再邀） */
export async function 回邀请(me: 谁, memberId: string, 同意: boolean): Promise<结果 & { projectId?: string }> {
  return 查完再写(async (tx) => {
    // 同意前看不到项目（团队范围里只算 JOINED 的组员），这一行按 id 取、只认本人
    const m = await 看全部(() => tx.projectMember.findUnique({ where: { id: String(memberId ?? "") }, select: { id: true, userId: true, projectId: true, inviteStatus: true } }));
    if (!m || m.userId !== me.id) return { ok: false as const, error: "这个邀请已经不在了，刷新看看" };
    if (m.inviteStatus !== "INVITED") return { ok: false as const, error: m.inviteStatus === "JOINED" ? "你已经在项目组里了" : "你已经拒绝过这个邀请了" };
    await 看全部(() => tx.projectMember.update({ where: { id: m.id }, data: { inviteStatus: 同意 ? "JOINED" : "DECLINED" } }));
    return { ok: true as const, projectId: m.projectId };
  }).then((r) => { if (r.ok) 忘掉企业版范围(); return r; }); // 同意了马上看得到客户
}

export type 待回邀请 = { id: string; projectId: string; 项目: string; 负责人: string; 邀请人: string; 角色: string | null; createdAt: Date };

/** 企业版：等我回的项目组邀请（只带项目名、负责人、谁邀的、角色，项目里的东西同意了才看得到） */
export async function 待我回的邀请(me: 谁): Promise<待回邀请[]> {
  if (!企业版()) return [];
  const rows = await 看全部(() => prisma.projectMember.findMany({
    where: { userId: me.id, inviteStatus: "INVITED" },
    select: { id: true, projectId: true, invitedById: true, createdAt: true, role: { select: { name: true } }, project: { select: { name: true, ownerId: true } } },
    orderBy: { createdAt: "desc" },
  }));
  const ids = [...new Set(rows.flatMap((r) => [r.project.ownerId, r.invitedById].filter((x): x is string => !!x)))];
  const 名 = new Map((await 看全部(() => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }))).map((u) => [u.id, u.name || u.email]));
  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, 项目: r.project.name, 负责人: 名.get(r.project.ownerId) ?? "—",
    // invitedById 空 = 系统发的（同号再次录入，lib/enterprise/same-number-collab.ts）
    邀请人: r.invitedById ? 名.get(r.invitedById) ?? "—" : "系统（同号再次录入）", 角色: r.role?.name ?? null, createdAt: r.createdAt,
  }));
}

/** 角色 id → 能用的角色 id（null = 不选）；停用的、不在的给一句话 */
async function 可用角色(tx: Prisma.TransactionClient, roleId: string | null | undefined): Promise<string | null | { ok: false; error: string }> {
  if (!roleId) return null;
  const r = await tx.projectRole.findUnique({ where: { id: String(roleId) } });
  if (!r) return { ok: false, error: "这个角色已经不在了，刷新看看" };
  if (!r.active) return { ok: false, error: `「${r.name}」已经停用了，换一个` };
  return r.id;
}

/** 换组员的角色。原来那个停用了也能换走；换成的得是在用的 */
export async function 换组员角色(me: 谁, memberId: string, roleId: string | null): Promise<结果> {
  const org = await 权限组织();
  return 查完再写(async (tx) => {
    const m = await tx.projectMember.findUnique({ where: { id: String(memberId ?? "") }, include: { project: { select: { ownerId: true, pooledAt: true } } } });
    if (!m) return { ok: false as const, error: "这位已经不在项目组里了，刷新看看" };
    if (!能改组员(me, m.project, org)) return { ok: false as const, error: "只有项目负责人能改组员" };
    if ((roleId || null) === m.roleId) return { ok: true as const };
    const 角色 = await 可用角色(tx, roleId);
    if (typeof 角色 === "object" && 角色) return 角色;
    await tx.projectMember.update({ where: { id: m.id }, data: { roleId: 角色 } });
    return { ok: true as const };
  });
}

/**
 * 移出项目组。被移出的人在这个项目卡点上没完成的认领行转给项目负责人（B5）；
 * 项目在公海里（没负责人）就原样留着，等有人领走时跟着 记转让 走
 */
export async function 移出组员(me: 谁, memberId: string): Promise<结果> {
  const org = await 权限组织();
  return 查完再写(async (tx) => {
    const m = await tx.projectMember.findUnique({ where: { id: String(memberId ?? "") }, include: { project: { select: { ownerId: true, pooledAt: true } } } });
    if (!m) return { ok: true as const };
    if (!能改组员(me, m.project, org)) return { ok: false as const, error: "只有项目负责人能改组员" };
    await tx.projectMember.delete({ where: { id: m.id } });
    if (m.project.pooledAt === null && m.project.ownerId && m.userId !== m.project.ownerId) {
      await 卡点随项目换人(tx, m.projectId, m.userId, m.project.ownerId, me.id, 移出组员接手理由);
    }
    return { ok: true as const };
  }).then((r) => { if (r.ok) 忘掉企业版范围(); return r; }); // 移出了马上看不到
}

/** 读必填数据 要的项目列（整行传进来就行） */
type 必填项目行 = Pick<Project,
  "id" | "customerId" | "node" | "contactId" | "nextStepAt" | "nextStepText" | "expectedDealAt" | "amount" | "remark" | "acceptancePassed" | "balanceSettled"
  | "painPoints" | "contractStatus" | "demandStatus" | "productNeeds" | "name" | "channelId" | "addrCountry" | "level" | "projTag" | "dealDemand" | "contractAmount" | "depositAmount"
  | "stockStatus" | "logisticsStatus" | "trackingNo"
  | "budgetLevel" | "priceSense" | "decisionChain" | "purchaseCycle" | "productFit" | "valueFit" | "decisionReach" | "competitor" | "deployFit" | "siteStatus"> & Partial<Pick<Project, "assignMode">>;

/**
 * 算「还差」要的数据（企业版节点必填，D-37）：客户（含外贸字段）、客户下的联系人、项目上的沟通各在哪个节点记的。
 * 11-01 按客户矩阵加：每条沟通的发起主体 / 内容 / 方式、项目分配记录的分配方式、线索验证结果。
 * 带上 规则 才读「线索验证」节点配的必填项（算有效沟通用，11-05）；不带 = 有效沟通看需求状态。
 * 只用 tx：保存的那笔事务里调，刚写的也读得到。
 * 签收：渲染路径（项目页 load.ts）传页面字典算好的已签收认法，不另查一句（客户详情查询条数上限）；写库路径不传，用 tx 现读
 */
export async function 读必填数据(tx: Prisma.TransactionClient, p: 必填项目行, 规则?: 组织规则, 签收已读?: Pick<已签收认法结果, "名们">): Promise<必填数据> {
  const [c, 联系人们, 沟通, 合同附件数, 回款笔数, 项目方案数, 分配, 验证, 验收报告数, 签收] = await Promise.all([
    // 只用来判必填齐没齐、不回给页面：绕开可见范围读，组员看不到客户时也不误报「所属客户」（11-03 B6-1）
    看全部(() => tx.customer.findUnique({
      where: { id: p.customerId },
      select: {
        phone: true, assignWay: true, touchpoint: true, addrCountry: true, channelId: true,
        // 客户本身的号（联系方式子表里没挂联系人的那几行，企业版客户页「号码」几行写这里；审核 11-18 P1-5）
        contactMethods: { where: { contactId: null }, select: { kind: true, value: true } },
        extra: { select: { country: true, whatsapp: true, wechat: true, email: true, source: true, level: true, alibabaId: true } },
      },
    })),
    看全部(() => tx.contact.findMany({ where: { customerId: p.customerId }, select: { id: true, name: true, phone: true, email: true, wechat: true, contactMethods: { select: { kind: true, value: true } } } })),
    tx.followUpProject.findMany({ where: { projectId: p.id, followUp: { deletedAt: null } }, select: { node: true, followUp: { select: { initiator: true, content: true, method: true } } } }),
    tx.attachment.count({ where: { projectId: p.id, tag: "合同" } }),
    tx.entProjectPayment.count({ where: { projectId: p.id } }),
    tx.attachment.count({ where: { projectId: p.id, tag: "方案" } }),
    tx.entLeadAssign.findFirst({ where: { projectId: p.id, way: { not: null } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { way: true } }),
    tx.entLeadVerify.findUnique({ where: { projectId: p.id }, select: { verdict: true, finalResult: true, pending: true } }),
    // 验收报告（M-必填-11）：「项目附件」里验收报告那一格传了几份
    tx.attachment.count({ where: { projectId: p.id, tag: "验收报告" } }),
    // 物流状态里算「已签收」的名字（客户 11-19 定稿）：按字典默认项 id 认，改了名也认
    签收已读 ?? 已签收物流状态(tx),
  ]);
  return {
    项目: {
      node: p.node, contactId: p.contactId, nextStepAt: p.nextStepAt, expectedDealAt: p.expectedDealAt, amount: p.amount, remark: p.remark, acceptancePassed: p.acceptancePassed, demandStatus: p.demandStatus ?? null, assignMode: p.assignMode ?? null,
      name: p.name, channelId: p.channelId, addrCountry: p.addrCountry, level: p.level, projTag: p.projTag, dealDemand: p.dealDemand, nextStepText: p.nextStepText,
      contractAmount: p.contractAmount, depositAmount: p.depositAmount, balanceSettled: p.balanceSettled,
      stockStatus: p.stockStatus, logisticsStatus: p.logisticsStatus, trackingNo: p.trackingNo,
      budgetLevel: p.budgetLevel, priceSense: p.priceSense, decisionChain: p.decisionChain, purchaseCycle: p.purchaseCycle, productFit: p.productFit,
      valueFit: p.valueFit, decisionReach: p.decisionReach, competitor: p.competitor, deployFit: p.deployFit, siteStatus: p.siteStatus,
    },
    客户: {
      phone: c?.phone ?? null, extra: c?.extra ?? null, assignWay: c?.assignWay ?? null, touchpoint: c?.touchpoint ?? null,
      addrCountry: c?.addrCountry ?? null, channelId: c?.channelId ?? null, contactMethods: c?.contactMethods ?? [],
    },
    有客户: !!c,
    联系人们,
    沟通节点们: [...new Set(沟通.map((x) => x.node))],
    沟通们: 沟通.map((x) => ({ node: x.node, initiator: x.followUp.initiator, content: x.followUp.content, method: x.followUp.method })),
    合同附件数, 回款笔数,
    痛点标注: p.painPoints, 合同状态: p.contractStatus, 项目方案数, 验收报告数,
    需求类型们: 读产品需求(p.productNeeds),
    分配方式: 分配?.way ?? null,
    线索验证: 验证 ?? null,
    线索验证必填: 规则 ? 节点必填(规则, 有效线索节点) : [],
    已签收物流们: 签收.名们,
  };
}

/** 企业版推进关 要的「有效沟通还差」：线索验证节点配的必填项（不含有效沟通、线索验证结果）缺哪几样，没配看需求状态（11-05）；
 * 所有角色都走这道闸门，经理也不例外（11-05 客户：「该规则适用于所有角色」） */
export function 有效沟通差of(tx: Prisma.TransactionClient, p: 必填项目行, 规则: 组织规则): () => Promise<string[]> {
  return async () => 有效沟通还差(await 读必填数据(tx, p, 规则)).map(必填叫法);
}

export const 自动推进理由 = "必填齐了，自动推进";

/**
 * 企业版换节点（手动改节点、按必填自动推）清项目上的下一步计划 / 时间：下一步只算在当前节点写的。
 * 库里没有「下一步更新时间」，带着上个节点的下一步进新节点，新节点配了下一步必填就直接算齐、一进来就被推走。
 * 老值不丢：写进这次节点变更的备注（原下一步：文字 · 时间）；记沟通时写的时间沟通记录上另有一份
 */
const 清掉的下一步 = { nextStepText: null, nextStepAt: null } as const;
const 原下一步头 = "原下一步：";

/** 换节点前项目上的下一步，写进节点变更备注的那句；没有下一步 = null */
export function 原下一步备注(p: { nextStepText?: string | null; nextStepAt?: Date | null }): string | null {
  const 字 = p.nextStepText?.trim() || "";
  const 时 = p.nextStepAt ? dayjs(p.nextStepAt).format("YYYY-MM-DD HH:mm") : "";
  if (!字 && !时) return null;
  return 原下一步头 + [字, 时].filter(Boolean).join(" · ");
}

/** 节点变更备注：原因、自动推进理由、原下一步，按行拼；都空 = null */
function 拼备注(...段: (string | null | undefined)[]): string | null {
  return 段.filter(Boolean).join("\n") || null;
}

/**
 * 是不是往前走进现在这个节点的：最后一行进这个节点的节点变更是往前（或建项目那一行）。
 * 退回来的不自动推（退回一般是要重做，等上级手动推）
 */
async function 往前进来的(tx: Prisma.TransactionClient, p: { id: string; phase: string; node: string }): Promise<boolean> {
  const 们 = await tx.projectNodeLog.findMany({
    where: { projectId: p.id, kind: "node", toPhase: p.phase, toNode: { in: 同名们(p.node) }, toResult: null },
    orderBy: [{ at: "desc" }, { id: "desc" }], take: 1,
    select: { fromPhase: true, fromNode: true },
  });
  const 上次 = 们[0];
  if (!上次?.fromPhase || !上次.fromNode) return true;
  const 字典 = 字典of(企业版());
  return 节点序号(p, 字典) > 节点序号({ phase: 上次.fromPhase, node: 上次.fromNode }, 字典);
}

/**
 * 这个人现在存一下，项目会不会按必填自动推一格：会 = 推到的位置，不会 = null。只查不写；按必填推进 和项目页「存一下会自动推」提示共用。
 * 节点推进没生效、需求补全期（M-权限-07）这两条由调用方先挡（按必填推进 开头挡了）。
 * 已读：渲染路径（项目页 load.ts）已经读好的 读必填数据 结果，传了就不再读；写库路径（按必填推进）不传，用 tx 现读
 */
export async function 自动推得到(tx: Prisma.TransactionClient, 规则: 组织规则, me: { id: string }, p: Project, 已读?: () => Promise<必填数据>): Promise<{ phase: string; node: string } | null> {
  if (!节点推进生效(规则) || (企业版() && 规则.阶段.需求补全期)) return null;
  // 节点推进不管的项目不自动推（项目按必填走：默认全部都管；设置成只管新建的时看 createdAt）；已结束、在公海的不推
  if (p.pooledAt || p.result || !项目按必填走(规则, p)) return null;
  // 待分配期间占位的建的人改字段：字段照存，不跟着自动推进（P-转-21、X-68 建的人不能推进）
  if (待分配占位(me, p)) return null;
  const 下 = 下一步(p, 字典of(企业版()));
  if (!下) return null;
  // [待客户定 A] 下一格换了阶段（线索→商机、商机→订单）不自动推：企业版跨阶段退不回去（nodes.ts 改节点问题），停在本格，
  // 等人点「完成节点」（项目页、看板都先弹确认）；项目页提示「必填齐了，点「完成节点」进商机 / 订单」。同阶段内照旧自动推一格
  if (企业版() && 下.phase !== p.phase) return null;
  // 退回来的节点不推（退回一般是要重做）
  if (!(await 往前进来的(tx, p))) return null;
  const 数据 = 已读 ?? (() => 读必填数据(tx, p, 规则));
  if (还差(规则, await 数据()).length) return null;
  if (await 企业版推进关(tx, p, 下, 规则, 已读 ? async () => 有效沟通还差(await 已读()).map(必填叫法) : 有效沟通差of(tx, p, 规则))) return null;
  return 下;
}

/**
 * 企业版节点必填（D-37）：现在的节点配了必填、全齐了、是往前走进来的，就往前推一步，记一行节点变更（理由写明自动推进，操作人 = 这次保存的人）。
 * 一次最多推一格（客户 11-19 定稿）：推到的节点就算也配了、也齐了，也停在那，等下一次保存（或人点「完成节点」）再推。
 * 返回推到的节点（没推 = 空，推了 = 一个）。没生效时一行都不查。在保存的那笔事务里调，规则在事务外读好传进来。
 * 保存项目字段、画像、勾交付、记回款、记沟通、客户资料连带推（客户项目按必填推进）、看板就地补填都走这一个
 */
export async function 按必填推进(tx: Prisma.TransactionClient, 规则: 组织规则, me: { id: string }, projectId: string): Promise<string[]> {
  return (await 按必填推进详(tx, 规则, me, projectId)).到;
}

/** 自动推之前项目在哪、下一步是什么（撤销用：回到这一格、带回这一份下一步，11-20 审查） */
export type 推前 = { phase: string; node: string; 下一步文字: string | null; 下一步时间: string | null };

/**
 * 按必填推进 + 回推之前在哪（推前）。
 * 留下一步（11-20 审查）：同一次保存里刚写了下一步（项目上记沟通填了下一步）就不清——那是员工这次刚交的，被这次自动推进清掉 = 悄悄丢输入；
 * 不清时节点变更备注里也不记「原下一步」。手动「完成节点」（改节点）、没写下一步的保存照旧清，老值记进备注
 */
export async function 按必填推进详(tx: Prisma.TransactionClient, 规则: 组织规则, me: { id: string }, projectId: string, opt: { 留下一步?: boolean } = {}): Promise<{ 到: string[]; 推前?: 推前 }> {
  // 需求状态补全期（M-权限-07）：只有销售管理、总管理手动推，填齐了也不自动推
  if (!节点推进生效(规则) || (企业版() && 规则.阶段.需求补全期)) return { 到: [] };
  const p = await tx.project.findUnique({ where: { id: projectId } });
  if (!p) return { 到: [] };
  const 下 = await 自动推得到(tx, 规则, me, p);
  if (!下) return { 到: [] };
  // 推到下一个节点：带过去的下一步不算新节点的（不然新节点配了下一步必填就直接齐了），清掉，老值记进这行节点变更
  await tx.project.update({ where: { id: p.id }, data: { phase: 下.phase, node: 下.node, ...(opt.留下一步 ? {} : 清掉的下一步) } });
  await 节点变了的提成(tx, p.id, p.phase, 下.phase);
  const 自 = 本套位置({ phase: p.phase, node: p.node, result: null }, 字典of(企业版()));
  await tx.projectNodeLog.create({
    data: {
      projectId: p.id, userId: me.id, reason: 拼备注(自动推进理由, opt.留下一步 ? null : 原下一步备注(p)),
      fromPhase: p.phase, fromNode: 自.node, fromResult: null, toPhase: 下.phase, toNode: 下.node, toResult: null,
    },
  });
  return { 到: [下.node], 推前: { phase: 自.phase, node: 自.node, 下一步文字: p.nextStepText ?? null, 下一步时间: p.nextStepAt ? p.nextStepAt.toISOString() : null } };
}

/**
 * 客户这边存了东西（客户资料、联系人、客户上的跟进）：这位客户名下停在配了必填节点上的项目，齐了的往前推。
 * 每个项目一笔事务；没生效时不查库。返回推了的项目和推到的节点（操作日志用）。
 * 企业版只推我能改节点的项目（能改节点，按项目逐个判，11-20 复审）：客户名下同事负责、我只是组员的不推（P-沟通-05 组员记沟通不触发自动推进），
 * 销售管理 / 总管理改下属的客户、沟通也不推下属的项目（11-01 起直属上级、总管理不再代推，C2）；推了的节点变更操作人是我，不能落到别人的项目上。
 * 例外 新建的：建档向导、客户页新建项目、线索转化这一次刚建的那个项目（可能指定给了别人），建的时候带的首条跟进齐了照推（原来就推，不改）
 */
export async function 客户项目按必填推进(me: { id: string; role?: string | null }, customerId: string, opt: { 新建的?: string } = {}): Promise<{ id: string; name: string; 到: string[] }[]> {
  const 规则 = await 生效组织规则();
  if (!节点推进生效(规则) || !customerId) return [];
  const 配了的 = Object.keys(规则.节点推进.必填).filter((n) => 节点必填(规则, n).length);
  // 配置的 key 已按本套名换成新名（org-rules.ts）；库里还存着旧节点名的项目（10-31 改名前的）新旧名一起认（同名们），不然漏推。
  // 范围是「只管开启之后新建的」时，生效时刻之前建的存量项目不查（按必填推进 里也会再挡一遍）；默认「全部」都查（客户 11-19 最新口径）
  const 起 = 只管新建之后(规则);
  const 们 = await prisma.project.findMany({ where: { customerId, pooledAt: null, result: null, node: { in: [...new Set(配了的.flatMap(同名们))] }, ...(起 ? { createdAt: { gte: new Date(起) } } : {}) }, select: { id: true, name: true, ownerId: true, pooledAt: true } });
  const org = 企业版() && 们.length ? await 权限组织() : null;
  const 推了: { id: string; name: string; 到: string[] }[] = [];
  for (const { ownerId, pooledAt, ...p } of 们) {
    // 企业版只认业务角色、不看账号 role（Actor 不带 role 时补空）
    if (企业版() && p.id !== opt.新建的 && !能改节点({ ...me, role: me.role ?? "" }, { ownerId, pooledAt }, org)) continue;
    const 到 = await 查完再写((tx) => 按必填推进(tx, 规则, me, p.id));
    if (到.length) 推了.push({ ...p, 到 });
  }
  // 推了节点（可能进了商机 / 首款到账，旧名首款支付）：客户状态跟着重算一次
  if (推了.length) await 项目变了重算([customerId]);
  return 推了;
}
