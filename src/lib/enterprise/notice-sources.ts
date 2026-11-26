/**
 * 企业版站内通知的各个来源（2026-11-01）：每个业务动作做成以后调一行这里的函数，按事件找收件人、拼标题和链接，交给 notify()。
 *
 * - 自己做的事不通知自己（自己分给自己、自己指认给自己…）
 * - 收件人看不到的数据（复核人看不到销售的项目）用 看全部 读名字；链接指向他确实能打开的页面
 * - 每个函数都吞掉所有错误：通知只是顺带的，任何一步出错都不能连累已经做成的分配、验证、交接
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { 看全部 } from "@/lib/team-scope";
import { notify } from "./notify";
import { 离职段 } from "./handover-db";
import { 这条记了补位 } from "./invalid-makeup";
import { 读组织, 负责人和上级, 在职负责人或上级, 市场复核人们, 市场复核要读的, 是系统管理员of, 管理员类别们of, 拆角色 } from "./org";
import { 企业版 } from "./switch";
import { 公海入口 } from "./nav";
import { 能改后台设置, 只读角色, 是销售角色 } from "./permissions";
import { 无效交给, 实际待, type 待哪步 } from "@/lib/project/lead-verify";
import { 卡点显示名 } from "@/lib/project/blocker-rules";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 不跟着转的提醒 } from "@/lib/carry-over-db";
import { 快轮到提醒 } from "./assign-eta";
import { 客户显名, 客户引, 显名列 } from "./customer-title";
import { 草稿保留天 } from "./coach-rec";
import { businessDayjs } from "@/lib/business-clock";

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
/** 原名下 = 分之前这条在谁名下（不在公海、不是待分配；assign-actions 分给 回的），市场管理改分通知（11-19）用 */
export type 分配条 = { toUserId: string; leadId?: string; projectId?: string; 留下?: 留下的活; 原名下?: string };

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

/**
 * 分到我的线索、超时提醒的链接带不带「放弃（豁免）」（11-21，lead-giveup.ts 通知放弃链接）。
 * 动态 import：lead-giveup.ts 自己 import 本文件（放弃转出发 分配通知），静态 import 成环
 */
export async function 带放弃链接(userId: string, projectId: string, link: string, 现在: Date = new Date()): Promise<string> {
  try {
    return await (await import("./lead-giveup")).通知放弃链接(userId, projectId, link, 现在);
  } catch (e) {
    console.warn("[通知] 放弃链接没判成：", e instanceof Error ? e.message : e);
    return link;
  }
}

/** 通知正文后面接一句 */
const 接一句 = (正文: string, 句: string | null) => (!句 ? 正文 : !正文 ? 句 : 正文.endsWith("。") ? `${正文}${句}` : `${正文}。${句}`);

/** 市场转给销售时客户也一起转了（P-转-17）：一位写名字，几位写个数；没转客户回 null */
async function 客户也转给你(们: readonly 分配条[]): Promise<string | null> {
  const ids = [...new Set(们.flatMap((c) => (c.留下 ? [c.留下.customerId] : [])))];
  if (!ids.length) return null;
  if (ids.length > 1) return `${ids.length} 位客户也转给你`;
  const c = await 看全部(() => prisma.customer.findUnique({ where: { id: ids[0] }, select: 显名列 }));
  return c ? `客户${客户引(c)}也转给你` : "客户也转给你";
}

/**
 * 线索分出去了：按接手人合并成一条（批量自动分配 10 条给同一个人 = 他收一条「自动分配给你 10 条新线索」）。
 * 自动 = 自动分配 / 批量自动分配 / 建档向导的自动分配；手动 = 指定分配
 */
export async function 分配通知(谁点的: 人, 条们: readonly 分配条[], 自动: boolean, 另附?: string): Promise<void> {
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
        // 另附（11-17 PR3）：定时分配到点时写「按定时分配，原定 HH:mm」；系统到点自动分的不说「谁点的」
        body: 接一句(接一句(接一句(n === 1 ? (自动 ? (谁点的.id === "system" ? "" : `${谁点的.name} 点的自动分配，轮到了你。`) : "") : 名单(名们), await 客户也转给你(们)), await 客户上还留着(们)), 另附 ?? null),
        // 只一条项目、发这一刻他能放弃（11-21）：链接带 ?giveup=1，飞书多一个「放弃（豁免）」、铃铛多一颗（lead-giveup-core.ts）
        link: 只一条项目 ? await 带放弃链接(toUserId, 们[0].projectId!, `/projects/${们[0].projectId}`) : "/leads",
        key: `assign:${自动 ? "auto" : "manual"}:${们.map((c) => c.projectId ?? c.leadId).sort().join(",").slice(0, 400)}:${分钟()}`,
      });
    }
  });
  // 市场管理把已在销售名下的改分给别人（11-19 客户答复）：另告诉原负责人和他的直属上级；接手人照上面收「分给你」
  await 市场改分通知(谁点的, 条们.flatMap((c) => (c.原名下 ? [{ 原: c.原名下, 新: c.toUserId, ...(c.projectId ? { projectId: c.projectId } : {}), ...(c.leadId ? { leadId: c.leadId } : {}) }] : [])));
  // 自动分配「快轮到我」（11-18，assign-eta.ts）：分出去一条，候选池里的销售各算一遍，进 3 条以内的推一次（自己分给自己也算分了一条）
  if (条们.length) await 分配后估算推送();
}

