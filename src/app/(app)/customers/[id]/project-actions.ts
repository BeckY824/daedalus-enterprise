"use server";

/**
 * 客户页「新建项目」（企业版项目模式，2026-10-29，定稿 P5 待定 16）：给这位已有的客户再建一个项目，客户自动带上。
 * 建档向导（projects/new）是「客户 + 联系人 + 项目 + 首条沟通」一笔新建，不认已有客户；这里只建后两样，规矩照向导：
 *   项目那几格、首条沟通 —— lib/project/wizard.ts 的 规整项目 / 规整沟通（同一份）
 *   跟进节点、客户是否明确回复 —— 和向导企业版那段同一套（线索阶段的节点、过了线索验证要明确回复）
 *   负责人在职、指派给别人算持有上限、开了超时回收必填下一步时间 —— 同 建档向导
 *   落库 —— 项目、第一行节点变更、首条沟通挂项目、沟通编号、沟通标记、客户最近跟进只往后挪（同 lib/project/from-lead.ts）
 * 分配方式（指定 / 自动 / 公海捞取）不在这里：客户已经有负责人，项目负责人直接选
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 同事的客户, 只读话 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 规整项目, 规整沟通, type 向导项目, type 向导跟进 } from "@/lib/project/wizard";
import { 企业版字典, 节点序号 } from "@/lib/project/nodes";
import { 有效线索节点, 缺有效沟通, 记沟通标记 } from "@/lib/project/stage-gates";
import { 记沟通编号 } from "@/lib/project/followup-meta";
import { 超上限 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 客户存了推项目 } from "@/lib/project/auto-advance";

export type 给客户建项目输入 = {
  customerId: string;
  项目: 向导项目;
  跟进: 向导跟进;
  /** 项目挂哪位联系人；不给 = 这位客户的主要联系人（没有就不挂） */
  联系人Id?: string | null;
};

type 结果 = { ok: true; projectId: string } | { ok: false; error: string };

/** 跟进节点、明确回复两格（和 规整向导 企业版那段同一套口径） */
function 认节点和回复(f: 向导跟进): { 节点: string; 明确回复: boolean } | { error: string } {
  const 节点 = typeof f?.节点 === "string" ? f.节点.trim() : "";
  if (!企业版字典.节点们.线索.includes(节点)) return { error: "请选跟进节点（线索阶段的哪一步）" };
  if (typeof f.明确回复 !== "boolean") return { error: "请选客户是否明确回复" };
  if (节点序号({ phase: "线索", node: 节点 }, 企业版字典) > 节点序号({ phase: "线索", node: 有效线索节点 }, 企业版字典) && !f.明确回复) {
    return { error: 缺有效沟通 };
  }
  return { 节点, 明确回复: f.明确回复 };
}

export async function 给客户建项目(输入: 给客户建项目输入): Promise<结果> {
  try {
    const me = await requireUser();
    if (!企业版() || (await getBusiness()).projectMode !== true) return { ok: false, error: "项目模式没开：请老板在「设置 → 业务配置」里打开" };
    if (!输入 || typeof 输入 !== "object" || typeof 输入.customerId !== "string" || !输入.项目 || !输入.跟进) {
      return { ok: false, error: "项目信息不完整，关掉重新填一次" };
    }
    const customerId = 输入.customerId;
    // 限定层：看不到的客户查不到；同事的 / 虚线下属的客户只读，不给建
    const 客户 = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
    if (!客户) return { ok: false, error: "这位客户已经不在了（或你看不到），刷新看看" };
    if (await 同事的客户(defaultClient, customerId)) return { ok: false, error: await 只读话(defaultClient) };

    if (!输入.项目.ownerId) return { ok: false, error: "请选项目负责人" };
    const 项目 = 规整项目(输入.项目, me.id);
    if ("error" in 项目) return { ok: false, error: 项目.error };
    const 规则 = await 生效组织规则();
    const 跟进 = 规整沟通(输入.跟进, { 要下一步: 规则.超时回收.开, 叫法: "首条" });
    if ("error" in 跟进) return { ok: false, error: 跟进.error };
    const 落 = 认节点和回复(输入.跟进);
    if ("error" in 落) return { ok: false, error: 落.error };

    const 负责人 = await prisma.user.findUnique({ where: { id: 项目.ownerId }, select: { name: true, active: true } });
    if (!负责人?.active) return { ok: false, error: "项目负责人不存在或已停用，请选一位在职成员" };
    if (项目.ownerId !== me.id) {
      const 超 = await 超上限(prisma, 规则, 项目.ownerId, { phase: "线索", result: null });
      if (超) return { ok: false, error: 超 };
    }

    const 联系人 = 输入.联系人Id
      ? await prisma.contact.findFirst({ where: { id: String(输入.联系人Id), customerId }, select: { id: true } })
      : await prisma.contact.findFirst({ where: { customerId, isPrimary: true }, select: { id: true } });
    if (输入.联系人Id && !联系人) return { ok: false, error: "选的联系人已经不在这位客户名下了，刷新后再选" };

    const projectId = await prisma.$transaction(async (tx) => {
      const p = await tx.project.create({
        data: { ...项目, customerId, contactId: 联系人?.id ?? null, creatorId: me.id, phase: "线索", node: 落.节点, nextStepAt: 跟进.nextStepAt, nextStepText: 跟进.nextStepText },
      });
      await tx.projectNodeLog.create({ data: { projectId: p.id, userId: me.id, toPhase: "线索", toNode: 落.节点 } });
      const f = await tx.followUp.create({
        data: { type: 跟进.type, content: 跟进.content, occurredAt: 跟进.occurredAt, title: "", status: "已完成", customerId, contactId: 联系人?.id ?? null, ownerId: me.id },
      });
      await tx.followUpProject.create({ data: { followUpId: f.id, projectId: p.id, node: 落.节点 } });
      await 记沟通编号(tx, f.id, p.id, 跟进.nextStepAt);
      await 记沟通标记(tx, f.id, p.id, "线索", 落.明确回复);
      // 这位可能有更晚的跟进：只往后挪，不往回改
      await tx.customer.updateMany({
        where: { id: customerId, OR: [{ lastFollowAt: null }, { lastFollowAt: { lt: 跟进.occurredAt } }] },
        data: { lastFollowAt: 跟进.occurredAt },
      });
      return p.id;
    });

    await recordAudit({
      user: me, action: "create", entity: "Project", entityId: projectId,
      summary: `客户页新建项目「${项目.name}」（客户「${客户.name}」，负责人 ${负责人.name}），连同首条沟通`,
      detail: { 项目: 项目.name, 客户: 客户.name, 负责人: 负责人.name, 金额: 项目.amount, 币种: 项目.currency, 节点: 落.节点 },
    });
    await 客户存了推项目(me, customerId);
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath(`/customers/${customerId}`);
    revalidatePath("/follow-ups");
    return { ok: true, projectId };
  } catch (e) {
    return 不在了(e);
  }
}
