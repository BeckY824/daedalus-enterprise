"use server";

/**
 * 重复咨询第一步 · 出口 C 的动作（规矩见 lib/enterprise/repeat-inquiry.ts 文件头）：市场成员查号码撞上同事名下的客户，
 * 在客户负责人名下新建一条带「老客户重复咨询」标记的线索。建档向导（新建线索 / 新建客户）、首页查重框、首页 AI 新线索卡共用这两个动作。
 *
 * 只认号码不认 id（同查重领取）：打开框、交的时候都按号码重查首条撞的那位；框打开时看到的负责人和交的时候对不上（客户刚进公海、
 * 换了负责人）= 这次作废，按最新的查重结果来。一个事务里：建线索项目（起点节点、渠道 = 这次选的、对接人、创建人 = 我、
 * 分配方式 = 指定分配、线跟负责人走、标记）、记一条算数的分配记录（P-转-30 指定也计入名额）、市场分给销售进线索验证、记这条沟通、重算客户状态；
 * 负责人的持有上限照指定分配核（M-公海-18），超了整笔不做。提交后：撞号台账这一行记「新建线索」、通知负责人、操作日志、重算客户三态。
 *
 * 客户负责人接不了指定分配（停用 / 离职、暂停或禁止参与分配、不是销售……）= 交销售（客户 E-213 第一节 2、3 问取 A，E-218 二②）：
 * 照查重领取（pool-actions.ts）先挑人：事务外按客户区域 → 电话 → 本人事业部定线、读挑人底子（repeat-inquiry.ts 交销售候选），
 * 挑接手人 挑本月已分最少的；同一个事务里按重读的数复核、核满额 / 判无效待补，线索直接建在挑中的销售名下（分配方式「自动分配」），
 * 记一条分配记录（计入本月已分）、写流转线、进线索验证，沟通、标记、对接人照上。任何时刻都不落在市场成员名下（他看不到客户名、指派不了）。
 * 是系统分，不过「分配方式谁能用」（挡分配方式）。挑不到人（规则「线索分配」关着、这条线没人、都暂停 / 禁止、都满额）= 整笔不建，
 * 回「这条线没有能接的销售，请找销售管理」（现有的待分配要建的人占着负责人一格，见 repeat-inquiry.ts 文件头）。
 * 客户不动（带标记的线索分配不算市场转客户，market-transfer.ts）。
 *
 * 两条路都没有选人：负责人由系统按上面写，参数里没有负责人，交了别的字段（ownerId 之类）也不认（tests/ent-repeat-inquiry.test.ts 钉着）。
 * 项目名「重复咨询-NO.客户编号」，同一位客户第 2 次起「-2」「-3」，序号读只读字段 repeatSeq（迁移 163）
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { getSetting } from "@/lib/settings";
import { 看全部, 读的我 } from "@/lib/team-scope";
import { 权限组织 } from "@/lib/enterprise/org";
import { 只读角色, 只读话of } from "@/lib/enterprise/permissions";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 认跟进方式, 分配方式叫法 } from "@/lib/enterprise/dict";
import { 规整沟通 } from "@/lib/project/wizard";
import { 落到渠道, 新数据渠道不行 } from "@/lib/enterprise/channel-main";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";
import { 查重领取记沟通, 查重领取建线索项目, 认对接人, 落对接人, 撞上的联系人, 查重领取作废, 查重领取换人, 查重领取理由, 候选挑不到为什么, type 认好的对接人 } from "@/lib/enterprise/dedupe-claim";
import { 出口C可用, 出口C的线, 出口C作废, 出口C作废话, 负责人到上限话, 出口C项目名, 出口C防重分钟, 出口C已转话, 出口C已转过话, 出口C交销售已分话, 出口C没人接话, 交销售候选 } from "@/lib/enterprise/repeat-inquiry";
import type { 查重领取候选 } from "@/lib/enterprise/dedupe-claim";
import { 企划线索计数key, 月份, 计不计数, 挑接手人, 挑的理由, 本月已分, 配额of, 满了 } from "@/lib/enterprise/lead-assign";
import { 本月分配行, 读挑人底子, 读线部门 } from "@/lib/enterprise/assign-eta";
import { 找待用补位, 用掉补位, 待用补位行 } from "@/lib/enterprise/invalid-makeup";
import { 写流转线, 换人定线 } from "@/lib/enterprise/flow-line";
import { 算市场建给销售, 市场分配进线索验证 } from "@/lib/enterprise/market-assign-node";
import { 持有上限起点, 写前核上限, 整批或不做 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 客户状态自动, 跟着项目重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 存沟通后重算三态 } from "@/lib/enterprise/tri-state-db";
import { 分配通知 } from "@/lib/enterprise/notice-sources";
import { 号码撞上 } from "@/lib/enterprise/dupe-ledger";
import { 客户引 } from "@/lib/enterprise/customer-title";
import { 重复咨询来源 } from "@/lib/project/system-created";
import { getBusiness } from "@/lib/business";
import type { 可选渠道 } from "@/components/ChannelPicker";
import type { 查重领取沟通 } from "./pool-actions";

/**
 * 框打开时取：负责人名字（按钮、框头）、交销售（负责人接不了，新线索按区域自动分给销售）、能选的渠道、号码有没有撞上一位联系人
 *（有就默认挂他；框里不列同事客户的资料和联系人名字）。没有选人那一格
 */
