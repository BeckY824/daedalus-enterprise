/**
 * 「完成节点」框里一窗填完（11-03）：还差的必填直接摆输入，填完一个按钮存齐并推进。纯逻辑，界面和测试共用，不碰 prisma。
 *
 *   - 校验没有第二套：真正的权限、校验都在 编辑项目 / 改项目画像Action / 勾项目交付 里。这里只是提前告诉人「这样填不算」，
 *     口径和 required.ts 的 齐了 一样（占位值不算、金额要大于 0、合同要「已生效」）
 *   - 一项一项存，这样哪一项没存上能对到哪一格；一项失败不挡其它项
 *   - 存某一项时服务端可能已经自动推进了（按必填推进）：看返回的 自动推到，推过就不再手动推，不然多走一步。
 *     画像项（除需求状态）、退回来的节点不自动推，那时才手动推
 */
import { 必填项们, 是占位值, type 必填项 } from "./required";
import { 生效的合同状态 } from "./proj-fields";
import { 钱格改动, 文字格改动, type 钱格值 } from "./inline-edit";
import { 规整地址, type 客户地址 } from "@/lib/enterprise/customer-v2";
import { 默认币种 } from "@/lib/currency";
import type { 编辑项目改动, 交付项 } from "./db";
import type { 画像改动 } from "./profile";
import type { 项目成交钱 } from "./profile-rules";

/** page.tsx 的 只能看字段 里那几个名字（企业版字段权限表） */
export type 字段权限名 = "商机金额" | "预计签约" | "痛点标注" | "合同状态";
type 钱格 = Parameters<typeof 钱格改动>[0];
type 单选画像键 = Exclude<keyof 画像改动, "productNeeds">;
export type 窗外去处 = "沟通" | "附件" | "回款" | "线索验证" | "客户";

type 窗里 =
  | { 控件: "钱"; 格: 钱格; 权限: 字段权限名 }
  | { 控件: "名称" | "联系人" | "渠道" | "地址" | "级别" }
  | { 控件: "需求描述" | "痛点"; 权限: 字段权限名 }
  | { 控件: "日期"; 权限: 字段权限名 }
  | { 控件: "合同状态"; 权限: 字段权限名 }
  | { 控件: "画像单选"; 键: 单选画像键 }
  | { 控件: "画像多选" }
  | { 控件: "勾"; 项: 交付项 };
type 窗外 = { 控件: "窗外"; 去: 窗外去处 | null; 原因: string };
export type 填法 = 窗里 | 窗外;

const 去沟通 = (原因: string): 窗外 => ({ 控件: "窗外", 去: "沟通", 原因 });
const 去客户 = (原因: string): 窗外 => ({ 控件: "窗外", 去: "客户", 原因 });
const 画像 = (键: 单选画像键): 窗里 => ({ 控件: "画像单选", 键 });

/**
 * 每个必填怎么填。写成 Record<必填项, …>：required.ts 加了新必填，这里不补就编译不过。
 * 窗外的几样：下一步、沟通只在记沟通时写；附件要传文件；回款是一笔一笔的；线索验证要走判定和复核；客户侧资料不是项目上的字段
 */
/** 窗外去客户页的几项落在客户页哪一格（customers/[id] RecordView 认 #field-xxx：展开没填的、滚过去，11-03 A6-1） */
export const 客户格: Partial<Record<必填项, string>> = { 分配方式: "assignWay" };

