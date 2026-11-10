/**
 * 企业版站内通知的各个来源（2026-11-01）：每个业务动作做成以后调一行这里的函数，按事件找收件人、拼标题和链接，交给 notify()。
 *
 * - 自己做的事不通知自己（自己分给自己、自己指认给自己…）
 * - 收件人看不到的数据（复核人看不到销售的项目）用 看全部 读名字；链接指向他确实能打开的页面
 * - 每个函数都吞掉所有错误：通知只是顺带的，任何一步出错都不能连累已经做成的分配、验证、交接
 */
import { prisma } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { notify } from "./notify";
import { 读组织, 管理员类别们of, 负责人和上级 } from "./org";
import { 企业版 } from "./switch";
import { 公海入口 } from "./nav";
import { 能改后台设置, 只读角色 } from "./permissions";
import { 无效交给, 实际待, type 待哪步 } from "@/lib/project/lead-verify";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 不跟着转的提醒 } from "@/lib/carry-over-db";

type 人 = { id: string; name: string };

async function 稳(名: string, 做: () => Promise<unknown>): Promise<void> {
  if (!企业版()) return;
  try {
    await 做();
  } catch (e) {
    console.warn(`[通知] ${名}没发：`, e instanceof Error ? e.message : e);
  }
}

const 名单 = (名们: string[], 最多 = 10) => (名们.length > 最多 ? `${名们.slice(0, 最多).join("、")} 等 ${名们.length} 条` : 名们.join("、"));
const 分钟 = () => Math.floor(Date.now() / 60_000);

/* ───────────────────────── 分配线索 ───────────────────────── */

/** 市场首次分给销售（X-18）时留在原负责人名下的活：哪位客户、原负责人是谁（P-转-10） */
export type 留下的活 = { customerId: string; 原: string };
export type 分配条 = { toUserId: string; leadId?: string; projectId?: string; 留下?: 留下的活 };

/**
 * 接手人要知道客户上还有多少活在原负责人手里。几位客户合起来数；都是 0 回 null。
 * 口径同 带走一位 不搬的那些：系统提醒（收回、撞号）是给原负责人本人的，不算。
 * 只算客户原负责人的，项目负责人是另一位时他的不算
 */
async function 客户上还留着(们: readonly 分配条[]): Promise<string | null> {
  const 留下们 = new Map(们.flatMap((c) => (c.留下 ? [[`${c.留下.customerId}:${c.留下.原}`, c.留下] as const] : []))).values();
  let 待办 = 0;
  let 计划 = 0;
  for (const { customerId, 原 } of 留下们) {
    const [n, m] = await 看全部(() => Promise.all([
      prisma.task.count({ where: { customerId, ownerId: 原, done: false, AND: 不跟着转的提醒("assign") } }),
      prisma.followPlan.count({ where: { customerId, ownerId: 原, done: false } }),
    ]));
    待办 += n;
    计划 += m;
  }
  return 待办 || 计划 ? `客户上还有原负责人 ${待办} 条未完成待办、${计划} 条未完成计划` : null;
}

/** 通知正文后面接一句 */
const 接一句 = (正文: string, 句: string | null) => (!句 ? 正文 : !正文 ? 句 : 正文.endsWith("。") ? `${正文}${句}` : `${正文}。${句}`);

/** 市场转给销售时客户也一起转了（P-转-17）：一位写名字，几位写个数；没转客户回 null */
async function 客户也转给你(们: readonly 分配条[]): Promise<string | null> {
  const ids = [...new Set(们.flatMap((c) => (c.留下 ? [c.留下.customerId] : [])))];
  if (!ids.length) return null;
  if (ids.length > 1) return `${ids.length} 位客户也转给你`;
  const c = await 看全部(() => prisma.customer.findUnique({ where: { id: ids[0] }, select: { name: true } }));
  return c ? `客户「${c.name}」也转给你` : "客户也转给你";
}

/**
 * 线索分出去了：按接手人合并成一条（批量自动分配 10 条给同一个人 = 他收一条「自动分配给你 10 条新线索」）。
 * 自动 = 自动分配 / 批量自动分配 / 建档向导的自动分配；手动 = 指定分配
 */
