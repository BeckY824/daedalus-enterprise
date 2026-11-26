/**
 * 通用查询：受限规格 → Prisma 查询。
 *
 * **模型不写 SQL。** 它只吐一段 JSON（查哪张表、筛什么、排什么、取几条），
 * 由这里翻成 Prisma 调用。和 `lib/report-query.ts` 是同一条路子，理由也一样：
 * 模型永远碰不到数据库，最坏结果是「这个问题答不了」，不会是查错或注入。
 *
 * 那些常见的 SQL 护栏——只允许 SELECT、禁子查询、强制 LIMIT——在这儿
 * **不是拦住的，是表达不出来**：这个规格里压根没有「写」和「子查询」这两个概念，
 * `取` 有硬上限。少一个 SQL 解析器，也就少了它那一串出名的绕过法
 * （注释、UNION、CTE、ATTACH、load_extension）。
 *
 * 为什么要它：十一个专用工具各自只认自己那几个参数，答不了
 * 「联系人里几个是母亲」（联系人根本没有工具）、「哪条线索最久没动」（不能排序）、
 * 「9 月签约的学员里哪几个是小红老师带来的」（要跨一张表）。
 *
 * **它的失败模式和别的工具不同。** 别的工具答不出来就是答不出来；
 * 这个会「查错了还很自信地报个数」——更隐蔽。所以 `说人话()` 是配套，不是装饰：
 * 过程条上必须把它到底查了什么原样写出来，让人能核对。
 */
import { dayjs } from "../utils";
import { calendarColumns } from "./calendar-query";
import { DEFAULT_BUSINESS, statusLabel, type BusinessConfig } from "../business-config";
import {
  FOLLOW_STATUSES,
  DECISION_STATUSES,
  LEAD_STATUSES,
  OPP_STAGES,
  OPP_STATUSES,
  GRADES,
  FOLLOW_TYPES,
  FOLLOW_METHODS,
  FOLLOW_RECORD_STATUSES,
} from "../constants";
import { 同名们, 后售培育名 } from "../project/stage-dict";
import { 企业版 } from "../enterprise/switch";
import { 项目画像项, 字典定义 } from "../enterprise/dict-kinds";
import { 不算补建, 不进统计, 历史分析留痕人 } from "../project/system-created";

/* ---------- 字段白名单 ---------- */

/**
 * 「人」「部门」是引用：库里存 id，对人和模型只说名字。
 * 条件里给名字，`编译` 时由调用方传进来的 名映射 换成 id（in / notIn），
 * 结果里的 id 也由调用方换回名字——id 对人没有意义，也不该让模型去猜。
 */
export type 字段型 = "文本" | "数字" | "日期" | "枚举" | "真假" | "人" | "部门";

export type 字段 = {
  /** Prisma 里的列名 */
  列: string;
  /** 给人和模型看的名字 */
  名: string;
  型: 字段型;
  /** 枚举的合法取值。填了的话，不在里面的值直接拒绝——拼错一个字不该悄悄查出 0 条 */
  取值?: readonly string[];
  /** 节点 / 结局名：改过名的旧名也要一起查（同名们），否则改名前的项目查不出来 */
  同名?: true;
};

const 字段们 = <T extends Record<string, 字段>>(t: T) => t;

/**
 * 节点记录的「记录类型」给人和模型看的叫法（审核 11-18 追加）：换负责人 / 放回公海 / 公海领取那几类行，原节点、新节点照抄当时的，
 * 按新节点连起来看会像「潜客培育 > 潜客培育」。行不过滤，只把类型说明白；括号里留库里的原值，按原值筛照样能筛
 */
export const 节点记录类型叫法: Readonly<Record<string, string>> = {
  node: "改节点（node）",
  transfer: "换负责人（transfer；原 / 新节点照抄当时的，不是节点变化）",
  "pool-release": "放回公海（pool-release；原 / 新节点照抄当时的，不是节点变化）",
  "pool-claim": "出线索公海换负责人（pool-claim；自己领取或管理分配，看原因开头：「从客户公海分配」「从线索公海分配」= 管理分的；原 / 新节点照抄当时的，不是节点变化）",
};

/**
 * 每张表开放哪些字段。**不在这儿的字段查不了**，也不该靠模型自觉。
 *
 * 刻意没开的：密码、token、各种 id 外键（id 对人没有意义，跨表走 `关联`）、
 * 以及 AI 对话那几张表（那是用户自己的思考过程，不是业务数据）。
 */
