"use server";

/**
 * 企业版「交接中」（2026-10-26，测试清单 D10）：接手人确认 / 拒收，发起人或总管理撤回，客户页顶上列出等确认的交接。
 * 发起见 projects/handover/actions.ts（离职交接，11-13 起交一位客户 / 交一个项目 / 全部交给都要接手人确认）和 customers/actions.ts assignSalesOwner（转让），
 * 规矩见 lib/enterprise/handover-db.ts。
 * 不是企业版一律什么都不做：列表回空，确认 / 撤回 / 拒收回错
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 进公海挂靠通知 } from "@/lib/enterprise/attach-approval";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 停用分拣, 停用方式们, type 停用方式 } from "@/lib/offboard-db";
import { 离职转给接手人, 离职放进公海 } from "@/lib/offboard-move";
import { 交接卡点 } from "@/lib/project/blocker";
import { 带走并记下在事务里 } from "@/lib/carry-over-db";
import { 持有上限起点, 整批核上限, 整批或不做 } from "@/lib/project/db";
import { 查完再写 } from "@/lib/check-then-write";
import { 客户有验证中线索 } from "@/lib/project/lead-verify-guard";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 权限组织 } from "@/lib/enterprise/org";
import { 算市场转客户 } from "@/lib/enterprise/market-transfer";
import { 待确认, 已作废, 了结, 读ids, 能撤回别人的交接, 离职范围of, type 交接种类 } from "@/lib/enterprise/handover-db";
import { 确认离职交接, 确认超上限尾, 留交接备注, 离职段, 能交接 } from "@/lib/enterprise/offboard-handover";
import { 公海分不给话 } from "@/lib/enterprise/permissions";
import { 移交作废天数, 移交作废说法 } from "@/lib/enterprise/handover-expire";
import { getBusiness } from "@/lib/business";
import { 交接通知, 同事待分配随客户通知 } from "@/lib/enterprise/notice-sources";
import { 不能当负责人 } from "@/lib/owners";
import { notify } from "@/lib/enterprise/notify";

export type 交接行 = {
  id: string;
  kind: 交接种类;
  从: string;
  给: string;
  发起人: string;
  /** 发起人转的是自己名下的（横幅不写两遍名字，11-03 C3-4） */
  自己的: boolean;
  /** 离职的「转交 / 公海」 */
  way: string | null;
  /** 企业版转让原因（字典「转让原因」，没选为空） */
  reason: string | null;
  个数: Record<string, number>;
  /** 确认框里那句：这笔确认后什么转给接手人、什么留下，和 确认交接 实际做的一致 */
  确认说明: string;
  /** 前几位客户的名字（接手人确认前要知道接的是谁）；客户总数另给 */
  客户: string[];
  客户总数: number;
  /**
   * 离职交接交的是什么（11-13）：「N 位客户：甲、乙」/「1 个项目：X」/「全部：N 位客户、M 个项目…」，横幅和确认框直接用；转让为空
   */
  离职说: string;
  createdAt: string;
  我能确认: boolean;
  我能撤回: boolean;
  /** 申请移交的发起人本人：可以改接手人（X-46 ⑥）；接手人 id 给下拉排除当前那位 */
  我能改接手人: boolean;
  接手人id: string;
  /** 待确认；系统作废的申请移交 =「已作废（超 7 天未处理）」，只给发起人看、没有可点的（11-10） */
  状态: string;
};

const 列几位 = 10;

function 读个数(s: string): Record<string, number> {
  try {
    const v = JSON.parse(s);
    if (!v || typeof v !== "object") return {};
    return Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number"));
  } catch {
    return {};
  }
}

/** 一次 in 查带多少个 id：SQLite 一句的参数个数有上限，客户多的交接分段查 */
const 每段 = 500;
async function 分段查<T>(ids: string[], 查: (段: string[]) => Promise<T[]>): Promise<T[]> {
  const 出: T[] = [];
  for (let i = 0; i < ids.length; i += 每段) 出.push(...(await 查(ids.slice(i, i + 每段))));
  return 出;
}