export async function 分配通知(谁点的: 人, 条们: readonly 分配条[], 自动: boolean): Promise<void> {
  await 稳("分配通知", async () => {
    const 按人 = new Map<string, 分配条[]>();
    for (const c of 条们) if (c.toUserId && c.toUserId !== 谁点的.id) 按人.set(c.toUserId, [...(按人.get(c.toUserId) ?? []), c]);
    if (!按人.size) return;
    const 全部 = [...按人.values()].flat();
    const projectIds = 全部.flatMap((c) => (c.projectId ? [c.projectId] : []));
    const leadIds = 全部.flatMap((c) => (c.leadId ? [c.leadId] : []));
    const [项目们, 线索们] = await 看全部(() => Promise.all([
      projectIds.length ? prisma.project.findMany({ where: { id: { in: projectIds } }, select: { id: true, name: true } }) : [],
      leadIds.length ? prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, name: true } }) : [],
    ]));
    const 名 = new Map([...项目们, ...线索们].map((x) => [x.id, x.name]));
    for (const [toUserId, 们] of 按人) {
      const 名们 = 们.map((c) => 名.get(c.projectId ?? c.leadId ?? "") ?? "（一条线索）");
      const n = 们.length;
      const 头 = 自动 ? "自动分配给你" : `${谁点的.name} 分给你`;
      const 只一条项目 = n === 1 && 们[0].projectId;
      await notify([toUserId], {
        kind: 自动 ? "自动分配" : "分配",
        title: n === 1 ? `${头}一条新线索：${名们[0]}` : `${头} ${n} 条新线索`,
        body: 接一句(接一句(n === 1 ? (自动 ? `${谁点的.name} 点的自动分配，轮到了你。` : "") : 名单(名们), await 客户也转给你(们)), await 客户上还留着(们)),
        link: 只一条项目 ? `/projects/${们[0].projectId}` : "/leads",
        key: `assign:${自动 ? "auto" : "manual"}:${们.map((c) => c.projectId ?? c.leadId).sort().join(",").slice(0, 400)}:${分钟()}`,
      });
    }
  });
}

/**
 * 公海里分出去了：同 分配通知 的口径（自己分给自己不发；一次分配接手人只收一条）。
 * 跟来 = 分客户时名下跟着过来的公海项目数；连客户 = 分项目时客户在客户公海里、整包一起给过来的客户数（P-公海-10）
 */
export async function 公海分配通知(谁点的: 人, toUserId: string, 对象: "客户" | "项目", ids: readonly string[], 跟来 = 0, 连客户 = 0): Promise<void> {
  await 稳("公海分配通知", async () => {
    if (!ids.length || toUserId === 谁点的.id) return;
    const 行们 = await 看全部(async () => (对象 === "客户"
      ? prisma.customer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
      : prisma.project.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })));
    const 名 = new Map(行们.map((x) => [x.id, x.name]));
    const 名们 = ids.map((id) => 名.get(id) ?? `（一个${对象}）`);
    const n = ids.length;
    const 页 = 对象 === "客户" ? "/customers" : "/projects";
    const 跟来话 = (连客户 ? (n === 1 && 连客户 === 1 ? "客户也一起给你了。" : `${连客户} 位客户也一起给你了。`) : "")
      + (跟来 ? `名下 ${跟来} 个公海里的项目也一起给你了。` : "");
    await notify([toUserId], {
      kind: "分配",
      title: n === 1 ? `${谁点的.name} 把公海里的${对象}分给你：${名们[0]}` : `${谁点的.name} 把公海里 ${n} 个${对象}分给你`,
      body: n === 1 ? 跟来话 : `${名单(名们)}${跟来话 ? `。${跟来话}` : ""}`,
      link: n === 1 ? `${页}/${ids[0]}` : 页,
      key: `pool-assign:${对象 === "客户" ? "customer" : "project"}:${[...ids].sort().join(",").slice(0, 400)}:${toUserId}:${分钟()}`,
    });
  });
}

/** 转客户时随客户换了负责人的同事项目：哪个项目、原来的负责人（同事）、哪位客户；在推 = 不是待分配、同事正在推的（P-转-07 Even 口径） */
export type 同事待分配条 = { id: string; 原: string; customerId: string; 在推?: true };

/**
 * 转客户把同事名下的项目（待分配的、在推的）一起给了接手人（P-转-07 / P-转-19）：告诉这位同事。
 * 他在这些客户上的待办和计划不搬、不关，还在他名下，能照常勾完成，通知里写清。
 * 点转让的人自己、接手人、已停用的不发；一位同事一条
 */
export async function 同事待分配随客户通知(操作人: string, 新: string, 条们: readonly 同事待分配条[]): Promise<void> {
  await 稳("同事待分配随客户通知", async () => {
    const 按人 = new Map<string, 同事待分配条[]>();
    for (const x of 条们) if (x.原 && x.原 !== 操作人 && x.原 !== 新) 按人.set(x.原, [...(按人.get(x.原) ?? []), x]);
    if (!按人.size) return;
    const 人们 = await prisma.user.findMany({ where: { id: { in: [...按人.keys(), 操作人, 新] } }, select: { id: true, name: true, active: true } });
    const 人 = new Map(人们.map((u) => [u.id, u]));
    const 全部 = [...按人.values()].flat();
    const [项目们, 客户们] = await 看全部(() => Promise.all([
      prisma.project.findMany({ where: { id: { in: 全部.map((x) => x.id) } }, select: { id: true, name: true } }),
      prisma.customer.findMany({ where: { id: { in: [...new Set(全部.map((x) => x.customerId))] } }, select: { id: true, name: true } }),
    ]));
    const 项目名 = new Map(项目们.map((x) => [x.id, x.name]));
    const 客户名 = new Map(客户们.map((x) => [x.id, x.name]));
    const 新名 = 人.get(新)?.name ?? "";
    const 谁 = 人.get(操作人)?.name ?? "";
    for (const [原, 们] of 按人) {
      if (!人.get(原)?.active) continue;
      const 客户 = [...new Set(们.map((x) => 客户名.get(x.customerId) ?? "（一位客户）"))];
      const 项目 = 们.map((x) => `「${项目名.get(x.id) ?? "（一个项目）"}」`);
      await notify([原], {
        kind: "交接",
        title: `${谁} 把客户${客户.map((c) => `「${c}」`).join("、")}转给了 ${新名}，你名下${们.some((x) => x.在推) ? "" : "待分配"}的项目${项目.length > 3 ? `${项目.slice(0, 3).join("")} 等 ${项目.length} 个` : 项目.join("")}随客户一起给了 ${新名}`,
        body: "这些客户上你的待办和计划还在你名下，没做完的可以照常勾完成。",
        link: 们.length === 1 ? `/projects/${们[0].id}` : "/projects",
        key: `awaiting-carry:${原}:${们.map((x) => x.id).sort().join(",").slice(0, 300)}:${分钟()}`,
      });
    }
  });
}

