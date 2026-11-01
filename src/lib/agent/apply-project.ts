/**
 * 首页 AI 项目类建议卡的落库（全页面 AI 写入）：只由 dashboard/apply.ts 的 applyProposal 调，人点了确认才走到这里。
 *
 * 一条铁律和 apply.ts 一样：这里不自己写库，每一种卡都转给页面上同一个 server action
 * （改项目节点 / 终止项目进程 / 记项目沟通Action / 解决卡点Action / 记回款 / 删回款 / 线索验证几步 / saveContact / deleteCustomers），
 * 权限、字段权限、团队范围、操作记录都在那里面，用的是确认人自己的身份。没权限 = 原样把那里的话回给卡片，什么都不写。
 *
 * 落库前把卡按库里此刻的样子再核一遍：项目进程、验证走到哪步变了就不写（卡是几分钟前按旧样子出的）。
 */
import { prisma, defaultClient } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import type { BusinessConfig } from "@/lib/business-config";
import { 看全部, 只读客户, 只读话 } from "@/lib/team-scope";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 字典of, 本套位置 } from "@/lib/project/nodes";
import { 有效线索节点 } from "@/lib/project/stage-gates";
import { 读线索验证 } from "@/lib/project/lead-verify";
import { buildProjectProposal, 项目卡缺, 描述项目卡, 认目标, 同一落点, type 项目卡 } from "./project-proposals";
import { 改项目节点, 终止项目进程, 记项目沟通Action, 线索初判Action, 市场复核Action, 销售终验Action, 总管理终判Action, 销售认领Action } from "@/app/(app)/projects/actions";
import { 解决卡点Action } from "@/app/(app)/projects/blocker-actions";
import { 记回款, 删回款 } from "@/app/(app)/projects/payment-actions";
import { saveContact } from "@/app/(app)/customers/[id]/actions";
import { deleteCustomers } from "@/app/(app)/customers/actions";

type 我 = { id: string; name: string; role: string };
/** 和 apply.ts ApplyResult 一个形状（那边 "use server" 文件不能导出类型以外的东西，这里自己写一份） */
export type 项目卡落库 =
  | { ok: true; message: string; 撤销?: { kind: "payment_add"; customerId: string; projectId: string; id: string }; 项目?: string }
  | { ok: false; error: string };

const 话 = (r: unknown, 兜底 = "没写成"): string =>
  r && typeof r === "object" && "error" in r && typeof (r as { error: unknown }).error === "string" ? (r as { error: string }).error : 兜底;

export async function 做项目卡(input: 项目卡, me: 我, b: BusinessConfig): Promise<项目卡落库> {
  // 卡上的值人能改、前端交回来的不可信：同一套校验从头收一遍
  const base = { id: String(input?.id ?? ""), customerId: String(input?.customerId ?? ""), customerName: String(input?.customerName ?? ""), reason: typeof input?.reason === "string" ? input.reason.trim().slice(0, 120) : "" };
  if (!base.reason) return { ok: false, error: "reason 必填" };
  const r = buildProjectProposal(base, input.kind, input as unknown as Record<string, unknown>, b);
  if (!r.ok) return r;
  const p = r.proposal;
  const miss = 项目卡缺(p);
  if (miss.length) return { ok: false, error: `还差${miss.join("、")}，填好再确认` };

  const done = await 分派(p, me);
  if (!done.ok) return done;
  const summary = `确认 AI 建议：${描述项目卡(p)}`;
  await recordAudit({ user: me, action: "ai_apply", entity: "Ai", entityId: p.kind, summary, detail: { 对象: p.targetName, 理由: p.reason } });
  return { ok: true, message: summary.replace("确认 AI 建议：", "已") + (done.补话 ?? ""), ...(done.撤销 ? { 撤销: done.撤销 } : {}), ...(done.项目 ? { 项目: done.项目 } : {}) };
}

type 分派结果 = { ok: true; 补话?: string; 撤销?: { kind: "payment_add"; customerId: string; projectId: string; id: string }; 项目?: string } | { ok: false; error: string };