export const 填法表: Record<必填项, 填法> = {
  联系方式: 去客户("联系方式记在客户、联系人资料上"),
  来源: 去客户("客户来源记在客户资料上"),
  国家: 去客户("国家 / 地区记在客户资料上"),
  客户等级: 去客户("客户等级记在客户资料上"),
  分配方式: 去客户("分配方式记在客户资料的「客户分配」里"),
  所属客户: { 控件: "窗外", 去: null, 原因: "项目没挂在客户名下，这里加不了，请找管理员处理" },
  主联系人: { 控件: "联系人" },
  需求: 画像("demandStatus"),
  需求类型: { 控件: "画像多选" },
  金额: { 控件: "钱", 格: "金额", 权限: "商机金额" },
  合同金额: { 控件: "钱", 格: "合同金额", 权限: "商机金额" },
  定金金额: { 控件: "钱", 格: "定金金额", 权限: "商机金额" },
  预计成交日期: { 控件: "日期", 权限: "预计签约" },
  需求描述: { 控件: "需求描述", 权限: "商机金额" },
  痛点标注: { 控件: "痛点", 权限: "痛点标注" },
  合同已生效: { 控件: "合同状态", 权限: "合同状态" },
  项目名称: { 控件: "名称" },
  // 项目来源只在项目自己的来源空着时才算缺（required.ts），所以这里只是补一次；有值就锁（P-删-03），服务端 改项目 拒换、拒清空
  项目来源: { 控件: "渠道" },
  项目所在地: { 控件: "地址" },
  项目级别: { 控件: "级别" },
  验收通过: { 控件: "勾", 项: "acceptancePassed" },
  尾款结清: { 控件: "勾", 项: "balanceSettled" },
  预算能力: 画像("budgetLevel"),
  价格感知: 画像("priceSense"),
  决策链路: 画像("decisionChain"),
  采购周期: 画像("purchaseCycle"),
  产品匹配: 画像("productFit"),
  价值认同: 画像("valueFit"),
  决策触达: 画像("decisionReach"),
  竞品信息: 画像("competitor"),
  部署条件: 画像("deployFit"),
  场地现状: 画像("siteStatus"),
  下一步时间: 去沟通("下一步时间是记沟通时一起写的，单独填不了"),
  下一步计划: 去沟通("下一步计划是记沟通时一起写的，单独填不了"),
  本节点沟通: 去沟通("要在当前进程上记一条沟通"),
  沟通三项: 去沟通("要在当前进程上记一条沟通，发起主体、内容、方式都写上"),
  有效沟通: { 控件: "窗外", 去: null, 原因: "「线索验证」这一步配的其他必填项都填好就算（没配的话选好需求状态）" },
  合同附件: { 控件: "窗外", 去: "附件", 原因: "要传文件，在「项目附件」的合同附件里传" },
  项目方案: { 控件: "窗外", 去: "附件", 原因: "要传文件，在「项目附件」的项目方案里传" },
  回款: { 控件: "窗外", 去: "回款", 原因: "回款要一笔一笔记（时间、币种、金额），在「回款」卡上记" },
  线索验证结果: { 控件: "窗外", 去: "线索验证", 原因: "要走线索验证的判定，判完才算" },
};

/** 窗里要用到的项目现值（ProjectDetail 的 项目详情 是它的超集） */
export type 补齐项目 = {
  name: string;
  amount: number;
  currency: string;
  contact?: { id: string } | null;
  expectedDealAt?: string | null;
  channelId?: string | null;
  level?: string | null;
  所在地?: (客户地址 & { location: string | null }) | null;
  成交钱?: 项目成交钱;
  项目新字段?: { painPoints?: string | null; contractStatus?: string | null };
  画像?: { 值: Partial<Record<string, string | string[] | null>> } | null;
  acceptancePassed: boolean;
  balanceSettled: boolean;
};

export type 地址草稿 = 客户地址;
export type 草稿值 = string | string[] | boolean | 钱格值 | 地址草稿 | null;
export type 草稿们 = Partial<Record<必填项, 草稿值>>;

const 是必填项 = (k: string): k is 必填项 => k in 填法表;
/** 目录顺序（新增的项排哪都一样）：存上一项、刷新以后行不乱跳 */
const 目录序 = new Map<string, number>(必填项们.map((x, i) => [x.key, i]));
export const 按目录排 = (们: readonly string[]) => [...new Set(们)].sort((a, b) => (目录序.get(a) ?? 999) - (目录序.get(b) ?? 999));