/* ───────────────────────── 线索验证（P12） ───────────────────────── */

const 验证标题: Record<待哪步, (项目: string) => string> = {
  市场复核: (p) => `线索「${p}」判了无效，待你市场复核`,
  总管理终判: (p) => `线索「${p}」待你终判`,
  销售终验: (p) => `线索「${p}」复核完了，待你终验`,
  销售认领: (p) => `线索「${p}」终判有效，待你认领`,
};

/**
 * 验证走了一步之后：现在等谁拍板就通知谁。
 * 市场复核 → 市场管理；总管理终判 → 总管理员（只认业务角色）；销售终验、销售认领 → 项目负责人。
 * 同一条线索同一步同一轮只通知一次（key 带上验证行的 updatedAt）
 */
export async function 验证待办通知(me: 人, projectId: string): Promise<void> {
  await 稳("验证通知", async () => {
    const [p, v, org] = await 看全部(() => Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, ownerId: true } }),
      prisma.entLeadVerify.findUnique({ where: { projectId }, select: { pending: true, invalidReason: true, reviewNote: true, disputeNote: true, updatedAt: true } }),
      读组织(),
    ]));
    if (!p || !v) return;
    const 步 = 实际待(v.pending, await 无效交给(org));
    if (!步) return;
    const 销售步 = 步 === "销售终验" || 步 === "销售认领";
    const 收 = 销售步
      ? [p.ownerId]
      : [...org.成员.keys()].filter((id) => 管理员类别们of(org, id).has(步 === "市场复核" ? "市场管理" : "总管理员"));
    const 说明 = 步 === "市场复核" ? v.invalidReason : 步 === "销售终验" ? v.reviewNote : 步 === "总管理终判" ? v.disputeNote ?? v.invalidReason : null;
    await notify(收.filter((id) => id !== me.id), {
      kind: "线索验证",
      title: 验证标题[步](p.name),
      body: `${me.name} 刚处理了这条线索${说明 ? `：${说明}` : "。"}`,
      // 复核、终判的人多半打不开销售的项目详情：去项目页顶上的「待复核的线索」
      link: 销售步 ? `/projects/${p.id}` : "/projects",
      key: `verify:${projectId}:${步}:${v.updatedAt.getTime()}`,
    });
  });
}

/* ───────────────────────── 项目组邀请、转项目 ───────────────────────── */

export async function 邀请通知(me: 人, projectId: string, userId: string): Promise<void> {
  await 稳("邀请通知", async () => {
    if (userId === me.id) return;
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }));
    await notify([userId], {
      kind: "项目邀请",
      title: `${me.name} 邀请你加入项目「${p?.name ?? ""}」的项目组`,
      body: "同意以后才看得到这个项目。",
      link: "/projects",
      key: `invite:${projectId}:${userId}:${分钟()}`,
    });
  });
}

/** 编辑项目改了负责人：通知新负责人 */
export async function 转项目通知(me: 人, projectId: string): Promise<void> {
  await 稳("转项目通知", async () => {
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, ownerId: true } }));
    if (!p || p.ownerId === me.id) return;
    await notify([p.ownerId], {
      kind: "转项目",
      title: `${me.name} 把项目「${p.name}」转给了你`,
      link: `/projects/${p.id}`,
      key: `owner:${p.id}:${p.ownerId}:${分钟()}`,
    });
  });
}

/* ───────────────────────── 卡点 ───────────────────────── */

export type 卡点动作 = "认领" | "解决";

/** 发布了卡点：告诉项目负责人和他的直属上级（发布的人自己不收）。同一个卡点只发一次 */
export async function 卡点发布通知(me: 人, code: string | undefined): Promise<void> {
  await 稳("卡点发布通知", async () => {
    if (!code) return;
    const [b, org] = await 看全部(() => Promise.all([
      prisma.entBlocker.findUnique({
        where: { code },
        select: { code: true, projectId: true, title: true, description: true, project: { select: { name: true, ownerId: true } } },
      }),
      读组织(),
    ]));
    if (!b) return;
    await notify(负责人和上级(org, b.project.ownerId, me.id), {
      kind: "卡点",
      title: `${me.name} 发布了卡点 ${b.code}`,
      body: `项目「${b.project.name}」· ${(b.title || b.description).slice(0, 200)}`,
      link: `/projects/${b.projectId}`,
      key: `blocker-new:${b.code}`,
    });
  });
}