/**
 * 每笔待确认的转让，确认那一刻会一起转来几个项目（「全部 N 个项目（含 M 个同事在推的…）」那半句）。
 * 口径同原来逐笔调的 数转走的项目（carry-over-db.ts，企业版那一支）：只数此刻还归原负责人、不在公海的客户；
 * 线索公海里的 + 原负责人（客户挂占位账号的：进公海前负责人）自己的 + 同事占着待分配的，去掉已经归接手人的；另加同事在推的。
 * 原来每笔查一轮、每位客户再查一条进公海记录，客户页每次加载都调（代码体检 5.2 N+1 第 2 条）：
 * 改成所有笔的客户、进公海记录、项目各一次 in 查，内存里按笔分，查库次数不随笔数、客户数涨。在 看全部 里调
 */
async function 转让项目句(行: { id: string; fromUserId: string; toUserId: string; customerIds: string }[]): Promise<Map<string, string>> {
  const 句 = new Map<string, string>(行.map((h) => [h.id, "全部项目"]));
  const 全部 = [...new Set(行.flatMap((h) => 读ids(h.customerIds)))];
  if (!全部.length) return 句;
  const 负责人 = new Map((await 分段查(全部, (段) => prisma.customer.findMany({ where: { id: { in: 段 }, pool: null }, select: { id: true, salesOwnerId: true } }))).map((c) => [c.id, c.salesOwnerId]));
  // 接手人就是原负责人的不用数（没有换人的）
  const 每笔 = 行.map((h) => ({ h, 还归他: h.fromUserId === h.toUserId ? [] : [...new Set(读ids(h.customerIds))].filter((id) => 负责人.get(id) === h.fromUserId) }));
  const 要数 = [...new Set(每笔.flatMap((x) => x.还归他))];
  if (!要数.length) return 句;
  // 进公海前负责人（同 公海前负责人）：最近一条「换到现负责人」的进公海记录的 from，没有就是现负责人
  const 进公海前 = new Map<string, string | null>();
  const 记录 = await 分段查(要数, (段) => prisma.customerOwnerLog.findMany({
    where: { customerId: { in: 段 }, kind: "pool-release" },
    orderBy: [{ at: "desc" }, { id: "desc" }],
    select: { customerId: true, toOwnerId: true, fromOwnerId: true, at: true, id: true },
  }));
  // 分段查出来的各段各自有序，合起来再排一遍，保证每位取到的是最近那条
  记录.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  for (const r of 记录) if (!进公海前.has(`${r.customerId}|${r.toOwnerId}`)) 进公海前.set(`${r.customerId}|${r.toOwnerId}`, r.fromOwnerId);
  const 项目 = new Map<string, { ownerId: string; pooledAt: Date | null; awaitAssignAt: Date | null; result: string | null }[]>();
  for (const p of await 分段查(要数, (段) => prisma.project.findMany({ where: { customerId: { in: 段 } }, select: { customerId: true, ownerId: true, pooledAt: true, awaitAssignAt: true, result: true } }))) {
    const 组 = 项目.get(p.customerId);
    if (组) 组.push(p);
    else 项目.set(p.customerId, [p]);
  }
  for (const { h, 还归他 } of 每笔) {
    let 列名的 = 0, 同事的 = 0;
    for (const c of 还归他) {
      const 主人 = 进公海前.get(`${c}|${h.fromUserId}`) ?? h.fromUserId;
      for (const p of 项目.get(c) ?? []) {
        if (p.ownerId !== h.toUserId && (p.pooledAt || p.ownerId === 主人 || p.awaitAssignAt)) 列名的++;
        // 同 同事在推的项目（carry-over-db.ts）
        if (!p.pooledAt && !p.awaitAssignAt && p.result === null && p.ownerId !== 主人 && p.ownerId !== h.toUserId && p.ownerId !== "") 同事的++;
      }
    }
    const 项目数 = 列名的 + 同事的;
    if (项目数) 句.set(h.id, `全部 ${项目数} 个项目${同事的 ? `（含 ${同事的} 个同事在推的，负责人一起改成你）` : ""}`);
  }
  return 句;
}

/**
 * 客户页顶上那条：等我确认的 + 我发起、还没确认的（管理员看全部还没确认的）。
 * 我发起的申请移交被系统作废了的（挂满 7 天没人处理）也列在「我发起的」里，状态「已作废（超 7 天未处理）」，作废后留 7 天
 */
