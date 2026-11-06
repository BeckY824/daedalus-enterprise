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
import { 无效交给, 实际待, type 待哪步 } from "@/lib/project/lead-verify";

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

export type 分配条 = { toUserId: string; leadId?: string; projectId?: string };

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
        body: n === 1 ? (自动 ? `${谁点的.name} 点的自动分配，轮到了你。` : "") : 名单(名们),
        link: 只一条项目 ? `/projects/${们[0].projectId}` : "/leads",
        key: `assign:${自动 ? "auto" : "manual"}:${们.map((c) => c.projectId ?? c.leadId).sort().join(",").slice(0, 400)}:${分钟()}`,
      });
    }
  });
}

/**
 * 公海里分出去了：同 分配通知 的口径（自己分给自己不发；一次分配接手人只收一条）。
 * 跟来 = 分客户时名下跟着过来的公海项目数
 */
export async function 公海分配通知(谁点的: 人, toUserId: string, 对象: "客户" | "项目", ids: readonly string[], 跟来 = 0): Promise<void> {
  await 稳("公海分配通知", async () => {
    if (!ids.length || toUserId === 谁点的.id) return;
    const 行们 = await 看全部(async () => (对象 === "客户"
      ? prisma.customer.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })
      : prisma.project.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } })));
    const 名 = new Map(行们.map((x) => [x.id, x.name]));
    const 名们 = ids.map((id) => 名.get(id) ?? `（一个${对象}）`);
    const n = ids.length;
    const 页 = 对象 === "客户" ? "/customers" : "/projects";
    const 跟来话 = 跟来 ? `名下 ${跟来} 个公海里的项目也一起给你了。` : "";
    await notify([toUserId], {
      kind: "分配",
      title: n === 1 ? `${谁点的.name} 把公海里的${对象}分给你：${名们[0]}` : `${谁点的.name} 把公海里 ${n} 个${对象}分给你`,
      body: n === 1 ? 跟来话 : `${名单(名们)}${跟来话 ? `。${跟来话}` : ""}`,
      link: n === 1 ? `${页}/${ids[0]}` : 页,
      key: `pool-assign:${对象 === "客户" ? "customer" : "project"}:${[...ids].sort().join(",").slice(0, 400)}:${toUserId}:${分钟()}`,
    });
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
export async function 交接通知(me: 人, handoverId: string, 事件: 交接事件): Promise<void> {
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
    const 几位 = 客户 ? ` ${客户} 位客户` : "客户";
    const 从 = 名.get(h.fromUserId) ?? "";
    const 收 = 事件 === "发起" || 事件 === "已撤回" ? h.toUserId : h.byUserId;
    const 客户名 = 事件 === "已确认" ? await 交接客户名(h.customerIds) : "";
    const title =
      事件 === "发起" ? (h.kind === "离职" ? `${从} 离职，${me.name} 把他的${几位}交接给你，等你确认` : `${me.name} 把${从 && 从 !== me.name ? ` ${从} 的` : ""}${几位}交接给你，等你确认`)
      : 事件 === "已确认" ? `${me.name} 确认接手了${几位}${客户名}`
      : 事件 === "已拒收" ? `${me.name} 拒收了你发起的交接，数据留在 ${从} 名下`
      : `${me.name} 撤回了交给你的交接，不用确认了`;
    const key = `handover:${h.id}:${事件}`;
    await notify([收].filter((id) => id !== me.id), {
      kind: "交接",
      title,
      body: 事件 === "发起" ? "确认之前这些客户还在原负责人名下，确认后才转到你名下。" : "",
      link: "/customers",
      key,
    });
    if (事件 === "发起") return;
    await prisma.entNotice.updateMany({ where: { userId: h.toUserId, dedupeKey: `handover:${h.id}:发起`, readAt: null }, data: { readAt: new Date() } });
    if (事件 === "已确认" && h.kind !== "离职" && ![me.id, h.byUserId].includes(h.fromUserId)) {
      await notify([h.fromUserId], { kind: "交接", title: `你名下的${几位}${客户名} 已交给 ${me.name}`, link: "/customers", key });
    }
    if (事件 === "已撤回" && ![me.id, h.toUserId].includes(h.byUserId)) {
      await notify([h.byUserId], { kind: "交接", title: `${me.name} 撤回了你发起的交接，数据留在 ${从} 名下`, link: "/customers", key });
    }
  });
}

/** 交接里的客户名，最多列 3 个：「：甲、乙、丙 等 5 位」；查不到就空 */
async function 交接客户名(customerIds: string): Promise<string> {
  let ids: string[] = [];
  try {
    const v: unknown = JSON.parse(customerIds);
    if (Array.isArray(v)) ids = v.filter((x): x is string => typeof x === "string");
  } catch {
    return "";
  }
  if (!ids.length) return "";
  const 名们 = (await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids.slice(0, 3) } }, select: { name: true } }))).map((c) => c.name);
  if (!名们.length) return "";
  return `：${名们.join("、")}${ids.length > 名们.length ? ` 等 ${ids.length} 位` : ""}`;
}

/**
 * 把客户分给谁（11-06）：运营分发实际是直接改负责人和新建时指定别人，之前接手人收不到提醒。
 * 单条链客户详情（负责人在那儿能看到全部联系方式），多条链客户列表。标题和正文都推到飞书，所以不放手机号
 */
export async function 分给你通知(谁点的: 人, toUserId: string, customerIds: readonly string[], 项目名?: string): Promise<void> {
  await 稳("分给你通知", async () => {
    const ids = [...new Set(customerIds)];
    if (!ids.length || !toUserId || toUserId === 谁点的.id) return;
    const 行们 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }));
    const 名 = new Map(行们.map((r) => [r.id, r.name]));
    const 名们 = ids.map((id) => 名.get(id)).filter((n): n is string => !!n);
    if (!名们.length) return;
    const 单条 = ids.length === 1;
    await notify([toUserId], {
      kind: "分配",
      title: 单条 ? `${谁点的.name} 把客户分给你：${名们[0]}` : `${谁点的.name} 把 ${ids.length} 位客户分给你`,
      body: 单条 ? (项目名 ? `项目：${项目名}` : "") : 名单(名们),
      link: 单条 ? `/customers/${ids[0]}` : "/customers",
      key: `owner-assign:${[...ids].sort().join(",").slice(0, 400)}:${toUserId}:${分钟()}`,
    });
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
      const 客户名 = await 交接客户名(JSON.stringify(ids));
      await notify([旧], {
        kind: "交接",
        title: `${me.name} 把你名下的 ${ids.length} 位客户${客户名} 改给了 ${新名}`,
        link: "/customers",
      });
    }
  });
}