export const 表们 = {
  客户: {
    模型: "customer" as const,
    名: "客户",
    字段: 字段们({
      姓名: { 列: "name", 名: "姓名", 型: "文本" },
      电话: { 列: "phone", 名: "电话", 型: "文本" },
      学校: { 列: "school", 名: "学校", 型: "文本" },
      年级: { 列: "grade", 名: "年级", 型: "枚举", 取值: GRADES },
      专业: { 列: "major", 名: "专业", 型: "文本" },
      跟进状态: { 列: "followStatus", 名: "跟进状态", 型: "枚举", 取值: FOLLOW_STATUSES },
      决策状态: { 列: "decisionStatus", 名: "决策状态", 型: "枚举", 取值: DECISION_STATUSES },
      预计签约: { 列: "expectedSignAt", 名: "预计签约时间", 型: "日期" },
      最近跟进: { 列: "lastFollowAt", 名: "最近跟进时间", 型: "日期" },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
      销售负责人: { 列: "salesOwnerId", 名: "销售负责人", 型: "人" },
      渠道负责人: { 列: "channelOwnerId", 名: "渠道负责人", 型: "人" },
      客户状态: { 列: "custStatus", 名: "客户状态", 型: "文本" },
      客户类型: { 列: "customerType", 名: "客户类型", 型: "文本" },
      客户属性: { 列: "customerAttr", 名: "客户属性", 型: "文本" },
      简称: { 列: "shortName", 名: "简称", 型: "文本" },
      省份: { 列: "addrProvince", 名: "省份", 型: "文本" },
      城市: { 列: "addrCity", 名: "城市", 型: "文本" },
      退回公海次数: { 列: "poolReturns", 名: "退回公海次数", 型: "数字" },
      分配方式: { 列: "assignWay", 名: "分配方式", 型: "文本" },
    }),
  },
  线索: {
    模型: "lead" as const,
    名: "线索",
    字段: 字段们({
      名称: { 列: "name", 名: "线索名称", 型: "文本" },
      联系人: { 列: "contact", 名: "联系人", 型: "文本" },
      电话: { 列: "phone", 名: "电话", 型: "文本" },
      邮箱: { 列: "email", 名: "邮箱", 型: "文本" },
      行业: { 列: "industry", 名: "行业", 型: "文本" },
      来源: { 列: "source", 名: "来源", 型: "文本" },
      状态: { 列: "status", 名: "状态", 型: "枚举", 取值: LEAD_STATUSES },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
      转化时间: { 列: "convertedAt", 名: "转化时间", 型: "日期" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
    }),
  },
  商机: {
    模型: "opportunity" as const,
    名: "商机",
    字段: 字段们({
      名称: { 列: "name", 名: "商机名称", 型: "文本" },
      金额: { 列: "amount", 名: "金额", 型: "数字" },
      阶段: { 列: "stage", 名: "阶段", 型: "枚举", 取值: OPP_STAGES },
      状态: { 列: "status", 名: "状态", 型: "枚举", 取值: OPP_STATUSES },
      成交概率: { 列: "probability", 名: "成交概率", 型: "数字" },
      预计成交: { 列: "expectedDealAt", 名: "预计成交时间", 型: "日期" },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
    }),
  },
  签约: {
    模型: "contract" as const,
    名: "签约记录",
    字段: 字段们({
      金额: { 列: "amount", 名: "签约金额", 型: "数字" },
      签约日: { 列: "signedAt", 名: "签约日期", 型: "日期" },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
    }),
  },
  联系人: {
    模型: "contact" as const,
    名: "联系人",
    字段: 字段们({
      姓名: { 列: "name", 名: "姓名", 型: "文本" },
      关系: { 列: "position", 名: "与学员的关系", 型: "文本" },
      电话: { 列: "phone", 名: "电话", 型: "文本" },
      邮箱: { 列: "email", 名: "邮箱", 型: "文本" },
      微信: { 列: "wechat", 名: "微信", 型: "文本" },
      关键联系人: { 列: "isPrimary", 名: "是否关键联系人", 型: "真假" },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
    }),
  },
  跟进记录: {
    模型: "followUp" as const,
    名: "跟进记录",
    字段: 字段们({
      类型: { 列: "type", 名: "类型", 型: "枚举", 取值: FOLLOW_TYPES.map((t) => t.value) },
      标题: { 列: "title", 名: "标题", 型: "文本" },
      内容: { 列: "content", 名: "内容", 型: "文本" },
      状态: { 列: "status", 名: "状态", 型: "枚举", 取值: FOLLOW_RECORD_STATUSES },
      时长秒: { 列: "duration", 名: "时长（秒）", 型: "数字" },
      发生时间: { 列: "occurredAt", 名: "发生时间", 型: "日期" },
      沟通方式: { 列: "method", 名: "沟通方式", 型: "文本" },
      记录人: { 列: "ownerId", 名: "记录人", 型: "人" },
    }),
  },
  跟进计划: {
    模型: "followPlan" as const,
    名: "跟进计划",
    字段: 字段们({
      主题: { 列: "subject", 名: "主题", 型: "文本" },
      计划时间: { 列: "plannedAt", 名: "计划时间", 型: "日期" },
      方式: { 列: "method", 名: "方式", 型: "枚举", 取值: FOLLOW_METHODS },
      已完成: { 列: "done", 名: "是否已完成", 型: "真假" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
    }),
  },
  任务: {
    模型: "task" as const,
    名: "任务",
    字段: 字段们({
      标题: { 列: "title", 名: "标题", 型: "文本" },
      截止时间: { 列: "dueAt", 名: "截止时间", 型: "日期" },
      已完成: { 列: "done", 名: "是否已完成", 型: "真假" },
      完成时间: { 列: "doneAt", 名: "完成时间", 型: "日期" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
      负责人: { 列: "ownerId", 名: "负责人", 型: "人" },
    }),
  },
  渠道: {
    模型: "channel" as const,
    名: "渠道",
    字段: 字段们({
      名称: { 列: "name", 名: "渠道名称", 型: "文本" },
      电话: { 列: "phone", 名: "电话", 型: "文本" },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
      启用: { 列: "active", 名: "是否启用", 型: "真假" },
      建档时间: { 列: "createdAt", 名: "建档时间", 型: "日期" },
      负责人: { 列: "channelOwnerId", 名: "渠道负责人", 型: "人" },
      属性: { 列: "attr", 名: "渠道属性", 型: "文本" },
      平台: { 列: "platform", 名: "平台", 型: "文本" },
      结束日期: { 列: "endDate", 名: "结束日期", 型: "日期" },
    }),
  },
  项目: {
    模型: "project" as const,
    名: "项目",
    字段: 字段们({
      名称: { 列: "name", 名: "项目名称", 型: "文本" },
      负责人: { 列: "ownerId", 名: "负责人", 型: "人" },
      创建人: { 列: "creatorId", 名: "创建人", 型: "人" },
      阶段: { 列: "phase", 名: "阶段", 型: "文本" },
      节点: { 列: "node", 名: "节点", 型: "文本", 同名: true },
      结局: { 列: "result", 名: "结局", 型: "文本", 同名: true },
      异常原因: { 列: "exceptionReason", 名: "异常原因", 型: "文本" },
      进公海时间: { 列: "pooledAt", 名: "进公海时间", 型: "日期" },
      下一步时间: { 列: "nextStepAt", 名: "下一步时间", 型: "日期" },
      下一步: { 列: "nextStepText", 名: "下一步", 型: "文本" },
      尾款结清: { 列: "balanceSettled", 名: "是否尾款结清", 型: "真假" },
      验收通过: { 列: "acceptancePassed", 名: "是否验收通过", 型: "真假" },
      // 已开票（12-15 第三批，迁移 176）：只能查，AI 不代勾（lib/project/invoiced.ts）
      已开票: { 列: "invoiced", 名: "是否已开票", 型: "真假" },
      开票勾选时间: { 列: "invoicedAt", 名: "勾已开票的时间", 型: "日期" },
      金额: { 列: "amount", 名: "商机金额", 型: "数字" },
      币种: { 列: "currency", 名: "币种", 型: "文本" },
      合同金额: { 列: "contractAmount", 名: "合同金额", 型: "数字" },
      定金: { 列: "depositAmount", 名: "定金", 型: "数字" },
      合同状态: { 列: "contractStatus", 名: "合同状态", 型: "文本" },
      预计成交: { 列: "expectedDealAt", 名: "预计成交时间", 型: "日期" },
      痛点: { 列: "painPoints", 名: "痛点标注", 型: "文本" },
      成交需求: { 列: "dealDemand", 名: "成交需求", 型: "文本" },
      ...Object.fromEntries(项目画像项.map((i) => [字典定义[i.种类].名, { 列: i.键, 名: 字典定义[i.种类].名, 型: "文本" as const }])),
      位置: { 列: "location", 名: "位置", 型: "文本" },
      省份: { 列: "addrProvince", 名: "省份", 型: "文本" },
      城市: { 列: "addrCity", 名: "城市", 型: "文本" },
      等级: { 列: "level", 名: "项目等级", 型: "文本" },
      // 项目标签（迁移 153，F-项目-14）：和项目级别各一列，AI 查询时别拿级别顶替
      标签: { 列: "projTag", 名: "项目标签", 型: "文本" },
      // 备货状态、物流状态、物流单号（迁移 154，客户 11-19）
      备货状态: { 列: "stockStatus", 名: "备货状态", 型: "文本" },
      物流状态: { 列: "logisticsStatus", 名: "物流状态", 型: "文本" },
      物流单号: { 列: "trackingNo", 名: "物流单号", 型: "文本" },
      备注: { 列: "remark", 名: "备注", 型: "文本" },
      创建时间: { 列: "createdAt", 名: "创建时间", 型: "日期" },
      更新时间: { 列: "updatedAt", 名: "更新时间", 型: "日期" },
      结束时间: { 列: "closedAt", 名: "结束时间", 型: "日期" },
    }),
  },
  卡点: {
    模型: "entBlocker" as const,
    名: "卡点",
    字段: 字段们({
      // 11-01 改版：没有处理人（认领人一人一行，在卡点认领表里）、不设解决时限；阻碍原因多选，obstacle 只存第一个
      编号: { 列: "code", 名: "卡点编号", 型: "文本" },
      // 11-19 起新卡点不填标题、描述（界面只留类型、影响、阻碍原因），这两列只有老卡点有值
      标题: { 列: "title", 名: "标题（11-19 前的老卡点才有）", 型: "文本" },
      阶段: { 列: "phase", 名: "阶段", 型: "文本" },
      类型: { 列: "type", 名: "卡点类型", 型: "文本" },
      影响: { 列: "impact", 名: "影响", 型: "文本" },
      障碍: { 列: "obstacle", 名: "阻碍原因（第一个）", 型: "文本" },
      描述: { 列: "description", 名: "描述（卡在哪儿，11-19 前的老卡点才有）", 型: "文本" },
      状态: { 列: "status", 名: "状态（待接受 / 处理中 / 已解决）", 型: "文本" },
      创建人: { 列: "creatorId", 名: "创建人", 型: "人" },
      资源申请: { 列: "resourceRequest", 名: "资源申请", 型: "文本" },
      进展: { 列: "progress", 名: "进展", 型: "文本" },
      解决方案: { 列: "solution", 名: "解决方案", 型: "文本" },
      结果: { 列: "result", 名: "结果", 型: "文本" },
      解决时间: { 列: "resolvedAt", 名: "解决时间", 型: "日期" },
      创建时间: { 列: "createdAt", 名: "创建时间", 型: "日期" },
    }),
  },
  项目成员: {
    模型: "projectMember" as const,
    名: "项目成员",
    字段: 字段们({
      成员: { 列: "userId", 名: "成员", 型: "人" },
      邀请状态: { 列: "inviteStatus", 名: "邀请状态", 型: "文本" },
      加入时间: { 列: "createdAt", 名: "加入时间", 型: "日期" },
    }),
  },
  节点记录: {
    模型: "projectNodeLog" as const,
    名: "节点记录",
    字段: 字段们({
      操作人: { 列: "userId", 名: "操作人", 型: "人" },
      时间: { 列: "at", 名: "时间", 型: "日期" },
      原阶段: { 列: "fromPhase", 名: "原阶段", 型: "文本" },
      原节点: { 列: "fromNode", 名: "原节点", 型: "文本", 同名: true },
      原结局: { 列: "fromResult", 名: "原结局", 型: "文本", 同名: true },
      新阶段: { 列: "toPhase", 名: "新阶段", 型: "文本" },
      新节点: { 列: "toNode", 名: "新节点", 型: "文本", 同名: true },
      新结局: { 列: "toResult", 名: "新结局", 型: "文本", 同名: true },
      原因: { 列: "reason", 名: "原因", 型: "文本" },
      类型: { 列: "kind", 名: "记录类型", 型: "文本" },
      原负责人: { 列: "fromOwnerId", 名: "原负责人", 型: "人" },
      新负责人: { 列: "toOwnerId", 名: "新负责人", 型: "人" },
    }),
  },
  项目回款: {
    模型: "entProjectPayment" as const,
    名: "项目回款",
    字段: 字段们({
      回款日: { 列: "paidAt", 名: "回款日期", 型: "日期" },
      币种: { 列: "currency", 名: "币种", 型: "文本" },
      金额: { 列: "amount", 名: "回款金额", 型: "数字" },
      登记人: { 列: "userId", 名: "登记人", 型: "人" },
      登记时间: { 列: "createdAt", 名: "登记时间", 型: "日期" },
    }),
  },
  线索验证: {
    模型: "entLeadVerify" as const,
    名: "线索验证",
    主键: "projectId",
    字段: 字段们({
      判定: { 列: "verdict", 名: "验证结果", 型: "文本" },
      待办: { 列: "pending", 名: "待谁处理", 型: "文本" },
      无效原因: { 列: "invalidReason", 名: "无效原因", 型: "文本" },
      初验说明: { 列: "verifyNote", 名: "初验说明", 型: "文本" },
      初验人: { 列: "verifiedById", 名: "初验人", 型: "人" },
      初验时间: { 列: "verifiedAt", 名: "初验时间", 型: "日期" },
      复核结果: { 列: "reviewResult", 名: "复核结果", 型: "文本" },
      复核说明: { 列: "reviewNote", 名: "复核说明", 型: "文本" },
      复核人: { 列: "reviewedById", 名: "复核人", 型: "人" },
      复核时间: { 列: "reviewedAt", 名: "复核时间", 型: "日期" },
      销售确认: { 列: "salesAck", 名: "销售确认", 型: "文本" },
      异议说明: { 列: "disputeNote", 名: "异议说明", 型: "文本" },
      确认时间: { 列: "ackedAt", 名: "确认时间", 型: "日期" },
      终判结果: { 列: "finalResult", 名: "终判结果", 型: "文本" },
      终判说明: { 列: "finalNote", 名: "终判说明", 型: "文本" },
      终判人: { 列: "finalById", 名: "终判人", 型: "人" },
      终判时间: { 列: "finalAt", 名: "终判时间", 型: "日期" },
      更新时间: { 列: "updatedAt", 名: "更新时间", 型: "日期" },
    }),
  },
  公海: {
    模型: "customerPool" as const,
    名: "公海客户",
    主键: "customerId",
    字段: 字段们({
      退回人: { 列: "userId", 名: "退回人", 型: "人" },
      原因: { 列: "reason", 名: "进公海原因", 型: "文本" },
      时间: { 列: "at", 名: "进公海时间", 型: "日期" },
    }),
  },
  部门: {
    模型: "entDept" as const,
    名: "部门",
    字段: 字段们({
      名称: { 列: "name", 名: "部门名称", 型: "文本" },
      上级部门: { 列: "parentId", 名: "上级部门", 型: "部门" },
      排序: { 列: "sort", 名: "排序", 型: "数字" },
    }),
  },
  组织成员: {
    模型: "entMember" as const,
    名: "组织成员",
    主键: "userId",
    字段: 字段们({
      成员: { 列: "userId", 名: "成员", 型: "人" },
      部门: { 列: "deptId", 名: "部门", 型: "部门" },
      业务角色: { 列: "bizRole", 名: "业务角色", 型: "文本" },
      条线: { 列: "line", 名: "条线", 型: "文本" },
      直属上级: { 列: "managerId", 名: "直属上级", 型: "人" },
      虚线上级: { 列: "dottedManagerId", 名: "虚线上级", 型: "人" },
    }),
  },
  提成: {
    模型: "entCommission" as const,
    名: "项目提成",
    主键: "projectId",
    字段: 字段们({
      底价: { 列: "basePrice", 名: "底价", 型: "数字" },
      定格时间: { 列: "fixedAt", 名: "定格时间", 型: "日期" },
      定格成交价: { 列: "fixedDeal", 名: "定格成交价", 型: "数字" },
      定格底价: { 列: "fixedBase", 名: "定格底价", 型: "数字" },
      基础提成比例: { 列: "fixedRateBase", 名: "基础提成比例", 型: "数字" },
      溢价提成比例: { 列: "fixedRatePremium", 名: "溢价提成比例", 型: "数字" },
      提成总额: { 列: "fixedTotal", 名: "提成总额", 型: "数字" },
      更新时间: { 列: "updatedAt", 名: "更新时间", 型: "日期" },
    }),
  },
  提成分配: {
    模型: "entCommissionSplit" as const,
    名: "提成分配",
    字段: 字段们({
      成员: { 列: "userId", 名: "成员", 型: "人" },
      比例: { 列: "percent", 名: "分配比例", 型: "数字" },
      设置人: { 列: "setById", 名: "设置人", 型: "人" },
      更新时间: { 列: "updatedAt", 名: "更新时间", 型: "日期" },
    }),
  },
  同事: {
    模型: "user" as const,
    名: "同事",
    字段: 字段们({
      姓名: { 列: "name", 名: "姓名", 型: "文本" },
      职位: { 列: "title", 名: "职位", 型: "文本" },
      角色: { 列: "role", 名: "系统角色", 型: "枚举", 取值: ["ADMIN", "MANAGER", "SALES"] },
      在职: { 列: "active", 名: "是否在职", 型: "真假" },
    }),
  },
} as const;

export type 表名 = keyof typeof 表们;

/** 每个请求独立生成显示字段，不修改跨租户共享的静态白名单。只读查询允许历史自由文本职位。 */
export function 查询表(表: 表名, b?: BusinessConfig): { 模型: string; 名: string; 主键?: string; 字段: Record<string, 字段> } {
  const original = 表们[表];
  if (表 !== "客户") return original;
  // 企业版客户没有电话（E-260，客户「客户没有电话这一说法」）：客户表不开「电话」，号码都在联系人表上（认字段 另给一句指路）
  const { 电话: _电话, ...除电话 } = 表们.客户.字段;
  const 开的: Record<string, 字段> = 企业版() ? 除电话 : 表们.客户.字段;
  if (!b) return { ...original, 字段: 开的 };
  const fields = b.fields ?? DEFAULT_BUSINESS.fields;
  return { ...original, 名: b.customer, 字段: {
    ...开的,
    学校: { ...表们.客户.字段.学校, 名: fields.school },
    年级: { 列: "grade", 名: fields.grade, 型: "文本" },
    专业: { ...表们.客户.字段.专业, 名: fields.major },
  } };
}


/**
 * 跨表：**只走这张表上的一跳**。
 *
 * 为什么不给任意层数：深层嵌套的性能和过程条可读性都会崩，
 * 而「查错了还很自信地报个数」恰恰最容易出在那儿——
 * 一句「小红老师带来的学员的商机的跟进记录」，人核对不动。
 * 一跳覆盖了绝大多数真实问法，而且每一跳都能写进过程条。
 */
export const 关联们: Record<string, { 从: 表名; 列: string; 到: 表名; 名: string; 经?: string }> = {
  "客户.来源渠道": { 从: "客户", 列: "channel", 到: "渠道", 名: "来源渠道" },
  "商机.客户": { 从: "商机", 列: "customer", 到: "客户", 名: "所属客户" },
  "签约.客户": { 从: "签约", 列: "customer", 到: "客户", 名: "所属客户" },
  "联系人.客户": { 从: "联系人", 列: "customer", 到: "客户", 名: "所属客户" },
  "跟进记录.客户": { 从: "跟进记录", 列: "customer", 到: "客户", 名: "所属客户" },
  "跟进计划.客户": { 从: "跟进计划", 列: "customer", 到: "客户", 名: "所属客户" },
  "任务.客户": { 从: "任务", 列: "customer", 到: "客户", 名: "所属客户" },
  "跟进记录.项目": { 从: "跟进记录", 列: "projectNode", 经: "project", 到: "项目", 名: "所属项目" },
  "项目.客户": { 从: "项目", 列: "customer", 到: "客户", 名: "所属客户" },
  "项目.渠道": { 从: "项目", 列: "channel", 到: "渠道", 名: "来源渠道" },
  "卡点.项目": { 从: "卡点", 列: "project", 到: "项目", 名: "所属项目" },
  "项目成员.项目": { 从: "项目成员", 列: "project", 到: "项目", 名: "所属项目" },
  "节点记录.项目": { 从: "节点记录", 列: "project", 到: "项目", 名: "所属项目" },
  "项目回款.项目": { 从: "项目回款", 列: "project", 到: "项目", 名: "所属项目" },
  "线索验证.项目": { 从: "线索验证", 列: "project", 到: "项目", 名: "所属项目" },
  "提成.项目": { 从: "提成", 列: "project", 到: "项目", 名: "所属项目" },
  "提成分配.项目": { 从: "提成分配", 列: "project", 到: "项目", 名: "所属项目" },
  "公海.客户": { 从: "公海", 列: "customer", 到: "客户", 名: "客户" },
};

/* ---------- 规格 ---------- */

export const 运算符 = {
  包含: { 名: "包含", 适用: ["文本"] },
  等于: { 名: "是", 适用: ["文本", "枚举", "数字", "真假", "人", "部门"] },
  不等于: { 名: "不是", 适用: ["文本", "枚举", "数字", "真假", "人", "部门"] },
  属于: { 名: "属于", 适用: ["枚举", "文本", "人", "部门"] },
  大于: { 名: "大于", 适用: ["数字"] },
  小于: { 名: "小于", 适用: ["数字"] },
  不早于: { 名: "不早于", 适用: ["日期"] },
  不晚于: { 名: "不晚于", 适用: ["日期"] },
  最近天数: { 名: "最近", 适用: ["日期"] },
  为空: { 名: "为空", 适用: ["文本", "日期", "数字", "枚举", "人", "部门"] },
  非空: { 名: "不为空", 适用: ["文本", "日期", "数字", "枚举", "人", "部门"] },
} as const;
export type 运算 = keyof typeof 运算符;

export type 条件 = { 字段: string; 运算: 运算; 值?: string | number | boolean | string[] };

export type 查询规格 = {
  表: 表名;
  条件: 条件[];
  /** 一跳关联上的筛选。key 是 关联们 里的路径名 */
  关联?: { 路径: string; 条件: 条件[] };
  排序?: { 字段: string; 降序: boolean };
  取: number;
  /** 只要个数，不要名单。问「有多少」时用它，省掉把一屏名字喂回模型 */
  只计数?: boolean;
  /** 按某字段分组计数（「按跟进状态分别有多少人」） */
  分组?: string;
};

/** 一次最多给多少行。模型给多少都收进这个上限——上下文是要按 token 付钱的 */
export const 取数上限 = 50;
const 分组上限 = 20;

/* ---------- 校验 ---------- */

class 查询错 extends Error {}
/** 给人看的中文错误。模型拿到它会重试，人在过程条上也看得懂为什么没查成 */
const 错 = (s: string) => new 查询错(s);

/** 企业版只用项目时没有的三张老表：线索、商机、订单都是项目的阶段（批次 20b：模型照旧查「线索」表，查出 0 条） */
export const 只用项目没有的表: readonly 表名[] = ["线索", "商机", "签约"];
/** 这一家能查的表。只用项目时去掉三张老表 */
export function 能查的表(只用项目 = false): 表名[] {
  return (Object.keys(表们) as 表名[]).filter((t) => !(只用项目 && 只用项目没有的表.includes(t)));
}

/** 表名的常见别称（批次 20b）。只收不会认错的 */
const 表别名: Record<string, 表名> = {
  沟通记录: "跟进记录", 沟通: "跟进记录", 跟进: "跟进记录", 跟进计划表: "跟进计划", 计划: "跟进计划",
  回款: "项目回款", 回款记录: "项目回款", 公海客户: "公海", 卡点记录: "卡点", 节点: "节点记录",
  客户联系人: "联系人", 组织架构: "部门", 订单: "签约", 合同: "签约",
};

function 认表(v: unknown, 只用项目 = false): 表名 {
  const 原 = typeof v === "string" ? v.trim() : "";
  const 去尾 = 原.replace(/表$/, "");
  const s = Object.hasOwn(表们, 原) ? 原 : Object.hasOwn(表们, 去尾) ? 去尾 : 表别名[原] ?? 表别名[去尾] ?? 原;
  const 能查 = 能查的表(只用项目);
  if (只用项目 && 只用项目没有的表.includes(s as 表名))
    throw 错(`这一家只用项目：没有单独的「${原}」表，线索、商机、订单都是项目的阶段。改查「项目」表，条件写 {"字段":"阶段","运算":"等于","值":"线索"}（商机、订单同理）`);
  if (Object.hasOwn(表们, s)) return s as 表名;
  throw 错(`没有「${原 || "(空)"}」这张表。能查的只有这几张，「表」只能填其中之一：${能查.join("、")}`);
}

/**
 * 字段名的同义写法（批次 20b）。同一组里的词指同一件事：模型写了组里任何一个，就在这张表上找组里有的那一个。
 * 只在这张表上**正好一个**字段对得上时才认，对上几个就报错列出来，不猜
 */
const 字段同义组: readonly (readonly string[])[] = [
  ["建档时间", "创建时间", "新建时间", "录入时间", "创建日期", "建档日期", "添加时间", "加入时间", "登记时间"],
  ["销售负责人", "负责人", "负责销售", "跟进人", "归属人", "所属销售", "销售", "所有人", "owner"],
  ["姓名", "名称", "名字", "客户名称", "客户名", "公司名称", "公司名", "公司", "项目名称", "线索名称", "商机名称", "渠道名称", "name"],
  ["电话", "手机", "手机号", "联系电话", "电话号码", "phone"],
  ["最近跟进时间", "最近跟进", "最后跟进时间", "上次跟进时间", "上次跟进"],
  ["发生时间", "跟进时间", "沟通时间"],
  ["回款日期", "回款时间"],
];

export function 认字段(表: 表名, v: unknown, b?: BusinessConfig): 字段 {
  const s = typeof v === "string" ? v.trim() : "";
  const 表定义 = 查询表(表, b);
  const 全部 = Object.entries(表定义.字段);
  const 精确 = Object.hasOwn(表定义.字段, s) ? 表定义.字段[s] : Object.values(表定义.字段).find(f => f.名 === s);
  if (精确) return 精确;
  const 对得上 = (词们: readonly string[]) => {
    const 中 = new Set(全部.filter(([k, f]) => 词们.includes(k) || 词们.includes(f.名)).map(([, f]) => f));
    return 中.size === 1 ? [...中][0] : null;
  };
  const 组 = 字段同义组.find((g) => g.some((w) => w.toLowerCase() === s.toLowerCase()));
  const 同义 = 组 ? 对得上(组) : null;
  if (同义) return 同义;
  if (表 === "客户" && 企业版() && 组?.includes("电话"))
    throw 错(`企业版${表定义.名}没有电话，号码都记在联系人上：改查「联系人」表的「电话」，要${表定义.名}就带上关联「联系人.客户」`);
  // 写多了或写少了几个字（「跟进状态值」「预计签约」）：包含关系正好对上一个才认
  const 近 = s.length >= 2 ? 全部.filter(([k, f]) => f.名.includes(s) || k.includes(s) || (k.length >= 2 && s.includes(k))) : [];
  const 近字段 = [...new Set(近.map(([, f]) => f))];
  if (近字段.length === 1) return 近字段[0];
  const 列 = Object.values(表定义.字段).map(f => `${f.名}（${f.型}）`).join("、");
  throw 错(
    `「${表定义.名}」上没有「${s || "(空)"}」这个字段。` +
      (近字段.length > 1 ? `相近的有：${近字段.map(f => f.名).join("、")}，挑一个。` : "") +
      `「字段」只能填这些（括号里是类型）：${列}`,
  );
}

function 认日期(v: unknown, 字段名: string): Date {
  const d = dayjs(typeof v === "string" || typeof v === "number" ? v : "");
  if (!d.isValid()) throw 错(`「${字段名}」要一个能认的日期（YYYY-MM-DD），给的是「${String(v)}」`);
  return d.toDate();
}

/** 运算的常见别写（批次 20b）。和字段类型无关、意思唯一的才放这里；「>=」「之后」这类按字段类型另认（认运算） */
const 运算别名: Record<string, 运算> = {
  "=": "等于", "==": "等于", "===": "等于", 是: "等于", 为: "等于", eq: "等于", equals: "等于", is: "等于", 精确: "等于",
  "!=": "不等于", "<>": "不等于", 不是: "不等于", ne: "不等于", 不为: "不等于", "not": "不等于",
  contains: "包含", like: "包含", 模糊: "包含", 包括: "包含", 含: "包含", 含有: "包含", 模糊匹配: "包含",
  in: "属于", 在: "属于", 之一: "属于", 属于其中: "属于", 任一: "属于", 其中之一: "属于", 在其中: "属于",
  最近: "最近天数", 近: "最近天数", 近几天: "最近天数", 最近几天: "最近天数", within: "最近天数",
  空: "为空", null: "为空", "is null": "为空", isnull: "为空", 未填: "为空", 没填: "为空",
  不为空: "非空", "not null": "非空", "is not null": "非空", notnull: "非空", 有值: "非空", 已填: "非空", 不空: "非空",
};
const 日期往后 = new Set([">", ">=", "≥", "gt", "gte", "大于", "大于等于", "之后", "以后", "晚于", "after", "since", "从", "起"]);
const 日期往前 = new Set(["<", "<=", "≤", "lt", "lte", "小于", "小于等于", "之前", "以前", "早于", "before", "until", "截至", "到", "止"]);

/** 把模型写的运算认成表里的那几个（按字段类型认「>=」「之后」这类），认不出返回 null */
function 认运算(v: unknown, f: 字段): 运算 | null {
  const s = typeof v === "string" ? v.trim() : "";
  const k = s.toLowerCase();
  // 日期先认方向：「大于 2026-11-01」就是不早于（差一个当天，人这么问时本来就含当天）
  if (f.型 === "日期") {
    if (日期往后.has(k)) return "不早于";
    if (日期往前.has(k)) return "不晚于";
  }
  if (Object.hasOwn(运算符, s)) return s as 运算;
  if (f.型 === "数字") {
    if (k === "gt" || k === "超过" || k === "多于" || k === "高于") return "大于";
    if (k === "lt" || k === "少于" || k === "低于" || k === "不到") return "小于";
  }
  return 运算别名[k] ?? 运算别名[s] ?? null;
}

/** 某类字段能用的运算 */
const 能用运算 = (型: 字段型) => Object.entries(运算符).filter(([, v]) => (v.适用 as readonly 字段型[]).includes(型)).map(([k]) => k);

/** 运算和字段类型对不上时的那一句：常见的几种直接说怎么改（批次 20b） */
function 类型不对话(f: 字段, op: 运算): string {
  const 能用 = 能用运算(f.型).join("、");
  if (f.型 === "日期" && (op === "等于" || op === "不等于" || op === "包含"))
    return `「${f.名}」是日期，不能用「${op}」。要某一天就写两条条件：不早于 YYYY-MM-DD、不晚于 YYYY-MM-DD；要最近 N 天用「最近天数」，值给天数。它能用：${能用}`;
  if (f.型 === "日期" && (op === "大于" || op === "小于"))
    return `「${f.名}」是日期，用「${op === "大于" ? "不早于" : "不晚于"}」，值写 YYYY-MM-DD。它能用：${能用}`;
  if (f.型 === "枚举" && op === "包含")
    return `「${f.名}」是固定取值，不能用「包含」，用「等于」或「属于」，值只能是：${f.取值?.join(" / ")}`;
  if ((f.型 === "人" || f.型 === "部门") && op === "包含")
    return `「${f.名}」直接写${f.型 === "人" ? "姓名" : "部门名"}，用「等于」（几位用「属于」，值给数组）。它能用：${能用}`;
  if (f.型 === "数字" && (op === "不早于" || op === "不晚于"))
    return `「${f.名}」是数字，用「大于」或「小于」（不含等于：要「至少 5」写 大于 4）。它能用：${能用}`;
  return `「${f.名}」是${f.型}，不能用「${运算符[op].名}」。它能用：${能用}`;
}

function 认条件(表: 表名, raw: unknown, b?: BusinessConfig): 条件 {
  const r = (raw ?? {}) as Record<string, unknown>;
  const f = 认字段(表, r.字段, b);
  const 字段键 = Object.entries(查询表(表, b).字段).find(([, v]) => v.列 === f.列)![0];
  let op = 认运算(r.运算, f);
  if (!op) {
    throw 错(`不认识的运算「${String(r.运算 ?? "(空)")}」（字段「${f.名}」）。「运算」只能填这些之一：${Object.keys(运算符).join("、")}；「${f.名}」是${f.型}，能用：${能用运算(f.型).join("、")}`);
  }
  // 等于给了一串值：就是「属于」（批次 20b：原来当成一个值整串比，查出 0 条）
  if (op === "等于" && Array.isArray(r.值) && (运算符.属于.适用 as readonly 字段型[]).includes(f.型)) op = "属于";
  const 适用 = 运算符[op].适用 as readonly 字段型[];
  if (!适用.includes(f.型)) throw 错(类型不对话(f, op));

  // 为空 / 非空不带值；其余必须带
  if (op === "为空" || op === "非空") return { 字段: 字段键, 运算: op };
  if (r.值 == null || r.值 === "") throw 错(`「${f.名} ${运算符[op].名}」少了一个值（只有「为空」「非空」不填值）`);

  const 原值 = (value: string) => b && (f.列 === "followStatus" || f.列 === "decisionStatus")
    ? f.取值?.find(v => statusLabel(b, v) === value) ?? value : value;
  if (op === "属于") {
    // 固定取值、人、部门给成一句「A、B」「A,B」时拆开（文本不拆：值里本来可能有逗号）
    const 拆 = f.型 === "枚举" || f.型 === "人" || f.型 === "部门";
    const 单 = (v: unknown) => (拆 ? String(v).split(/[,，、/]/) : [String(v)]);
    const xs = (Array.isArray(r.值) ? r.值.flatMap(单) : 单(r.值)).map((x) => x.trim()).filter(Boolean).map(原值);
    if (!xs.length) throw 错(`「${f.名} 属于」要至少一个值`);
    if (f.取值) for (const x of xs) 校枚举(f, x);
    return { 字段: 字段键, 运算: op, 值: xs };
  }
  if (op === "最近天数") {
    // 「30天」「30 days」：取那个数
    const n = typeof r.值 === "number" ? r.值 : Number(String(r.值).match(/\d+(\.\d+)?/)?.[0] ?? NaN);
    if (!Number.isFinite(n) || n <= 0 || n > 3650) throw 错(`「最近天数」的值要 1~3650 之间的天数（比如 30），给的是「${String(r.值)}」`);
    return { 字段: 字段键, 运算: op, 值: Math.round(n) };
  }
  if (f.型 === "数字") {
    const n = Number(r.值);
    if (!Number.isFinite(n)) throw 错(`「${f.名}」要一个数，给的是「${String(r.值)}」`);
    return { 字段: 字段键, 运算: op, 值: n };
  }
  if (f.型 === "真假") {
    const b = r.值 === true || r.值 === "true" || r.值 === "是" || r.值 === 1;
    return { 字段: 字段键, 运算: op, 值: b };
  }
  if (f.型 === "日期") {
    认日期(r.值, f.名); // 只校验，存原样字符串，编译时再转
    return { 字段: 字段键, 运算: op, 值: String(r.值) };
  }
  const 显示值 = String(r.值).trim().slice(0, 100);
  const s = 原值(显示值);
  if (f.取值 && op !== "包含") 校枚举(f, s);
  return { 字段: 字段键, 运算: op, 值: s };
}

/**
 * 枚举值拼错了要**当场报错**，不能当成一个普通字符串查下去。
 * 查「跟进状态 = 意向高」（正确的是「意向较高」）会如实返回 0 条，
 * 而模型会照着 0 条答「一位都没有」——这正是「查错了还很自信地报个数」。
 */
function 校枚举(f: 字段, v: string) {
  if (f.取值 && !f.取值.includes(v)) {
    throw 错(`「${f.名}」没有「${v}」这个取值。只能是：${f.取值.join(" / ")}`);
  }
}

/* ---------- 入参规整（批次 20b） ----------
  c1 上 query_records 79 次里 26 次「查询写得不对」。能确定意思的写法先在这里规整，不让它白跑一趟：
  英文键名、条件给成一个对象或 JSON 字符串、条件写成 {"字段名": 值}、排序只给一个字段名。
  意思不唯一的（字段对上好几个、运算看不出方向）照旧报错，错误里写清能填什么。
*/
const 顶层键别名: Record<string, string> = {
  table: "表", 表名: "表", conditions: "条件", filters: "条件", filter: "条件", where: "条件", 筛选: "条件", 过滤: "条件",
  join: "关联", relation: "关联", 跨表: "关联", sort: "排序", orderBy: "排序", order: "排序",
  limit: "取", take: "取", 条数: "取", 数量: "取", count: "只计数", countOnly: "只计数", 计数: "只计数", groupBy: "分组", group: "分组", 分组字段: "分组",
};
const 条件键别名: Record<string, string> = {
  field: "字段", 列: "字段", 字段名: "字段", op: "运算", operator: "运算", 操作: "运算", 运算符: "运算", 比较: "运算",
  value: "值", values: "值", 取值: "值", path: "路径", conditions: "条件", desc: "降序", 倒序: "降序",
};
function 换键(o: Record<string, unknown>, 表: Record<string, string>): Record<string, unknown> {
  const 出: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    const 新 = 表[k] ?? k;
    if (!(新 in 出) || k === 新) 出[新] = v;
  }
  return 出;
}
function 解JSON(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!/^[[{]/.test(t)) return v;
  try { return JSON.parse(t); } catch { return v; }
}
function 规整条件们(v: unknown): unknown[] {
  const x = 解JSON(v);
  if (x == null || x === "") return [];
  if (Array.isArray(x)) return x.map((c) => (c && typeof c === "object" && !Array.isArray(c) ? 换键(c as Record<string, unknown>, 条件键别名) : c));
  if (typeof x === "object") {
    const o = 换键(x as Record<string, unknown>, 条件键别名);
    // 一条条件给成了对象
    if ("字段" in o) return [o];
    // {"跟进状态": "意向较高", "城市": "杭州"}：每一项是「等于」（给的是数组就是「属于」）
    return Object.entries(x as Record<string, unknown>).map(([k, val]) => ({ 字段: k, 运算: Array.isArray(val) ? "属于" : "等于", 值: val }));
  }
  throw 错(`「条件」要一个数组，每一项形如 {"字段":"跟进状态","运算":"等于","值":"意向较高"}；给的是「${String(x).slice(0, 40)}」`);
}
export function 规整入参(raw: unknown): Record<string, unknown> {
  const r = 换键((解JSON(raw) ?? {}) as Record<string, unknown>, 顶层键别名);
  if (r.条件 !== undefined) r.条件 = 规整条件们(r.条件);
  const 关 = 解JSON(r.关联);
  if (关 && typeof 关 === "object" && !Array.isArray(关)) {
    const a = 换键(关 as Record<string, unknown>, 条件键别名);
    r.关联 = { ...a, 条件: 规整条件们(a.条件) };
  }
  const 排 = 解JSON(r.排序);
  if (typeof 排 === "string" && 排.trim()) {
    // 「建档时间」「建档时间 升序」「-建档时间」
    const t = 排.trim();
    const 升 = /(\s|^)(升序|asc)$/i.test(t);
    r.排序 = { 字段: t.replace(/^[-+]/, "").replace(/\s*(升序|降序|asc|desc)$/i, "").trim(), 降序: !升 };
  } else if (排 && typeof 排 === "object" && !Array.isArray(排)) {
    const o = 换键(排 as Record<string, unknown>, 条件键别名);
    if (typeof o.降序 === "string") o.降序 = !/^(false|否|升序|asc)$/i.test(o.降序);
    r.排序 = o;
  }
  if (typeof r.只计数 === "string") r.只计数 = /^(true|是|1)$/i.test(r.只计数);
  return r;
}

export function 校验规格(raw: unknown, b?: BusinessConfig, 选项: { 只用项目?: boolean } = {}): 查询规格 {
  const r = 规整入参(raw);
  const 表 = 认表(r.表, 选项.只用项目);

  const 条件 = (Array.isArray(r.条件) ? r.条件 : []).slice(0, 8).map((c) => 认条件(表, c, b));

  let 关联: 查询规格["关联"];
  if (r.关联 && typeof r.关联 === "object") {
    const a = r.关联 as Record<string, unknown>;
    const 路径 = typeof a.路径 === "string" ? a.路径.trim() : "";
    const 定义 = 关联们[路径];
    if (!定义) {
      const 可用 = Object.keys(关联们).filter((k) => 关联们[k].从 === 表);
      throw 错(
        可用.length
          ? `「${表们[表].名}」上没有「${路径 || "(空)"}」这条关联。能走的：${可用.join("、")}`
          : `「${表们[表].名}」没有可以跨的表，去掉「关联」再查`,
      );
    }
    if (定义.从 !== 表) throw 错(`「${路径}」是从「${定义.从}」出发的，不是「${表}」。从「${表}」能走的：${Object.keys(关联们).filter((k) => 关联们[k].从 === 表).join("、") || "（没有，去掉「关联」）"}`);
    const 子条件 = (Array.isArray(a.条件) ? a.条件 : []).slice(0, 4).map((c) => 认条件(定义.到, c, b));
    if (!子条件.length) throw 错(`走了「${路径}」却没给任何条件——那跟不跨表是一回事`);
    关联 = { 路径, 条件: 子条件 };
  }

  let 排序: 查询规格["排序"];
  if (r.排序 && typeof r.排序 === "object") {
    const s = r.排序 as Record<string, unknown>;
    const f = 认字段(表, s.字段, b);
    排序 = { 字段: Object.entries(查询表(表, b).字段).find(([, v]) => v.列 === f.列)![0], 降序: s.降序 !== false };
  }

  let 分组: string | undefined;
  if (r.分组 != null && r.分组 !== "") {
    const f = 认字段(表, r.分组, b);
    if (f.型 === "日期") throw 错(`「${f.名}」是日期，按它分组会分出成百上千组。按月看走势用 query_metric`);
    分组 = Object.entries(查询表(表, b).字段).find(([, v]) => v.列 === f.列)![0];
  }

  const n = Number(r.取);
  const 取 = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 取数上限) : 20;

  return { 表, 条件, 关联, 排序, 取, 只计数: r.只计数 === true, 分组 };
}

/* ---------- 翻回人话（过程条要用） ---------- */

const 值成话 = (c: 条件, f: 字段, b?: BusinessConfig): string => {
  const show = (v: string) => b && (f.列 === "followStatus" || f.列 === "decisionStatus") ? statusLabel(b, v) : v;
  if (c.运算 === "属于") return (c.值 as string[]).map(show).join(" 或 ");
  if (c.运算 === "最近天数") return `${c.值} 天`;
  if (f.型 === "真假") return c.值 ? "是" : "否";
  return show(String(c.值));
};

function 条件成话(表: 表名, c: 条件, b?: BusinessConfig): string {
  const f = 认字段(表, c.字段, b);
  if (c.运算 === "为空" || c.运算 === "非空") return `${f.名}${运算符[c.运算].名}`;
  if (c.运算 === "最近天数") return `${f.名}在最近 ${c.值} 天内`;
  return `${f.名} ${运算符[c.运算].名} ${值成话(c, f, b)}`;
}

/**
 * 把规格写成一句人话，**原样摆在过程条上**。
 *
 * 这是这个工具的配套，不是装饰。它的失败模式是「查错了还很自信地报个数」——
 * 比「答不出来」隐蔽得多。人得能一眼核对「它到底查的是不是我问的那个东西」，
 * 否则一个算错口径的数会被当成事实用下去。
 */
export function 说人话(s: 查询规格, b?: BusinessConfig): string {
  const 表定义 = 查询表(s.表, b);
  const 段: string[] = [`在${表定义.名}里`];
  if (s.条件.length) 段.push(`找 ${s.条件.map((c) => 条件成话(s.表, c, b)).join("、且 ")}`);
  else 段.push("找全部");
  if (按新建数项目(s, b)) 段.push("不含补建和历史回填的项目（同数据页「新建」口径）");
  else if (排历史回填(s.表)) 段.push(s.表 === "项目" ? "不含历史回填的项目（同数据页口径）" : "不含历史回填项目上的记录（同数据页口径）");
  if (s.关联) {
    const 定义 = 关联们[s.关联.路径];
    段.push(`并且${定义.名} ${s.关联.条件.map((c) => 条件成话(定义.到, c, b)).join("、且 ")}`);
  }
  if (s.分组) 段.push(`按${认字段(s.表, s.分组, b).名}分组数个数`);
  else if (s.只计数) 段.push("只数个数");
  else {
    if (s.排序) 段.push(`按${认字段(s.表, s.排序.字段, b).名}${s.排序.降序 ? "从大到小" : "从小到大"}排`);
    段.push(`取 ${s.取} 条`);
  }
  return 段.join("，");
}

/* ---------- 编译成 Prisma ---------- */

/** 「人」「部门」条件里的名字 → id。调用方查库得来；一个名字可能对上几个人（重名），都算 */
export type 名映射 = {
  人: Map<string, string[]>; 部门: Map<string, string[]>;
  /**
   * 后售培育（P-界面-63）：「节点」认「后售培育」这个虚拟值（库里没有这个节点，存的是潜客培育）。调用方按 用到后售培育 先取好
   * after-sale.ts 后售条件 放这里：节点 = 后售培育 → 后售条件；节点 = 潜客培育 → 潜客培育且不是后售（和数据页、项目列表一致，两边不重不漏）。
   * 不给 = 照旧（后售培育查 0 条、潜客培育含后售）
   */
  后售?: Record<string, unknown>;
};

/** 规格里有没有按项目「节点」比后售培育 / 潜客培育（有才去取 后售条件） */
export function 用到后售培育(s: 查询规格, b?: BusinessConfig): boolean {
  const 有 = (表: 表名, cs: 条件[]) => 表 === "项目" && cs.some((c) => 认字段(表, c.字段, b).列 === "node" && c.值 != null
    && (Array.isArray(c.值) ? c.值 : [String(c.值)]).some((v) => v === 后售培育名 || 同名们("潜客培育").includes(String(v))));
  return 有(s.表, s.条件) || (!!s.关联 && 有(关联们[s.关联.路径].到, s.关联.条件));
}

/** 规格里用到的全部人名 / 部门名（含关联上的），调用方据此查一次库 */
export function 用到的名字(s: 查询规格, b?: BusinessConfig): { 人: string[]; 部门: string[] } {
  const 出 = { 人: new Set<string>(), 部门: new Set<string>() };
  const 收 = (表: 表名, cs: 条件[]) => {
    for (const c of cs) {
      const f = 认字段(表, c.字段, b);
      if ((f.型 !== "人" && f.型 !== "部门") || c.值 == null) continue;
      for (const v of Array.isArray(c.值) ? c.值 : [String(c.值)]) 出[f.型].add(v);
    }
  };
  收(s.表, s.条件);
  if (s.关联) 收(关联们[s.关联.路径].到, s.关联.条件);
  return { 人: [...出.人], 部门: [...出.部门] };
}

function 条件成where(表: 表名, c: 条件, b?: BusinessConfig, 映射?: 名映射): Record<string, unknown> {
  const f = 认字段(表, c.字段, b);
  const 列 = f.列;
  if ((f.型 === "人" || f.型 === "部门") && c.值 != null) {
    const 型 = f.型;
    const ids = (Array.isArray(c.值) ? c.值 : [String(c.值)]).flatMap((v) => 映射?.[型].get(v) ?? []);
    return c.运算 === "不等于" ? { OR: [{ [列]: { notIn: ids } }, { [列]: null }] } : { [列]: { in: ids } };
  }
  if (f.同名 && (c.运算 === "等于" || c.运算 === "属于" || c.运算 === "不等于")) {
    const 值们 = (Array.isArray(c.值) ? c.值 : [String(c.值)]).map(String);
    // 后售培育：后售 ⊂ 节点潜客培育，拆成「后售条件」和「潜客培育且不是后售」两份，各自认、不重不漏
    if (映射?.后售 && 表 === "项目" && 列 === "node" && 值们.some((v) => v === 后售培育名 || 同名们("潜客培育").includes(v))) {
      const 后售 = 映射.后售;
      const 潜客名 = 同名们("潜客培育");
      const 普通 = 值们.filter((v) => v !== 后售培育名 && !潜客名.includes(v)).flatMap((v) => 同名们(v));
      const 或: Record<string, unknown>[] = [
        ...(普通.length ? [{ node: { in: 普通 } }] : []),
        ...(值们.some((v) => 潜客名.includes(v)) ? [{ AND: [{ node: { in: 潜客名 } }, { NOT: 后售 }] }] : []),
        ...(值们.includes(后售培育名) ? [后售] : []),
      ];
      const 中 = 或.length === 1 ? 或[0] : { OR: 或 };
      return c.运算 === "不等于" ? { NOT: 中 } : 中;
    }
    const 名们 = 值们.flatMap((v) => 同名们(v));
    return c.运算 === "不等于" ? { [列]: { notIn: 名们 } } : { [列]: { in: 名们 } };
  }
  const 日历列 = calendarColumns[表]?.[列];
  if (日历列 && ["不早于", "不晚于", "最近天数"].includes(c.运算)) {
    const date = c.运算 === "最近天数" ? dayjs().subtract(Number(c.值), "day") : dayjs(String(c.值));
    const op = c.运算 === "不晚于" ? "lte" : "gte";
    return { OR: [
      { [日历列]: { [op]: date.format("YYYY-MM-DD") } },
      { [日历列]: null, [列]: { [op]: (c.运算 === "不晚于" ? date.endOf("day") : date.startOf("day")).toDate() } },
    ] };
  }
  switch (c.运算) {
    case "包含":
      return { [列]: { contains: String(c.值) } };
    case "等于":
      return { [列]: c.值 };
    case "不等于":
      return { [列]: { not: c.值 } };
    case "属于":
      return { [列]: { in: c.值 as string[] } };
    case "大于":
      return { [列]: { gt: c.值 } };
    case "小于":
      return { [列]: { lt: c.值 } };
    case "不早于":
      return { [列]: { gte: dayjs(String(c.值)).startOf("day").toDate() } };
    case "不晚于":
      // 「到 9 月 30 日」含那一天，和别处的日期区间一个口径
      return { [列]: { lte: dayjs(String(c.值)).endOf("day").toDate() } };
    case "最近天数":
      return { [列]: { gte: dayjs().subtract(Number(c.值), "day").startOf("day").toDate() } };
    case "为空":
      return { [列]: null };
    case "非空":
      return { [列]: { not: null } };
  }
}

/**
 * 项目表按「创建时间」筛 = 问的是「新建了多少」（11-17 复盘第 9 类）：补零项目客户补建的潜客培育项目
 * （creatorId = 补建创建人，createdAt 记客户建档时间）、历史沟通分析回填的（source = 历史分析来源）不是这段时间新建的，
 * 同数据页 / 首页卡「本月新增」一样排掉（lib/project/system-created.ts 的 不算补建）。不带创建时间的（现在一共多少）照旧全算
 */
export function 按新建数项目(s: 查询规格, b?: BusinessConfig): boolean {
  return s.表 === "项目" && s.条件.some((c) => 认字段(s.表, c.字段, b).列 === "createdAt");
}

/**
 * 历史沟通分析回填的项目（source = 历史分析来源）不进任何统计（system-created.ts「所有统计都不算」，25E 总控定）：
 * 项目表不论按什么条件都排掉；挂在项目下的表（关联们里有「X.项目」、经 project 一跳的）只算非回填项目上的记录；
 * 节点记录另按留痕人排（回填约定第 2 条，同数据页 留痕不算历史分析）
 */
function 排历史回填(表: 表名): boolean {
  return 表 === "项目" || 关联们[`${表}.项目` as keyof typeof 关联们]?.列 === "project";
}

export function 编译(s: 查询规格, b?: BusinessConfig, 映射?: 名映射): { where: Record<string, unknown>; orderBy?: Record<string, "asc" | "desc">; take: number } {
  const and: Record<string, unknown>[] = s.条件.map((c) => 条件成where(s.表, c, b, 映射));
  // 不算补建 已含 不进统计（历史分析回填的 + 仅记录用的，X-147 同数据页）
  if (按新建数项目(s, b)) and.push(不算补建);
  else if (s.表 === "项目") and.push(不进统计);
  else if (排历史回填(s.表)) {
    and.push({ project: { is: 不进统计 } });
    if (s.表 === "节点记录") and.push({ userId: { not: 历史分析留痕人 } });
  }
  if (s.关联) {
    const 定义 = 关联们[s.关联.路径];
    const 子 = { AND: s.关联.条件.map((c) => 条件成where(定义.到, c, b, 映射)) };
    and.push({ [定义.列]: { is: 定义.经 ? { [定义.经]: { is: 子 } } : 子 } });
  }
  return {
    where: and.length ? { AND: and } : {},
    orderBy: s.排序 ? { [认字段(s.表, s.排序.字段, b).列]: s.排序.降序 ? ("desc" as const) : ("asc" as const) } : undefined,
    take: s.取,
  };
}

export { 分组上限 };