/** 一条改分：原 = 改之前的负责人，新 = 接手人；三选一说的是哪一条（线索阶段的项目 / 老线索 / 客户） */
export type 改分条 = { 原: string | null | undefined; 新: string; projectId?: string; leadId?: string; customerId?: string };

/**
 * 市场管理改分（11-19 客户答复）：操作人有市场管理业务角色、把已经在某位销售名下的线索 / 项目 / 客户改给另一位时，
 * 除接手人照旧收「分给你」外，再告诉原负责人和他的直属上级：谁、哪一条、从谁改到谁。
 * - 只在原负责人是另一位在职的销售（销售 / 销售管理，兼市场的按销售算，同 是销售角色）时发：占位账号、公海、待分配、市场名下的（X-18 首次分配）不发；
 *   调用方只在「分之前真在他名下」时交 原
 * - 收件人照 负责人和上级（直属上级只认手填、停用的不算，同 main）：去掉操作人本人、去掉接手人（他收的是分给你那条）；直属上级没填就只发原负责人
 * - 原负责人已停用（P-转-40，Even 11-19 复核第 30 题）：他停用前是销售 / 销售管理才算改分；不发他本人，改发他停用前手填的直属上级（还在职才算），
 *   上级也停用或没填就推系统管理员——就是 负责人和上级 对停用的人的现成找法（同三态 T12、验证待办 审核 11-18 通知 P2-7）；标题里他的名字后注「（已停用）」
 * - 别的角色改负责人、超时轮转（系统操作人）不走这里。几条按收件人合成一条；号码打码在 notify 里
 */
export async function 市场改分通知(谁点的: 人, 条们: readonly 改分条[], opt: { 原负责人另有通知?: boolean } = {}): Promise<void> {
  await 稳("市场改分通知", async () => {
    if (!条们.length) return;
    const org = await 读组织();
    if (!管理员类别们of(org, 谁点的.id).has("市场管理")) return;
    // 停用的人不在 org.成员 里，是销售角色 认不出：按他停用前的业务角色（EntMember 行还留着）认
    const 停用的原 = [...new Set(条们.flatMap((c) => (c.原 && org.停用的?.has(c.原) ? [c.原] : [])))];
    const 停用前销售 = new Set(停用的原.length
      ? (await 看全部(() => prisma.entMember.findMany({ where: { userId: { in: 停用的原 } }, select: { userId: true, bizRole: true } })))
        .filter((m) => 拆角色(m.bizRole).some((r) => r === "sales" || r === "sales_mgr")).map((m) => m.userId)
      : []);
    const 算的 = 条们.filter((c): c is 改分条 & { 原: string } => !!c.原 && c.原 !== 谁点的.id && c.原 !== c.新 && (是销售角色(org, c.原) || 停用前销售.has(c.原)));
    if (!算的.length) return;
    const pIds = 算的.flatMap((c) => (c.projectId ? [c.projectId] : []));
    const lIds = 算的.flatMap((c) => (c.leadId ? [c.leadId] : []));
    const cIds = 算的.flatMap((c) => (c.customerId ? [c.customerId] : []));
    const 人ids = [...new Set(算的.flatMap((c) => [c.原, c.新]))];
    const [项目们, 线索们, 客户们, 人们] = await 看全部(() => Promise.all([
      pIds.length ? prisma.project.findMany({ where: { id: { in: pIds } }, select: { id: true, name: true } }) : [],
      lIds.length ? prisma.lead.findMany({ where: { id: { in: lIds } }, select: { id: true, name: true } }) : [],
      cIds.length ? prisma.customer.findMany({ where: { id: { in: cIds } }, select: 显名列 }) : [],
      prisma.user.findMany({ where: { id: { in: 人ids } }, select: { id: true, name: true } }),
    ]));
    const 名 = new Map<string, string>([...[...项目们, ...线索们].map((x) => [x.id, x.name] as const), ...客户们.map((x) => [x.id, 客户显名(x)] as const)]);
    const 叫 = new Map(人们.map((u) => [u.id, u.name]));
    const 一句 = (c: 改分条 & { 原: string }) => {
      const 是客户 = !c.projectId && !c.leadId;
      const 啥 = 是客户 ? "客户" : "线索";
      const 原名 = `${叫.get(c.原) ?? "原负责人"}${停用前销售.has(c.原) ? "（已停用）" : ""}`;
      return { 啥, 名: 名.get(c.projectId ?? c.leadId ?? c.customerId ?? "") ?? `（一条${啥}）`, 原名, 新名: 叫.get(c.新) ?? "另一位同事" };
    };
    const 按人 = new Map<string, (改分条 & { 原: string })[]>();
    for (const c of 算的) {
      // 原负责人另有通知（批量改负责人已发 改负责人通知 给他，内容一样）：只补直属上级
      for (const id of 负责人和上级(org, c.原, 谁点的.id)) if (id !== c.新 && !(opt.原负责人另有通知 && id === c.原)) 按人.set(id, [...(按人.get(id) ?? []), c]);
    }
    for (const [收, 们] of 按人) {
      const 句们 = 们.map(一句);
      const 页 = 们.every((c) => c.customerId && !c.projectId && !c.leadId) ? "/customers" : 们.every((c) => c.leadId) ? "/leads" : "/projects";
      let title: string;
      if (们.length === 1) {
        const x = 句们[0];
        title = 们[0].原 === 收
          ? `${谁点的.name} 把你名下的${x.啥}「${x.名}」改分给了 ${x.新名}`
          : `${谁点的.name} 把 ${x.原名} 名下的${x.啥}「${x.名}」改分给了 ${x.新名}`;
      } else {
        title = 们.every((c) => c.原 === 收) ? `${谁点的.name} 把你名下的 ${们.length} 条改分给了别人`
          // 原负责人都停用了：收的可能是兜底的系统管理员，不说「下属」
          : 们.every((c) => 停用前销售.has(c.原)) ? `${谁点的.name} 把已停用同事名下的 ${们.length} 条改分给了别人`
          : `${谁点的.name} 把下属名下的 ${们.length} 条改分给了别人`;
      }
      await notify([收], {
        kind: "分配",
        title,
        body: 们.length === 1 ? `从 ${句们[0].原名} 改到 ${句们[0].新名}` : 名单(句们.map((x) => `${x.啥}「${x.名}」从 ${x.原名} 改到 ${x.新名}`)),
        link: 页,
        key: `market-reassign:${们.map((c) => c.projectId ?? c.leadId ?? c.customerId).sort().join(",").slice(0, 400)}:${收}:${分钟()}`,
      });
    }
  });
}

