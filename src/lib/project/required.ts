/**
 * 企业版节点必填 + 自动推进（2026-10-24，D-37）：老板给节点配「必填哪几样」，填齐了项目自动往前推一步。
 * 这里只管目录和算「还差」（界面也引，不能碰 prisma）；读库、推进在 lib/project/db.ts 的 按必填推进。
 *
 * 规矩：
 *   - 没开、或一个节点都没配：和原来完全一样
 *   - 配了必填的节点：填齐了自动推到下一节点（同一步一步走的规矩），留一行节点变更，理由写明是自动推进；
 *     推到的下一个节点也配了、也已经齐了，接着推（一次可能走好几步）
 *   - 没填齐也能保存，只是不推；节点页上列「还差哪几样」
 *   - 配了必填的节点，手动往前推只给老板、主管（销售本人只能靠填齐）；往后退照旧
 *   - 退回到的节点不自动推（退回来一般是要重做，等上级手动推）；退回时已填的都留着
 *   - 没配必填的节点照原来：能管项目的人手动推，不自动推
 * 必填目录只用系统里已有的字段；报价这些还没有的字段，等清单定了再加（合同附件、回款 10-31 加了；痛点标注、项目方案、合同已生效 10-31 迁移 101 加了）
 */
import { 团队版字典, 企业版字典, 企业版旧名换新名, 同名们, type 阶段字典 } from "./stage-dict";
import type { 组织规则 } from "./org-rules";
import { 生效的合同状态 } from "./proj-fields";

export const 必填项们 = [
  { key: "联系方式", 说明: "电话、WhatsApp、微信、邮箱、阿里国际站 ID 任一（客户或联系人上的都算）" },
  { key: "来源", 说明: "客户来源" },
  { key: "国家", 说明: "国家 / 地区" },
  { key: "客户等级", 说明: "A / B / C / D" },
  { key: "主联系人", 说明: "项目上选了主联系人" },
  { key: "需求", 说明: "项目画像的「需求状态」选了（「暂未确认」不算）" },
  { key: "金额", 说明: "项目金额大于 0" },
  { key: "预计成交日期", 说明: "项目的预计成交日期" },
  { key: "下一步时间", 说明: "项目的下一步时间" },
  { key: "本节点沟通", 说明: "在当前进程上记过至少一条沟通" },
  { key: "验收通过", 说明: "「验收通过」打了勾" },
  { key: "合同附件", 说明: "项目的「合同附件」里传了至少一个文件" },
  { key: "回款", 说明: "项目上记了至少一笔回款（当前回款不为 0）" },
  { key: "痛点标注", 说明: "项目的「痛点标注」写了内容" },
  { key: "项目方案", 说明: "项目的「项目方案」里传了至少一个文件" },
  { key: "合同已生效", 说明: "项目的「合同状态」是「已生效」" },
] as const;
export type 必填项 = (typeof 必填项们)[number]["key"];
export const 必填项名们: readonly string[] = 必填项们.map((x) => x.key);
/** 界面上的叫法：「需求」查的是项目画像的需求状态（10-31 前查项目备注），不写明白销售找不到在哪填；「本节点沟通」10-29 起叫「当前进程沟通」（键名照旧，存在组织规则里） */
export const 必填叫法 = (k: string) => (k === "需求" ? "需求（需求状态）" : k === "本节点沟通" ? "当前进程沟通" : k);
/** 需求状态的过渡值（字典 projDemand 第五项）：选了它不算需求填了 */
export const 需求未确认 = "暂未确认";

/**
 * 能配必填的节点：除了最后一个（尾款结算后面只剩点结局，由人点成功交付 / 交付结清）。
 * 两套字典的并集：企业版节点 10-31 改了名，两套的名字都认
 */
const 去尾 = (字典: 阶段字典) => [...字典.节点们.线索, ...字典.节点们.商机, ...字典.节点们.订单].slice(0, -1);
const 企业版能配 = 去尾(企业版字典);
/** 再加改名表里的旧名（库里存过的 key，如当天上线版本存的 方案确认）：读配置时别被当成不认识的丢掉 */
const 旧名们 = Object.keys(企业版旧名换新名).filter((k) => 企业版能配.includes(企业版旧名换新名[k]));
export const 能配必填的节点: readonly string[] = [...new Set([...去尾(团队版字典), ...企业版能配, ...旧名们])];

/**
 * 待确认清单① 的默认建议里、系统已有字段能对上的那几样；设置页「用建议清单」一键填上（部署手册写的默认配置就是这张）。
 * key 用团队版节点名，设置页按 本套节点名 对到企业版新名（明确需求 = 痛点挖掘、共识方案 = 方案敲定、首款支付 = 首款到账）。
 * 10-31 按机制字段回复改：线索验证不再要客户等级、「需求」改看需求状态；痛点挖掘要痛点标注；方案敲定要项目方案；成交推进只要当前进程沟通（金额、预计成交日期不再配）；
 * 首款到账要当前回款不为 0（回款每笔 > 0，记了一笔就不为 0）。
 * 签约审批（合同审批）要合同状态到「已生效」（10-31 晚回问清单定）；安装实施故意不设（不需要安装的订单也得能过）；
 * 签订合同要合同附件；生产备货、物流运输要的采购单、物流单据系统里还没有，等清单定了加字段再配
 */
