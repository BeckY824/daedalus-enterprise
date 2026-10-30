/**
 * 企业版线索分配（2026-10-24 会上定的，规则「线索分配和配额」，默认关）。
 *
 * - 营销线索可以分给内贸销售，也可以分给外贸销售：分的时候选走哪条线，接手人的业务线要对得上（没填业务线 = 两边都做）。
 * - 分配数按月算、每月清零：每分一次在 EntLeadAssign 记一行，带 month（YYYY-MM），配额只数本月那一格。
 *   销售自己拓的线索没有分配记录，自然不算。
 * - 直属上级、虚线上级（以及总管理员、老板）能给个人设每月配额，不设固定复核周期。
 *   没设：手动分不限；自动分配不挑他（10-25 用户定「没填的不参与」），配额 0 也不挑。
 * - 10-30 客户定「开着，每人都不限额」：规则里多一个选项「不设配额」（不设配额key，默认关）。开了以后配额整个不起作用：
 *   自动分配在规则范围内（在职、能接这条线、参与自动分配）的人里挑本月已分最少的，手动分也不查满额；关着和以前一样。
 * - 线索分出去以后，原来的负责人（市场人员）仍能看到转化情况：记录里留了 fromUserId，
 *   「我分出去的线索」按它查，不受「按组织架构看客户」限定。
 * - **还没定的留口子**：营销企划线索走哪边、算不算数——kind 记下来，算不算数走 计不计数()，
 *   现在先和营销线索一样算，定了以后改这一处（或拨 企划线索计数key 那个 Setting）。
 *
 * 纯函数在上半截（测试直接用），下半截读写库。权限、规则开关的检查在 leads/assign-actions.ts。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma, defaultClient } from "@/lib/prisma";
import { businessDayjs } from "@/lib/business-clock";
import { 管理员类别们of, type 组织 } from "./org-core";
import { 能改设置, type 改权限配置 } from "./edit-perm-table";

export const 线索种类 = ["营销", "营销企划"] as const;
export type 线索种类 = (typeof 线索种类)[number];
export type 线 = "内贸" | "外贸";

/** 营销企划线索算不算进当月分配数：Setting 里存 JSON true / false，没存 = 算（10-24 计数细节未定，先和营销线索一样） */
export const 企划线索计数key = "enterprise.lead_assign.plan_counted";

/**
 * 本月是哪一格：按业务钟（企业版固定北京时间，lib/business-clock），北京月初零点换格 = 每月清零。
 * 不看服务器 TZ：部署包里 TZ 没设成 Asia/Shanghai 时，月末那 8 小时会记到下个月
 */
export function 月份(d = new Date()): string {
  return businessDayjs(d).format("YYYY-MM");
}

/** 能接分配线索的业务角色：销售、销售管理 */
const 能接的角色 = new Set(["sales", "sales_mgr"]);

/** 能点「分配」的人：老板（账号管理员）、总管理员、市场管理 */
export function 能分配(org: 组织, 我: { id: string; role: string }): boolean {
  if (我.role === "ADMIN") return true;
  const 类们 = 管理员类别们of(org, 我.id);
  return 类们.has("总管理员") || 类们.has("市场管理");
}

/**
 * 能给 目标 设配额的人：按「后台设置谁能改」的「线索分配配额」一行（edit-perm-table.ts），
 * 默认他的直属上级、虚线上级（B2 第 6 条默认建议，10-26），老板总能改。
 */
export function 能设配额(org: 组织, 我: { id: string; role: string }, 目标: string, 配置: 改权限配置 = {}): boolean {
  return 能改设置(org, 我, "线索配额", 配置, 目标);
}

/** 这条线索能不能分给 接手人：返回出错原因，null = 可以 */
export function 接手问题(org: 组织, 接手人: string, line: 线 | null): string | null {
  const m = org.成员.get(接手人);
  if (!m) return "接手人不在组织里，或者已经停用";
  if (!m.角色们.some((r) => 能接的角色.has(r))) return "线索只能分给销售或销售管理";
  if (line && m.line && m.line !== line) return `他是${m.line}销售，这条线索走${line}`;
  return null;
}

/** 这一条分配算不算进接手人当月的数。营销企划怎么算还没定：先看 Setting，没设 = 算 */
export function 计不计数(kind: 线索种类, 企划算数: boolean | null): boolean {
  if (kind === "营销企划") return 企划算数 ?? true;
  return true;
}

