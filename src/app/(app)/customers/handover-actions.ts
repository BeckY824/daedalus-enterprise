"use server";

/**
 * 企业版「交接中」（2026-10-26，测试清单 D10）：接手人确认 / 拒收，发起人或总管理撤回，客户页顶上列出等确认的交接。
 * 发起见 settings/actions.ts deactivateUser（离职）和 customers/actions.ts assignSalesOwner（转让），规矩见 lib/enterprise/handover-db.ts。
 * 不是企业版一律什么都不做：列表回空，确认 / 撤回 / 拒收回错
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 规则开着 } from "@/lib/enterprise/rules";
import { 停用分拣, 停用方式们, 离职进手的持有项目, type 停用方式 } from "@/lib/offboard-db";
import { 离职转给接手人, 离职放进公海 } from "@/lib/offboard-move";
import { 交接卡点 } from "@/lib/project/blocker";
import { 带走并记下, 数进手的持有项目, 数转走的项目 } from "@/lib/carry-over-db";
import { 超上限n } from "@/lib/project/db";
import { 客户有验证中线索 } from "@/lib/project/lead-verify-guard";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 权限组织 } from "@/lib/enterprise/org";
import { 算市场转客户 } from "@/lib/enterprise/market-transfer";
import { 待确认, 了结, 读ids, 能撤回别人的交接, type 交接种类 } from "@/lib/enterprise/handover-db";
import { getBusiness } from "@/lib/business";
import { 交接通知 } from "@/lib/enterprise/notice-sources";
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
  createdAt: string;
  我能确认: boolean;
  我能撤回: boolean;
  /** 申请移交的发起人本人：可以改接手人（X-46 ⑥）；接手人 id 给下拉排除当前那位 */
  我能改接手人: boolean;
  接手人id: string;
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

