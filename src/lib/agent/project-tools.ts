/**
 * 首页 AI 的项目类「出卡」工具（全页面 AI 写入，企业版只用项目时才给，见 run.ts 这一家的工具）。
 *
 * 和 tools.ts 的 proposeTool 同一个分寸：工具只按名字找到那一条、算好落点、往 ctx.proposals 里放一张卡，
 * 一个字都不写库。人在卡上确认后才由 dashboard/apply.ts → agent/apply-project.ts 转给页面上同一个 server action。
 *
 * 找人找项目都走带团队范围的 prisma（看不到的找不到）；公海里同事客户的项目不露客户名（和 list_projects 一个规矩）。
 * 找到不止一个不猜：全放进 候选，人在卡上挑。
 */
import type { Tool, ToolContext, ToolResult } from "./tools";
import { prisma } from "../prisma";
import { 露客户, 看得到的客户, 异常类别字典, 能进公海的阶段 } from "../project/db";
import { 本套位置, 字典of, type 阶段字典 } from "../project/nodes";
import { 生效组织规则 } from "../project/org-rules-store";
import { 有效线索节点 } from "../project/stage-gates";
import { 读线索验证, 待我复核的 } from "../project/lead-verify";
import { 可选项 } from "../enterprise/dict";
import { buildProposal, describeProposal, missingFields } from "./proposals";
import { 认目标, 每步能判, 联系人可改, type 候选, type 项目卡Kind, type 验证步 } from "./project-proposals";
import { 卡点类型们, 影响等级们 } from "../project/blocker-rules";
import { dayjs } from "../utils";

const str = (v: unknown, max = 60) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");
/** 一次最多给人挑几个 */
const 候选上限 = 10;

const 项目列 = { id: true, name: true, customerId: true, ownerId: true, creatorId: true, pooledAt: true, awaitAssignAt: true, phase: true, node: true, result: true, customer: { select: { name: true } } } as const;
type 项目行 = { id: string; name: string; customerId: string; ownerId: string; creatorId: string; pooledAt: Date | null; awaitAssignAt: Date | null; phase: string; node: string; result: string | null; customer: { name: string } };

type 找到 = { ok: true; 行: 项目行[]; 露: (p: 项目行) => boolean } | { ok: false; 话: string };

/**
 * 按 projectId 或名字（项目名、客户名）找项目：先精确、再包含；只在当前账号看得到的范围里。
 * 按客户名找到、但这位客户此刻看不到的（公海里同事的）剔掉，免得拿名字试出来
 */
async function 找项目(ctx: ToolContext, a: Record<string, unknown>): Promise<找到> {
  const id = str(a.projectId, 40);
  const 名 = str(a.project, 60);
  if (!id && !名) return { ok: false, 话: "要说是哪个项目：给 project（项目名或客户名）或 projectId" };
  let 行: 项目行[];
  if (id) {
    const p = await prisma.project.findUnique({ where: { id }, select: 项目列 });
    行 = p ? [p] : [];
  } else {
    行 = await prisma.project.findMany({ where: { OR: [{ name: 名 }, { customer: { name: 名 } }] }, select: 项目列, take: 候选上限 + 1, orderBy: { updatedAt: "desc" } });
    if (!行.length) {
      行 = await prisma.project.findMany({ where: { OR: [{ name: { contains: 名 } }, { customer: { name: { contains: 名 } } }] }, select: 项目列, take: 候选上限 + 1, orderBy: { updatedAt: "desc" } });
    }
  }
  const 可见 = await 看得到的客户(行.map((p) => p.customerId));
  const me = { id: ctx.userId };
  const 露 = (p: 项目行) => 露客户(me, p, 可见);
  行 = 行.filter((p) => !名 || p.name.includes(名) || 露(p));
  if (!行.length) return { ok: false, 话: `当前账号能看到的范围里没找到项目「${名 || id}」` };
  return { ok: true, 行, 露 };
}

const 客户of = (p: 项目行, 露: (p: 项目行) => boolean) => (露(p) ? { customerId: p.customerId, customerName: p.customer.name } : { customerId: "", customerName: "" });
const 项目说明 = (p: 项目行, 露: (p: 项目行) => boolean) => `${露(p) ? `${p.customer.name} · ` : ""}${p.phase}·${p.node}${p.result ? `（${p.result}）` : ""}`;