export type 窗里环境 = {
  /** 能就地改：负责人、不在公海、企业版（和项目卡同一个判断） */
  能就地改: boolean;
  改不了话: string;
  只能看字段?: readonly string[];
  /** 渠道们有几个；undefined = 这个人拿不到 */
  渠道数?: number;
  有所在地: boolean;
  有画像: boolean;
  联系人数: number;
};
export type 行归类 =
  | { 类: "填"; 法: 窗里 }
  | { 类: "去"; 去: 窗外去处 | null; 原因: string };

/** 这一项在这个人、这个项目上：能不能当场填，不能的话为什么、去哪 */
export function 归类(项: string, 环: 窗里环境): 行归类 {
  if (!是必填项(项)) return { 类: "去", 去: null, 原因: "这一项这里填不了，请找管理员看一下" };
  const 法 = 填法表[项];
  if (法.控件 === "窗外") return { 类: "去", 去: 法.去, 原因: 法.原因 };
  if (!环.能就地改) return { 类: "去", 去: null, 原因: 环.改不了话 };
  if ("权限" in 法 && 环.只能看字段?.includes(法.权限)) return { 类: "去", 去: null, 原因: "你的字段权限不能改这一项，请找管理员" };
  if (法.控件 === "渠道" && !环.渠道数) return { 类: "去", 去: null, 原因: "还没有能选的渠道，请管理员先在设置里加" };
  if (法.控件 === "地址" && !环.有所在地) return { 类: "去", 去: null, 原因: "现在看不到这个项目的所在地，领取后才能填" };
  if ((法.控件 === "画像单选" || 法.控件 === "画像多选") && !环.有画像) return { 类: "去", 去: null, 原因: "现在看不到这个项目的画像，领取后才能填" };
  if (法.控件 === "联系人" && !环.联系人数) return { 类: "去", 去: "客户", 原因: "这位客户还没有联系人，先到客户页加一位" };
  return { 类: "填", 法 };
}

const 字 = (v: unknown) => (typeof v === "string" ? v : "");
const 有字 = (v: unknown) => 字(v).trim().length > 0;
const 去占位 = (v: string | null | undefined) => (v && !是占位值(v) ? v : null);

/** 项目上现在存的文字（只给会存占位值的那几格）；窗外、钱、勾没有 */
function 现在的字(项: 必填项, p: 补齐项目): string | null {
  const 法 = 填法表[项];
  switch (法.控件) {
    case "名称": return p.name;
    case "需求描述": return p.成交钱?.dealDemand ?? null;
    case "痛点": return p.项目新字段?.painPoints ?? null;
    case "级别": return p.level ?? null;
    case "画像单选": return 字(p.画像?.值[法.键]) || null;
    default: return null;
  }
}

/** 库里存的是占位值：格子里留空，旁边说一句为什么（不然人会以为「我填过了」） */
export function 现值不算的话(项: 必填项, p: 补齐项目): string | null {
  const 现 = 现在的字(项, p);
  return 现 && 是占位值(现) ? `现在是「${现}」，不算填了` : null;
}