export async function 待确认的交接(): Promise<{ 等我确认: 交接行[]; 我发起的: 交接行[] }> {
  const me = await requireUser();
  if (!企业版()) return { 等我确认: [], 我发起的: [] };
  // 看全部还没确认的：总管理（11-01 只认业务角色，同 能撤回别人的交接）
  const 管 = await 能撤回别人的交接(me);
  const org = await 权限组织();
  // 看全部：交接里的客户还不归接手人，限定着查他一个名字都拿不到
  return 看全部(async () => {
    const 作废的 = { status: 已作废, byUserId: me.id, doneAt: { gte: new Date(Date.now() - 移交作废天数 * 24 * 3_600_000) } };
    // 等我确认的单独按接手人查、不设上限（11-13 审查：全库待确认多了，接手人自己的那笔不能被前 50 条挤掉）
    const 给我的 = await prisma.entHandover.findMany({ where: { status: 待确认, toUserId: me.id }, orderBy: { createdAt: "desc" } });
    const 其余 = await prisma.entHandover.findMany({
      // 管理员看全部还没确认的；别人只看自己发起的（OR 里放空对象 Prisma 不当「全部」，分开写）；给我的上面已经取了
      where: { OR: [管 ? { status: 待确认, toUserId: { not: me.id } } : { status: 待确认, toUserId: { not: me.id }, byUserId: me.id }, 作废的] },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const 行 = [...给我的, ...其余.filter((h) => !(h.status === 待确认 && h.toUserId === me.id))];
    if (!行.length) return { 等我确认: [], 我发起的: [] };
    // 离职交接：发起人这条路还得此刻还管这位离职成员（换了上级的不能再撤回、改人），总管理不受限
    const 还管 = new Set<string>();
    if (!管) for (const from of new Set(行.filter((h) => h.kind === "离职" && h.byUserId === me.id && h.status === 待确认).map((h) => h.fromUserId))) if (await 能交接(me, from)) 还管.add(from);
    const 离职能管 = (h: (typeof 行)[number]) => 管 || (h.byUserId === me.id && 还管.has(h.fromUserId));
    const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(行.flatMap((h) => [h.fromUserId, h.toUserId, h.byUserId]))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 前几位 = 行.flatMap((h) => 读ids(h.customerIds).slice(0, 列几位));
    const 名 = new Map((await 分段查(前几位, (段) => prisma.customer.findMany({ where: { id: { in: 段 } }, select: { id: true, name: true } }))).map((c) => [c.id, c.name]));
    // 转让：确认那一刻会一起转来的项目，按此刻的数据数（同 确认交接：还归原负责人、不在公海的才转）；同事在推的只给个数（P-转-07、X-49）
    const 项目句 = await 转让项目句(行.filter((h) => h.kind === "转让"));
    // 离职单条交项目：项目名（看板上交的是挂在别人客户上的项目，接手人要知道是哪个）
    const 项目ids = 行.filter((h) => h.kind === "离职").flatMap((h) => 读ids(h.projectIds).slice(0, 列几位));
    const 项目名 = new Map((await 分段查(项目ids, (段) => prisma.project.findMany({ where: { id: { in: 段 } }, select: { id: true, name: true } }))).map((p) => [p.id, p.name]));
    const 成行 = (h: (typeof 行)[number]): 交接行 => {
      const ids = 读ids(h.customerIds);
      const 等 = h.status === 待确认;
      return {
        id: h.id, kind: h.kind as 交接种类, way: h.way, reason: h.reason,
        从: 人.get(h.fromUserId) ?? "（已删除的成员）", 给: 人.get(h.toUserId) ?? "（已删除的成员）", 发起人: 人.get(h.byUserId) ?? "（已删除的成员）",
        自己的: h.fromUserId === h.byUserId,
        // 转让里市场转给销售的待办、计划不搬（P-转-10）；离职和别的转让都带走。确认时只转不在公海的，这里同样按不在公海判。
        // 转让：名下全部项目都转（同事在推的、待分配的一起，P-转-07 Even 口径）；离职：在职同事负责的不动（P-转-14）
        确认说明: h.kind !== "转让"
          ? 离职确认说明(离职范围of(h.way))
          : org && 算市场转客户(org, { salesOwnerId: h.fromUserId, pool: null }, h.toUserId)
            ? `确认后这些客户和名下的联系人、沟通记录、${项目句.get(h.id)}，都转到你名下；原负责人没做完的待办和计划不转过来，你也能看到。`
            : `确认后这些客户和名下的联系人、沟通记录、${项目句.get(h.id)}，连同原负责人没做完的待办和计划，都转到你名下。`,
        个数: 读个数(h.counts), 客户: ids.slice(0, 列几位).map((id) => 名.get(id)).filter((x): x is string => !!x), 客户总数: ids.length,
        离职说: h.kind === "离职" ? 离职说(h, 名, 项目名) : "",
        createdAt: h.createdAt.toISOString(),
        我能确认: 等 && h.toUserId === me.id, 我能撤回: 等 && (h.kind === "离职" ? 离职能管(h) : h.byUserId === me.id || 管),
        // 申请移交：发起人本人；离职交接：发起人或总管理（11-13）
        我能改接手人: 等 && (h.kind === "转让" ? h.byUserId === me.id && h.fromUserId === me.id : 离职能管(h)), 接手人id: h.toUserId,
        状态: 等 ? 待确认 : 移交作废说法,
      };
    };
    return { 等我确认: 行.filter((h) => h.status === 待确认 && h.toUserId === me.id).map(成行), 我发起的: 行.filter((h) => h.status !== 待确认 || h.toUserId !== me.id).map(成行) };
  });
}

/** 离职交接确认框里那句：确认后什么转给接手人（和 确认离职交接 实际做的一致） */
function 离职确认说明(范围: ReturnType<typeof 离职范围of>): string {
  if (范围 === "客户") return "确认后这位客户和名下的联系人、沟通记录，连同原负责人自己负责的项目、没做完的待办和计划，都转到你名下；同事负责的项目负责人不变（待分配的一起转给你）。客户备注里会留一行交接记录。";
  if (范围 === "项目") return "确认后这个项目的负责人改成你，卡点认领跟着转；客户负责人不变。";
  return "确认后原负责人名下的客户（连同联系人、沟通记录、他自己负责的项目、没做完的待办和计划）、线索、渠道都转到你名下；同事负责的项目负责人不变（待分配的一起转给你）。客户备注里会留一行交接记录。";
}

/** 离职交接交的是什么：「1 位客户：甲」「1 个项目：X」「全部：3 位客户、2 个项目」 */
function 离职说(h: { way: string | null; counts: string; customerIds: string; projectIds: string }, 客户名: Map<string, string>, 项目名: Map<string, string>): string {
  const 范围 = 离职范围of(h.way);
  const 列 = (ids: string[], 名: Map<string, string>) => {
    const 们 = ids.slice(0, 列几位).map((id) => 名.get(id)).filter((x): x is string => !!x);
    return 们.length ? `：${们.join("、")}${ids.length > 们.length ? ` 等 ${ids.length} 个` : ""}` : "";
  };
  if (范围 === "客户") { const ids = 读ids(h.customerIds); return `${ids.length} 位客户${列(ids, 客户名)}`; }
  if (范围 === "项目") { const ids = 读ids(h.projectIds); return `${ids.length} 个项目${列(ids, 项目名)}`; }
  return `全部（${离职段(读个数(h.counts)) || "名下剩下的"}）`;
}

type 结果 = { ok: true; 客户: number; 说?: string } | { ok: false; error: string };
const 已处理 = "这笔交接已经处理过了（被确认、撤回或拒收），刷新看看";

function 刷新() {
  revalidatePath("/customers");
  revalidatePath("/projects");
  revalidatePath("/settings");
}

/**
 * 确认了超持有上限（M-公海-18，11-09 拦；11-11 起核和转在同一个事务里）：交接回滚成待确认，那句话的后半句。
 * 拦的范围照旧：离职 = 此刻分拣给接手人的、转让 = 此刻还归原负责人的客户一起带过来的（他自己的、线索公海里的、同事待分配的、同事在推的），
 * 都是真转进接手人手上的，所以写完再数（整批核上限）就是原来事务外先数的那个数
 */

/**
 * 接手人确认：到这时才真转。离职按此刻重新分拣（发起之后他名下又多出、少了的都对得上），给接手人的那半照离职老规矩转；
 * 转让只转此刻还归原负责人的（中间被人改给了别人的不动），名下的活照老规矩一起走（项目连同事在推的一起转，P-转-07）。
 * 「待确认 → 已确认」带着条件改，和撤回、拒收同时点只成一个
 */
export async function 确认交接(id: string): Promise<结果> {
  const me = await requireUser();
  if (!企业版() || typeof id !== "string" || !id) return { ok: false, error: 已处理 };
  const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id } }));
  if (!h || h.status !== 待确认) return { ok: false, error: 已处理 };
  if (h.toUserId !== me.id) return { ok: false, error: "只有接手人自己能确认" };
  // 离职交接：接手人此刻还得能接（发起之后被停用、摘了业务角色、改成只读的，确认不了），同看板发起时那道闸；交接留在待确认
  if (h.kind === "离职") {
    const 不行 = (await prisma.user.findUnique({ where: { id: me.id }, select: { active: true } }))?.active === false
      ? "该成员已停用"
      : 公海分不给话(me, await 权限组织(), me.id);
    if (不行) return { ok: false, error: `你现在接不了这笔离职交接（${不行}）；交接还在等确认，请发起人改接手人或撤回` };
  }
  const b = await getBusiness();
  // 规则、组织在事务外读（事务占着库的唯一连接，事务里读设置会等到超时）
  const 规则 = await 生效组织规则();
  await 钉住老签约();

  // 11-13 起「项目 → 离职交接」发起的（交一位客户 / 交一个项目 / 全部交给）：照当场交的老规矩转，转不了的跳过并说清
  if (h.kind === "离职" && ["客户", "项目", "全部"].includes(h.way ?? "")) {
    const 整批 = await 整批或不做(() => 确认离职交接(me, h));
    if (!整批.ok) return { ok: false, error: 整批.超 };
    if (!整批.值) return { ok: false, error: 已处理 };
    const r = 整批.值;
    const 从 = (await prisma.user.findUnique({ where: { id: h.fromUserId }, select: { name: true } }))?.name ?? h.fromUserId;
    await recordAudit({
      user: me, action: "handover", entity: "User", entityId: h.fromUserId,
      summary: `确认接手离职成员「${从}」的交接：${r.段 || "没有转成的"}` + (r.跳过 ? `（${r.跳过}在交接期间已放回公海、换了人或结束了，没转）` : ""),
      detail: { 交接: h.id, way: h.way, from: h.fromUserId, to: me.id, 发起人: h.byUserId, 客户: r.客户, 项目: r.项目, 跳过: r.跳过, ...(r.分 ? { 待办: r.分.待办.length, 计划: r.分.计划.length, 线索: r.分.线索.length, 渠道: r.分.渠道.length, 主渠道: r.分.主渠道.length } : {}) },
    });
    await 交接通知(me, h.id, "已确认", undefined, r.客户, { 段: r.段, 跳过: r.跳过 });
    刷新();
    revalidatePath("/projects/handover");
    const 说 = r.段 ? `已接手 ${r.段}` : "这笔交接里的都在交接期间已被处理（放回公海、换了人或结束了），没有转到你名下";
    return { ok: true, 客户: r.客户.length, 说: r.段 && r.跳过 ? `${说}；另有 ${r.跳过}在交接期间已被处理，没转` : 说 };
  }

  if (h.kind === "离职") {
    const 方式: 停用方式 = (停用方式们 as readonly string[]).includes(h.way ?? "") ? (h.way as 停用方式) : "转交";
    const 记分配 = await 规则开着("线索分配");
    // 持有上限和转在同一个事务里（M-公海-18）：先记下接手人名下原有几个，全部转完再数，超了抛错整笔回滚，交接还是待确认
    const 整批 = await 整批或不做(() => 看全部(() => 查完再写(async (tx) => {
      if (!(await 了结(tx, h.id, "已确认", me))) return null;
      const 起 = await 持有上限起点(tx, 规则, me.id);
      const 分 = await 停用分拣(tx, h.fromUserId, 方式, true);
      const 项目 = await 离职转给接手人(tx, 分, h.fromUserId, me.id, h.byUserId, 记分配);
      // 发起到确认之间又该进公海的（方式 = 公海），这时一起放
      await 离职放进公海(tx, 分, h.byUserId);
      // 企业版卡点：确认了才跟着转给接手人；项目在公海里的回看板
      await 交接卡点(tx, h.fromUserId, me.id, h.byUserId, 分.进公海项目);
      await 整批核上限(tx, 起, "交接", 确认超上限尾);
      // 老行确认也在客户备注留一行（客户 11-13：别「悄悄转过去没人知道」）
      await 留交接备注(tx, 分.客户, h.fromUserId, me.id, h.byUserId);
      return { 分, 项目 };
    }, { timeout: 30_000 })));
    if (!整批.ok) return { ok: false, error: 整批.超 };
    if (!整批.值) return { ok: false, error: 已处理 };
    const { 分, 项目 } = 整批.值;
    await 进公海挂靠通知(分.进公海客户); // 进公海关掉的挂靠申请，事务提交了再通知申请人（P-挂靠-01 / 02）
    const 从 = (await prisma.user.findUnique({ where: { id: h.fromUserId }, select: { name: true } }))?.name ?? h.fromUserId;
    await recordAudit({
      user: me, action: "deactivate", entity: "User", entityId: h.fromUserId,
      summary: `确认接手离职成员「${从}」的交接：${分.客户.length} 位${b.customer}、${分.商机.length} 个进行中商机、` +
        `${分.计划.length + 分.待办.length} 条没完成的计划和待办、${分.线索.length} 条线索、${分.渠道.length} 个渠道` + (项目.length ? `、${项目.length} 个项目` : ""),
      detail: { 交接: h.id, userId: h.fromUserId, transferToId: me.id, 方式, 客户: 分.客户, 商机: 分.商机, 待办: 分.待办, 计划: 分.计划, 线索: 分.线索, 渠道: 分.渠道, 项目, 进公海客户: 分.进公海客户, 进公海项目: 分.进公海项目 },
    });
    await 交接通知(me, h.id, "已确认", undefined, 分.客户);
    刷新();
    return { ok: true, 客户: 分.客户.length };
  }

  const ids = 读ids(h.customerIds);
  // 发起之后名下线索进了验证（X-77）：先不确认，验证走完或撤回验证再来；交接留在待确认
  const 验 = await 客户有验证中线索(prisma, (await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids }, salesOwnerId: h.fromUserId }, select: { id: true } }))).map((c) => c.id));
  if (验) return { ok: false, error: 验 };
  const org = await 权限组织();
  // 改客户负责人、名下的活和项目跟着走、核持有上限，一个事务做完（M-公海-18，11-11）：超了整笔回滚，交接还是待确认、什么都没转
  const 整批 = await 整批或不做(() => 看全部(() => 查完再写(async (tx) => {
    if (!(await 了结(tx, h.id, "已确认", me))) return null;
    const 起 = await 持有上限起点(tx, 规则, me.id);
    // 交接期间进了公海的不转（11-03 完成度 C3-2）：转了负责人是接手人、人却在公海里，他看不到也领不到
    const 还归他 = (await tx.customer.findMany({ where: { id: { in: ids }, salesOwnerId: h.fromUserId, pool: null }, select: { id: true } })).map((c) => c.id);
    if (还归他.length) await tx.customer.updateMany({ where: { id: { in: 还归他 } }, data: { salesOwnerId: me.id } });
    // 名下的活、项目跟着走，每位记一行换负责人（操作人记发起的那位：是他定的转给谁）
    const 带 = await 带走并记下在事务里(tx, 还归他.map((customerId) => ({ customerId, 旧: h.fromUserId })), me.id, h.byUserId, "assign", org);
    await 整批核上限(tx, 起, "交接", 确认超上限尾);
    return { 换: 还归他, 带 };
  }, { timeout: 30_000 })));
  if (!整批.ok) return { ok: false, error: 整批.超 };
  if (!整批.值) return { ok: false, error: 已处理 };
  const { 换, 带: { 数, 记下, 没转成, 留下, 同事待分配 } } = 整批.值;
  // 转客户带走了同事的项目（待分配的、在推的）：事务提交了才告诉这位同事（P-转-19）
  if (同事待分配.length) await 同事待分配随客户通知(h.byUserId, me.id, 同事待分配);
  // 确认后又被别人改走的不算接手（带走并记下 什么都没动）
  const 转成了 = 换.filter((id) => !没转成.includes(id));
  const 从 = (await prisma.user.findUnique({ where: { id: h.fromUserId }, select: { name: true } }))?.name ?? h.fromUserId;
  await recordAudit({
    user: me, action: "assign", entity: "Customer",
    summary: `确认接手「${从}」转来的 ${转成了.length} 名${b.customer}，销售负责人改为「${me.name}」` + (ids.length > 转成了.length ? `（${ids.length - 转成了.length} 名在交接期间已换了人或进了公海，没动）` : ""),
    detail: { 交接: h.id, ids: 转成了, salesOwnerId: me.id, 原负责人: 转成了.map((id) => ({ id, salesOwnerId: h.fromUserId })), 带走: 数, 带过来: 记下 },
  });
  await 交接通知(me, h.id, "已确认", 留下, 转成了);
  刷新();
  return { ok: true, 客户: 转成了.length };
}