/**
 * 出一张卡：去重 → buildProposal 收一遍 → 放进 ctx.proposals → 告诉模型还差什么。
 * 一个时：args 里带 targetId / targetName；多个时：targetId 空、带 候选
 */
/** 这一轮出过哪些卡（按 ctx.proposals 这个数组记，一轮一份）：同一个对象同一类只留一张 */
const 出过 = new WeakMap<object, Set<string>>();

function 出卡(ctx: ToolContext, kind: 项目卡Kind, 客户: { id: string; name: string }, args: Record<string, unknown>, 补话 = "", 现值?: Record<string, string>): ToolResult {
  const 候 = (args.候选 as 候选[] | undefined) ?? [];
  const 键 = `${kind}:${args.要卡点 === true ? "卡点" : ""}:${str(args.targetId) || 候.map((c) => c.id).join(",")}`;
  const 记 = 出过.get(ctx.proposals) ?? new Set<string>();
  if (记.has(键)) return { summary: "已经提过了", data: { note: "这张建议卡已经给出，不要重复提" } };
  const 序 = `${kind}-${ctx.proposals.length}-${str(args.targetId) || "pick"}`;
  const r = buildProposal(序, kind, 客户, args, ctx.b);
  if (!r.ok) return { summary: `建议不合法：${r.error}`, data: { error: r.error } };
  记.add(键);
  出过.set(ctx.proposals, 记);
  ctx.proposals.push(现值 ? { ...r.proposal, 现值 } : r.proposal);
  const miss = missingFields(r.proposal, ctx.b);
  const 挑 = 候.length ? `找到 ${候.length} 个，卡上让人挑` : "";
  return {
    summary: `建议：${describeProposal(r.proposal, ctx.b.customer, undefined, ctx.b)}${miss.length ? `（还差 ${miss.join("、")}）` : ""}`,
    data: {
      ok: true, missing: miss,
      note: `${候.length ? "找到不止一个，卡上列了几个让人自己挑，不要替人选，也不要再调同一个工具。" : ""}${miss.length ? "建议卡已给出，留空的人会在卡片上补。" : "建议卡已给出，等人确认。"}不要再调同一个工具，回答里说清楚：确认后才会写入。${补话}`,
      ...(挑 ? { 挑: 挑 } : {}),
    },
  };
}

/** 一个 → 直接指向它；多个 → 候选（每个带自己的 补） */
function 指向(行: 项目行[], 露: (p: 项目行) => boolean, 补of: (p: 项目行) => Record<string, unknown> = () => ({})) {
  const 前 = 行.slice(0, 候选上限);
  if (前.length === 1) {
    const p = 前[0];
    return { 客户: { id: 客户of(p, 露).customerId, name: 客户of(p, 露).customerName }, args: { targetId: p.id, targetName: p.name, projectId: p.id, ...补of(p) } };
  }
  return {
    客户: { id: "", name: "" },
    args: {
      targetId: "", targetName: "",
      候选: 前.map((p): 候选 => ({ id: p.id, 名: p.name, 说明: 项目说明(p, 露), 补: { ...客户of(p, 露), projectId: p.id, ...补of(p) } })),
    },
  };
}

async function 字典() {
  const 规则 = await 生效组织规则();
  return { 规则, 字典: 字典of(true, 规则.阶段.出口叫法) as 阶段字典 };
}

const 卡点类型说 = 卡点类型们.filter((t) => t !== "暂无卡点").join("/");

