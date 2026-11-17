/**
 * 客户列表「导出」的表头和每一行。从 CustomersView 的 exportCsv 里拆出来，是为了能单测「导出 → 再导入一圈」
 * （2026-10-04 J-073：原来 13 列、没有备注，人手录的备注导出全没了，组件内部函数测不到，就一直没人发现）。
 * 拼文件在 export.worker.ts（写 xlsx），这里只管写哪几列。原来的 lib/csv.ts 源码里没人用了，2026-10-28 挪进 tests/helpers/csv.ts。
 */
import type { BusinessConfig } from "@/lib/business-config";
import { statusLabel, 外贸精简, 签约叫 } from "@/lib/business-config";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { 跟进方式名 } from "@/lib/follow-method";
import type { 外贸档案 } from "@/lib/customer-extra";
import { 拆主子 } from "@/lib/enterprise/channel-main-core";
import { 客户编号文字 } from "@/lib/customer-no";

/** 导出要用到的那几样。CustomerRow（列表行）和 客户行（导出取数）都满足 */
export type 导出行 = {
  name: string;
  phone: string;
  school: string | null;
  major: string | null;
  grade: string | null;
  referrerName?: string | null;
  /** 客户来源渠道全称（企业版两层时拆成主渠道、子渠道两列） */
  channelName?: string | null;
  attributionName?: string | null;
  followStatus: string;
  decisionStatus: string;
  expectedSignAt: string | null;
  signedAmount: number;
  signedTotals?: { 币种: string; 合计: number }[];
  salesOwnerName: string;
  channelOwnerName?: string | null;
  remark: string | null;
  /** 外贸档案（2026-10-05）。外贸模版导出时写成五列 */
  extra?: 外贸档案 | null;
  /** 客户编号（迁移 146，11-17 PR-1）：导出写 NO.00012，回填前没有编号的留空 */
  customerNo?: number | null;
  /** 这位的联系人上一共挂了几张图片（D-24；企业版联系人附件：名片原图等，10-28）。图片不进 Excel，只写张数 */
  附件数?: { 联系人?: number } | null;
};

/** 「联系人 3 张」；一张都没有写空（商机附件 11-11 起不数：企业版商机表已清空） */
export function 附件个数说法(n: 导出行["附件数"]): string {
  if (!n) return "";
  return n.联系人 ? `联系人 ${n.联系人} 张` : "";
}

/** 行上的签约按币种；老的调用方没给 signedTotals 时把 signedAmount 当人民币 */
export function 签约各币(r: { signedAmount: number; signedTotals?: { 币种: string; 合计: number }[] }) {
  return r.signedTotals ?? (r.signedAmount ? [{ 币种: "CNY", 合计: r.signedAmount }] : []);
}

/** 企业版渠道两层（P-渠道-01 附.5）：全称「主|子」拆成两格；没子渠道、或子和主同名时子渠道留空 */
export function 拆导出渠道(全称: string | null | undefined): [string, string] {
  const { 主, 子 } = 拆主子(全称 ?? "");
  return [主, 子 === 主 ? "" : 子];
}

/**
 * 客户编号一列（11-17 客户抬头 PR-1）：系统发的号，写在「备注」后面，表头跟叫法走（「客户编号」/「学员编号」）；最末一列是 export.worker.ts 补的「系统 ID」（库里的 id）。
 * 两列都是系统给的、导回来不收：普通导入见 lib/import/plan.ts 自家导出只读列，数据接入见 enterprise-import/mapping.ts 规则猜列
 */
export const 编号列 = (b: Pick<BusinessConfig, "customer">) => `${b.customer}编号`;
export const 系统ID列 = "系统 ID";