export type 出口C框 =
  | { ok: true; 负责人名: string; 交销售: boolean; 渠道们: 可选渠道[]; 有撞上的联系人: boolean }
  | { ok: false; error: string };

/**
 * 这次的对接人：撞上的 = 挂号码撞上的那位客户联系人（不显示他的名字、不改他的信息）；否则填新的人（名字必填、职务选填，在客户下新建一位，不设主联系人）
 */
export type 出口C对接人 = { 撞上的?: boolean; 名字?: string | null; 职务?: string | null };
/**
 * 负责人名 = 框打开时看到的那位客户负责人：交的时候客户换了负责人就作废（不认 id，同查号码不给前端客户 id 以外的东西）。
 * 它只用来核对、不是选人：新线索落给谁全由服务端定（见文件头），这里没有、也不认负责人 / 接手人参数
 */
export type 出口C新项目 = { 渠道?: string | null; 对接人?: 出口C对接人 | null; 负责人名?: string | null };
/** 成功的话不带项目名、客户名（同事的客户，市场成员看不到它的名称）：只说转给了负责人跟进 */
export type 出口C结果 = { ok: true; 提示: string; 负责人: string } | { ok: false; error: string };

export async function 出口C框数据(类型: string, 值: string): Promise<出口C框> {
  const me = await requireUser();
  const 号 = 验号码(类型, 值);
  if (!号.ok) return { ok: false, error: 号.提示 };
  const org = await 权限组织();
  const r = await 出口C可用(org, me.id, 号);
  if (!r.ok) return r;
  // 交销售：框打开就说挑不到人（整笔不建，免得写完沟通才被拒；交的时候照样再挑）
  if (r.目标.交销售) {
    const 候 = await 交销售候选(org!, me.id, r.目标.客户.id, r.目标.负责人);
    if (!候.ok) return 候;
  }
  const 撞上 = await 撞上的联系人(prisma, r.目标.客户.id, 号);
  return { ok: true, 负责人名: r.目标.负责人名, 交销售: r.目标.交销售, 渠道们: await 可选渠道们(), 有撞上的联系人: !!撞上 };
}