/** 配额满了没：配额 null = 没设，手动分不限（自动分配另看 有配额） */
export const 满了 = (已分: number, 配额: number | null) => 配额 !== null && 已分 >= 配额;

/** 自动分配只挑填了配额、而且不是 0 的人（10-25：没填的不参与；配额 0 也不分） */
export const 有配额 = (配额: number | null): 配额 is number => 配额 !== null && 配额 > 0;

/**
 * 每人参不参与自动分配（10-26 改三态）：允许 / 暂停 / 禁止。暂停 = 暂时不参与、可随时恢复；禁止 = 不参与。
 * 两种都不进轮转，手动分配都照常。存 Setting：{ userId: "暂停" | "禁止" }，允许的不存，没存 = 人人允许。
 * 老格式（10-24 起的开关）是 string[] = 关掉的人，读成 禁止；对象里存 true / false 的读成 允许 / 禁止。下一次改就写成新格式
 */
export const 自动分配不参与key = "enterprise.lead_assign.auto_excluded";

export const 参与状态们 = ["允许", "暂停", "禁止"] as const;
export type 参与状态 = (typeof 参与状态们)[number];
export const 是参与状态 = (x: unknown): x is 参与状态 => (参与状态们 as readonly unknown[]).includes(x);

/** 存着的值规整成 userId → 暂停 / 禁止（允许不放进来）。存坏了的当没设 */
export function 认参与状态(v: unknown): Record<string, Exclude<参与状态, "允许">> {
  const out: Record<string, Exclude<参与状态, "允许">> = {};
  if (Array.isArray(v)) {
    for (const id of v) if (typeof id === "string" && id) out[id] = "禁止";
    return out;
  }
  if (!v || typeof v !== "object") return out;
  for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
    if (!id) continue;
    if (x === "暂停" || x === "禁止") out[id] = x;
    else if (x === false) out[id] = "禁止";
  }
  return out;
}

/** 这个人现在的状态 */
export const 参与状态of = (表: Record<string, 参与状态>, userId: string): 参与状态 => 表[userId] ?? "允许";

/**
 * 规则「线索分配和配额」里的选项「不设配额（人人参与、不限额）」（10-30 客户定「开着，每人都不限额」）：
 * Setting 里存 JSON true / false，没存 = 关（和以前一样按配额）。开了以后自动分配不看配额、手动分配不查满额
 */
export const 不设配额key = "enterprise.lead_assign.no_quota";

export type 候选人 = { userId: string; 已分: number; 配额: number | null; 进池: Date };

/**
 * 自动分配的候选人：组织里在职的（读组织时已去掉停用 / 离职的）、能接这条线的，去掉线索现在的负责人。
 * 参不参与、配额由 挑接手人 再筛
 */
export function 自动候选人们(org: 组织, 现负责人: string | null, line: 线 | null): string[] {
  return [...org.成员.keys()].filter((id) => id !== 现负责人 && 接手问题(org, id, line) === null);
}

/**
 * 挑接手人、挑的理由 同一套筛法：去掉不参与的、没填配额 / 配额 0 的、（这一条算数时）分满的。
 * 不限额（不设配额开着）时只去掉不参与的，配额不起作用
 */
function 可挑(候选: 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 不限额: boolean): 候选人[] {
  if (不限额) return 候选.filter((c) => !不参与.has(c.userId));
  return 候选.filter((c) => !不参与.has(c.userId) && 有配额(c.配额) && !(查满 && 满了(c.已分, c.配额)));
}

/** 本月已分 / 配额 谁的比例低：交叉相乘比，不做除法，3/9 和 1/3 判成一样。可挑的人配额都 > 0 */
const 比例差 = (a: 候选人, b: 候选人) => a.已分 * b.配额! - b.已分 * a.配额!;
/** 不限额时比本月已分谁少 */
const 已分差 = (a: 候选人, b: 候选人) => a.已分 - b.已分;

/**
 * 自动分配挑谁（D-38，10-26 定成 A7 默认）：去掉不参与的、没填配额的、（这一条算数时）分满的，
 * 挑「本月已分 / 配额」比例最低的；比例一样给最早进分配池的。EntMember 没记进池时间，先按建号时间算；
 * 再一样按 id，结果不随查询顺序变。
 * 不限额（10-30）：参与的人都能挑，比本月已分条数（最少优先），并列的同样给最早进分配池的
 */
