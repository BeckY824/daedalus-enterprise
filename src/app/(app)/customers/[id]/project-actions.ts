"use server";

/**
 * 客户页「新建项目」（企业版项目模式，2026-10-29，定稿 P5 待定 16）：给这位已有的客户再建一个项目，客户自动带上。
 * 建档向导（projects/new）是「客户 + 联系人 + 项目 + 首条沟通」一笔新建，不认已有客户；这里只建后两样，规矩照向导：
 *   项目那几格、首条沟通 —— lib/project/wizard.ts 的 规整项目 / 规整沟通（同一份）
 *   跟进节点 —— 和向导企业版那段同一套（线索阶段的节点，新建只能落在线索验证及之前，11-05）
 *   负责人在职、指派给别人算持有上限、开了超时回收必填下一步时间 —— 同 建档向导
 *   落库 —— 项目、第一行节点变更、首条沟通挂项目、沟通编号、沟通标记、客户最近跟进只往后挪（同 lib/project/from-lead.ts）
 * 分配方式（11-01 会议 §3「新增项目时新增字段分配方式」）：和向导同一套（lib/project/after-create-assign.ts）。
 *   指定分配 = 负责人是选的那位；其余先建在我名下，建好按分配方式走（自动分配没分出去 / 暂不分配 = 留在新线索待分配）。
 *   没传（老调用）= 和原来一样：负责人直接选，不记分配方式、建好不再动。
 *   客户负责人一般不动（P-转-03）；市场名下的客户首次分给销售算转客户（X-18），指定、自动、老弹窗同一条（lib/enterprise/market-transfer.ts）
 * 业务线（A1，11-01 16:1x）：内贸 / 外贸 / 暂不分配三选一，带了分配方式（企业版新弹窗）就必填；没传分配方式的老调用不要求
 * 项目所在地（11-02）：选填，四格 + 详细地址，规整同编辑项目；弹窗按所在地给业务线建议，人确认（提交即确认），服务端不按地址改线
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { 不能当负责人 } from "@/lib/owners";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 同事的客户, 只读话, 看全部 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 公海客户先领取话 } from "@/lib/enterprise/pool-rules";
import { 没设业务角色, 只读角色, 只读角色话 } from "@/lib/enterprise/permissions";
import { 认跟进方式 } from "@/lib/enterprise/dict";
import { 规整项目, 规整沟通, type 向导项目, type 向导跟进 } from "@/lib/project/wizard";
import { 企业版字典, 节点序号 } from "@/lib/project/nodes";
import { 有效线索节点, 建档不能过线索验证, 记沟通标记 } from "@/lib/project/stage-gates";
import { 记沟通编号 } from "@/lib/project/followup-meta";
import { 新项目默认值 } from "@/lib/project/proj-fields";
import { 新项目所在地 } from "@/lib/project/profile-rules";
import { 超上限 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 客户存了推项目 } from "@/lib/project/auto-advance";
import { 客户状态自动, 跟着项目重算 } from "@/lib/enterprise/cust-status-auto-db";
import { 定分配方式, 建好再分, 新建分配方式数据 } from "@/lib/project/after-create-assign";
import { 项目分给你通知, type 留下的活 } from "@/lib/enterprise/notice-sources";
import { 客户在市场手里, 算市场转客户, 转客户给销售 } from "@/lib/enterprise/market-transfer";
import { 分配带走的同事项目 } from "@/lib/carry-over-db";
import type { 转走项目预览 } from "@/lib/carry-over";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 认业务线, 业务线不认得, 业务线必填, 是项目线, type 项目线 } from "@/lib/enterprise/assign-line";

export type 给客户建项目输入 = {
  customerId: string;
  项目: 向导项目;
  跟进: 向导跟进;
  /** 项目挂哪位联系人；不给 = 这位客户的主要联系人（没有就不挂） */
  联系人Id?: string | null;
};

type 结果 = { ok: true; projectId: string; 提示?: string; 转走?: boolean; 看不到客户了?: boolean } | { ok: false; error: string };