/** 11-01 卡点改认领制（不指认、不转让）：有人认领、最后一位完成即解决 → 都告诉发布卡点的人 */
export async function 卡点通知(me: 人, code: string | undefined, 动作: 卡点动作): Promise<void> {
  await 稳("卡点通知", async () => {
    if (!code) return;
    const b = await 看全部(() => prisma.entBlocker.findUnique({
      where: { code },
      select: { code: true, projectId: true, creatorId: true, title: true, description: true, project: { select: { name: true } } },
    }));
    if (!b) return;
    const 给 = b.creatorId;
    if (!给 || 给 === me.id) return;
    const title = 动作 === "认领" ? `${me.name} 认领了你发布的卡点 ${b.code}` : `你发布的卡点 ${b.code} 已解决`;
    await notify([给], {
      kind: "卡点",
      title,
      body: `项目「${b.project.name}」· ${(b.title || b.description).slice(0, 200)}`,
      link: `/projects/${b.projectId}`,
      key: `blocker:${b.code}:${动作}:${给}:${分钟()}`,
    });
  });
}

/* ───────────────────────── 交接 ───────────────────────── */

export type 交接事件 = "发起" | "已确认" | "已拒收" | "已撤回";

/**
 * 发起 → 接手人去确认；确认、拒收 → 告诉发起人；撤回 → 告诉接手人不用管了。
 * 11-03 C3-3：确认了也告诉原负责人（转让的；离职的人已停用不发），别人撤回的也告诉发起人。
 * 11-03 C3-5 / C4-7 / C8-1：了结之后接手人那条「等你确认」标成已读，免得一直挂着；确认的标题带客户名，发起多笔分得清
 */
export async function 交接通知(me: 人, handoverId: string, 事件: 交接事件, 留下?: readonly 留下的活[], 实转?: readonly string[]): Promise<void> {
  await 稳("交接通知", async () => {
    const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id: handoverId } }));
    if (!h) return;
    const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [h.fromUserId, h.toUserId] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    let 客户 = 0;
    try {
      客户 = Number((JSON.parse(h.counts) as { 客户?: unknown }).客户) || 0;
    } catch {
      /* counts 坏了就不报个数 */
    }
    // P-删-10：确认了按实际转成的写（交接期间换了人、进了公海、删了的不算），发起时的个数只用在发起 / 撤回 / 拒收
    if (事件 === "已确认" && 实转) 客户 = 实转.length;
    const 几位 = 客户 ? ` ${客户} 位客户` : "客户";
    const 从 = 名.get(h.fromUserId) ?? "";
    const 收 = 事件 === "发起" || 事件 === "已撤回" ? h.toUserId : h.byUserId;
    const 客户名 = 事件 === "已确认" ? await 交接客户名(实转 ?? 读ids(h.customerIds)) : "";
    const 一位没转 = 事件 === "已确认" && !!实转 && !实转.length;
    // 负责人本人转自己的客户 = 申请移交（X-20，客户 11-09 回执 X4）：说「申请移交」，不说「交接」
    const 申请 = h.kind === "转让" && h.byUserId === h.fromUserId;
    const title =
      申请 && 事件 === "发起" ? `${me.name} 申请把${几位}移交给你，等你确认`
      : 申请 && 事件 === "已拒收" ? `${me.name} 拒绝了你的移交申请，客户仍在你名下`
      : 申请 && 事件 === "已撤回" && me.id === h.byUserId ? `${me.name} 撤回了移交申请，不用确认了`
      : 事件 === "发起" ? (h.kind === "离职" ? `${从} 离职，${me.name} 把他的${几位}交接给你，等你确认` : `${me.name} 把${从 && 从 !== me.name ? ` ${从} 的` : ""}${几位}交接给你，等你确认`)
      : 一位没转 ? `${me.name} 确认了交接，但客户在交接期间已换了人、进了公海或被删，没有转到 ${me.name} 名下`
      : 事件 === "已确认" ? `${me.name} 确认接手了${几位}${客户名}`
      : 事件 === "已拒收" ? `${me.name} 拒收了你发起的交接，数据留在 ${从} 名下`
      : `${me.name} 撤回了交给你的交接，不用确认了`;
    const key = `handover:${h.id}:${事件}`;
    await notify([收].filter((id) => id !== me.id), {
      kind: "交接",
      title,
      body: 接一句(
        事件 === "发起" ? (申请 ? "你确认后才转到你名下；不确认不生效，客户还在原负责人名下。" : "确认之前这些客户还在原负责人名下，确认后才转到你名下。") : "",
        留下?.length ? await 客户上还留着(留下.map((l) => ({ toUserId: h.toUserId, 留下: l }))) : null,
      ),
      link: "/customers",
      key,
    });
    if (事件 === "发起") return;
    await prisma.entNotice.updateMany({ where: { userId: h.toUserId, dedupeKey: `handover:${h.id}:发起`, readAt: null }, data: { readAt: new Date() } });
    if (事件 === "已确认" && !一位没转 && h.kind !== "离职" && ![me.id, h.byUserId].includes(h.fromUserId)) {
      await notify([h.fromUserId], { kind: "交接", title: `你名下的${几位}${客户名} 已交给 ${me.name}`, link: "/customers", key });
    }
    if (事件 === "已撤回" && ![me.id, h.toUserId].includes(h.byUserId)) {
      await notify([h.byUserId], { kind: "交接", title: `${me.name} 撤回了你发起的交接，数据留在 ${从} 名下`, link: "/customers", key });
    }
  });
}

