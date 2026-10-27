/**
 * 企业版首页对话框认名片（2026-10-27）：认出来的表单摆成一张「新建线索」卡，和模型提的那种同一张（ProposalCard），
 * 人核对、改完点确认，走同一条建成项目的路（dashboard/apply.ts 建成项目）。
 *
 * 名称放公司（企业版的客户是公司），联系人放人名；没印公司的名片名称就是人名。
 * 来源：只有一个启用中的渠道就填它，不然留空等人在卡上选（认不出不猜）。
 * 下一步时间先放明天（开了超时回收必填），人在卡上改。
 * 名片上别的格（职位、邮箱、微信……）都拼进备注，不丢
 */
import { buildProposal, type Proposal } from "@/lib/agent/proposals";
import type { BusinessConfig } from "@/lib/business-config";
import { dayjs } from "@/lib/utils";
import type { 名片表单 } from "./form";

export const 名片卡理由 = "从名片认出来的，确认前请核对";

export function 名片成新线索卡(
  填: 名片表单,
  b: Pick<BusinessConfig, "sources" | "fields" | "grades">,
  渠道名们: readonly string[],
  id = "card",
  今 = new Date(),
): { ok: true; proposal: Extract<Proposal, { kind: "add_lead" }> } | { ok: false; error: string } {
  const 人 = 填.name.trim(), 公司 = 填.school.trim();
  const 电话 = 填.phone || 填.whatsapp;
  if (!人 && !公司) return { ok: false, error: "名片上没认出姓名或公司，换一张清楚点的照片再试" };
  const 备注 = [
    填.grade && `职位：${填.grade}`,
    填.major && `行业：${填.major}`,
    填.email && `邮箱：${填.email}`,
    填.wechat && `微信：${填.wechat}`,
    填.whatsapp && 填.whatsapp !== 电话 && `WhatsApp：${填.whatsapp}`,
    填.website && `官网：${填.website}`,
    填.country && `国家：${填.country}`,
    填.remark,
  ].filter(Boolean).join("\n");
  const r = buildProposal(id, "add_lead", { id: "", name: "" }, {
    reason: 名片卡理由,
    name: 公司 || 人,
    contact: 公司 ? 人 : "",
    phone: 电话,
    status: "待跟进",
    remark: 备注,
    nextAt: dayjs(今).add(1, "day").format("YYYY-MM-DD"),
  }, b);
  if (!r.ok) return r;
  if (r.proposal.kind !== "add_lead") return { ok: false, error: "名片卡建不出来" };
  return { ok: true, proposal: { ...r.proposal, source: 渠道名们.length === 1 ? 渠道名们[0] : "" } };
}