/** 跟进节点（和 规整向导 企业版那段同一套口径；11-05 去掉明确回复） */
function 认节点和回复(f: 向导跟进): { 节点: string } | { error: string } {
  const 节点 = typeof f?.节点 === "string" ? f.节点.trim() : "";
  if (!企业版字典.节点们.线索.includes(节点)) return { error: "请选当前进程（线索阶段的哪一步）" };
  if (节点序号({ phase: "线索", node: 节点 }, 企业版字典) > 节点序号({ phase: "线索", node: 有效线索节点 }, 企业版字典)) return { error: 建档不能过线索验证 };
  return { 节点 };
}

export type 新项目分配数据 = Awaited<ReturnType<typeof 新建分配方式数据>> & { 客户业务线: 项目线 | null };

/** 客户页「新增项目」弹窗打开时取：能用的分配方式、按业务角色的默认值、是不是销售（A6 / A9），业务线默认带客户的（A1）。看不到的客户 / 没开 = null */
export async function 新项目分配数据(customerId: string): Promise<新项目分配数据 | null> {
  try {
    const me = await requireUser();
    if (!企业版() || (await getBusiness()).projectMode !== true) return null;
    const 客户 = await prisma.customer.findUnique({ where: { id: String(customerId ?? "") }, select: { bizLine: true } });
    if (!客户) return null;
    return { ...(await 新建分配方式数据(me)), 客户业务线: 是项目线(客户.bizLine) ? 客户.bizLine : null };
  } catch {
    return null;
  }
}

/**
 * 客户页新建项目之前列出会一起转走的同事项目（P-转-07）：这次建完会走 X-18（指定给销售 / 自动分配）、真会带走同事的项目才有，条件同分配弹窗（分配带走的项目）。
 * 门和 给客户建项目 一样；看不到的、建不了的、算不出来的都回 0 个：不拦，建的时候服务端照常查。只读
 */
export async function 建项目带走的项目(customerId: string, 项目: { 分配方式?: number | null; ownerId?: string | null; 业务线?: string | null }): Promise<转走项目预览> {
  const 不弹: 转走项目预览 = { 项目数: 0, 项目: [] };
  const me = await requireUser();
  try {
    if (!企业版() || (await getBusiness()).projectMode !== true || typeof customerId !== "string" || !项目 || typeof 项目 !== "object") return 不弹;
    if (!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } })) || (await 同事的客户(defaultClient, customerId))) return 不弹;
    const org = await 权限组织();
    if (!org || 没设业务角色(org, me.id) || 只读角色(me, org)) return 不弹;
    const 接手人 = typeof 项目.ownerId === "string" ? 项目.ownerId : "";
    // 没带分配方式、负责人又不是自己 = 指定给别人（同 给客户建项目）
    const 分配 = await 定分配方式(me, { 分配方式: 项目.分配方式 ?? 0, ownerId: 接手人 });
    if ("error" in 分配) return 不弹;
    // 自动分配还没挑人（挑的都是销售）；业务线暂不分配的不自动分（建好再分）
    const 自动 = 分配.i === 1 && 项目.业务线 !== "暂不分配";
    const 指定给别人 = 分配.i === 0 && !!接手人 && 接手人 !== me.id;
    if (!自动 && !指定给别人) return 不弹;
    return await 看全部(async () => {
      const 客户 = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, salesOwnerId: true, pool: { select: { customerId: true } } } });
      if (!客户 || !(自动 ? 客户在市场手里(org, 客户) : 算市场转客户(org, 客户, 接手人))) return 不弹;
      return 分配带走的同事项目([客户], 自动 ? "" : 接手人, []);
    });
  } catch {
    return 不弹;
  }
}