/** 交接 customerIds（JSON 数组）读成 id；坏了就空 */
function 读ids(customerIds: string): string[] {
  try {
    const v: unknown = JSON.parse(customerIds);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** 交接里的客户名，最多列 3 个：「：甲、乙、丙 等 5 位」；查不到就空 */
async function 交接客户名(ids: readonly string[]): Promise<string> {
  if (!ids.length) return "";
  const 名们 = (await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids.slice(0, 3) } }, select: { name: true } }))).map((c) => c.name);
  if (!名们.length) return "";
  return `：${名们.join("、")}${ids.length > 名们.length ? ` 等 ${ids.length} 位` : ""}`;
}

/** 占位账号（公海客户挂的「无负责人」）和停用的人不是真接手人，不发提醒 */
async function 收得到分配(toUserId: string): Promise<boolean> {
  const u = await 看全部(() => prisma.user.findUnique({ where: { id: toUserId }, select: { active: true, email: true } }));
  return !!u && u.active && u.email !== 无负责人占位邮箱;
}

/**
 * 把客户分给谁（11-06）：运营分发实际是直接改负责人和新建时指定别人，之前接手人收不到提醒。
 * 单条链客户详情（负责人在那儿能看到全部联系方式），多条链客户列表。标题和正文都推到飞书，所以不放手机号
 */
export async function 分给你通知(谁点的: 人, toUserId: string, customerIds: readonly string[], 项目名?: string, 留下: readonly 留下的活[] = []): Promise<void> {
  await 稳("分给你通知", async () => {
    const ids = [...new Set(customerIds)];
    if (!ids.length || !toUserId || toUserId === 谁点的.id) return;
    if (!(await 收得到分配(toUserId))) return;
    const 行们 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }));
    const 名 = new Map(行们.map((r) => [r.id, r.name]));
    const 名们 = ids.map((id) => 名.get(id)).filter((n): n is string => !!n);
    if (!名们.length) return;
    const 单条 = ids.length === 1;
    await notify([toUserId], {
      kind: "分配",
      title: 单条 ? `${谁点的.name} 把客户分给你：${名们[0]}` : `${谁点的.name} 把 ${ids.length} 位客户分给你`,
      body: 接一句(单条 ? (项目名 ? `项目：${项目名}` : "") : 名单(名们), 留下.length ? await 客户上还留着(留下.map((l) => ({ toUserId, 留下: l }))) : null),
      link: 单条 ? `/customers/${ids[0]}` : "/customers",
      key: `owner-assign:${[...ids].sort().join(",").slice(0, 400)}:${toUserId}:${分钟()}`,
    });
  });
}

/**
 * 客户页给已有客户新建项目、指定别人负责：客户不跟着转，接手人多半打不开客户详情，所以链项目详情；
 * 接手人本来就是这位客户的负责人，才链客户详情。自己留着不发
 */
export async function 项目分给你通知(谁点的: 人, toUserId: string, projectId: string, 项目名: string, customerId: string, 留下?: 留下的活): Promise<void> {
  await 稳("项目分给你通知", async () => {
    if (!toUserId || toUserId === 谁点的.id) return;
    if (!(await 收得到分配(toUserId))) return;
    const c = await 看全部(() => prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, salesOwnerId: true } }));
    if (!c) return;
    await notify([toUserId], {
      kind: "分配",
      title: `${谁点的.name} 把项目分给你：${项目名}`,
      body: 接一句(接一句(`客户：${c.name}`, 留下 ? "客户也转给你" : null), 留下 ? await 客户上还留着([{ toUserId, 留下 }]) : null),
      link: c.salesOwnerId === toUserId ? `/customers/${customerId}` : `/projects/${projectId}`,
      key: `project-assign:${projectId}:${toUserId}:${分钟()}`,
    });
  });
}


/**
 * P-转-05：「项目 → 离职交接」看板上交完（单条客户、单条项目、一键全部），告诉接手人一声。
 * 同 分给你通知（#197 转让通知接手人）一套发法：站内待办 + 飞书，不带手机号；上级自己交给自己不发。
 * 单位客户链客户详情、只交项目链项目，多条链客户列表。概要 = 一键全部时动作里拼好的「N 位客户、M 个项目…」。
 * 交接要确认那条路（发起 → 接手人确认）走 交接通知，不在这里
 */