export function 挑接手人(候选: 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 不限额 = false): string | null {
  const 可 = 可挑(候选, 不参与, 查满, 不限额);
  const 差 = 不限额 ? 已分差 : 比例差;
  可.sort((a, b) => 差(a, b) || a.进池.getTime() - b.进池.getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return 可[0]?.userId ?? null;
}

/**
 * 挑中 谁 的理由，给界面上的结果提示用（「为什么是他」）。和 挑接手人 用同一套筛法：
 * 这一条不算数时不看满没满（没填配额的照样不挑）；比例并列时说明是按进池先后给的
 */
export function 挑的理由(候选: 候选人[], 不参与: ReadonlySet<string>, 查满: boolean, 谁: string, 不限额 = false): string {
  const 可 = 可挑(候选, 不参与, 查满, 不限额);
  const 他 = 可.find((c) => c.userId === 谁);
  if (!他) return "";
  if (不限额) {
    const 并列 = 可.filter((c) => c.已分 === 他.已分).length;
    return 并列 > 1
      ? `本月已分最少（${他.已分} 条，和 ${并列 - 1} 人并列，先给最早进分配池的）；不设配额，不限额`
      : `本月已分最少（${他.已分} 条）；不设配额，不限额`;
  }
  const 并列 = 可.filter((c) => 比例差(c, 他) === 0).length;
  const 比 = `${他.已分}/${他.配额}`;
  const 理由 = 并列 > 1 ? `本月已分 / 配额比例最低（${比}，和 ${并列 - 1} 人并列，先给最早进分配池的）` : `本月已分 / 配额比例最低（${比}）`;
  return 查满 ? 理由 : `${理由}；这条不算数，不占配额`;
}

/** 能改「参与自动分配」开关的人（Q-12 默认）：老板、总管理员、销售管理；直属上级只能看 */
export function 能改参与(org: 组织, 我: { id: string; role: string }): boolean {
  if (我.role === "ADMIN") return true;
  const 类们 = 管理员类别们of(org, 我.id);
  return 类们.has("总管理员") || 类们.has("销售管理");
}

// —— 读库 ——

/** 查完再写 的事务里传 tx 进来，查的和写的落在同一个事务 */
type 库 = Pick<Prisma.TransactionClient, "entLeadAssign" | "entLeadQuota" | "entLeadQuotaBonus">;

/** 本月已经算进数的分配条数 */
export async function 本月已分(userId: string, 月 = 月份(), db: 库 = prisma): Promise<number> {
  return db.entLeadAssign.count({ where: { toUserId: userId, month: 月, counted: true } });
}

/**
 * 生效配额 = 设的每月配额 + 本月加的额（线索验证：最终判无效的线索给负责人本月 +1，lib/project/lead-verify.ts）。
 * 没设配额 = null，加额不起作用：手动分本来不限、自动分配本来不挑他
 */
export const 生效配额 = (基: number | null, 加: number): number | null => (基 === null ? null : 基 + 加);

/** 本月加了几条额：按 月份() 那一格存，下个月是新的一格 = 每月清零 */
export async function 本月加额(userId: string, 月 = 月份(), db: Pick<库, "entLeadQuotaBonus"> = prisma): Promise<number> {
  return (await db.entLeadQuotaBonus.findUnique({ where: { userId_month: { userId, month: 月 } } }))?.count ?? 0;
}

/** 一批人本月各加了几条额，没加的不在表里 */
export async function 本月加额们(ids: string[], 月 = 月份(), db: Pick<库, "entLeadQuotaBonus"> = prisma): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const 行 = await db.entLeadQuotaBonus.findMany({ where: { userId: { in: ids }, month: 月 } });
  return new Map(行.map((r) => [r.userId, r.count]));
}

/**
 * 给 userId 本月配额 +1（线索最终判无效时调）。没设配额的人不加，返回 false：
 * 他不参与自动分配、手动分也不限，加了没意义，还会让以后设配额的那个月凭空多出来
 */
export async function 加一条配额(db: Pick<库, "entLeadQuota" | "entLeadQuotaBonus">, userId: string, 月 = 月份()): Promise<boolean> {
  if (!(await db.entLeadQuota.findUnique({ where: { userId } }))) return false;
  await db.entLeadQuotaBonus.upsert({
    where: { userId_month: { userId, month: 月 } },
    create: { userId, month: 月, count: 1 },
    update: { count: { increment: 1 } },
  });
  return true;
}