/**
 * 多了一条分配记录以后推「快轮到」（assign-eta.ts 快轮到提醒）：分配通知末尾、市场成员新建时直接指定给销售（direct-assign.ts）都调这一句。
 * 出错吞掉，同别的通知
 */
export async function 分配后估算推送(): Promise<void> {
  await 稳("快轮到提醒", async () => 快轮到提醒(await 读组织()));
}

/**
 * 公海里分出去了：同 分配通知 的口径（自己分给自己不发；一次分配接手人只收一条）。
 * 跟来 = 分客户时名下跟着过来的公海项目数；连客户 = 分项目时客户在客户公海里、整包一起给过来的客户数（P-公海-10）
 */
export async function 公海分配通知(谁点的: 人, toUserId: string, 对象: "客户" | "项目", ids: readonly string[], 跟来 = 0, 连客户 = 0): Promise<void> {
  await 稳("公海分配通知", async () => {
    if (!ids.length || toUserId === 谁点的.id) return;
    const 行们 = await 看全部(async () => (对象 === "客户"
      ? prisma.customer.findMany({ where: { id: { in: [...ids] } }, select: 显名列 }).then((r) => r.map((x) => ({ id: x.id, name: 客户显名(x) })))
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
      prisma.customer.findMany({ where: { id: { in: [...new Set(全部.map((x) => x.customerId))] } }, select: 显名列 }),
    ]));
    const 项目名 = new Map(项目们.map((x) => [x.id, x.name]));
    const 客户名 = new Map(客户们.map((x) => [x.id, 客户显名(x)]));
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

/**
 * 离职交接把在职同事名下「还在待分配」的项目随客户交给了接手人（E-339）：告诉这位同事，写明是待分配被接手、不是项目被拿走。
 * 他在这些客户上的待办和计划不搬、还在他名下。离职的人本人、接手人、已停用的不发；一位同事一条（带走多个合成「N 个待分配项目」）
 */
export async function 离职带走待分配通知(离职者: string, 接手人: string, 条们: readonly 同事待分配条[]): Promise<void> {
  await 稳("离职带走待分配通知", async () => {
    const 按人 = new Map<string, 同事待分配条[]>();
    for (const x of 条们) if (x.原 && x.原 !== 离职者 && x.原 !== 接手人) 按人.set(x.原, [...(按人.get(x.原) ?? []), x]);
    if (!按人.size) return;
    const 人们 = await prisma.user.findMany({ where: { id: { in: [...按人.keys(), 接手人, 离职者] } }, select: { id: true, name: true, active: true } });
    const 人 = new Map(人们.map((u) => [u.id, u]));
    const 全部 = [...按人.values()].flat();
    const [项目们, 客户们] = await 看全部(() => Promise.all([
      prisma.project.findMany({ where: { id: { in: 全部.map((x) => x.id) } }, select: { id: true, name: true } }),
      prisma.customer.findMany({ where: { id: { in: [...new Set(全部.map((x) => x.customerId))] } }, select: 显名列 }),
    ]));
    const 项目名 = new Map(项目们.map((x) => [x.id, x.name]));
    const 客户名 = new Map(客户们.map((x) => [x.id, 客户显名(x)]));
    const 接手名 = 人.get(接手人)?.name ?? "";
    const 离职名 = 人.get(离职者)?.name ?? "离职同事";
    for (const [原, 们] of 按人) {
      if (!人.get(原)?.active) continue;
      const 客户 = [...new Set(们.map((x) => 客户名.get(x.customerId) ?? "（一位客户）"))];
      const 客户串 = 客户.slice(0, 3).map((c) => `「${c}」`).join("、") + (客户.length > 3 ? ` 等 ${客户.length} 位客户` : "");
      const 项目说 = 们.length === 1 ? `待分配项目「${项目名.get(们[0].id) ?? "（一个项目）"}」` : `${们.length} 个待分配项目`;
      await notify([原], {
        kind: "交接",
        title: `你建的${项目说}随 ${离职名} 的离职交接（客户${客户串}）由 ${接手名} 接手`,
        body: "这是待分配的项目换了接手人，不是你的项目被拿走；这些客户上你的待办和计划还在你名下，没做完的可以照常勾完成。",
        link: 们.length === 1 ? `/projects/${们[0].id}` : "/projects",
        key: `offboard-awaiting:${原}:${们.map((x) => x.id).sort().join(",").slice(0, 300)}:${分钟()}`,
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
 * 市场复核 → 能拍板的那几位（org-core 市场复核人们，和拍板同一份：建的人 / 直属市场管理 → 客户创建人那条链 → 无主线索复核人 → 系统管理员；11-18）；
 * 总管理终判 → 系统管理员（同拍板的 是总管理）；销售终验、销售认领 → 项目负责人。
 * 同一条线索同一步同一轮只通知一次（key 带上验证行的 updatedAt）
 */
export async function 验证待办通知(me: 人, projectId: string): Promise<void> {
  await 稳("验证通知", async () => {
    const [p, v, org] = await 看全部(() => Promise.all([
      prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true, ...市场复核要读的 } }),
      prisma.entLeadVerify.findUnique({ where: { projectId }, select: { pending: true, invalidReason: true, reviewNote: true, disputeNote: true, updatedAt: true } }),
      读组织(),
    ]));
    if (!p || !v) return;
    const 步 = 实际待(v.pending, await 无效交给(org));
    if (!步) {
      await 判无效结果通知(me, org, p, v.updatedAt);
      return;
    }
    const 销售步 = 步 === "销售终验" || 步 === "销售认领";
    // 销售那一步：负责人停用了改发他停用前的直属上级（审核 11-18 通知 P2-7）
    const 收 = 销售步
      ? 在职负责人或上级(org, p.ownerId)
      : 步 === "市场复核" ? 市场复核人们(org, p) : [...org.成员.keys()].filter((id) => 是系统管理员of(org, id));
    const 说明 = 步 === "市场复核" ? v.invalidReason : 步 === "销售终验" ? v.reviewNote : 步 === "总管理终判" ? v.disputeNote ?? v.invalidReason : null;
    /*
      同一步只推一遍（审核 11-18 通知 P2-10）：键带验证行 updatedAt，同一步里补理由、撤回再判都会换键再推一遍（正式库 19 秒内同一批人各收 2 条）。
      这位对这个项目这一步还有没读的那条，就不再推；读过了、或到了下一步，照常推
    */
    const 前缀 = `verify:${projectId}:${步}:`;
    const 没读的 = new Set((await prisma.entNotice.findMany({
      where: { userId: { in: 收 }, kind: "线索验证", readAt: null, dedupeKey: { startsWith: 前缀 } },
      select: { userId: true },
    })).map((n) => n.userId));
    await notify(收.filter((id) => id !== me.id && !没读的.has(id)), {
      kind: "线索验证",
      title: 验证标题[步](p.name),
      body: `${me.name} 刚处理了这条线索${说明 ? `：${说明}` : "。"}`,
      // 复核、终判的人多半打不开销售的项目详情：去项目页顶上的「待复核的线索」
      link: 销售步 ? `/projects/${p.id}` : "/projects",
      key: `verify:${projectId}:${步}:${v.updatedAt.getTime()}`,
    });
  });
}

/**
 * 最终判无效（市场复核 / 总管理终判判无效，线索流失）：告诉负责人结果（同一种通知「线索验证」，11-20 补）。
 * 记了判无效待补的（invalid-makeup.ts）加一句「已记 1 条判无效待补，下一条自动分配优先补给你」。
 * 只认最后一步是 市场复核 / 总管理终判 判无效的；销售自己初判即终判的不发（他自己判的）
 */
async function 判无效结果通知(me: 人, org: Awaited<ReturnType<typeof 读组织>>, p: { id: string; name: string; ownerId: string }, 版: Date): Promise<void> {
  const 末 = await 看全部(() => prisma.entLeadVerifyLog.findFirst({ where: { projectId: p.id }, orderBy: [{ at: "desc" }, { id: "desc" }], select: { step: true, verdict: true, note: true } }));
  if (!末 || 末.verdict !== "无效" || (末.step !== "市场复核" && 末.step !== "总管理终判")) return;
  const 补了 = await 这条记了补位(p.id, p.ownerId);
  await notify(在职负责人或上级(org, p.ownerId).filter((id) => id !== me.id), {
    kind: "线索验证",
    title: `线索「${p.name}」${末.step}最终判了无效`,
    body: `${me.name} 判了无效${末.note ? `：${末.note}。` : "。"}${补了 ? "已记 1 条判无效待补，下一条自动分配优先补给你。" : ""}`,
    link: `/projects/${p.id}`,
    key: `verify:${p.id}:判无效:${版.getTime()}`,
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

/** 通知正文里的卡点名：同界面（blocker-rules.ts 卡点显示名），老卡点用标题，新卡点「类型 · 阻碍原因」 */
const 原因名带 = { select: { reason: { select: { name: true } } }, orderBy: [{ reason: { sort: "asc" as const } }, { reason: { name: "asc" as const } }] };
function 通知卡点名(b: { title: string; type: string; description: string; reasons: { reason: { name: string } }[] }): string {
  return 卡点显示名({ title: b.title, type: b.type, 原因们: b.reasons.map((l) => l.reason.name), description: b.description });
}

/** 发布了卡点：告诉项目负责人和他的直属上级（发布的人自己不收）。同一个卡点只发一次 */
export async function 卡点发布通知(me: 人, code: string | undefined): Promise<void> {
  await 稳("卡点发布通知", async () => {
    if (!code) return;
    const [b, org] = await 看全部(() => Promise.all([
      prisma.entBlocker.findUnique({
        where: { code },
        select: { code: true, projectId: true, title: true, type: true, description: true, reasons: 原因名带, project: { select: { name: true, ownerId: true } } },
      }),
      读组织(),
    ]));
    if (!b) return;
    await notify(负责人和上级(org, b.project.ownerId, me.id), {
      kind: "卡点",
      title: `${me.name} 发布了卡点 ${b.code}`,
      body: `项目「${b.project.name}」· ${通知卡点名(b).slice(0, 200)}`,
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
      select: { code: true, projectId: true, creatorId: true, title: true, type: true, description: true, reasons: 原因名带, project: { select: { name: true } } },
    }));
    if (!b) return;
    const 给 = b.creatorId;
    if (!给 || 给 === me.id) return;
    const title = 动作 === "认领" ? `${me.name} 认领了你发布的卡点 ${b.code}` : `你发布的卡点 ${b.code} 已解决`;
    await notify([给], {
      kind: "卡点",
      title,
      body: `项目「${b.project.name}」· ${通知卡点名(b).slice(0, 200)}`,
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
/**
 * 离职交接（11-13 起看板上交一位客户 / 交一个项目 / 全部交给都要接手人确认）：标题按交的是什么说（「1 个项目」「3 位客户、2 个项目」），
 * 发起时的说法从 counts 拼；确认时调用方传实际转成的 段 和转不了跳过的 跳过
 */
export type 离职确认说 = { 段: string; 跳过: string };

export async function 交接通知(me: 人, handoverId: string, 事件: 交接事件, 留下?: readonly 留下的活[], 实转?: readonly string[], 离职实?: 离职确认说): Promise<void> {
  await 稳("交接通知", async () => {
    const h = await 看全部(() => prisma.entHandover.findUnique({ where: { id: handoverId } }));
    if (!h) return;
    const 名 = new Map((await prisma.user.findMany({ where: { id: { in: [h.fromUserId, h.toUserId] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    let 客户 = 0;
    let 个数: Record<string, number> = {};
    try {
      const v = JSON.parse(h.counts) as Record<string, unknown>;
      客户 = Number(v.客户) || 0;
      个数 = Object.fromEntries(Object.entries(v).filter((e): e is [string, number] => typeof e[1] === "number"));
    } catch {
      /* counts 坏了就不报个数 */
    }
    // P-删-10：确认了按实际转成的写（交接期间换了人、进了公海、删了的不算），发起时的个数只用在发起 / 撤回 / 拒收
    if (事件 === "已确认" && 实转) 客户 = 实转.length;
    const 几位 = 客户 ? ` ${客户} 位客户` : "客户";
    const 从 = 名.get(h.fromUserId) ?? "";
    const 收 = 事件 === "发起" || 事件 === "已撤回" ? h.toUserId : h.byUserId;
    const 客户名 = 事件 === "已确认" ? await 交接客户名(实转 ?? 读ids(h.customerIds)) : "";
    const 一位没转 = 事件 === "已确认" && !!实转 && !实转.length && !离职实?.段;
    // 负责人本人转自己的客户 = 申请移交（X-20，客户 11-09 回执 X4）：说「申请移交」，不说「交接」
    const 申请 = h.kind === "转让" && h.byUserId === h.fromUserId;
    // 11-13 起看板发起的离职交接（way = 客户 / 项目 / 全部）：按交的是什么说，不只说几位客户
    const 新离职 = h.kind === "离职" && ["客户", "项目", "全部"].includes(h.way ?? "");
    const 离职发起段 = 新离职 ? 离职段(个数) || "名下剩下的" : "";
    // 发起时接手人要知道接的是谁：单条带名字，全部在正文里列客户名（同原来当场交的通知，不带手机号）
    const [离职客户名, 离职项目名] = 新离职 && 事件 === "发起"
      ? await 看全部(() => Promise.all([
          prisma.customer.findMany({ where: { id: { in: 读ids(h.customerIds).slice(0, 20) } }, select: 显名列 }).then((r) => r.map((x) => 客户显名(x))),
          prisma.project.findMany({ where: { id: { in: 读ids(h.projectIds).slice(0, 20) } }, select: { name: true } }).then((r) => r.map((x) => x.name)),
        ]))
      : [[], []];
    const 单条名 = h.way === "客户" && 离职客户名.length === 1 ? `客户：${离职客户名[0]}` : h.way === "项目" && 离职项目名.length === 1 ? `项目：${离职项目名[0]}` : "";
    const title =
      新离职 && 事件 === "发起" ? `${从} 离职，${me.name} 把他名下的${单条名 ? 单条名 : ` ${离职发起段}`} 交接给你，等你确认`
      : 新离职 && 事件 === "已确认" && 离职实 ? (离职实.段
        ? `${me.name} 确认接手了 ${从} 名下的 ${离职实.段}${客户名}${离职实.跳过 ? `；另有 ${离职实.跳过}在交接期间已被处理，没转` : ""}`
        : `${me.name} 确认了交接，但这些在交接期间已放回公海、换了人或结束了，没有转到 ${me.name} 名下`)
      : 新离职 && 事件 === "已拒收" ? `${me.name} 拒收了你发起的离职交接（${离职发起段}），数据留在 ${从} 名下`
      : 申请 && 事件 === "发起" ? `${me.name} 申请把${几位}移交给你，等你确认`
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
        事件 === "发起"
          ? 新离职
            ? 接一句(单条名 ? "" : [离职客户名.length && `客户：${名单(离职客户名)}`, 离职项目名.length && `项目：${名单(离职项目名)}`].filter(Boolean).join("；"), "在客户页「等你确认的交接」里确认后才转到你名下；确认之前还在离职成员名下。")
            : 申请 ? "你确认后才转到你名下；不确认不生效，客户还在原负责人名下。" : "确认之前这些客户还在原负责人名下，确认后才转到你名下。"
          : "",
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

/**
 * 离职的人恢复启用，他所有没确认的离职交接都撤回了（settings/actions.ts reactivateUser）：每位接手人合成一条
 * 「X 已恢复启用，交给你的 N 笔交接已撤回」，不逐笔发；他们那几条「等你确认」标已读。点的人自己是接手人的不发
 */
export async function 恢复启用撤回交接通知(me: 人, 回来的: string, 撤了: readonly { id: string; toUserId: string }[]): Promise<void> {
  await 稳("恢复启用撤回交接通知", async () => {
    const 按人 = new Map<string, string[]>();
    for (const h of 撤了) 按人.set(h.toUserId, [...(按人.get(h.toUserId) ?? []), h.id]);
    for (const [to, ids] of 按人) {
      await prisma.entNotice.updateMany({ where: { userId: to, dedupeKey: { in: ids.map((x) => `handover:${x}:发起`) }, readAt: null }, data: { readAt: new Date() } });
      if (to === me.id) continue;
      await notify([to], {
        kind: "交接",
        title: `${回来的} 已恢复启用，交给你的 ${ids.length} 笔交接已撤回`,
        body: "不用再确认，客户和项目还在 TA 名下。",
        link: "/customers",
        key: `handover-reactivate:${[...ids].sort().join(",").slice(0, 400)}:${to}`,
      });
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
  const 名们 = (await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids.slice(0, 3) } }, select: 显名列 }))).map((c) => 客户显名(c));
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
    // 全称选填（11-19）：名字空着的客户用 客户显名 兜（简称 → 编号），不再因为名字空把这条通知整条吞掉
    const 行们 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: ids } }, select: 显名列 }));
    const 名 = new Map(行们.map((r) => [r.id, 客户显名(r)]));
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
    const c = await 看全部(() => prisma.customer.findUnique({ where: { id: customerId }, select: { ...显名列, salesOwnerId: true } }));
    if (!c) return;
    await notify([toUserId], {
      kind: "分配",
      title: `${谁点的.name} 把项目分给你：${项目名}`,
      body: 接一句(接一句(`客户：${客户显名(c)}`, 留下 ? "客户也转给你" : null), 留下 ? await 客户上还留着([{ toUserId, 留下 }]) : null),
      link: c.salesOwnerId === toUserId ? `/customers/${customerId}` : `/projects/${projectId}`,
      key: `project-assign:${projectId}:${toUserId}:${分钟()}`,
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
export async function 客户放回公海通知(me: 人, 客户们: readonly { id: string; name: string; shortName?: string | null; customerNo?: number | null; salesOwnerId: string }[], 原因?: string | null, 公海项目: readonly string[] = []): Promise<void> {
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
        单条 ? "" : `客户：${名单(我的.map((c) => 客户显名(c)))}`,
        放回原因(原因),
        项目数 ? `你在${单条 ? "这位客户" : "这些客户"}上负责的 ${项目数} 个项目一起进了线索公海` : null,
        `放回后你看不到${单条 ? "这位客户" : "这些客户"}，也不能自己领回`,
      ].reduce<string>((a, b) => 接一句(a, b ? `${b}。` : null), "");
      await notify([原], {
        kind: "回收",
        title: 单条 ? `${me.name} 把你名下的客户放回了公海：${客户显名(我的[0])}` : `${me.name} 把你名下的 ${我的.length} 位客户放回了公海`,
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
    const 现 = await 看全部(() => prisma.customer.findMany({ where: { id: { in: [...客户ids] }, pool: { is: null } }, select: { ...显名列, salesOwnerId: true } }));
    const 收 = await 在职的原负责人(me, 现.map((c) => c.salesOwnerId));
    for (const 原 of 收) {
      const 我的 = 现.filter((c) => c.salesOwnerId === 原);
      const 单条 = 我的.length === 1;
      await notify([原], {
        kind: "回收",
        title: 单条 ? `${me.name} 撤销了刚才的放回公海，客户回到你名下：${客户显名(我的[0])}` : `${me.name} 撤销了刚才的放回公海，${我的.length} 位客户回到你名下`,
        body: 单条 ? "" : `客户：${名单(我的.map((c) => 客户显名(c)))}`,
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
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true, customer: { select: { ...显名列, salesOwnerId: true, pool: { select: { customerId: true } } } } } }));
    if (!p) return;
    const 客户还归他 = p.customer.salesOwnerId === 原 && !p.customer.pool;
    await notify([原], {
      kind: "回收",
      title: `${me.name} 把你名下的项目放回了线索公海：${p.name}`,
      body: [`客户：${客户显名(p.customer)}`, 放回原因(原因), "放回后你看不到这个项目，也不能自己领回"].reduce<string>((a, b) => 接一句(a, b ? `${b}。` : null), ""),
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
 * 来由「撤回合并」：撤回合并后被并那家拆回来、原负责人已停用（customer-merge.ts），标题说「撤回了合并」，不说从回收站恢复
 */
export async function 恢复到停用负责人通知(
  me: 人,
  条: readonly { id: string; 原: string; 进了公海: boolean; 没进原因?: readonly string[] }[],
  来由: "回收站" | "撤回合并" = "回收站",
): Promise<void> {
  await 稳("恢复到停用负责人通知", async () => {
    if (!条.length) return;
    const [客户行, 人行, org] = await Promise.all([
      看全部(() => prisma.customer.findMany({ where: { id: { in: 条.map((c) => c.id) } }, select: 显名列 })),
      prisma.user.findMany({ where: { id: { in: [...new Set(条.map((c) => c.原))] } }, select: { id: true, name: true } }),
      读组织(),
    ]);
    const 客户名 = new Map(客户行.map((c) => [c.id, 客户显名(c)]));
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
    const 撤合 = 来由 === "撤回合并";
    /** 「张三 从回收站恢复了客户「X」」/「张三 撤回了合并，客户「X」拆回来了」；几位时说个数 */
    const 做了 = (们: 一位[]) =>
      撤合
        ? 们.length === 1 ? `${me.name} 撤回了合并，客户「${们[0].name}」拆回来了` : `${me.name} 撤回了合并，${们.length} 位客户拆回来了`
        : 们.length === 1 ? `${me.name} 从回收站恢复了客户「${们[0].name}」` : `${me.name} 从回收站恢复了 ${们.length} 位客户`;
    const 键头 = 撤合 ? "merge-undo-inactive-owner" : "restore-inactive-owner";
    for (const [谁, { 公海, 留下 }] of 按收件人) {
      if (公海.length) {
        const 单条 = 公海.length === 1;
        await notify([谁], {
          kind: "回收",
          title: 单条 ? `${做了(公海)}，原负责人 ${公海[0].原名} 已停用，客户进了客户公海` : `${做了(公海)}，原负责人已停用，客户进了客户公海`,
          body: 接一句(单条 ? "" : 列(公海), "原负责人自己负责、还没结束的线索 / 商机项目一起进了线索公海，可以从公海领取或分配。"),
          link: 公海入口,
          key: `${键头}:pool:${键(公海)}:${谁}:${分钟()}`,
        });
      }
      if (留下.length) {
        const 单条 = 留下.length === 1;
        const 原因们 = [...new Set(留下.flatMap((c) => c.没进原因))];
        await notify([谁], {
          kind: "交接",
          title: 单条 ? `${做了(留下)}，负责人 ${留下[0].原名} 已停用` : `${做了(留下)}，负责人已停用`,
          body: 接一句(
            单条 ? "" : 列(留下),
            `${单条 ? "这位客户" : "这些客户"}${原因们.length ? `不能进公海（${原因们.join("、")}）` : "没能放进公海"}，还挂在已停用的人名下、没人跟进，请到「项目 → 离职交接」指定接手人。`,
          ),
          link: 离职交接看板,
          key: `${键头}:${键(留下)}:${谁}:${分钟()}`,
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

/* ───────────────────────── 教练主题（11-17） ───────────────────────── */

export type 主题事件 = "发起" | "回复" | "追问" | "关闭";
/**
 * 教练主题的通知（coach-topic-db.ts 调，收件人按 coach-topic.ts 发起通知谁 / 回复通知谁 / 关闭通知谁）。站内铃铛 + 飞书（只推已绑定的）。
 * 飞书会推标题和正文：正文只放一句「去哪看」，**不放主题内容和回复内容**（点评是给销售本人的，11-17 评估）。
 * 键带回复编号：EntNotice 按「人 + 键」去重，同一主题第二次追问、第二次回复各算一条
 */
export async function 主题通知(me: 人, 事件: 主题事件, t: { id: string; title: string; projectId: string; 项目名: string }, 收件人: readonly string[], 回复id?: string): Promise<void> {
  await 稳("主题通知", async () => {
    const 们 = 收件人.filter((x) => x && x !== me.id);
    if (!们.length) return;
    const 话 = 事件 === "发起" ? "发起了点评" : 事件 === "关闭" ? "关闭了主题" : 事件 === "追问" ? "追问了主题" : "回复了主题";
    await notify(们, {
      kind: "主题",
      title: `${me.name} 在项目「${t.项目名}」${话}「${t.title}」`,
      body: "到项目详情「沟通记录」卡顶上看",
      link: `/projects/${t.projectId}`,
      key: `coach-topic:${t.id}:${事件}${回复id ? `:${回复id}` : ""}`,
    });
  });
}

/* ───────────────────────── 录音点评（11-22 PR4） ───────────────────────── */

/**
 * 录音没整理成（coach-rec-jobs.ts 转写失败时调）：只发给录的人自己（铃铛 + 飞书，只推已绑定的）。
 * 标题只写项目名，正文写为什么（给人看的那句，不带密钥、签名）和去哪重试；不带录音、转写内容、文件名（文件名里可能有号码）。
 * 键带时刻：同一条重试后又失败，各算一条
 */
export async function 录音没整理成通知(authorId: string, r: { id: string; projectId: string }, 话: string): Promise<void> {
  await 稳("录音没整理成通知", async () => {
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: r.projectId }, select: { name: true } }));
    await notify([authorId], {
      kind: "录音",
      title: `你在项目「${p?.name ?? "（项目不在了）"}」交的录音点评没整理成`,
      body: `${话.slice(0, 120)}。到项目详情「沟通记录」卡顶上的录音草稿里点「重试整理」，或者删掉重新传`,
      link: `/projects/${r.projectId}`,
      key: `coach-rec-fail:${r.id}:${分钟()}`,
    });
  });
}

/**
 * 录音点评「整理好了」（PR5，改版方案 §4.3）：只给录的人。标题只写项目名；正文说去哪确认发出，不带转写、要点、文件名。
 * 链接带 crec=<录音编号>：点开回到客户页（项目页按原规则跳客户页、带上参数），沟通卡上的草稿条认出这一条就直接打开确认框。
 * 键带录音编号和时刻：重新整理一次又好了，各算一条
 */
export async function 录音整理好了通知(authorId: string, r: { id: string; projectId: string }): Promise<void> {
  await 稳("录音整理好了通知", async () => {
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: r.projectId }, select: { name: true } }));
    await notify([authorId], {
      kind: "录音",
      title: `你在项目「${p?.name ?? "（项目不在了）"}」的录音点评整理好了`,
      body: `到项目详情「沟通记录」卡顶上的录音草稿里确认主题和要点，没问题就发出；没发出的草稿 ${草稿保留天} 天后自动删除`,
      link: `/projects/${r.projectId}?crec=${r.id}`,
      key: `coach-rec-ready:${r.id}:${分钟()}`,
    });
  });
}

/**
 * 录音点评草稿明天到期（PR6，清理一轮在第 6 天发）：只给录的人。标题只写项目名；正文写哪天删、去哪发出。
 * 键带草稿起点：同一条重新整理过（起点变了）再到期，各算一条
 */
export async function 录音草稿快到期通知(authorId: string, r: { id: string; projectId: string; status: string }, 到期: Date, 起点: Date): Promise<void> {
  await 稳("录音草稿快到期通知", async () => {
    const p = await 看全部(() => prisma.project.findUnique({ where: { id: r.projectId }, select: { name: true } }));
    const 哪天 = businessDayjs(到期).format("M 月 D 日 HH:mm");
    await notify([authorId], {
      kind: "录音",
      title: `你在项目「${p?.name ?? "（项目不在了）"}」的录音点评草稿明天到期`,
      body: `没发出的草稿放满 ${草稿保留天} 天自动删除（约 ${哪天}）：到项目详情「沟通记录」卡顶上的录音草稿里${r.status === "待确认" ? "确认发出" : r.status === "待提交" ? "提交整理" : "处理"}，不要了可以直接删掉`,
      link: r.status === "待确认" ? `/projects/${r.projectId}?crec=${r.id}` : `/projects/${r.projectId}`,
      key: `coach-rec-expire-soon:${r.id}:${起点.getTime()}`,
    });
  });
}

/** 录音点评被系统自动删了（PR6：草稿到期、项目进公海 / 回收站）：只给录的人，正文是为什么（不带转写、文件名） */
export async function 录音自动删除通知(authorId: string, r: { id: string; projectId: string }, 话: string): Promise<void> {
  await 稳("录音自动删除通知", async () => {
    // 项目进了回收站的也要写出名字（限定层会把回收站里的藏掉，这里直接读）
    const p = await defaultClient.project.findUnique({ where: { id: r.projectId }, select: { name: true, deletedAt: true } });
    await notify([authorId], {
      kind: "录音",
      title: `你在项目「${p?.name ?? "（项目不在了）"}」的录音点评已自动删除`,
      body: `${话.slice(0, 120)}；录音文件一起删了，要点评请重新录`,
      link: p && !p.deletedAt ? `/projects/${r.projectId}` : "/projects",
      key: `coach-rec-auto-del:${r.id}`,
    });
  });
}

/** 这个月录音转写超过 200 小时（PR6，防密钥被刷）：给系统管理员，一个月只提醒一次 */
export async function 录音转写超量通知(秒: number, 月: string): Promise<void> {
  await 稳("录音转写超量通知", async () => {
    const org = await 读组织();
    const 系统管理员们 = [...org.成员.keys()].filter((id) => 能改后台设置({ id }, org));
    if (!系统管理员们.length) return;
    await notify(系统管理员们, {
      kind: "录音",
      title: `这个月录音转写已经 ${Math.floor(秒 / 3600)} 小时，超过 200 小时`,
      body: "看看是不是正常在用；不对劲的话到设置 → AI 接入 →「语音转文字」先关掉开关，再查审计里的「录音转写」",
      link: "/settings",
      key: `coach-rec-asr-hours:${月}`,
    });
  });
}
