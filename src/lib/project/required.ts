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
 * 必填目录只用系统里已有的字段；报价这些还没有的字段，等清单定了再加（合同附件、回款 10-31 加了；痛点标注、项目方案、合同已生效 10-31 迁移 101 加了；
 * 11-01 按客户「项目阶段字段配置矩阵」把系统里已有的列都补进来，验收材料系统里没有，待定）
 */
import { 团队版字典, 企业版字典, 企业版旧名换新名, 同名们, type 阶段字典 } from "./stage-dict";
import type { 组织规则 } from "./org-rules";
import { 生效的合同状态 } from "./proj-fields";

export const 必填项们 = [
  { key: "联系方式", 说明: "电话、WhatsApp、微信、邮箱、阿里国际站 ID 任一（客户或联系人上的都算）" },
  { key: "来源", 说明: "客户来源" },
  { key: "国家", 说明: "国家 / 地区" },
  { key: "客户等级", 说明: "A / B / C / D" },
  { key: "主联系人", 叫法: "所属联系人", 说明: "项目上选了主联系人（所属联系人）" },
  { key: "需求", 叫法: "需求（需求状态）", 说明: "项目画像的「需求状态」选了（「暂未确认」不算）" },
  { key: "金额", 叫法: "预计成交金额", 说明: "项目金额（预计成交金额）大于 0" },
  { key: "预计成交日期", 说明: "项目的预计成交日期" },
  { key: "下一步时间", 说明: "项目的下一步时间" },
  { key: "本节点沟通", 叫法: "当前进程沟通", 说明: "在当前进程上记过至少一条沟通" },
  { key: "验收通过", 说明: "「验收通过」打了勾" },
  { key: "合同附件", 说明: "项目的「合同附件」里传了至少一个文件" },
  { key: "回款", 叫法: "当前回款", 说明: "项目上记了至少一笔回款（当前回款不为 0）" },
  { key: "痛点标注", 叫法: "痛点描述（痛点标注）", 说明: "项目的「痛点标注」写了内容" },
  { key: "项目方案", 说明: "项目的「项目方案」里传了至少一个文件" },
  { key: "合同已生效", 叫法: "合同状态（已生效）", 说明: "项目的「合同状态」是「已生效」" },
  // 11-01 按客户「项目阶段字段配置矩阵」补：都是系统里已有的列，判定同样是「占位值不算」
  { key: "下一步计划", 说明: "项目的下一步计划（记沟通时写的那句话）" },
  { key: "沟通三项", 叫法: "当前进程沟通（发起主体、沟通内容、沟通方式）", 说明: "在当前进程上至少一条沟通把发起主体、沟通内容、沟通方式三样都填了（缺一样不算）" },
  { key: "需求类型", 说明: "项目画像的「需求类型」至少选了一项" },
  { key: "需求描述", 叫法: "需求描述（成交需求）", 说明: "项目的「成交需求」写了内容" },
  { key: "分配方式", 说明: "新建时选了分配方式，或项目分配记录上有分配方式，或客户的「分配方式（客户）」选了" },
  { key: "项目名称", 说明: "项目名称写了" },
  { key: "所属客户", 说明: "项目挂在一位客户名下" },
  { key: "项目来源", 说明: "项目来源选了渠道" },
  { key: "项目所在地", 说明: "项目所在地的国家 / 地区选了" },
  { key: "项目级别", 叫法: "项目级别 / 项目标签", 说明: "项目级别（项目标签）选了；两个叫法在系统里是同一项" },
  { key: "有效沟通", 叫法: "线索验证机制（有效沟通）", 说明: "至少一条「客户明确回复了」的沟通" },
  { key: "线索验证结果", 说明: "线索验证判了「有效线索」，且没在等复核 / 认领" },
  { key: "预算能力", 说明: "项目画像的「预算能力」选了" },
  { key: "价格感知", 说明: "项目画像的「价格感知」选了" },
  { key: "决策链路", 说明: "项目画像的「决策链路」选了" },
  { key: "采购周期", 说明: "项目画像的「采购周期」选了" },
  { key: "产品匹配", 说明: "项目画像的「产品匹配」选了" },
  { key: "价值认同", 说明: "项目画像的「价值认同」选了" },
  { key: "决策触达", 说明: "项目画像的「决策触达」选了" },
  { key: "竞品信息", 说明: "项目画像的「竞品信息」选了" },
  { key: "部署条件", 说明: "项目画像的「部署条件」选了" },
  { key: "场地现状", 说明: "项目画像的「场地现状」选了" },
  { key: "合同金额", 说明: "项目的合同金额大于 0" },
  { key: "定金金额", 说明: "项目的定金金额大于 0" },
  { key: "尾款结清", 说明: "「尾款结清」打了勾" },
] as const satisfies readonly { key: string; 叫法?: string; 说明: string }[];
export type 必填项 = (typeof 必填项们)[number]["key"];
export const 必填项名们: readonly string[] = 必填项们.map((x) => x.key);
/**
 * 界面上的叫法：键名存在组织规则里不改，给人看的写明白在哪填（「需求」查需求状态、「本节点沟通」10-29 起叫当前进程沟通；
 * 11-01 按客户矩阵的字段名：金额 = 预计成交金额、回款 = 当前回款、主联系人 = 所属联系人…）。没写叫法的原样
 */