/** 打开时格子里的值：现值里占位值、0 不带进来 */
export function 初始草稿(项: 必填项, p: 补齐项目): 草稿值 {
  const 法 = 填法表[项];
  switch (法.控件) {
    case "钱": {
      const 钱 = p.成交钱;
      const 数 = 法.格 === "金额" ? p.amount : 法.格 === "合同金额" ? 钱?.contractAmount : 钱?.depositAmount;
      const 币 = 法.格 === "金额" ? p.currency : 法.格 === "合同金额" ? 钱?.contractCurrency : 钱?.depositCurrency;
      return { 数: 数 && 数 > 0 ? 数 : null, 币: 币 || p.currency || 默认币种 };
    }
    case "名称": case "需求描述": case "痛点": case "级别": case "画像单选": return 去占位(现在的字(项, p));
    case "日期": return p.expectedDealAt ?? null;
    case "合同状态": return p.项目新字段?.contractStatus ?? null;
    case "联系人": return p.contact?.id ?? null;
    case "渠道": return p.channelId ?? null;
    case "地址": {
      const a = p.所在地;
      return { addrCountry: a?.addrCountry ?? null, addrProvince: a?.addrProvince ?? null, addrCity: a?.addrCity ?? null, addrDistrict: a?.addrDistrict ?? null };
    }
    case "画像多选": {
      const 们 = p.画像?.值.productNeeds;
      return Array.isArray(们) ? 们.filter((x) => !是占位值(x)) : [];
    }
    case "勾": return 法.项 === "acceptancePassed" ? p.acceptancePassed : p.balanceSettled;
    case "窗外": return null;
  }
}

/** 还一个字没动（空着不标红，只在按钮下面写还差谁）；填了但不算才当场说 */
export function 草稿是空的(项: 必填项, 值: 草稿值 | undefined): boolean {
  const 法 = 填法表[项];
  switch (法.控件) {
    case "钱": return (值 as 钱格值 | null)?.数 == null;
    case "地址": {
      const a = 值 as 地址草稿 | null;
      return !a || ![a.addrCountry, a.addrProvince, a.addrCity, a.addrDistrict].some(有字);
    }
    case "画像多选": return !Array.isArray(值) || !值.length;
    case "勾": return 值 !== true;
    default: return !有字(值);
  }
}

/** 这样填算不算填了（null = 算）。判定和 required.ts 齐了 同一个口径 */
export function 草稿问题(项: 必填项, 值: 草稿值 | undefined): string | null {
  const 法 = 填法表[项];
  const 占位话 = (v: string) => `「${v.trim()}」是占位值，不算填了`;
  switch (法.控件) {
    case "窗外": return "这一项这里填不了";
    case "钱": {
      const v = 值 as 钱格值 | null | undefined;
      if (v?.数 == null || !(v.数 > 0)) return "要大于 0";
      return v.币 ? null : "请选币种";
    }
    case "名称": case "需求描述": case "痛点": case "级别": case "画像单选": {
      if (!有字(值)) return "还没填";
      return 是占位值(字(值)) ? 占位话(字(值)) : null;
    }
    case "日期": case "联系人": case "渠道": return 有字(值) ? null : "还没选";
    case "合同状态": return 值 === 生效的合同状态 ? null : `要选「${生效的合同状态}」才算填上`;
    case "地址": {
      // 和服务端存的时候一个算法：国家空着、填了省市的算国内
      const r = 规整地址((值 ?? {}) as 地址草稿);
      if (!r.ok) return r.error;
      if (!r.值.addrCountry) return "还没选国家 / 地区";
      return 是占位值(r.值.addrCountry) ? 占位话(r.值.addrCountry) : null;
    }
    case "画像多选": return Array.isArray(值) && 值.some((x) => 有字(x) && !是占位值(x)) ? null : "至少选一项";
    case "勾": return 值 === true ? null : "还没勾上";
  }
}

export type 一项改动 =
  | { 存: "项目"; 改动: 编辑项目改动 }
  | { 存: "画像"; 改动: 画像改动 }
  | { 存: "交付"; 项: 交付项 };