/** 生效配额：设的配额 + 本月加的额；没设 = null */
export async function 配额of(userId: string, db: 库 = prisma, 月 = 月份()): Promise<number | null> {
  const 基 = (await db.entLeadQuota.findUnique({ where: { userId } }))?.quota ?? null;
  return 基 === null ? null : 生效配额(基, await 本月加额(userId, 月, db));
}

export type 分出去的线索 = {
  /** 老的线索表；企业版只用项目以后分的是项目，这里为空、看 projectId */
  leadId: string | null;
  /** 企业版「新线索」= 项目的线索阶段：分的是哪个项目 */
  projectId: string | null;
  name: string;
  status: string;
  convertedAt: string | null;
  /** 转成了哪个客户；线索删了或没转 = null */
  customerId: string | null;
  接手人: string;
  当前负责人: string | null;
  line: string | null;
  kind: string;
  分配时间: string;
};

/**
 * 我分出去的线索和它们现在的转化情况（10-24：「线索分出去以后，原来的市场人员仍能看到转化情况」）。
 * 我 = 分之前的负责人（fromUserId）或者点分配的人（byUserId）。同一条线索分了几次只留最近一次。
 *
 * 线索走不限定的那个连接：分出去以后线索在别人名下，「按组织架构看客户」开着时我按负责人是看不到它的；
 * 这里只取名称、状态、转化时间这几列，不带电话、邮箱。
 */
export async function 我分出去的(我: string, 最多 = 200): Promise<分出去的线索[]> {
  const 记录 = await prisma.entLeadAssign.findMany({
    where: { OR: [{ fromUserId: 我 }, { byUserId: 我 }] },
    orderBy: { createdAt: "desc" },
    take: 最多 * 2,
  });
  // 同一条（线索或项目）分了几次只留最近一次
  const 最近 = new Map<string, (typeof 记录)[number]>();
  for (const r of 记录) {
    const k = r.projectId ? `p:${r.projectId}` : r.leadId ? `l:${r.leadId}` : null;
    if (k && !最近.has(k)) 最近.set(k, r);
  }
  const 留 = [...最近.values()].slice(0, 最多);
  const leadIds = 留.flatMap((r) => (r.projectId || !r.leadId ? [] : [r.leadId]));
  const projectIds = 留.flatMap((r) => (r.projectId ? [r.projectId] : []));
  const [leads, projects] = await Promise.all([
    leadIds.length
      ? defaultClient.lead.findMany({
          where: { id: { in: leadIds } },
          select: { id: true, name: true, status: true, convertedAt: true, customerId: true, owner: { select: { name: true } } },
        })
      : [],
    projectIds.length
      ? defaultClient.project.findMany({
          // 不限定的连接不过软删扩展：回收站里的项目（P9）当删了，自己带上
          where: { id: { in: projectIds }, deletedAt: null, customer: { deletedAt: null } },
          select: { id: true, name: true, phase: true, node: true, result: true, customerId: true, ownerId: true, pooledAt: true },
        })
      : [],
  ]);
  const 线索 = new Map(leads.map((l) => [l.id, l]));
  const 项目 = new Map(projects.map((p) => [p.id, p]));
  const 人名 = new Map(
    (await defaultClient.user.findMany({
      where: { id: { in: [...new Set([...留.map((r) => r.toUserId), ...projects.map((p) => p.ownerId)])] } },
      select: { id: true, name: true },
    })).map((u) => [u.id, u.name]),
  );
  return 留.flatMap((r): 分出去的线索[] => {
    const 共 = { 接手人: 人名.get(r.toUserId) ?? "—", line: r.line, kind: r.kind, 分配时间: r.createdAt.toISOString() };
    if (r.projectId) {
      const p = 项目.get(r.projectId);
      if (!p) return []; // 项目被删了
      // 项目不单独记转商机的时间：转没转看状态那一栏（阶段 · 节点，或结局）
      return [{
        leadId: null,
        projectId: p.id,
        name: p.name,
        status: p.result ?? `${p.phase} · ${p.node}`,
        convertedAt: null,
        customerId: p.customerId,
        当前负责人: p.pooledAt ? "公海" : (人名.get(p.ownerId) ?? null),
        ...共,
      }];
    }
    const l = r.leadId ? 线索.get(r.leadId) : undefined;
    if (!l) return []; // 线索被删了
    return [{
      leadId: l.id,
      projectId: null,
      name: l.name,
      status: l.status,
      convertedAt: l.convertedAt?.toISOString() ?? null,
      customerId: l.customerId,
      当前负责人: l.owner?.name ?? null,
      ...共,
    }];
  });
}