export async function 离职交接通知(me: 人, 离职的: string, toUserId: string, 客户ids: readonly string[], 项目ids: readonly string[] = [], 概要 = ""): Promise<void> {
  await 稳("离职交接通知", async () => {
    if (!toUserId || toUserId === me.id) return;
    const 客户们 = [...new Set(客户ids)];
    const 项目们 = [...new Set(项目ids)];
    if (!客户们.length && !项目们.length && !概要) return;
    if (!(await 收得到分配(toUserId))) return;
    const [客户行, 项目行] = await 看全部(() => Promise.all([
      客户们.length ? prisma.customer.findMany({ where: { id: { in: 客户们 } }, select: { id: true, name: true } }) : [],
      项目们.length ? prisma.project.findMany({ where: { id: { in: 项目们 } }, select: { id: true, name: true } }) : [],
    ]));
    const 客户名 = new Map(客户行.map((r) => [r.id, r.name]));
    const 项目名 = new Map(项目行.map((r) => [r.id, r.name]));
    const 客户名们 = 客户们.map((id) => 客户名.get(id)).filter((n): n is string => !!n);
    const 项目名们 = 项目们.map((id) => 项目名.get(id)).filter((n): n is string => !!n);
    const 谁 = `${离职的 ? `${离职的} 离职，` : ""}${me.name}`;
    const 单客户 = !概要 && 客户们.length === 1 && !项目们.length;
    const 单项目 = !概要 && !客户们.length && 项目们.length === 1;
    const 段 = 概要 || [客户们.length && `${客户们.length} 位客户`, 项目们.length && `${项目们.length} 个项目`].filter(Boolean).join("、");
    await notify([toUserId], {
      kind: "交接",
      title: 单客户 && 客户名们.length ? `${谁} 把客户交接给你：${客户名们[0]}`
        : 单项目 && 项目名们.length ? `${谁} 把项目交接给你：${项目名们[0]}`
        : `${谁} 把${离职的 ? "他名下的" : ""} ${段} 交接给你`,
      body: 接一句(客户名们.length && !单客户 ? `客户：${名单(客户名们)}` : "", 项目名们.length && !单项目 ? `项目：${名单(项目名们)}` : null),
      link: 单客户 ? `/customers/${客户们[0]}` : 单项目 ? `/projects/${项目们[0]}` : !客户们.length && 项目们.length ? "/projects" : "/customers",
      key: `offboard-handover:${[...客户们, ...项目们].sort().join(",").slice(0, 400)}:${toUserId}:${分钟()}`,
    });
  });
}

/** P-删-10：别人（系统管理员）删了你负责的项目，告诉你一声；进了回收站，30 天内找系统管理员能恢复。停用的不发 */
export async function 项目被删通知(me: 人, ownerId: string, 项目名: string, customerId: string): Promise<void> {
  await 稳("项目被删通知", async () => {
    if (!ownerId || ownerId === me.id) return;
    const u = await 看全部(() => prisma.user.findUnique({ where: { id: ownerId }, select: { active: true } }));
    if (!u?.active) return;
    await notify([ownerId], {
      kind: "回收",
      title: `${me.name} 删除了你负责的项目「${项目名}」`,
      body: "项目进了回收站，30 天内可以找系统管理员恢复。",
      link: customerId ? `/customers/${customerId}` : "/projects",
    });
  });
}

/* ───────────────────────── 放回公海（P-公海-03） ───────────────────────── */

/** 原负责人里收得到的：在职、不是操作人自己、不是公海占位账号 */
async function 在职的原负责人(me: 人, ids: readonly string[]): Promise<Set<string>> {
  const 们 = [...new Set(ids)].filter((id) => !!id && id !== me.id);
  if (!们.length) return new Set();
  const 行 = await 看全部(() => prisma.user.findMany({ where: { id: { in: 们 }, active: true, email: { not: 无负责人占位邮箱 } }, select: { id: true } }));
  return new Set(行.map((u) => u.id));
}

const 放回原因 = (原因?: string | null) => (typeof 原因 === "string" && 原因.trim() ? `原因：${原因.trim()}` : null);

/**
 * P-公海-03：别人（上级、销售管理、总管理）把我的客户放回公海，告诉原负责人一声；自己放回自己的不发。
 * 只发给原负责人本人，按人各发一条、只列他自己的客户（公海里不露原负责人，P-公海-04）。
 * 放回后原负责人看不到这位客户（回避），所以不给链接。公海项目 = 跟着进线索公海的项目 id（客户原负责人自己负责的）
 */