/** 发起人或总管理撤回：什么都不转，数据留在原负责人名下。离职的成员仍是停用的（要换接手人就再办一次离职，或恢复成员） */
export async function 撤回交接(id: string): Promise<结果> {
  const me = await requireUser();
  const 别人的也能撤 = await 能撤回别人的交接(me);
  return 了结一笔(me, id, "已撤回", async (h) => {
    if (h.kind === "离职") return 离职不能管(me, h);
    return h.byUserId === me.id || 别人的也能撤 ? null : "只有发起人或总管理能撤回";
  });
}

/**
 * 离职交接的撤回、改接手人谁能做（11-13）：总管理都能；发起人还得此刻还管这位离职成员（能交接：仍是他手填的直属上级、或是系统管理员），
 * 换了上级、被改成只读的不能再动。能 = null，不能 = 那句话（说「撤回」，改接手人那边换词）
 */
async function 离职不能管(me: Awaited<ReturnType<typeof requireUser>>, h: { byUserId: string; fromUserId: string }): Promise<string | null> {
  if (await 能撤回别人的交接(me)) return null;
  if (h.byUserId !== me.id) return "只有发起人或总管理能撤回";
  return (await 能交接(me, h.fromUserId)) ? null : "你现在已经不管这位离职成员了（不是 TA 的直属上级），不能撤回；请找总管理";
}