export const 项目写工具: Tool[] = [
  {
    name: "propose_project_node",
    description: `建议把一个项目推到某个进程、或定结局（线索流失 / 丢单 / 成功交付 / 异常状态）、或终止进程。只出建议卡，人确认后才改。\
目标可以说进程名、出口（如「转商机」「丢单」）、「下一步」或「终止」。线索流失、丢单要写原因；异常状态要给异常类别（不知道就空着，卡上让人选）。`,
    args: `{"project": "项目名或客户名", "projectId": "项目 id，知道就给，可空", "目标": "进程名 / 出口 / 结局 / 下一步 / 终止", "原因": "流失、丢单原因或异常备注，可空", "异常类别": "定异常状态时的类别，可空", "reason": "一句话理由"}`,
    async run(a, ctx) {
      const 目标 = str(a.目标, 20);
      if (!目标) return { summary: "没说推到哪", data: { error: "目标 必填：进程名、出口、结局、「下一步」或「终止」" } };
      const 找 = await 找项目(ctx, a);
      if (!找.ok) return { summary: 找.话, data: { error: 找.话 } };
      const { 字典: 典 } = await 字典();
      const 认们 = 找.行.map((p) => ({ p, 认: 认目标(目标, 本套位置(p, 典), 典) }));
      const 能 = 认们.filter((x) => x.认.ok);
      if (!能.length) {
        const e = 认们[0].认;
        const 话 = !e.ok ? e.error : "推不过去";
        return { summary: `推不过去：${话}`, data: { error: 找.行.length > 1 ? `找到 ${找.行.length} 个，都推不到「${目标}」：${话}` : 话 } };
      }
      const 类们 = (await 异常类别字典()).filter((c) => c.active).map((c) => c.name);
      const 类 = str(a.异常类别, 30);
      if (类 && !类们.includes(类)) return { summary: "异常类别不认得", data: { error: `没有异常类别「${类}」，可选：${类们.join(" / ")}` } };
      const 到of = new Map(能.map((x) => [x.p.id, x.认.ok ? x.认.到 : null]));
      const 指 = 指向(能.map((x) => x.p), 找.露, (p) => ({ 到: 到of.get(p.id) }));
      return 出卡(ctx, "project_node", 指.客户, { ...指.args, 目标, 原因: a.原因, 异常类别: 类, 异常类别们: 类们, reason: a.reason });
    },
  },
  {
    name: "propose_project_followup",
    description: `建议在一个项目上记一条沟通，同时定下一步（做什么、哪天）。只出建议卡，人确认后才记。\
开了超时回收的线索、商机项目，下一步时间必填。要顺手新建卡点用 propose_blocker_add。`,
    args: `{"project": "项目名或客户名", "projectId": "项目 id，可空", "type": "沟通方式，默认电话", "content": "沟通内容", "下一步": "下一步计划", "下一步时间": "YYYY-MM-DD，可空", "reason": "一句话理由"}`,
    async run(a, ctx) {
      return 沟通卡(a, ctx, false);
    },
  },
  {
    name: "propose_blocker_add",
    description: `建议给一个项目加一个卡点（卡点跟着一条沟通发布，和项目页「记沟通 + 新建卡点」一样）。只出建议卡，人确认后才发。\
卡点类型：${卡点类型说}；影响等级：${影响等级们.join("/")}。`,
    args: `{"project": "项目名或客户名", "projectId": "项目 id，可空", "卡点类型": "${卡点类型说}", "影响等级": "${影响等级们.join("/")}，可空", "卡点描述": "卡在哪", "type": "沟通方式，默认电话", "content": "这次沟通内容，可空（空就用卡点描述）", "下一步": "下一步计划", "下一步时间": "YYYY-MM-DD，可空", "reason": "一句话理由"}`,
    async run(a, ctx) {
      return 沟通卡(a, ctx, true);
    },
  },
  {
    name: "propose_blocker_resolve",
    description: "建议在一个卡点上点「我已完成」。只有认领了这个卡点、自己那份还没完成的人才能确认；所有认领人都完成后卡点才变成已解决。只有最后一个完成的人要写解决方案和结果（记到卡点上），其余人只写一句处理说明（放 result，可空）。只出建议卡，人确认后才改。",
    args: `{"project": "项目名或客户名，可空", "blocker": "卡点编号（BLK…）或描述里的关键词，可空", "solution": "怎么解决的", "result": "解决结果", "reason": "一句话理由"}`,
    async run(a, ctx) {
      const 词 = str(a.blocker, 60);
      let 项目ids: string[] | null = null;
      let 露: (p: 项目行) => boolean = () => false;
      const 项目们 = new Map<string, 项目行>();
      if (str(a.project) || str(a.projectId)) {
        const 找 = await 找项目(ctx, a);
        if (!找.ok) return { summary: 找.话, data: { error: 找.话 } };
        项目ids = 找.行.map((p) => p.id);
        露 = 找.露;
        for (const p of 找.行) 项目们.set(p.id, p);
      }
      if (!项目ids && !词) return { summary: "没说是哪个卡点", data: { error: "给 project 或 blocker（卡点编号 / 描述关键词）" } };
      const 卡点们 = await prisma.entBlocker.findMany({
        where: {
          status: { not: "已解决" },
          ...(项目ids ? { projectId: { in: 项目ids } } : {}),
          ...(词 ? { OR: [{ code: 词 }, { title: { contains: 词 } }, { description: { contains: 词 } }] } : {}),
        },
        select: { id: true, code: true, title: true, description: true, status: true, projectId: true, claims: { select: { userId: true, done: true } }, project: { select: 项目列 } },
        orderBy: { createdAt: "desc" },
        take: 候选上限 + 1,
      });
      if (!卡点们.length) return { summary: "没找到没解决的卡点", data: { error: "当前账号能看到的范围里没找到还没解决的卡点" } };
      if (!项目ids) {
        const 可见 = await 看得到的客户(卡点们.map((k) => k.project.customerId));
        露 = (p) => 露客户({ id: ctx.userId }, p, 可见);
      }
      const 名of = (k: (typeof 卡点们)[number]) => `${k.code} ${(k.title || k.description).slice(0, 20)}`;
      const 我的份 = (k: (typeof 卡点们)[number]) => k.claims.find((c) => c.userId === ctx.userId);
      const 说of = (k: (typeof 卡点们)[number]) => {
        const 我 = 我的份(k);
        return `${k.project.name} · ${k.status} · ${k.claims.filter((c) => c.done).length}/${k.claims.length}${我 ? (我.done ? " · 我已完成" : " · 我认领了") : ""}`;
      };
      // 我认领了、我那份没完成、别人都完成了 = 我点完成卡点就解决，方案 / 结果必填；其余情况不必填
      const 最后一个of = (k: (typeof 卡点们)[number]) => { const 我 = 我的份(k); return !!我 && !我.done && k.claims.every((c) => c.userId === ctx.userId || c.done); };
      const 补of = (k: (typeof 卡点们)[number]) => ({ projectId: k.projectId, 最后一个: 最后一个of(k), ...客户of(项目们.get(k.projectId) ?? k.project, 露) });
      const 前 = 卡点们.slice(0, 候选上限);
      const args =
        前.length === 1
          ? { targetId: 前[0].id, targetName: 名of(前[0]), projectId: 前[0].projectId, 最后一个: 最后一个of(前[0]) }
          : { targetId: "", targetName: "", 候选: 前.map((k): 候选 => ({ id: k.id, 名: 名of(k), 说明: 说of(k), 补: 补of(k) })) };
      const 客户 = 前.length === 1 ? (() => { const c = 补of(前[0]); return { id: c.customerId, name: c.customerName }; })() : { id: "", name: "" };
      const 不是我 = 前.length === 1 && !(我的份(前[0]) && !我的份(前[0])!.done);
      return 出卡(ctx, "blocker_resolve", 客户, { ...args, solution: a.solution, result: a.result, reason: a.reason },
        不是我 ? "注意：你没认领这个卡点（或你那份已经点过完成），确认时多半会被拒，回答里照实说。" : "");
    },
  },
  {
    name: "propose_payment_add",
    description: "建议给一个项目记一笔回款（日期、金额、币种）。只出建议卡，人确认后才记；记完可以在卡上撤销。",
    args: `{"project": "项目名或客户名", "projectId": "项目 id，可空", "paidAt": "回款日期 YYYY-MM-DD", "amount": 金额, "currency": "币种代码，可空（默认本位币）", "reason": "一句话理由"}`,
    async run(a, ctx) {
      const 找 = await 找项目(ctx, a);
      if (!找.ok) return { summary: 找.话, data: { error: 找.话 } };
      const 指 = 指向(找.行, 找.露);
      return 出卡(ctx, "payment_add", 指.客户, { ...指.args, paidAt: a.paidAt, amount: a.amount, currency: a.currency, reason: a.reason });
    },
  },
  {
    name: "propose_payment_delete",
    description: "建议删除一个项目的一笔回款（可按日期、金额缩小）。删了不能恢复。只出建议卡，人确认后才删。",
    args: `{"project": "项目名或客户名", "projectId": "项目 id，可空", "paidAt": "那笔的日期 YYYY-MM-DD，可空", "amount": 那笔的金额，可空, "reason": "一句话理由"}`,
    async run(a, ctx) {
      const 找 = await 找项目(ctx, a);
      if (!找.ok) return { summary: 找.话, data: { error: 找.话 } };
      const 日 = str(a.paidAt, 20);
      const d = 日 ? dayjs(日) : null;
      if (d && !d.isValid()) return { summary: "日期看不懂", data: { error: "paidAt 写成 YYYY-MM-DD" } };
      const 额 = typeof a.amount === "number" ? a.amount : str(a.amount) ? Number(str(a.amount).replace(/[,¥￥\s]/g, "")) : null;
      if (额 !== null && !Number.isFinite(额)) return { summary: "金额看不懂", data: { error: "amount 要是数字" } };
      // 回款表不带团队范围：只在上面找到（看得到）的项目里找
      const 项目们 = new Map(找.行.map((p) => [p.id, p]));
      const 笔们 = await prisma.entProjectPayment.findMany({
        where: {
          projectId: { in: [...项目们.keys()] },
          ...(d ? { paidAt: { gte: d.startOf("day").toDate(), lte: d.endOf("day").toDate() } } : {}),
          ...(额 !== null ? { amount: 额 } : {}),
        },
        select: { id: true, projectId: true, paidAt: true, currency: true, amount: true },
        orderBy: { paidAt: "desc" },
        take: 候选上限 + 1,
      });
      if (!笔们.length) return { summary: "没找到这笔回款", data: { error: `项目「${找.行.map((p) => p.name).join("、")}」上没找到对得上的回款` } };
      const 名of = (x: (typeof 笔们)[number]) => `${项目们.get(x.projectId)?.name ?? ""} ${dayjs(x.paidAt).format("YYYY-MM-DD")} ${x.currency} ${x.amount}`;
      const 前 = 笔们.slice(0, 候选上限);
      const 补of = (x: (typeof 笔们)[number]) => ({ projectId: x.projectId, ...客户of(项目们.get(x.projectId)!, 找.露) });
      const args =
        前.length === 1
          ? { targetId: 前[0].id, targetName: 名of(前[0]), projectId: 前[0].projectId }
          : { targetId: "", targetName: "", 候选: 前.map((x): 候选 => ({ id: x.id, 名: 名of(x), 补: 补of(x) })) };
      const 客户 = 前.length === 1 ? (() => { const c = 补of(前[0]); return { id: c.customerId, name: c.customerName }; })() : { id: "", name: "" };
      return 出卡(ctx, "payment_delete", 客户, { ...args, reason: a.reason });
    },
  },
  {
    name: "propose_lead_verify",
    description: `建议对一条在「${有效线索节点}」的线索做验证这一步（初判 / 市场复核 / 销售终验 / 总管理终判 / 销售认领，走到哪步工具自己算）。只出建议卡，人确认后才判。\
判：初判 有效/无效/还需培育；市场复核、总管理终判 有效/无效；销售终验 接受/异议；销售认领 继续/退回公海。初判无效要给无效原因；还需培育要给下一步时间和计划内容；异议要写说明。`,
    args: `{"project": "项目名或客户名", "projectId": "项目 id，可空", "判": "这一步的判定", "说明": "说明，可空", "无效原因": "初判无效时的原因，可空", "下一步时间": "还需培育时 YYYY-MM-DD，可空", "计划内容": "还需培育时的计划，可空", "reason": "一句话理由"}`,
    async run(a, ctx) {
      const me = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { id: true, role: true } });
      if (!me) return { summary: "找不到当前账号", data: { error: "找不到当前账号" } };
      const { 字典: 典 } = await 字典();
      const 名 = str(a.project, 60);
      // 复核的人多半看不到销售的项目：除了看得到的，再并上「待我复核的」里名字对得上的
      const 找 = await 找项目(ctx, a);
      const 行: 项目行[] = 找.ok ? [...找.行] : [];
      const 露 = 找.ok ? 找.露 : () => false;
      const 待我 = await 待我复核的(me);
      const 并 = 待我.filter((x) => !行.some((p) => p.id === x.projectId) && (x.projectId === str(a.projectId, 40) || (!!名 && x.项目.includes(名))));
      const 在验证 = (p: 项目行) => { const 位 = 本套位置(p, 典); return 位.phase === "线索" && 位.node === 有效线索节点 && !p.result && !p.pooledAt; };
      const 候们: { id: string; 名: string; 说明: string; 步: 验证步; 我能: boolean; 客户: { customerId: string; customerName: string } }[] = [];
      for (const p of 行.filter(在验证).slice(0, 候选上限)) {
        const 验 = await 读线索验证(me, { ...p, node: 本套位置(p, 典).node });
        const 步 = (验?.待 ?? "初判") as 验证步;
        候们.push({ id: p.id, 名: p.name, 说明: `${项目说明(p, 露)} · 该${步}`, 步, 我能: !!验?.我能, 客户: 客户of(p, 露) });
      }
      for (const x of 并.slice(0, 候选上限 - 候们.length)) {
        候们.push({ id: x.projectId, 名: x.项目, 说明: `负责人 ${x.负责人 || "—"} · 该${x.步}`, 步: x.步, 我能: true, 客户: { customerId: "", customerName: "" } });
      }
      if (!候们.length) {
        const 话 = 找.ok ? `「${名 || str(a.projectId)}」现在不在「${有效线索节点}」，或者已经验证完了` : 找.话;
        return { summary: 话, data: { error: 话 } };
      }
      const 判 = str(a.判, 10);
      const 原因们 = await 可选项("invalid");
      const 无效原因 = str(a.无效原因, 100);
      if (无效原因 && 原因们.length && !原因们.includes(无效原因)) return { summary: "无效原因不认得", data: { error: `无效原因只能选：${原因们.join(" / ")}` } };
      const 共 = { 判, 说明: a.说明, 无效原因, 无效原因们: 原因们, 下一步时间: a.下一步时间, 计划内容: a.计划内容, reason: a.reason };
      if (候们.length === 1) {
        const c = 候们[0];
        if (判 && !每步能判[c.步].includes(判)) return { summary: "这一步判不了这个", data: { error: `这条线索现在该「${c.步}」，只能判 ${每步能判[c.步].join(" / ")}` } };
        return 出卡(ctx, "lead_verify", { id: c.客户.customerId, name: c.客户.customerName }, { ...共, targetId: c.id, targetName: c.名, projectId: c.id, 步: c.步 },
          c.我能 ? "" : `注意：这一步（${c.步}）现在不归你拍板，确认时会被拒，回答里照实说。`);
      }
      return 出卡(ctx, "lead_verify", { id: "", name: "" }, {
        ...共, targetId: "", targetName: "", 步: "",
        候选: 候们.map((c): 候选 => ({ id: c.id, 名: c.名, 说明: c.我能 ? c.说明 : `${c.说明}（你现在不能做这一步）`, 补: { ...c.客户, projectId: c.id, 步: c.步 } })),
      });
    },
  },
  {
    name: "propose_contact_update",
    description: `建议改一位联系人的${Object.values(联系人可改).join("、")}（电话、邮箱、微信不经 AI 改，请人到联系人页改）。只出建议卡，人确认后才改。`,
    args: `{"contact": "联系人姓名", "customer": "所属客户名，可空（同名时缩小）", "改": [{"field": "${Object.values(联系人可改).join("/")}", "value": "新值"}], "reason": "一句话理由"}`,
    async run(a, ctx) {
      const 名 = str(a.contact, 40);
      if (!名) return { summary: "没说是哪位联系人", data: { error: "contact 必填" } };
      const 客户名 = str(a.customer, 60);
      const 选 = { id: true, name: true, position: true, remark: true, gender: true, birthday: true, hobby: true, address: true, customerId: true, customer: { select: { name: true } } } as const;
      const 条件 = (精确: boolean) => ({ deletedAt: null, name: 精确 ? 名 : { contains: 名 }, ...(客户名 ? { customer: { name: { contains: 客户名 } } } : {}) });
      let 人们 = await prisma.contact.findMany({ where: 条件(true), select: 选, take: 候选上限 + 1 });
      if (!人们.length) 人们 = await prisma.contact.findMany({ where: 条件(false), select: 选, take: 候选上限 + 1 });
      if (!人们.length) return { summary: "没找到这位联系人", data: { error: `当前账号能看到的范围里没找到联系人「${名}」` } };
      const r = buildProposal("probe", "contact_update", { id: "", name: "" }, { 改: a.改, reason: a.reason || "-" }, ctx.b);
      if (!r.ok) return { summary: `建议不合法：${r.error}`, data: { error: r.error } };
      const 改的 = r.proposal.kind === "contact_update" ? r.proposal.改.map((c) => c.field) : [];
      const 现值of = (p: (typeof 人们)[number]) => Object.fromEntries(改的.map((f) => [f, String(p[f] ?? "")]));
      const 前 = 人们.slice(0, 候选上限);
      if (前.length === 1) {
        const p = 前[0];
        return 出卡(ctx, "contact_update", { id: p.customerId, name: p.customer.name }, { 改: a.改, reason: a.reason, targetId: p.id, targetName: p.name }, "", 现值of(p));
      }
      return 出卡(ctx, "contact_update", { id: "", name: "" }, {
        改: a.改, reason: a.reason, targetId: "", targetName: "",
        候选: 前.map((p): 候选 => ({ id: p.id, 名: p.name, 说明: `${p.customer.name}${p.position ? ` · ${p.position}` : ""}`, 补: { customerId: p.customerId, customerName: p.customer.name, 现值: 现值of(p) } })),
      });
    },
  },
  {
    name: "propose_customer_delete",
    description: "建议删除一位客户（进回收站，联系人、项目、沟通记录一起进，30 天内能在回收站恢复）。只在人明确要删时用。只出建议卡，人确认后才删。",
    args: `{"customer": "客户名", "id": "客户 id，知道就给，可空", "reason": "一句话理由"}`,
    async run(a, ctx) {
      const id = str(a.id, 40);
      const 名 = str(a.customer, 60);
      if (!id && !名) return { summary: "没说删哪位", data: { error: "给 customer（客户名）或 id" } };
      const 选 = { id: true, name: true, _count: { select: { projects: true } } } as const;
      let 们 = id
        ? await prisma.customer.findMany({ where: { id }, select: 选 })
        : await prisma.customer.findMany({ where: { name: 名 }, select: 选, take: 候选上限 + 1 });
      if (!们.length && 名) 们 = await prisma.customer.findMany({ where: { name: { contains: 名 } }, select: 选, take: 候选上限 + 1 });
      if (!们.length) return { summary: "没找到这位客户", data: { error: `当前账号能看到的范围里没找到「${名 || id}」` } };
      const 前 = 们.slice(0, 候选上限);
      if (前.length === 1) {
        return 出卡(ctx, "customer_delete", { id: 前[0].id, name: 前[0].name }, { targetId: 前[0].id, targetName: 前[0].name, reason: a.reason });
      }
      return 出卡(ctx, "customer_delete", { id: "", name: "" }, {
        targetId: "", targetName: "", reason: a.reason,
        候选: 前.map((c): 候选 => ({ id: c.id, 名: c.name, 说明: `${c._count.projects} 个项目`, 补: { customerId: c.id, customerName: c.name } })),
      });
    },
  },
];