export async function 出口C建线索(类型: string, 值: string, 沟通: 查重领取沟通, 新项目?: 出口C新项目): Promise<出口C结果> {
  const me = await requireUser();
  const org = await 权限组织();
  if (org && 只读角色(me, org)) return { ok: false, error: 只读话of(me, org) };
  const 号 = 验号码(类型, 值);
  if (!号.ok) return { ok: false, error: 号.提示 };
  const 判 = await 出口C可用(org, me.id, 号);
  if (!判.ok) return 判;
  const { 客户, 负责人, 负责人名, 交销售 } = 判.目标;
  if (typeof 新项目?.负责人名 === "string" && 新项目.负责人名 && 新项目.负责人名 !== 负责人名) return { ok: false, error: 出口C作废话 };
  // 沟通必填（同记沟通 / 查重领取）：方式、内容、时间；下一步是负责人的格，这里不收
  if (!沟通 || typeof 沟通 !== "object") return { ok: false, error: "要写一条这次的沟通记录" };
  const 认 = await 认跟进方式({ ...沟通 });
  if ("error" in 认) return { ok: false, error: 认.error };
  const 好 = 规整沟通({ ...认, 下一步: null, 下一步时间: null }, { 要下一步: false, 叫法: "这条" });
  if ("error" in 好) return { ok: false, error: 好.error };
  // 这次的渠道必填（同查重领取：主渠道占位落成渠道、停用 / 历史渠道不认）
  const 渠道交 = typeof 新项目?.渠道 === "string" ? 新项目.渠道.trim() : "";
  if (!渠道交) return { ok: false, error: "请选这次的渠道：新建的线索记在这个渠道上" };
  const 落 = await 落到渠道(渠道交, me);
  if (!落.ok) return { ok: false, error: 落.error };
  const 不行 = 落.id ? await 新数据渠道不行(落.id) : "停用";
  if (不行) return { ok: false, error: 不行 === "停用" ? "这个渠道不存在或已停用，换一个" : 不行 };
  const 渠道 = 落.id!;
  // 对接人：挂号码撞上的那位，或填新的人
  let 对接人: 认好的对接人;
  if (新项目?.对接人?.撞上的) {
    const id = await 撞上的联系人(prisma, 客户.id, 号);
    if (!id) return { ok: false, error: "号码对应的联系人已经不在了，请填新的对接人" };
    对接人 = { 挂: id };
  } else {
    const r = await 认对接人(prisma, 客户.id, { 原id: null, 名字: 新项目?.对接人?.名字 ?? null, 职务: 新项目?.对接人?.职务 ?? null });
    if ("error" in r) return { ok: false, error: r.error };
    对接人 = r;
  }
  // 交销售：事务外先读好候选（同查重领取：方向按 客户区域 → 电话 → 我的事业部，P-转-26；客户现负责人回避）；现在就挑不到 = 整笔不建
  let 候: 查重领取候选 | null = null;
  if (交销售) {
    const 读 = await 交销售候选(org!, me.id, 客户.id, 负责人);
    if (!读.ok) return 读;
    候 = 读.候;
  }
  // 主路径：线跟负责人走；交销售：这次定的方向（判不出 = null：项目业务线按接手人的线，流转线按接手人事业部）
  const 线 = 候 ? 候.向.线 : await 出口C的线(org!, 负责人, 客户.id, me.id);
  const [way, 企划算数, 规则, 状态开, 线设] = await Promise.all([
    分配方式叫法(交销售 ? 1 : 0), getSetting<boolean>(企划线索计数key), 生效组织规则(), 客户状态自动(), 交销售 ? 读线部门() : Promise.resolve(null),
  ]);
  const 算数 = 计不计数("营销", 企划算数);
  const 月 = 候?.月 ?? 月份();

  let 项目id = "";
  // 交销售挑人（同查重领取那一圈）：跳过 = 不参与的 + 事务里核出分满的；底 = 挑人底子（同一刻有别的自动分配先写了就重读）
  const 跳过 = new Set(候?.底.不参与 ?? []);
  let 底 = 候?.底 ?? null;
  let 谁 = "";
  let 为什么 = "";
  let 补发 = false;
  let 重挑 = 0;
  let 撞号 = 0;
  for (;;) {
    if (候 && 底) {
      const 挑 = 挑接手人(底.排位(), 跳过, 候.查满, 底.不限额);
      if (!挑) return { ok: false, error: 出口C没人接话(候选挑不到为什么(候, 底)) };
      谁 = 挑;
      为什么 = 查重领取理由(候, 挑的理由(底.排位(), 跳过, 候.查满, 谁, 底.不限额));
    }
    // 新线索建在谁名下：主路径 = 客户负责人；交销售 = 系统挑中的销售（不经过市场成员名下）
    const 接手人 = 交销售 ? 谁 : 负责人;
    try {
      // 整段看全部：客户、联系人、项目都是同事名下的，发起人的限定读看不到（按组织看客户开着时，限定层下的 findFirst / updateMany
      // 一行都碰不到：对接人报「刚被删了」、进线索验证留了痕却没改节点、持有数也数少了）。谁能做已经在 出口C可用 判过
      const r = await 整批或不做(() => 看全部(() => prisma.$transaction(async (tx) => {
        // 事务里再核：客户还不在公海、还在这位负责人名下（打开框到交之间进了公海 / 换了人 = 作废）
        const 现 = await 看全部(() => tx.customer.findUnique({ where: { id: 客户.id }, select: { salesOwnerId: true, customerNo: true, pool: { select: { customerId: true } } } }));
        if (!现 || 现.pool || 现.salesOwnerId !== 负责人) throw new 出口C作废(出口C作废话);
        // 防重复提交：同一客户、我、10 分钟内出口 C 已经建过（两条路都算，框开着时负责人刚被暂停换了路也认）= 认那一条，不新建、不再计数。
        // 只认出口 C 自己建的：两条路的分配记录都是我点的、「从我分出去」（fromUserId = 我）；查重领取建的同标记线索记的是公海客户的原负责人，不算
        const 同标记 = await 看全部(() => tx.project.findMany({
          where: { customerId: 客户.id, creatorId: me.id, source: 重复咨询来源, deletedAt: null, createdAt: { gte: new Date(Date.now() - 出口C防重分钟 * 60_000) } },
          select: { id: true },
        }));
        const 刚建 = 同标记.length
          ? await 看全部(() => tx.entLeadAssign.findFirst({ where: { projectId: { in: 同标记.map((x) => x.id) }, fromUserId: me.id, byUserId: me.id }, orderBy: { createdAt: "desc" }, select: { projectId: true } }))
          : null;
        if (刚建?.projectId) return { 已有: 刚建.projectId };
        // 持有上限（M-公海-18）：同客户页指定给别人，新建的线索算 1 个。交销售那条路照自动分配不看持有上限（A10 / A11）
        if (!交销售) await 写前核上限(tx, await 持有上限起点(tx, 规则, 负责人), 1, "分配");
        // 交销售：按事务里重读的本月分配数再挑一遍，还是他才写（同 自动分给 / 查重领取 的复核）；判无效待补、满额也在这里核
        let 补位id: string | null = null;
        if (候 && 底) {
          if (挑接手人(底.排位(undefined, await 本月分配行(候.人们, 候.月, tx), 底.用补位 ? await 待用补位行(候.人们, tx) : undefined), 跳过, 候.查满, 底.不限额) !== 谁) throw new 查重领取换人(false);
          补位id = 底.用补位 ? await 找待用补位(tx, 谁, 候.向.线) : null;
          if (!补位id && 候.查满 && !底.不限额 && 满了(await 本月已分(谁, 候.月, tx), await 配额of(谁, tx))) throw new 查重领取换人(true);
        }
        const 对接人id = await 落对接人(tx, 客户.id, 对接人, me.id);
        // 项目名第 2 次起加序：序号在 查重领取建线索项目 里按只读字段 repeatSeq 取（含回收站、已结束的），同一个事务里写
        const id = await 查重领取建线索项目(tx, {
          customerId: 客户.id, 项目名: (序) => 出口C项目名(现.customerNo, 序), 接手人, 创建人: me.id, 渠道, 对接人: 对接人id, 线, 分配方式: way,
        });
        // 流转线（32G）：主路径按这次的线写（线跟负责人走）；交销售同自动分配，按这次定的方向写，判不出按接手人事业部（flow-line-core.ts 换人后的线）
        if (交销售) await 换人定线(tx, { 项目: [id] }, { 操作人: me.id, 接手人, 自动: true, 方向: 线 }, { org: org!, 设: 线设! });
        else await 写流转线(tx, 线!, { 项目: [id] });
        // 一条分配记录：主路径 = 指定分配、交销售 = 自动分配，都计入接手人本月已分（P-转-30）；交销售用了判无效待补的 = 补发，不计数
        const 记 = await tx.entLeadAssign.create({
          data: { projectId: id, toUserId: 接手人, fromUserId: me.id, byUserId: me.id, line: 线, kind: "营销", counted: 算数 && !补位id, month: 月, way },
          select: { id: true },
        });
        // 判无效补发：标这个待补用在这条分配上（同 assign-actions 分项目给）；没标上 = 换人重挑
        if (补位id && !(await 用掉补位(tx, 补位id, 记.id, id))) throw new 查重领取换人(false);
        // 市场分给销售：建好就进线索验证（M-线索-04），由接手人判
        if (算市场建给销售(org!, me.id, 接手人)) await 市场分配进线索验证(tx, [id], 接手人, me.id);
        await 查重领取记沟通(tx, me.id, id, 好, new Date());
        await 看全部(() => 跟着项目重算(tx, 状态开, [客户.id]));
        return { 新: id, 补发: !!补位id };
      })));
      if (!r.ok) return { ok: false, error: 负责人到上限话(负责人名) };
      if ("已有" in r.值) return { ok: true, 提示: 出口C已转过话(负责人名, 出口C防重分钟, 交销售), 负责人: 负责人名 };
      项目id = r.值.新;
      补发 = r.值.补发;
      break;
    } catch (e) {
      if (e instanceof 出口C作废 || e instanceof 查重领取作废) return { ok: false, error: e.message.replace("这次没领", "这次没建") };
      // 交销售：挑的人刚被分满了 = 顺延下一位；同一刻别的自动分配先写了 = 按最新的数重挑（同查重领取）
      if (e instanceof 查重领取换人 && 候) {
        if (e.满) { 跳过.add(谁); continue; }
        if (++重挑 > 5) return { ok: false, error: "同时分配的太多，这次没建，请稍后再试" };
        底 = await 读挑人底子(候.人们, 候.月, 候.补位);
        continue;
      }
      // 两边同时交、序号撞了唯一索引（多进程时两笔事务各读到同一个最大号）：整笔已回滚，重来一次（再来就读到对方那条，防重会认它）
      if (序号撞了(e) && ++撞号 < 3) continue;
      throw e;
    }
  }

  const b = await getBusiness();
  const 项目名 = (await 看全部(() => prisma.project.findUnique({ where: { id: 项目id }, select: { name: true } })))?.name ?? "";
  const 接手人名 = 交销售 ? (await prisma.user.findUnique({ where: { id: 谁 }, select: { name: true } }))?.name ?? 谁 : 负责人名;
  await recordAudit({
    user: me, action: "create", entity: "Project", entityId: 项目id,
    summary: 交销售
      ? `查号码撞上同事名下的${b.customer}${客户引(客户)}（负责人「${负责人名}」接不了指定分配），新建线索「${项目名}」按区域自动分配给「${接手人名}」（老客户重复咨询，${b.customer}不动），并记了一条沟通`
      : `查号码撞上同事名下的${b.customer}${客户引(客户)}，在负责人「${负责人名}」名下新建线索「${项目名}」（老客户重复咨询，指定分配），并记了一条沟通`,
    detail: {
      出口C: true, 号码类型: 号.类型, 客户: 客户.id, 负责人, 渠道, 线, 分配方式: way, counted: 算数 && !补发, month: 月, 新建对接人: "建" in 对接人,
      ...(交销售 ? { 交销售: true, 给: 谁, 方向: 候!.向, 为什么, ...(补发 ? { 判无效补发: true } : {}) } : {}),
    },
  });
  // 撞号台账：这次的结果记「新建线索」（查重时记的「拦截」那一行，10 分钟内并进去；不计入预警次数，dupe-ledger.ts）
  await 号码撞上(me.id, await 读的我(defaultClient), 号, "新建线索");
  if (交销售) {
    // 项目上也记一条（同查重领取 / assign-actions 分项目给）：项目的操作日志里看得到这次分配
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: 项目id,
      summary: `分配新线索「${项目名}」给 ${接手人名}${线 ? `（${线}）` : ""}${补发 ? "，判无效补发、不计数" : 算数 ? "" : "，不计数"}`,
      detail: { toUserId: 谁, fromUserId: me.id, line: 线, kind: "营销", counted: 算数 && !补发, month: 月, 分配方式: way, 出口C: true },
    });
    await 分配通知(me, [{ projectId: 项目id, toUserId: 谁 }], true,
      `老客户重复咨询：${me.name} 查号码撞上这位${b.customer}，原负责人接不了，按区域自动分给你这条新线索（创建人记 ${me.name}，${b.customer}负责人不变），这次的沟通记在它上面。如与原项目同一需求，线索验证时选「重复线索」`);
    await 存沟通后重算三态(客户.id);
    revalidatePath("/projects");
    revalidatePath("/leads");
    revalidatePath(`/customers/${客户.id}`);
    return { ok: true, 提示: 出口C交销售已分话(接手人名, 负责人名), 负责人: 负责人名 };
  }
  await 分配通知(me, [{ projectId: 项目id, toUserId: 负责人 }], false,
    `老客户重复咨询：${me.name} 查号码撞上你名下的这位${b.customer}，在你名下新建了这条线索（创建人记 ${me.name}），这次的沟通记在它上面。如与原项目同一需求，线索验证时选「重复线索」`);
  // 客户三态：照现状算一次动静（客户 11-22 拍板 3），关着不查库
  await 存沟通后重算三态(客户.id);
  revalidatePath("/projects");
  revalidatePath("/leads");
  revalidatePath(`/customers/${客户.id}`);
  return { ok: true, 提示: 出口C已转话(负责人名), 负责人: 负责人名 };
}

/** 序号撞了 (repeatOfCustomerId, repeatSeq) 的唯一索引（Prisma P2002）：出口C建线索 重来一次 */
function 序号撞了(e: unknown): boolean {
  if (!e || typeof e !== "object" || (e as { code?: unknown }).code !== "P2002") return false;
  return JSON.stringify((e as { meta?: unknown }).meta ?? "").includes("repeatSeq");
}