/** 接手人拒收：同撤回，数据留在原负责人名下，发起人看操作日志知道被拒了 */
export async function 拒收交接(id: string): Promise<结果> {
  const me = await requireUser();
  return 了结一笔(me, id, "已拒收", (h) => (h.toUserId === me.id ? null : "只有接手人自己能拒收"));
}

/**
 * 申请移交改接手人（X-46 ⑥）：负责人本人发起的申请移交还没确认时，发起人可以换一位接手人，申请接着等新接手人确认。
 * 只有发起人本人（= 原负责人）能改；管理发起的转让交接不在这里改（要换就撤回重发）。
 * 新接手人同发起时的闸：在职、有业务角色、不是只读管理员，不能是自己、不能是原接手人。
 * 离职交接（11-13）：发起人或总管理能改；新接手人同离职交接看板的闸（公海分不给话），不能是离职的那位
 * 带着 status、toUserId 条件改，和接手人同时确认 / 拒收只成一个。原接手人那条「等你确认」标已读并告诉他不用管了，新接手人收「等你确认」
 */
export async function 改接手人(id: string, toUserId: string): Promise<结果> {
  const me = await requireUser();
  if (!企业版() || typeof id !== "string" || !id || typeof toUserId !== "string" || !toUserId) return { ok: false, error: 已处理 };
  const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id } }));
  if (!h || h.status !== 待确认) return { ok: false, error: 已处理 };
  const 离职 = h.kind === "离职";
  if (离职) {
    const 不能管 = await 离职不能管(me, h);
    if (不能管) return { ok: false, error: 不能管.replace("撤回", "改接手人") };
  } else if (h.kind !== "转让" || h.byUserId !== me.id || h.fromUserId !== me.id) return { ok: false, error: "只有发起申请移交的负责人本人能改接手人" };
  if (toUserId === h.toUserId) return { ok: false, error: "接手人没变" };
  if (离职 && toUserId === h.fromUserId) return { ok: false, error: "不能交回给离职的成员" };
  if (!离职 && toUserId === me.id) return { ok: false, error: "不能改成自己；不想移交了就撤回申请" };
  const 新 = await prisma.user.findUnique({ where: { id: toUserId }, select: { name: true, active: true } });
  if (!新?.active) return { ok: false, error: "该成员不存在或已停用，请选择一位在职成员" };
  const 不行 = 离职 ? await 公海分不给话(me, await 权限组织(), toUserId) : await 不能当负责人(toUserId);
  if (不行) return { ok: false, error: 不行 };
  const r = await 看全部(() => prisma.entHandover.updateMany({ where: { id, status: 待确认, toUserId: h.toUserId, ...(离职 ? {} : { byUserId: me.id }) }, data: { toUserId } }));
  if (r.count !== 1) return { ok: false, error: 已处理 };
  const 原 = await prisma.user.findUnique({ where: { id: h.toUserId }, select: { name: true } });
  const n = 读ids(h.customerIds).length;
  await recordAudit({
    user: me, action: "assign", entity: "Customer", entityId: null,
    ...(离职 ? { action: "handover", entity: "User", entityId: h.fromUserId } : {}),
    summary: 离职
      ? `把离职交接的接手人从「${原?.name ?? h.toUserId}」改成「${新.name}」，等对方确认`
      : `把移交申请（${n} 位客户）的接手人从「${原?.name ?? h.toUserId}」改成「${新.name}」，等对方确认`,
    detail: { 交接: h.id, 改接手人: true, 原接手人: h.toUserId, toUserId, 客户: 读ids(h.customerIds), ...(离职 ? { 项目: 读ids(h.projectIds) } : {}) },
  });
  // 原接手人：「等你确认」标已读，再说一句不用管了（key 带时间：来回改也每次都说）
  await prisma.entNotice.updateMany({ where: { userId: h.toUserId, dedupeKey: `handover:${h.id}:发起`, readAt: null }, data: { readAt: new Date() } });
  await notify([h.toUserId], { kind: "交接", title: 离职 ? `${me.name} 把离职交接改给了别人，不用确认了` : `${me.name} 把移交申请改给了别人，不用确认了`, link: "/customers", key: `handover:${h.id}:改走:${Date.now()}` });
  // 新接手人：改回以前收过「等你确认」的那位，把那条重新标未读（唯一键挡着不会再记一条）
  await prisma.entNotice.updateMany({ where: { userId: toUserId, dedupeKey: `handover:${h.id}:发起` }, data: { readAt: null } });
  await 交接通知(me, h.id, "发起");
  刷新();
  revalidatePath("/projects/handover");
  return { ok: true, 客户: 0 };
}

