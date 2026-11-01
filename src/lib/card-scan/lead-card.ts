/**
 * 企业版首页对话框认名片（2026-10-27）：认出来的表单摆成一张「新建线索」卡，和模型提的那种同一张（ProposalCard），
 * 人核对、改完点确认，走同一条建成项目的路（dashboard/apply.ts 建成项目，和新建客户同一个建档向导）。
 *
 * 名称放公司（企业版的客户是公司），联系人放人名；没印公司的名片名称就是人名。
 * 来源：只有一个启用中的渠道就填它，不然留空等人在卡上选（认不出不猜）。
 * 下一步时间先放明天（开了超时回收必填），人在卡上改。
 * 2026-11-01 起邮箱、微信、WhatsApp、国家是卡上自己的格（建档时进联系人 / 客户地址），职位、行业、官网还拼进备注；
 * 认得没把握的格子（名片标黄的、国家没认出的）进 待确认，人点一下或改一下才能确认。
 * 微信资料页截图另走 微信成新线索卡；销售发图时打的那句话（「广交会的客户」）由 用话补卡 补来源和国家
 */
import { buildProposal, type Proposal, type 线索待确认格 } from "@/lib/agent/proposals";
import type { BusinessConfig } from "@/lib/business-config";
import { dayjs } from "@/lib/utils";
import { 找国家, type 名片表单 } from "./form";
import type { 微信资料 } from "./wechat";

export const 名片卡理由 = "从名片认出来的，确认前请核对";
export const 微信卡理由 = "从微信截图认出来的，确认前请核对";

type 新线索卡 = Extract<Proposal, { kind: "add_lead" }>;
type 出卡 = { ok: true; proposal: 新线索卡 } | { ok: false; error: string };
type 叫法 = Pick<BusinessConfig, "sources" | "fields" | "grades">;

function 摆卡(id: string, args: Record<string, unknown>, b: 叫法, 渠道名们: readonly string[], 今: Date): 出卡 {
  const r = buildProposal(id, "add_lead", { id: "", name: "" }, { status: "待跟进", nextAt: dayjs(今).add(1, "day").format("YYYY-MM-DD"), ...args }, b);
  if (!r.ok) return r;
  if (r.proposal.kind !== "add_lead") return { ok: false, error: "卡建不出来" };
  return { ok: true, proposal: { ...r.proposal, source: 渠道名们.length === 1 ? 渠道名们[0] : "" } };
}

export function 名片成新线索卡(
  填: 名片表单,
  b: 叫法,
  渠道名们: readonly string[],
  id = "card",
  今 = new Date(),
  黄: readonly (keyof 名片表单)[] = [],
): 出卡 {
  const 人 = 填.name.trim(), 公司 = 填.school.trim();
  const 电话 = 填.phone || 填.whatsapp;
  if (!人 && !公司) return { ok: false, error: "名片上没认出姓名或公司，换一张清楚点的照片再试" };
  const 备注 = [
    填.grade && `职位：${填.grade}`,
    填.major && `行业：${填.major}`,
    填.website && `官网：${填.website}`,
    填.remark,
  ].filter(Boolean).join("\n");
  const 待 = new Set<线索待确认格>();
  for (const k of 黄) {
    if (k === "name") 待.add(公司 ? "contact" : "name");
    else if (k === "school") 待.add("name");
    else if (k === "phone" || k === "email" || k === "wechat" || k === "country") 待.add(k);
    else if (k === "whatsapp" && 填.whatsapp !== 电话) 待.add("whatsapp");
  }
  // 名片上没印国家：不猜，人在卡上填或点掉
  if (!填.country.trim()) 待.add("country");
  return 摆卡(id, {
    reason: 名片卡理由,
    name: 公司 || 人,
    contact: 公司 ? 人 : "",
    phone: 电话,
    email: 填.email,
    wechat: 填.wechat,
    whatsapp: 填.whatsapp !== 电话 ? 填.whatsapp : "",
    country: 填.country,
    remark: 备注,
    待确认: [...待],
  }, b, 渠道名们, 今);
}

/**
 * 微信资料页截图 → 新线索卡：名称是人（微信加的都是人，公司后补），微信号进微信格。
 * 昵称拆过（「Babs | Canada」→ Babs）名称待确认、原昵称记进备注；国家没写或只是从昵称猜的也待确认
 */
export function 微信成新线索卡(w: 微信资料, b: 叫法, 渠道名们: readonly string[], id = "card", 今 = new Date()): 出卡 {
  const 名 = w.名字 || w.微信号;
  const 待: 线索待确认格[] = [];
  if (!w.名字 || w.名字拆过) 待.push("name");
  if (!w.国家 || w.国家靠猜) 待.push("country");
  return 摆卡(id, {
    reason: 微信卡理由,
    name: 名,
    contact: "",
    phone: "",
    wechat: w.微信号,
    country: w.国家,
    city: w.城市,
    remark: w.名字拆过 && w.昵称 ? `微信昵称：${w.昵称}` : "",
    待确认: 待,
  }, b, 渠道名们, 今);
}

/** 「香港展会」「广交会」里的地名是展会，不是客户的国家 */
const 展会尾 = /^\s*(展|会|交易会|博览会|广交会|fair|expo|show|exhibition)/i;

/**
 * 销售发图时打的那句话补到卡上（2026-11-01 用户：「录入的时候用户会给出一定的文字描述这个你也要结合上下文」）：
 * - 话里有渠道名（最长的那个）→ 来源；
 * - 话里有国家（不算展会名里的地名）→ 卡上国家空着或待确认就填上；
 * 话里说到的格就不用再确认。别的意思（意向、跟进）交给模型在回答里说，这里不猜
 */
export function 用话补卡(卡: 新线索卡, 话: string, 渠道名们: readonly string[]): 新线索卡 {
  let 剩 = 话.slice(0, 500);
  const 小 = 剩.toLowerCase();
  const 渠道 = [...渠道名们].filter((n) => n.trim()).sort((a, b) => b.length - a.length).find((n) => 小.includes(n.toLowerCase()));
  const 出 = { ...卡 };
  if (渠道) {
    出.source = 渠道;
    const i = 小.indexOf(渠道.toLowerCase());
    剩 = 剩.slice(0, i) + " " + 剩.slice(i + 渠道.length);
  }
  let 国家: string | null = null;
  for (let 起 = 0, 找 = 找国家(剩); 找 && !国家; 找 = 找国家(剩.slice(起))) {
    const 末 = 起 + 找.位 + 找.长;
    if (!展会尾.test(剩.slice(末))) 国家 = 找.国家;
    起 = 末;
  }
  const 待 = new Set(卡.待确认 ?? []);
  if (国家 && (!卡.country || 待.has("country"))) {
    出.country = 国家;
    待.delete("country");
  }
  出.待确认 = [...待];
  if (!出.待确认.length) delete 出.待确认;
  return 出;
}