async function 分派(p: 项目卡, me: 我): Promise<分派结果> {
  switch (p.kind) {
    case "project_node": {
      // 用库里此刻的位置把「去哪一步」重算一遍：和卡上的落点不一样 = 卡出来之后项目被人推过，不写
      const 项 = await prisma.project.findUnique({ where: { id: p.targetId }, select: { id: true, phase: true, node: true, result: true } });
      if (!项) return { ok: false, error: "这个项目已经不在了，或者你看不到它" };
      const 字典 = 字典of(true, (await 生效组织规则()).阶段.出口叫法);
      const 认 = 认目标(p.目标, 本套位置(项, 字典), 字典);
      if (!认.ok) return 认;
      if (!同一落点(认.到, p.到)) return { ok: false, error: "项目进程已经变了，刷新后重新让 AI 出卡" };
      let categoryId: string | null = null;
      if (认.到.result === "异常状态") {
        const 类 = await prisma.projectExceptionCategory.findFirst({ where: { name: p.异常类别, active: true }, select: { id: true } });
        if (!类) return { ok: false, error: `没有叫「${p.异常类别}」的启用中的异常类别` };
        categoryId = 类.id;
      }
      const 附 = { categoryId, 备注: p.原因 || null };
      const 结 = 认.终止 ? await 终止项目进程(p.targetId, 附) : await 改项目节点(p.targetId, 认.到, 附);
      if (!结.ok) return { ok: false, error: 话(结) };
      if ("变了" in 结 && 结.变了 === false) return { ok: false, error: "项目已经在这一步了，没有改动" };
      const 推 = "自动推到" in 结 && Array.isArray(结.自动推到) && 结.自动推到.length ? `；按规则自动推到了 ${结.自动推到.join("、")}` : "";
      return { ok: true, 项目: p.targetId, 补话: 推 };
    }
    case "project_followup": {
      const 项 = await prisma.project.findUnique({ where: { id: p.targetId }, select: { id: true, phase: true } });
      if (!项) return { ok: false, error: "这个项目已经不在了，或者你看不到它" };
      const 结 = await 记项目沟通Action(
        p.targetId,
        { type: p.type, content: p.content, occurredAt: new Date().toISOString(), 下一步时间: p.下一步时间 || null, 阶段: 项.phase, 明确回复: p.明确回复 === "是", 下一步: p.下一步 },
        p.要卡点 ? { type: p.卡点类型, impact: p.影响等级 || undefined, description: p.卡点描述 || undefined } : undefined,
      );
      if (!结.ok) return { ok: false, error: 话(结) };
      const 卡 = "卡点" in 结 && 结.卡点 ? `；卡点 ${结.卡点} 已发布` : "";
      // 沟通已经记上，卡点没发出去：不回滚沟通，把原因说清（人去项目页再发）
      const 没发 = "卡点没发" in 结 && 结.卡点没发 ? `；沟通已记上，但卡点没发出去：${结.卡点没发}` : "";
      return { ok: true, 项目: p.targetId, 补话: 卡 + 没发 };
    }
    case "blocker_resolve": {
      const 卡点 = await prisma.entBlocker.findUnique({ where: { id: p.targetId }, select: { projectId: true } });
      const 结 = await 解决卡点Action(p.targetId, { solution: p.solution, result: p.result });
      if (!结.ok) return { ok: false, error: 话(结) };
      return { ok: true, ...(卡点?.projectId ? { 项目: 卡点.projectId } : {}) };
    }
    case "payment_add": {
      const 结 = await 记回款(p.targetId, { paidAt: p.paidAt, currency: p.currency, amount: p.amount });
      if (!结.ok) return { ok: false, error: 话(结) };
      const id = "id" in 结 ? 结.id : undefined;
      const 推 = "自动推到" in 结 ? 结.自动推到 : undefined;
      // 记这笔顺手把项目自动推走了：撤销只删回款、推回不去，就不给撤销
      const 撤销 = id && !推?.length ? { kind: "payment_add" as const, customerId: p.customerId, projectId: p.targetId, id } : undefined;
      return { ok: true, 项目: p.targetId, ...(撤销 ? { 撤销 } : {}), 补话: 推?.length ? `；按规则自动推到了 ${推.join("、")}（这笔不能从卡上撤销）` : "" };
    }
    case "payment_delete": {
      const 笔 = await prisma.entProjectPayment.findUnique({ where: { id: p.targetId }, select: { projectId: true } });
      const 结 = await 删回款(p.targetId);
      if (!结.ok) return { ok: false, error: 话(结) };
      return { ok: true, ...(笔?.projectId ? { 项目: 笔.projectId } : {}) };
    }
    case "lead_verify": {
      // 复核的人多半看不到这位销售的项目：和 lib/project/lead-verify.ts 一样看全部读；能不能拍板交给各步的 Action 判
      const 项 = await 看全部(() => prisma.project.findUnique({
        where: { id: p.targetId },
        select: { id: true, name: true, phase: true, node: true, result: true, ownerId: true, pooledAt: true, customerId: true },
      }));
      if (!项) return { ok: false, error: "这个项目已经不在了" };
      const 字典 = 字典of(true, (await 生效组织规则()).阶段.出口叫法);
      const 位 = 本套位置(项, 字典);
      if (!(位.phase === "线索" && 位.node === 有效线索节点 && !项.result && !项.pooledAt)) return { ok: false, error: `这条线索现在不在「${有效线索节点}」，没法验证` };
      const 验 = await 读线索验证(me, { ...项, node: 位.node });
      const 该 = 验?.待 ?? "初判";
      if (该 !== p.步) return { ok: false, error: `这条线索现在该「${该}」，不是「${p.步}」：刷新后重新让 AI 出卡` };
      const 结 =
        p.步 === "初判" ? await 线索初判Action(p.targetId, p.判 as "有效" | "无效" | "还需培育", { invalidReason: p.无效原因 || null, verifyNote: p.说明 || null, 下一步时间: p.下一步时间 || null, 计划内容: p.计划内容 || null })
        : p.步 === "市场复核" ? await 市场复核Action(p.targetId, p.判 === "有效", p.说明 || null)
        : p.步 === "销售终验" ? await 销售终验Action(p.targetId, p.判 === "接受", p.说明 || null)
        : p.步 === "总管理终判" ? await 总管理终判Action(p.targetId, p.判 === "有效", p.说明 || null)
        : await 销售认领Action(p.targetId, p.判 === "继续");
      if (!结.ok) return { ok: false, error: 话(结) };
      return { ok: true, 项目: p.targetId };
    }
    case "contact_update": {
      const 人 = await prisma.contact.findFirst({
        where: { id: p.targetId, deletedAt: null },
        select: { id: true, name: true, position: true, phone: true, email: true, wechat: true, remark: true, customerId: true, isPrimary: true, updatedAt: true, customer: { select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: true } } },
      });
      if (!人) return { ok: false, error: "这位联系人已经不在了，或者你看不到" };
      // saveContact 自己不拦只读（客户页上只读时编辑按钮直接不摆）：这里照界面的规矩先拦
      if (人.customer && (await 只读客户(defaultClient, 人.customer))) return { ok: false, error: await 只读话(defaultClient) };
      const 改 = Object.fromEntries(p.改.map((c) => [c.field, c.value])) as Record<string, string>;
      const 企: Record<string, string> = {};
      for (const k of ["gender", "birthday", "hobby", "address"] as const) if (k in 改) 企[k] = 改[k];
      const 结 = await saveContact({
        id: 人.id,
        name: 改.name ?? 人.name,
        position: "position" in 改 ? 改.position : 人.position ?? "",
        phone: 人.phone ?? "", email: 人.email ?? "", wechat: 人.wechat ?? "",
        remark: "remark" in 改 ? 改.remark : 人.remark ?? "",
        customerId: 人.customerId, isPrimary: 人.isPrimary,
        版本: 人.updatedAt.toISOString(),
        ...(Object.keys(企).length ? { 企业: 企 } : {}),
      });
      if (!结.ok) return { ok: false, error: 话(结) };
      return { ok: true };
    }
    case "customer_delete": {
      const c = await prisma.customer.findUnique({ where: { id: p.targetId }, select: { id: true, salesOwnerId: true, channelOwnerId: true, pool: true } });
      if (!c) return { ok: false, error: "这位客户已经不在了，或者你看不到" };
      if (await 只读客户(defaultClient, c)) return { ok: false, error: await 只读话(defaultClient) };
      const 结 = await deleteCustomers([c.id]);
      if (!结.ok) return { ok: false, error: 结.error };
      return { ok: true, 补话: "（进了回收站，30 天内能恢复）" };
    }
  }
}