const 叫法表: Record<string, string> = Object.fromEntries(必填项们.flatMap((x) => ("叫法" in x ? [[x.key, x.叫法]] : [])));
export const 必填叫法 = (k: string) => 叫法表[k] ?? k;
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
 * 默认建议（设置页「用建议清单」一键填上，部署手册写的默认配置就是这张）：11-01 按客户「项目阶段字段配置矩阵」整张重排。
 * key 用团队版节点名，设置页按 本套节点名 对到企业版新名（明确需求 = 痛点挖掘、共识方案 = 方案敲定、签约审批 = 合同审批、首款支付 = 首款到账、验收交付 = 交付验收）。
 *   - 每个节点（尾款结算除外）都要下一步计划、下一步时间；潜客培育到首款到账九个节点还要当前进程沟通三项（发起主体、沟通内容、沟通方式）
 *   - 项目标签、项目级别在系统里是同一列，合成「项目级别」一项；「线索验证机制字段」按有效沟通（客户明确回复的沟通）认
 *   - 尾款结算是最后一个节点，不能配：尾款结清、验收通过由「交付结清」结局硬拦（nodes.ts 改节点问题），它的下一步计划 / 时间配不了
 *   - 交付验收的「验收材料」系统里没有对应字段，等定了再加
 *   - 线索流失、商机丢单要写原因，异常状态要选类别：结局校验本来就在服务端拦（nodes.ts 改节点问题），不走这张表
 */
const 下一步: 必填项[] = ["下一步计划", "下一步时间"];
const 沟通下一步: 必填项[] = ["沟通三项", ...下一步];
export const 建议必填: Record<string, 必填项[]> = {
  潜客培育: ["需求类型", "分配方式", "项目名称", "所属客户", "主联系人", "项目来源", "项目所在地", ...沟通下一步],
  线索验证: ["需求描述", "有效沟通", "分配方式", "项目级别", "线索验证结果", ...沟通下一步],
  线索推进: ["需求", ...沟通下一步],
  明确需求: ["预算能力", "痛点标注", ...沟通下一步],
  共识方案: ["价格感知", "采购周期", "产品匹配", "竞品信息", "项目方案", "金额", "预计成交日期", ...沟通下一步],
  成交推进: ["决策链路", "价值认同", "决策触达", ...沟通下一步],
  签约审批: ["部署条件", "合同已生效", ...沟通下一步],
  签订合同: ["合同附件", "合同金额", "定金金额", ...沟通下一步],
  首款支付: ["回款", ...沟通下一步],
  生产备货: [...下一步],
  物流运输: [...下一步],
  安装实施: ["场地现状", ...下一步],
  验收交付: ["验收通过", ...下一步],
};