async function 了结一笔(
  me: Awaited<ReturnType<typeof requireUser>>,
  id: string,
  状态: "已撤回" | "已拒收",
  /** 能做 = null，不能 = 那句话 */
  不能: (h: { kind: string; byUserId: string; toUserId: string; fromUserId: string }) => string | null | Promise<string | null>,
): Promise<结果> {
  if (!企业版() || typeof id !== "string" || !id) return { ok: false, error: 已处理 };
  const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id } }));
  if (!h || h.status !== 待确认) return { ok: false, error: 已处理 };
  const 话 = await 不能(h);
  if (话) return { ok: false, error: 话 };
  if (!(await 看全部(() => 了结(prisma, h.id, 状态, me)))) return { ok: false, error: 已处理 };
  const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [h.fromUserId, h.toUserId] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const n = 读ids(h.customerIds).length;
  await recordAudit({
    user: me, action: h.kind === "离职" ? "deactivate" : "assign", entity: h.kind === "离职" ? "User" : "Customer", entityId: h.kind === "离职" ? h.fromUserId : null,
    summary: `${状态 === "已撤回" ? "撤回" : "拒收"}了「${人.get(h.fromUserId) ?? h.fromUserId}」交给「${人.get(h.toUserId) ?? h.toUserId}」的${h.kind}交接（${h.kind === "离职" ? 离职段(读个数(h.counts)) || "名下剩下的" : `${n} 位客户`}），数据留在原负责人名下`,
    detail: { 交接: h.id, kind: h.kind, 状态, fromUserId: h.fromUserId, toUserId: h.toUserId, 客户: 读ids(h.customerIds) },
  });
  await 交接通知(me, h.id, 状态);
  刷新();
  revalidatePath("/projects/handover");
  return { ok: true, 客户: 0 };
}