export const 建议必填: Record<string, 必填项[]> = {
  潜客培育: ["联系方式", "来源", "本节点沟通", "下一步时间"],
  线索验证: ["主联系人", "国家", "需求"],
  线索推进: ["金额"],
  明确需求: ["痛点标注"],
  共识方案: ["项目方案"],
  成交推进: ["本节点沟通"],
  签约审批: ["合同已生效"],
  签订合同: ["合同附件"],
  首款支付: ["回款"],
  验收交付: ["验收通过"],
};

/** 算还差时要的数据（db.ts 读好传进来） */
export type 必填数据 = {
  项目: { node: string; contactId: string | null; nextStepAt: Date | string | null; expectedDealAt: Date | string | null; amount: number; remark: string | null; acceptancePassed: boolean; demandStatus?: string | null };
  客户: {
    phone: string | null;
    extra: { country?: string | null; whatsapp?: string | null; wechat?: string | null; email?: string | null; source?: string | null; level?: string | null; alibabaId?: string | null } | null;
  };
  联系人们: { phone?: string | null; email?: string | null; wechat?: string | null }[];
  /** 挂在项目上的沟通各在哪个节点记的 */
  沟通节点们: string[];
  /** 项目「合同附件」里的文件数、记了几笔回款（10-31）；没读 = 0 */
  合同附件数?: number;
  回款笔数?: number;
  /** 痛点标注、合同状态（迁移 101，库里原样：老项目合同状态是空 = 起草中）、「项目方案」里的文件数；没读 = 没填 / 0 */
  痛点标注?: string | null;
  合同状态?: string | null;
  项目方案数?: number;
};

/**
 * 占位值（M-节点-05）：导入的老数据、手填的「暂无」「待定」「-」这些不算填了。比的时候去掉首尾空白、不分大小写。
 * 名单是我方默认，客户给了再加
 */
export const 占位值们: readonly string[] = [
  需求未确认, "暂无", "无", "没有", "未知", "不详", "待定", "待确认", "未确认", "未填", "未填写", "空",
  "-", "--", "---", "—", "——", "/", "\\", "?", "？", "n/a", "na", "none", "null", "nil", "tbd", "unknown", "0",
];
const 占位集 = new Set(占位值们.map((x) => x.toLowerCase()));
export const 是占位值 = (v: string | null | undefined) => 占位集.has(String(v ?? "").trim().toLowerCase());
/** 有合法值：不是空的、也不是占位值 */
const 有 = (v: string | null | undefined) => !!v && v.trim().length > 0 && !是占位值(v);

function 齐了(项: 必填项, d: 必填数据): boolean {
  const x = d.客户.extra;
  switch (项) {
    case "联系方式":
      return 有(d.客户.phone) || 有(x?.whatsapp) || 有(x?.wechat) || 有(x?.email) || 有(x?.alibabaId)
        || d.联系人们.some((c) => 有(c.phone) || 有(c.email) || 有(c.wechat));
    case "来源": return 有(x?.source);
    case "国家": return 有(x?.country);
    case "客户等级": return 有(x?.level);
    case "主联系人": return !!d.项目.contactId;
    // 10-31 客户定：需求 = 需求状态选了表面触达 / 方向明晰 / 明确需求 / 共识痛点（字典可改名，按「选了、不是暂未确认」认），备注不再算
    case "需求": return 有(d.项目.demandStatus);
    case "金额": return d.项目.amount > 0;
    case "预计成交日期": return !!d.项目.expectedDealAt;
    case "下一步时间": return !!d.项目.nextStepAt;
    // 沟通挂的节点、项目的节点可能一边旧名一边新名（企业版 10-31 改名）：同一个节点就算
    case "本节点沟通": return 同名们(d.项目.node).some((n) => d.沟通节点们.includes(n));
    case "验收通过": return d.项目.acceptancePassed;
    case "合同附件": return (d.合同附件数 ?? 0) > 0;
    case "回款": return (d.回款笔数 ?? 0) > 0;
    case "痛点标注": return 有(d.痛点标注);
    case "项目方案": return (d.项目方案数 ?? 0) > 0;
    case "合同已生效": return d.合同状态 === 生效的合同状态;
  }
}

/** 这个节点配了哪几样（没开 = 空）。项目存的旧名、配置里的旧 key 都按同一个节点认（企业版 10-31 改名） */
export function 节点必填(规则: 组织规则, node: string): 必填项[] {
  if (!规则.节点推进.开) return [];
  const 必填 = 规则.节点推进.必填;
  return (必填[node] ?? 同名们(node).map((n) => 必填[n]).find(Boolean) ?? []) as 必填项[];
}

/** 开了、至少一个节点配了：才按新规矩走（读库、拦手动推进） */
export function 节点推进生效(规则: 组织规则): boolean {
  return 规则.节点推进.开 && Object.values(规则.节点推进.必填).some((l) => l.length > 0);
}

/** 现在这个节点还差哪几样（按配的顺序）；空 = 齐了。没配的节点永远空 */
export function 还差(规则: 组织规则, d: 必填数据): 必填项[] {
  return 节点必填(规则, d.项目.node).filter((项) => !齐了(项, d));
}

/** 这个节点按必填走：开了、配了至少一样 */
export function 按必填走(规则: 组织规则, node: string): boolean {
  return 节点必填(规则, node).length > 0;
}