export async function 客户放回公海通知(me: 人, 客户们: readonly { id: string; name: string; salesOwnerId: string }[], 原因?: string | null, 公海项目: readonly string[] = []): Promise<void> {
  await 稳("客户放回公海通知", async () => {
    const 收 = await 在职的原负责人(me, 客户们.map((c) => c.salesOwnerId));
    if (!收.size) return;
    const 项目行 = 公海项目.length ? await 看全部(() => prisma.project.findMany({ where: { id: { in: [...公海项目] } }, select: { customerId: true } })) : [];
    for (const 原 of 收) {
      const 我的 = 客户们.filter((c) => c.salesOwnerId === 原);
      const ids = new Set(我的.map((c) => c.id));
      const 项目数 = 项目行.filter((p) => ids.has(p.customerId)).length;
      const 单条 = 我的.length === 1;
      const 正文 = [
        单条 ? "" : `客户：${名单(我的.map((c) => c.name))}`,
        放回原因(原因),
        项目数 ? `你在${单条 ? "这位客户" : "这些客户"}上负责的 ${项目数} 个项目一起进了线索公海` : null,
        `放回后你看不到${单条 ? "这位客户" : "这些客户"}，也不能自己领回`,
      ].reduce<string>((a, b) => 接一句(a, b ? `${b}。` : null), "");
      await notify([原], {
        kind: "回收",
        title: 单条 ? `${me.name} 把你名下的客户放回了公海：${我的[0].name}` : `${me.name} 把你名下的 ${我的.length} 位客户放回了公海`,
        body: 正文,
        link: null,
        key: `pool-return:customer:${[...ids].sort().join(",").slice(0, 400)}:${原}:${分钟()}`,
      });
    }
  });
}

/** 撤销了刚才的放进公海：前面那条「放回了公海」已经发出去了，再告诉原负责人客户回到他名下。现 = 撤销后的客户（负责人已还回去） */
export async function 客户撤销放回通知(me: 人, 客户ids: readonly string[]): Promise<void> {
  await 稳("客户撤销放回通知", async () => {
    if (!客户ids.length) return;
    const 现 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: [...客户ids] }, pool: { is: null } }, select: { id: true, name: true, salesOwnerId: true } }));
    const 收 = await 在职的原负责人(me, 现.map((c) => c.salesOwnerId));
    for (const 原 of 收) {
      const 我的 = 现.filter((c) => c.salesOwnerId === 原);
      const 单条 = 我的.length === 1;
      await notify([原], {
        kind: "回收",
        title: 单条 ? `${me.name} 撤销了刚才的放回公海，客户回到你名下：${我的[0].name}` : `${me.name} 撤销了刚才的放回公海，${我的.length} 位客户回到你名下`,
        body: 单条 ? "" : `客户：${名单(我的.map((c) => c.name))}`,
        link: 单条 ? `/customers/${我的[0].id}` : "/customers",
        key: `pool-return-undo:${我的.map((c) => c.id).sort().join(",").slice(0, 400)}:${原}:${分钟()}`,
      });
    }
  });
}

/**
 * P-公海-03：别人把我的项目放回线索公海，告诉原负责人一声；自己放回自己的不发。
 * 原负责人认刚记的那行 pool-release（进公海后项目上的负责人已清空）：最近一条、操作人是我的才算。
 * 放回后他打不开这个项目（回避）：客户还归他就链客户详情，不然不给链接
 */
export async function 项目放回公海通知(me: 人, projectId: string, 原因?: string | null): Promise<void> {
  await 稳("项目放回公海通知", async () => {
    const 痕 = await 看全部(() => prisma.projectNodeLog.findFirst({
      where: { projectId, kind: "pool-release" }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { userId: true, fromOwnerId: true },
    }));
    if (!痕?.fromOwnerId || 痕.userId !== me.id) return;
    const 原 = 痕.fromOwnerId;
    if (!(await 在职的原负责人(me, [原])).has(原)) return;
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true, customer: { select: { name: true, salesOwnerId: true, pool: { select: { customerId: true } } } } } }));
    if (!p) return;
    const 客户还归他 = p.customer.salesOwnerId === 原 && !p.customer.pool;
    await notify([原], {
      kind: "回收",
      title: `${me.name} 把你名下的项目放回了线索公海：${p.name}`,
      body: [`客户：${p.customer.name}`, 放回原因(原因), "放回后你看不到这个项目，也不能自己领回"].reduce<string>((a, b) => 接一句(a, b ? `${b}。` : null), ""),
      link: 客户还归他 ? `/customers/${p.customerId}` : null,
      key: `pool-return:project:${projectId}:${原}:${分钟()}`,
    });
  });
}

/* ───────────────────────── 恢复到停用的人名下（P-删-06） ───────────────────────── */

/** 离职交接看板：停用的人的直属上级、系统管理员都打得开，恢复回来的客户就列在那位停用的人的卡里 */
const 离职交接看板 = "/projects/handover";

/**
 * P-删-06：从回收站恢复（或查重捞回）客户时原负责人已停用（restore-inactive-owner.ts）。告诉停用负责人的直属上级
 * （手填的、在职、不是只读管理员）；没有这样的上级就告诉系统管理员。两种各一条：
 *   - 进了公海：知会一声，客户恢复后因原负责人已停用进了客户公海
 *   - 例外挡住没进（M-公海-02 / X-31，已签约 / 已流失、交接中同离职分拣）：还挂在停用的人名下、没人跟，按实际命中的原因写，请到离职交接看板指定接手人
 * 操作恢复的人自己不收（上级自己恢复的不发）；一次回来几位按收件人合成一条
 */