/** 记沟通 / 加卡点 两个工具共用：下一步时间要不要必填照 项目沟通须知 同一个判断 */
async function 沟通卡(a: Record<string, unknown>, ctx: ToolContext, 要卡点: boolean): Promise<ToolResult> {
  const 找 = await 找项目(ctx, a);
  if (!找.ok) return { summary: 找.话, data: { error: 找.话 } };
  const { 规则 } = await 字典();
  const 要时间 = (p: 项目行) => 规则.超时回收.开 && !p.result && (能进公海的阶段 as readonly string[]).includes(p.phase);
  const 指 = 指向(找.行, 找.露, (p) => (要时间(p) ? { 要时间: true } : {}));
  const 描述 = str(a.卡点描述, 500);
  return 出卡(ctx, "project_followup", 指.客户, {
    ...指.args,
    type: a.type, content: str(a.content, 2000) || (要卡点 ? 描述 : ""), 下一步: a.下一步, 下一步时间: a.下一步时间,
    要卡点, 卡点类型: 要卡点 ? a.卡点类型 : "", 影响等级: 要卡点 ? a.影响等级 : "", 卡点描述: 要卡点 ? 描述 : "",
    reason: a.reason,
  });
}

export const 项目写工具名: ReadonlySet<string> = new Set(项目写工具.map((t) => t.name));