export async function 给客户建项目(输入: 给客户建项目输入): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版() || (await getBusiness()).projectMode !== true) return { ok: false, error: "项目模式没开：请管理员在「设置 → 业务配置」里打开" };
    if (!输入 || typeof 输入 !== "object" || typeof 输入.customerId !== "string" || !输入.项目 || !输入.跟进) {
      return { ok: false, error: "项目信息不完整，关掉重新填一次" };
    }
    const customerId = 输入.customerId;
    // 限定层：看不到的客户查不到；同事的 / 虚线下属的客户只读，不给建
    const 客户 = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
    if (!客户) return { ok: false, error: "这位客户已经不在了（或你看不到），刷新看看" };
    if (await 同事的客户(defaultClient, customerId)) return { ok: false, error: await 只读话(defaultClient) };
    // 11-05：公海里的客户不能直接建项目，先领取（建了项目客户还挂在公海、负责人还是空，见 V3.5.1 P-公海-08）
    if (await prisma.customerPool.findUnique({ where: { customerId }, select: { customerId: true } })) return { ok: false, error: 公海客户先领取话 };

    // 11-02：只认业务角色。没设的、管理员（只读）不给建
    const org = await 权限组织();
    if (!org || 没设业务角色(org, me.id)) return { ok: false, error: "你还没有业务角色，不能改数据，请找总管理设置" };
    if (只读角色(me, org)) return { ok: false, error: 只读角色话 };
    const 分配 = 输入.项目.分配方式 === undefined || 输入.项目.分配方式 === null ? null : await 定分配方式(me, 输入.项目);
    if (分配 && "error" in 分配) return { ok: false, error: 分配.error };
    let 指定分配名 = 分配?.i === 0 ? 分配.名 : null;
    // 没带分配方式、负责人又不是自己 = 指定给别人：照「指定分配」查能不能用
    if (!分配 && 输入.项目.ownerId && 输入.项目.ownerId !== me.id) {
      const 指定 = await 定分配方式(me, { 分配方式: 0, ownerId: 输入.项目.ownerId });
      if ("error" in 指定) return { ok: false, error: 指定.error };
      指定分配名 = 指定.名;
    }
    // 指定分配以外：先建在我名下，建好再按分配方式走
    const 项目输入 = !分配 || 分配.i === 0 ? 输入.项目 : { ...输入.项目, ownerId: me.id };
    if (!项目输入.ownerId) return { ok: false, error: "请选项目负责人" };
    const 项目 = 规整项目(项目输入, me.id);
    if ("error" in 项目) return { ok: false, error: 项目.error };
    // 业务线：企业版新弹窗（带了分配方式）必填三选一
    const 业务线 = 认业务线(输入.项目.业务线);
    if (业务线 === undefined) return { ok: false, error: 业务线不认得 };
    if (分配 && !业务线) return { ok: false, error: 业务线必填 };
    // 项目所在地（11-02，选填）：和编辑项目同一套规整；没填五格都是 null
    const 地 = 新项目所在地(输入.项目.所在地);
    if (!地.ok) return { ok: false, error: 地.error };
    const 规则 = await 生效组织规则();
    const 认 = await 认跟进方式(输入.跟进);
    if ("error" in 认) return { ok: false, error: 认.error };
    const 跟进 = 规整沟通(认, { 要下一步: 规则.超时回收.开, 叫法: "首条", 要下一步文字: 规则.超时回收.开 });
    if ("error" in 跟进) return { ok: false, error: 跟进.error };
    const 落 = 认节点和回复(输入.跟进);
    if ("error" in 落) return { ok: false, error: 落.error };

    const 负责人 = await prisma.user.findUnique({ where: { id: 项目.ownerId }, select: { name: true, active: true } });
    if (!负责人?.active) return { ok: false, error: "项目负责人不存在或已停用，请选一位在职成员" };
    const 不行 = await 不能当负责人(项目.ownerId);
    if (不行) return { ok: false, error: 不行 };
    if (项目.ownerId !== me.id) {
      const 超 = await 超上限(prisma, 规则, 项目.ownerId, { phase: "线索", result: null });
      if (超) return { ok: false, error: 超 };
    }

    const 联系人 = 输入.联系人Id
      ? await prisma.contact.findFirst({ where: { id: String(输入.联系人Id), customerId }, select: { id: true } })
      : await prisma.contact.findFirst({ where: { customerId, isPrimary: true }, select: { id: true } });
    if (输入.联系人Id && !联系人) return { ok: false, error: "选的联系人已经不在这位客户名下了，刷新后再选" };

    const 状态开 = await 客户状态自动();
    // 指定给别人，客户在市场手里、接手的是销售：算转客户（X-18，和自动分配同一条）。换负责人之前钉住老签约（事务外，它用全局连接）
    const 指定给别人 = 指定分配名 !== null && 项目.ownerId !== me.id;
    const 读客户 = (db: Parameters<typeof 转客户给销售>[0]) => 看全部(() => db.customer.findUnique({ where: { id: customerId }, select: { salesOwnerId: true, pool: { select: { customerId: true } } } }));
    if (指定给别人 && 算市场转客户(org, await 读客户(prisma), 项目.ownerId)) await 钉住老签约();
    const { projectId, 留下 } = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: {
          ...项目, ...(分配 ? { assignMode: 分配.名 } : {}), ...(业务线 ? { bizLine: 业务线 } : {}), ...地.值, customerId, contactId: 联系人?.id ?? null, creatorId: me.id, phase: "线索", node: 落.节点,
          nextStepAt: 跟进.nextStepAt, nextStepText: 跟进.nextStepText, ...新项目默认值(true),
        },
      });
      await tx.projectNodeLog.create({ data: { projectId: p.id, userId: me.id, toPhase: "线索", toNode: 落.节点 } });
      const f = await tx.followUp.create({
        data: { type: 跟进.type, method: 跟进.method, initiator: 跟进.initiator, content: 跟进.content, occurredAt: 跟进.occurredAt, title: "", status: "已完成", customerId, contactId: 联系人?.id ?? null, ownerId: me.id },
      });
      await tx.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: 落.节点 } });
      await 记沟通编号(tx, f.id, p.id, 跟进.nextStepAt);
      await 记沟通标记(tx, f.id, p.id, "线索", false);
      // 这位可能有更晚的跟进：只往后挪，不往回改
      await tx.customer.updateMany({
        where: { id: customerId, OR: [{ lastFollowAt: null }, { lastFollowAt: { lt: 跟进.occurredAt } }] },
        data: { lastFollowAt: 跟进.occurredAt },
      });
      // 事务里再判一次；转走后我可能就看不到这位客户了，这一段放开范围（同 分项目给）
      const 现客户 = 指定给别人 ? await 读客户(tx) : null;
      const 留下: 留下的活 | undefined = 现客户 && 算市场转客户(org, 现客户, 项目.ownerId)
        ? await 看全部(() => 转客户给销售(tx, customerId, 现客户.salesOwnerId, 项目.ownerId, me.id, 指定分配名!))
        : undefined;
      // 企业版客户状态跟着项目算：多了一个项目（没项目的客户从空变潜在）
      await 看全部(() => 跟着项目重算(tx, 状态开, [customerId]));
      return { projectId: p.id, 留下 };
    });

    await recordAudit({
      user: me, action: "create", entity: "Project", entityId: projectId,
      summary: `客户页新建项目「${项目.name}」（客户「${客户.name}」，负责人 ${负责人.name}${分配 ? `，分配方式「${分配.名}」` : ""}），连同首条沟通`,
      detail: { 项目: 项目.name, 客户: 客户.name, 负责人: 负责人.name, 金额: 项目.amount, 币种: 项目.currency, 节点: 落.节点, ...(分配 ? { 分配方式: 分配.名 } : {}), ...(留下 ? { 客户转给: 负责人.name } : {}) },
    });
    // 转走了：这位客户我可能已经看不到了，放开范围，不然推进被拦、静默跳过（同 建档向导）
    if (留下) await 看全部(() => 客户存了推项目(me, customerId));
    else await 客户存了推项目(me, customerId);
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/follow-ups");
    const 分了 = 分配 ? await 建好再分(me, 分配, projectId, 项目.name, 业务线) : null;
    // 自动 / 公海 / 暂不分配 建好再分 自己管（返回对象）；指定别人走这里，自己留着函数里不发
    if (!分了) await 项目分给你通知(me, 项目.ownerId, projectId, 项目.name, customerId, 留下);
    const 去向 = { ...(分了 ?? {}), ...(留下 ? { 提示: `已指派给 ${负责人.name}`, 转走: true } : {}) };
    // 分走之后这位客户我可能看不到了（市场转给销售）：弹窗据此离开客户页，留着刷新就是 404
    const 还看得到 = !去向.转走 || !!(await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }));
    return { ok: true, projectId, ...去向, ...(还看得到 ? {} : { 看不到客户了: true }) };
  } catch (e) {
    return 不在了(e);
  }
}