/** 客户页顶上那条：等我确认的 + 我发起、还没确认的（管理员看全部还没确认的） */
export async function 待确认的交接(): Promise<{ 等我确认: 交接行[]; 我发起的: 交接行[] }> {
  const me = await requireUser();
  if (!企业版()) return { 等我确认: [], 我发起的: [] };
  // 看全部还没确认的：总管理（11-01 只认业务角色，同 能撤回别人的交接）
  const 管 = await 能撤回别人的交接(me);
  const org = await 权限组织();
  // 看全部：交接里的客户还不归接手人，限定着查他一个名字都拿不到
  return 看全部(async () => {
    const 行 = await prisma.entHandover.findMany({
      // 管理员看全部还没确认的；别人只看给自己的、自己发起的（OR 里放空对象 Prisma 不当「全部」，分开写）
      where: 管 ? { status: 待确认 } : { status: 待确认, OR: [{ toUserId: me.id }, { byUserId: me.id }] },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    if (!行.length) return { 等我确认: [], 我发起的: [] };
    const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(行.flatMap((h) => [h.fromUserId, h.toUserId, h.byUserId]))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    const 前几位 = 行.flatMap((h) => 读ids(h.customerIds).slice(0, 列几位));
    const 名 = new Map((await prisma.customer.findMany({ where: { id: { in: 前几位 } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    // 转让：确认那一刻会一起转来的项目，按此刻的数据数（同 确认交接：还归原负责人、不在公海的才转）；同事在推的只给个数（P-转-07、X-49）
    const 项目句 = new Map<string, string>();
    for (const h of 行) {
      if (h.kind !== "转让") continue;
      const 还归他 = (await prisma.customer.findMany({ where: { id: { in: 读ids(h.customerIds) }, salesOwnerId: h.fromUserId, pool: null }, select: { id: true } })).map((c) => c.id);
      const 预 = await 数转走的项目(还归他, h.toUserId);
      项目句.set(h.id, !预.项目数 ? "全部项目" : `全部 ${预.项目数} 个项目${预.同事?.项目数 ? `（含 ${预.同事.项目数} 个同事在推的，负责人一起改成你）` : ""}`);
    }
    const 成行 = (h: (typeof 行)[number]): 交接行 => {
      const ids = 读ids(h.customerIds);
      return {
        id: h.id, kind: h.kind as 交接种类, way: h.way, reason: h.reason,
        从: 人.get(h.fromUserId) ?? "（已删除的成员）", 给: 人.get(h.toUserId) ?? "（已删除的成员）", 发起人: 人.get(h.byUserId) ?? "（已删除的成员）",
        自己的: h.fromUserId === h.byUserId,
        // 转让里市场转给销售的待办、计划不搬（P-转-10）；离职和别的转让都带走。确认时只转不在公海的，这里同样按不在公海判。
        // 转让：名下全部项目都转（同事在推的、待分配的一起，P-转-07 Even 口径）；离职：在职同事负责的不动（P-转-14）
        确认说明: h.kind !== "转让"
          ? "确认后这些客户和名下的联系人、沟通记录，连同原负责人自己负责的项目、没做完的待办和计划，都转到你名下；同事负责的项目负责人不变（待分配的一起转给你）。"
          : org && 算市场转客户(org, { salesOwnerId: h.fromUserId, pool: null }, h.toUserId)
            ? `确认后这些客户和名下的联系人、沟通记录、${项目句.get(h.id)}，都转到你名下；原负责人没做完的待办和计划不转过来，你也能看到。`
            : `确认后这些客户和名下的联系人、沟通记录、${项目句.get(h.id)}，连同原负责人没做完的待办和计划，都转到你名下。`,
        个数: 读个数(h.counts), 客户: ids.slice(0, 列几位).map((id) => 名.get(id)).filter((x): x is string => !!x), 客户总数: ids.length,
        createdAt: h.createdAt.toISOString(),
        我能确认: h.toUserId === me.id, 我能撤回: h.byUserId === me.id || 管,
        我能改接手人: h.kind === "转让" && h.byUserId === me.id && h.fromUserId === me.id, 接手人id: h.toUserId,
      };
    };
    return { 等我确认: 行.filter((h) => h.toUserId === me.id).map(成行), 我发起的: 行.filter((h) => h.toUserId !== me.id).map(成行) };
  });
}

type 结果 = { ok: true; 客户: number } | { ok: false; error: string };
const 已处理 = "这笔交接已经处理过了（被确认、撤回或拒收），刷新看看";

function 刷新() {
  revalidatePath("/customers");
  revalidatePath("/projects");
  revalidatePath("/settings");
}

/**
 * 确认了会一次进好几个算持有的项目（M-公海-18，11-09）：加上手上已有的超了持有上限就不让确认，交接还是待确认，
 * 回一句说清谁、上限、现有几个（推进或放回一些再确认，或让发起人撤回换人）。在事务外按此刻的数据先数一遍：
 *   离职：此刻重新分拣给接手人的项目里，算持有的（他自己的、挂在别处的；同事待分配的清了也算）；
 *   转让：此刻还归原负责人、不在公海的客户会一起带过来的（他自己的、线索公海里的、同事待分配的、同事在推的），同 带走并记下
 */
async function 确认了超上限(h: { kind: string; way: string | null; fromUserId: string; customerIds: string }, 接手人: string): Promise<string | null> {
  let 进 = 0;
  if (h.kind === "离职") {
    const 方式: 停用方式 = (停用方式们 as readonly string[]).includes(h.way ?? "") ? (h.way as 停用方式) : "转交";
    进 = await 看全部(() => 离职进手的持有项目(prisma, h.fromUserId, 方式, 接手人));
  } else {
    const 还归他 = (await 看全部(() => prisma.customer.findMany({ where: { id: { in: 读ids(h.customerIds) }, salesOwnerId: h.fromUserId, pool: null }, select: { id: true } }))).map((c) => c.id);
    进 = await 数进手的持有项目(还归他, 接手人, { 公海: true, 自己的: true, 同事待分配: true, 同事在推: true });
  }
  return 进 ? 超上限n(prisma, await 生效组织规则(), 接手人, 进) : null;
}

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
  const 超 = await 确认了超上限(h, me.id);
  if (超) return { ok: false, error: 超 };
  const b = await getBusiness();
  await 钉住老签约();

  if (h.kind === "离职") {
    const 方式: 停用方式 = (停用方式们 as readonly string[]).includes(h.way ?? "") ? (h.way as 停用方式) : "转交";
    const 记分配 = await 规则开着("线索分配");
    const 成 = await 看全部(() => prisma.$transaction(async (tx) => {
      if (!(await 了结(tx, h.id, "已确认", me))) return null;
      const 分 = await 停用分拣(tx, h.fromUserId, 方式, true);
      const 项目 = await 离职转给接手人(tx, 分, h.fromUserId, me.id, h.byUserId, 记分配);
      // 发起到确认之间又该进公海的（方式 = 公海），这时一起放
      await 离职放进公海(tx, 分, h.byUserId);
      // 企业版卡点：确认了才跟着转给接手人；项目在公海里的回看板
      await 交接卡点(tx, h.fromUserId, me.id, h.byUserId, 分.进公海项目);
      return { 分, 项目 };
    }, { timeout: 30_000 }));
    if (!成) return { ok: false, error: 已处理 };
    const { 分, 项目 } = 成;
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
  const 换 = await 看全部(() => prisma.$transaction(async (tx) => {
    if (!(await 了结(tx, h.id, "已确认", me))) return null;
    // 交接期间进了公海的不转（11-03 完成度 C3-2）：转了负责人是接手人、人却在公海里，他看不到也领不到
    const 还归他 = (await tx.customer.findMany({ where: { id: { in: ids }, salesOwnerId: h.fromUserId, pool: null }, select: { id: true } })).map((c) => c.id);
    if (还归他.length) await tx.customer.updateMany({ where: { id: { in: 还归他 } }, data: { salesOwnerId: me.id } });
    return 还归他;
  }));
  if (!换) return { ok: false, error: 已处理 };
  // 名下的活、项目跟着走，每位记一行换负责人（操作人记发起的那位：是他定的转给谁）
  const { 数, 记下, 没转成, 留下 } = await 带走并记下(换.map((customerId) => ({ customerId, 旧: h.fromUserId })), me.id, h.byUserId);
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
  return 了结一笔(me, id, "已撤回", (h) => h.byUserId === me.id || 别人的也能撤, "只有发起人或总管理能撤回");
}

/** 接手人拒收：同撤回，数据留在原负责人名下，发起人看操作日志知道被拒了 */
export async function 拒收交接(id: string): Promise<结果> {
  const me = await requireUser();
  return 了结一笔(me, id, "已拒收", (h) => h.toUserId === me.id, "只有接手人自己能拒收");
}

/**
 * 申请移交改接手人（X-46 ⑥）：负责人本人发起的申请移交还没确认时，发起人可以换一位接手人，申请接着等新接手人确认。
 * 只有发起人本人（= 原负责人）能改；管理发起的交接、离职交接不在这里改（要换就撤回重发）。
 * 新接手人同发起时的闸：在职、有业务角色、不是只读管理员，不能是自己、不能是原接手人。
 * 带着 status、toUserId 条件改，和接手人同时确认 / 拒收只成一个。原接手人那条「等你确认」标已读并告诉他不用管了，新接手人收「等你确认」
 */
export async function 改接手人(id: string, toUserId: string): Promise<结果> {
  const me = await requireUser();
  if (!企业版() || typeof id !== "string" || !id || typeof toUserId !== "string" || !toUserId) return { ok: false, error: 已处理 };
  const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id } }));
  if (!h || h.status !== 待确认) return { ok: false, error: 已处理 };
  if (h.kind !== "转让" || h.byUserId !== me.id || h.fromUserId !== me.id) return { ok: false, error: "只有发起申请移交的负责人本人能改接手人" };
  if (toUserId === h.toUserId) return { ok: false, error: "接手人没变" };
  if (toUserId === me.id) return { ok: false, error: "不能改成自己；不想移交了就撤回申请" };
  const 新 = await prisma.user.findUnique({ where: { id: toUserId }, select: { name: true, active: true } });
  if (!新?.active) return { ok: false, error: "该成员不存在或已停用，请选择一位在职成员" };
  const 不行 = await 不能当负责人(toUserId);
  if (不行) return { ok: false, error: 不行 };
  const r = await 看全部(() => prisma.entHandover.updateMany({ where: { id, status: 待确认, toUserId: h.toUserId, byUserId: me.id }, data: { toUserId } }));
  if (r.count !== 1) return { ok: false, error: 已处理 };
  const 原 = await prisma.user.findUnique({ where: { id: h.toUserId }, select: { name: true } });
  const n = 读ids(h.customerIds).length;
  await recordAudit({
    user: me, action: "assign", entity: "Customer", entityId: null,
    summary: `把移交申请（${n} 位客户）的接手人从「${原?.name ?? h.toUserId}」改成「${新.name}」，等对方确认`,
    detail: { 交接: h.id, 改接手人: true, 原接手人: h.toUserId, toUserId, 客户: 读ids(h.customerIds) },
  });
  // 原接手人：「等你确认」标已读，再说一句不用管了（key 带时间：来回改也每次都说）
  await prisma.entNotice.updateMany({ where: { userId: h.toUserId, dedupeKey: `handover:${h.id}:发起`, readAt: null }, data: { readAt: new Date() } });
  await notify([h.toUserId], { kind: "交接", title: `${me.name} 把移交申请改给了别人，不用确认了`, link: "/customers", key: `handover:${h.id}:改走:${Date.now()}` });
  // 新接手人：改回以前收过「等你确认」的那位，把那条重新标未读（唯一键挡着不会再记一条）
  await prisma.entNotice.updateMany({ where: { userId: toUserId, dedupeKey: `handover:${h.id}:发起` }, data: { readAt: null } });
  await 交接通知(me, h.id, "发起");
  刷新();
  return { ok: true, 客户: 0 };
}

async function 了结一笔(
  me: Awaited<ReturnType<typeof requireUser>>,
  id: string,
  状态: "已撤回" | "已拒收",
  能: (h: { byUserId: string; toUserId: string }) => boolean,
  不能: string,
): Promise<结果> {
  if (!企业版() || typeof id !== "string" || !id) return { ok: false, error: 已处理 };
  const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id } }));
  if (!h || h.status !== 待确认) return { ok: false, error: 已处理 };
  if (!能(h)) return { ok: false, error: 不能 };
  if (!(await 看全部(() => 了结(prisma, h.id, 状态, me)))) return { ok: false, error: 已处理 };
  const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [h.fromUserId, h.toUserId] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const n = 读ids(h.customerIds).length;
  await recordAudit({
    user: me, action: h.kind === "离职" ? "deactivate" : "assign", entity: h.kind === "离职" ? "User" : "Customer", entityId: h.kind === "离职" ? h.fromUserId : null,
    summary: `${状态 === "已撤回" ? "撤回" : "拒收"}了「${人.get(h.fromUserId) ?? h.fromUserId}」交给「${人.get(h.toUserId) ?? h.toUserId}」的${h.kind}交接（${n} 位客户），数据留在原负责人名下`,
    detail: { 交接: h.id, kind: h.kind, 状态, fromUserId: h.fromUserId, toUserId: h.toUserId, 客户: 读ids(h.customerIds) },
  });
  await 交接通知(me, h.id, 状态);
  刷新();
  return { ok: true, 客户: 0 };
}