export async function 恢复到停用负责人通知(me: 人, 条: readonly { id: string; 原: string; 进了公海: boolean; 没进原因?: readonly string[] }[]): Promise<void> {
  await 稳("恢复到停用负责人通知", async () => {
    if (!条.length) return;
    const [客户行, 人行, org] = await Promise.all([
      看全部(() => prisma.customer.findMany({ where: { id: { in: 条.map((c) => c.id) } }, select: { id: true, name: true } })),
      prisma.user.findMany({ where: { id: { in: [...new Set(条.map((c) => c.原))] } }, select: { id: true, name: true } }),
      读组织(),
    ]);
    const 客户名 = new Map(客户行.map((c) => [c.id, c.name]));
    const 人名 = new Map(人行.map((u) => [u.id, u.name]));
    const 系统管理员们 = [...org.成员.keys()].filter((id) => 能改后台设置({ id }, org));
    type 一位 = { id: string; name: string; 原名: string; 没进原因: readonly string[] };
    const 按收件人 = new Map<string, { 公海: 一位[]; 留下: 一位[] }>();
    for (const c of [...条].sort((a, b) => (客户名.get(a.id) ?? "").localeCompare(客户名.get(b.id) ?? ""))) {
      if (!客户名.has(c.id)) continue;
      const 上 = org.离职上级?.get(c.原);
      const 收 = 上 && org.成员.has(上) && !只读角色({ id: 上 }, org) ? [上] : 系统管理员们;
      for (const 谁 of 收) {
        if (谁 === me.id) continue;
        const 份 = 按收件人.get(谁) ?? { 公海: [], 留下: [] };
        (c.进了公海 ? 份.公海 : 份.留下).push({ id: c.id, name: 客户名.get(c.id)!, 原名: 人名.get(c.原) ?? "", 没进原因: c.没进原因 ?? [] });
        按收件人.set(谁, 份);
      }
    }
    const 列 = (们: 一位[]) => `客户：${名单(们.map((c) => `${c.name}（${c.原名}）`))}`;
    const 键 = (们: 一位[]) => 们.map((c) => c.id).sort().join(",").slice(0, 400);
    for (const [谁, { 公海, 留下 }] of 按收件人) {
      if (公海.length) {
        const 单条 = 公海.length === 1;
        await notify([谁], {
          kind: "回收",
          title: 单条 ? `${me.name} 从回收站恢复了客户「${公海[0].name}」，原负责人 ${公海[0].原名} 已停用，客户进了客户公海` : `${me.name} 从回收站恢复了 ${公海.length} 位客户，原负责人已停用，客户进了客户公海`,
          body: 接一句(单条 ? "" : 列(公海), "原负责人自己负责、还没结束的线索 / 商机项目一起进了线索公海，可以从公海领取或分配。"),
          link: 公海入口,
          key: `restore-inactive-owner:pool:${键(公海)}:${谁}:${分钟()}`,
        });
      }
      if (留下.length) {
        const 单条 = 留下.length === 1;
        const 原因们 = [...new Set(留下.flatMap((c) => c.没进原因))];
        await notify([谁], {
          kind: "交接",
          title: 单条 ? `${me.name} 从回收站恢复了客户「${留下[0].name}」，负责人 ${留下[0].原名} 已停用` : `${me.name} 从回收站恢复了 ${留下.length} 位客户，负责人已停用`,
          body: 接一句(
            单条 ? "" : 列(留下),
            `${单条 ? "这位客户" : "这些客户"}${原因们.length ? `不能进公海（${原因们.join("、")}）` : "没能放进公海"}，还挂在已停用的人名下、没人跟进，请到「项目 → 离职交接」指定接手人。`,
          ),
          link: 离职交接看板,
          key: `restore-inactive-owner:${键(留下)}:${谁}:${分钟()}`,
        });
      }
    }
  });
}

/** 直接改负责人（转给自己、规则关着）当场就换了：告诉原负责人一声（11-03 C3-3）。不发给操作人自己；新负责人走上面的 分给你通知 */
export async function 改负责人通知(me: 人, 换了: readonly { customerId: string; 旧: string }[], 新: string): Promise<void> {
  await 稳("改负责人通知", async () => {
    const 按人 = new Map<string, string[]>();
    for (const c of 换了) if (c.旧 !== me.id && c.旧 !== 新) 按人.set(c.旧, [...(按人.get(c.旧) ?? []), c.customerId]);
    if (!按人.size) return;
    const 在职 = new Set((await prisma.user.findMany({ where: { id: { in: [...按人.keys()] }, active: true }, select: { id: true } })).map((u) => u.id));
    const 新名 = 新 === me.id ? me.name : (await prisma.user.findUnique({ where: { id: 新 }, select: { name: true } }))?.name ?? "";
    for (const [旧, ids] of 按人) {
      if (!在职.has(旧)) continue;
      const 客户名 = await 交接客户名(ids);
      await notify([旧], {
        kind: "交接",
        title: `${me.name} 把你名下的 ${ids.length} 位客户${客户名} 改给了 ${新名}`,
        link: "/customers",
      });
    }
  });
}