/** 算还差时要的数据（db.ts 读好传进来）。11-01 加的几样都可不传：没读 = 没填 */
export type 必填数据 = {
  项目: {
    node: string; contactId: string | null; nextStepAt: Date | string | null; expectedDealAt: Date | string | null; amount: number; remark: string | null; acceptancePassed: boolean; demandStatus?: string | null; assignMode?: string | null;
    name?: string | null; channelId?: string | null; addrCountry?: string | null; level?: string | null; dealDemand?: string | null; nextStepText?: string | null;
    contractAmount?: number | null; depositAmount?: number | null; balanceSettled?: boolean;
  } & { [列 in 画像列]?: string | null };
  客户: {
    phone: string | null;
    extra: { country?: string | null; whatsapp?: string | null; wechat?: string | null; email?: string | null; source?: string | null; level?: string | null; alibabaId?: string | null } | null;
    /** 分配方式（客户）Customer.assignWay */
    assignWay?: string | null;
  };
  /** 客户还在（所属客户）；没读 = 不在 */
  有客户?: boolean;
  联系人们: { phone?: string | null; email?: string | null; wechat?: string | null }[];
  /** 挂在项目上的沟通各在哪个节点记的 */
  沟通节点们: string[];
  /** 挂在项目上的每条沟通：哪个节点记的、发起主体、内容、方式（沟通三项用） */
  沟通们?: { node: string; initiator: string | null; content: string | null; method: string | null }[];
  /** 项目「合同附件」里的文件数、记了几笔回款（10-31）；没读 = 0 */
  合同附件数?: number;
  回款笔数?: number;
  /** 痛点标注、合同状态（迁移 101，库里原样：老项目合同状态是空 = 起草中）、「项目方案」里的文件数；没读 = 没填 / 0 */
  痛点标注?: string | null;
  合同状态?: string | null;
  项目方案数?: number;
  /** 需求类型（productNeeds 读出来的多选）；项目分配记录上的分配方式（最近一条有值的） */
  需求类型们?: string[];
  分配方式?: string | null;
  /** 有效沟通条数（客户明确回复了的） */
  有效沟通数?: number;
  /** 线索验证（EntLeadVerify）；没有这一行 = null */
  线索验证?: { verdict: string | null; finalResult: string | null; pending: string | null } | null;
};

/** 项目画像单选项 → 项目上的列 */
const 画像列表 = {
  预算能力: "budgetLevel", 价格感知: "priceSense", 决策链路: "decisionChain", 采购周期: "purchaseCycle", 产品匹配: "productFit",
  价值认同: "valueFit", 决策触达: "decisionReach", 竞品信息: "competitor", 部署条件: "deployFit", 场地现状: "siteStatus",
} as const;
type 画像列 = (typeof 画像列表)[keyof typeof 画像列表];
/** 线索验证判有效写的值（lead-verify.ts） */
export const 有效线索判定 = "有效线索";

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
    case "下一步计划": return 有(d.项目.nextStepText);
    // 沟通三项要在同一条沟通上都有：这条缺方式、那条缺发起主体，拼不起来算齐
    case "沟通三项": {
      const 节们 = 同名们(d.项目.node);
      return (d.沟通们 ?? []).some((c) => 节们.includes(c.node) && 有(c.initiator) && 有(c.content) && 有(c.method));
    }
    case "需求类型": return (d.需求类型们 ?? []).some((v) => 有(v));
    case "需求描述": return 有(d.项目.dealDemand);
    // 11-01 会议 §1：建的时候选的分配方式（项目上的 assignMode）也算
    case "分配方式": return 有(d.分配方式) || 有(d.客户.assignWay) || 有(d.项目.assignMode);
    case "项目名称": return 有(d.项目.name);
    case "所属客户": return !!d.有客户;
    case "项目来源": return !!d.项目.channelId;
    case "项目所在地": return 有(d.项目.addrCountry);
    case "项目级别": return 有(d.项目.level);
    case "有效沟通": return (d.有效沟通数 ?? 0) > 0;
    // 判了有效、没在等复核 / 销售认领（总管理终判有效后 verdict 先写成有效线索、还等销售认领）
    case "线索验证结果": return !!d.线索验证 && !d.线索验证.pending && (d.线索验证.verdict === 有效线索判定 || d.线索验证.finalResult === 有效线索判定);
    case "预算能力": case "价格感知": case "决策链路": case "采购周期": case "产品匹配":
    case "价值认同": case "决策触达": case "竞品信息": case "部署条件": case "场地现状":
      return 有(d.项目[画像列表[项]]);
    case "合同金额": return (d.项目.contractAmount ?? 0) > 0;
    case "定金金额": return (d.项目.depositAmount ?? 0) > 0;
    case "尾款结清": return !!d.项目.balanceSettled;
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