export function 客户导出表(rows: 导出行[], b: BusinessConfig, 隐藏负责人 = false, 渠道两层 = false): { head: string[]; body: string[][] } {
  /*
    外贸模版（2026-10-05）：多国家 / WhatsApp / 微信 / 邮箱 / 来源五列，不写推荐人、渠道归属、渠道负责人、预计签约
    （界面上不摆的，导出也不写）。表头和导入认的别名一致（lib/import/fields.ts），导回来各落各的格
  */
  if (外贸精简(b)) {
    const 金额 = (r: 导出行) => 签约各币(r).filter((x) => x.合计 > 0).map((x) => `${x.币种} ${x.合计}`).join(" · ");
    return {
      head: [`${b.customer}姓名`, "联系电话", b.fields.school, b.fields.major, b.fields.grade, "国家", "WhatsApp", "微信", "邮箱", "来源", "客户等级", "官网", "阿里国际站 ID", "跟进状态", "决策状态", `${签约叫(b)}金额`, ...(隐藏负责人 ? [] : ["销售负责人"]), "图片张数", "备注", 编号列(b)],
      body: rows.map((r) => [
        r.name, r.phone, r.school ?? "", r.major ?? "", r.grade ?? "",
        r.extra?.country ?? "", r.extra?.whatsapp ?? "", r.extra?.wechat ?? "", r.extra?.email ?? "", r.extra?.source ?? "",
        r.extra?.level ?? "", r.extra?.website ?? "", r.extra?.alibabaId ?? "",
        statusLabel(b, r.followStatus), statusLabel(b, r.decisionStatus), 金额(r), ...(隐藏负责人 ? [] : [r.salesOwnerName]), 附件个数说法(r.附件数), r.remark ?? "",
        客户编号文字(r.customerNo) ?? "",
      ]),
    };
  }
  /*
    「备注」放最后一列，表头就叫「备注」：导入那边的别名认得它，导出的文件原样导回来备注落回备注栏，
    不会变成「某某：…」并进别处（2026-10-04 J-073）
  */
  // 姓名那一列跟叫法走（L-057：叫「学员」的库导出来还写「客户姓名」）；导入的别名认 `${b.customer}姓名`，导回来照样认得
  const head = [`${b.customer}姓名`, "联系电话", b.fields.school, b.fields.major, b.fields.grade, "推荐人", "渠道归属", ...(渠道两层 ? ["主渠道", "子渠道"] : []), "跟进状态", "决策状态", "预计签约", "签约金额", ...(隐藏负责人 ? [] : ["销售负责人", "渠道负责人"]), "图片张数", "备注", 编号列(b)];
  const body = rows.map((r) => [
    r.name, r.phone, r.school ?? "", r.major ?? "", r.grade ?? "",
    r.referrerName ?? "", r.attributionName ?? "",
    // 企业版两层：主渠道、子渠道各一格，表头和导入别名一致（lib/import/fields.ts），导回来拼回全称
    ...(渠道两层 ? 拆导出渠道(r.channelName) : []),
    statusLabel(b, r.followStatus), statusLabel(b, r.decisionStatus),
    // 导出写「USD 3,200 · CNY 19,800」：只写数字的话，美元单在表里就成了人民币
    r.expectedSignAt ? fmtDate(r.expectedSignAt) : "", 签约各币(r).filter((x) => x.合计 > 0).map((x) => `${x.币种} ${x.合计}`).join(" · "),
    ...(隐藏负责人 ? [] : [r.salesOwnerName, r.channelOwnerName ?? ""]),
    // 图片不进 Excel（D-24），写明联系人上挂了几张；导回来这列不收（lib/import/plan.ts 自家导出只读列）
    附件个数说法(r.附件数),
    r.remark ?? "",
    客户编号文字(r.customerNo) ?? "",
  ]);
  return { head, body };
}

/** 导出时一条跟进要的那几样（export-action.ts 取） */
export type 跟进导出行 = {
  customerName: string;
  phone: string;
  occurredAt: string;
  type: string;
  method?: string | null;
  title: string;
  content: string;
  status: string;
  ownerName: string;
  /** 这条跟进所属客户的编号（11-17 客户抬头 PR-1b）：和客户表那列同一写法，没编号留空 */
  customerNo?: number | null;
};

/**
 * 「跟进记录」那张表（2026-10-05 外贸客户：「导出客户的时候，是否也能把跟进的记录也一并导出」）。
 * 一条跟进一行，按客户、再按时间先后排，带上客户姓名和电话——在 Excel 里按客户筛就是这位的全部往来
 */
export function 跟进导出表(rows: 跟进导出行[], b: BusinessConfig): { head: string[]; body: string[][] } {
  /*
    客户编号一列（11-17 客户抬头 PR-1b）：位置和客户表一样——内容列最后、export.worker.ts 补的「客户系统 ID」「跟进系统 ID」前面；
    表头跟叫法走，没编号的客户（存量回填前）留空，不写短号
  */
  return {
    head: [`${b.customer}姓名`, "联系电话", "时间", "方式", "标题", "内容", "状态", "记录人", 编号列(b)],
    body: rows.map((f) => [
      f.customerName, f.phone, fmtDateTime(f.occurredAt), 跟进方式名(f, ""), f.title, f.content, f.status,
      f.ownerName,
      客户编号文字(f.customerNo) ?? "",
    ]),
  };
}