/** 草稿 → 交给哪个 action 的哪几列。只交这一项（改项目 没传的不动） */
export function 这项的改动(项: 必填项, 值: 草稿值 | undefined): 一项改动 | null {
  const 法 = 填法表[项];
  switch (法.控件) {
    case "窗外": return null;
    case "钱": return { 存: "项目", 改动: 钱格改动(法.格, 值 as 钱格值) };
    case "名称": return { 存: "项目", 改动: { name: 字(值).trim() } };
    case "需求描述": return { 存: "项目", 改动: { dealDemand: 文字格改动(字(值)) } };
    case "痛点": return { 存: "项目", 改动: { painPoints: 文字格改动(字(值)) } };
    case "日期": return { 存: "项目", 改动: { expectedDealAt: 字(值) || null } };
    case "级别": return { 存: "项目", 改动: { level: 字(值) || null } };
    case "合同状态": return { 存: "项目", 改动: { contractStatus: 字(值) } };
    case "联系人": return { 存: "项目", 改动: { contactId: 字(值) || null } };
    case "渠道": return { 存: "项目", 改动: { channelId: 字(值) || null } };
    case "地址": {
      const a = 值 as 地址草稿;
      return { 存: "项目", 改动: { addrCountry: a.addrCountry, addrProvince: a.addrProvince, addrCity: a.addrCity, addrDistrict: a.addrDistrict } };
    }
    case "画像单选": return { 存: "画像", 改动: { [法.键]: 字(值) } };
    case "画像多选": return { 存: "画像", 改动: { productNeeds: (值 as string[]).filter((x) => !是占位值(x)) } };
    case "勾": return { 存: "交付", 项: 法.项 };
  }
}

export type 窗口状态 = {
  /** 这次点保存要存的：当场能填、填得算数、还没存上 */
  待存: 必填项[];
  /** 当场能填但还没填好 */
  没填好: 必填项[];
  /** 只能去别处的、或这个人改不了的 */
  窗外们: string[];
  能一键完成: boolean;
};

/** 还差的每一项现在是什么情况，决定「保存并完成节点」亮不亮 */
export function 算窗口状态(行们: readonly string[], 环: 窗里环境, 草稿: (k: 必填项) => 草稿值 | undefined, 已存: readonly string[], 能推进: boolean): 窗口状态 {
  const 态: 窗口状态 = { 待存: [], 没填好: [], 窗外们: [], 能一键完成: false };
  for (const k of 行们) {
    if (已存.includes(k)) continue;
    if (归类(k, 环).类 === "去" || !是必填项(k)) { 态.窗外们.push(k); continue; }
    (草稿问题(k, 草稿(k)) ? 态.没填好 : 态.待存).push(k);
  }
  态.能一键完成 = 能推进 && 态.待存.length > 0 && !态.没填好.length && !态.窗外们.length;
  return 态;
}

export type 存一项结果 = { ok: boolean; error?: string; 自动推到?: string[] };
export type 依次保存结果 = { 已存: 必填项[]; 失败: Partial<Record<必填项, string>>; 自动推到: string[] };
const 没存上 = "没存上，请稍后再试";

/** 一项一项存：一项失败（返回 ok:false 或抛错）记下原因，接着存别的 */
export async function 依次保存(项们: readonly 必填项[], 存一项: (k: 必填项) => Promise<存一项结果>): Promise<依次保存结果> {
  const 果: 依次保存结果 = { 已存: [], 失败: {}, 自动推到: [] };
  for (const k of 项们) {
    try {
      const r = await 存一项(k);
      if (r.ok) {
        果.已存.push(k);
        if (r.自动推到?.length) 果.自动推到.push(...r.自动推到);
      } else 果.失败[k] = r.error ?? 没存上;
    } catch {
      果.失败[k] = 没存上;
    }
  }
  return 果;
}

/** 点的是哪个按钮：保存并完成 / 仍要推进（老板、主管，存完不看还差）/ 只保存 */
export type 想怎么走 = "推" | "强推" | "只存";
/**
 * 存完下一步：有失败留窗（已填的都在）；服务端已经自动推过了就关窗，不再手动推（否则多走一步）；
 * 都存上了才手动推（画像项、退回来的节点不自动推）
 */
export function 存完怎么走(果: Pick<依次保存结果, "失败" | "自动推到">, 想: 想怎么走): "留窗" | "关窗" | "推" | "强推" {
  if (Object.keys(果.失败).length) return "留窗";
  if (果.自动推到.length) return "关窗";
  return 想 === "只存" ? "留窗" : 想;
}
