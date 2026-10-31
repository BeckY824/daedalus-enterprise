/**
 * 企业版项目关联的几条命名规矩（2026-10-29 P17）：关联客户 / 关联联系人 / 客户页「参与的项目」上怎么称呼一个项目、一位客户、一位联系人。
 * 纯函数、不碰库，界面和服务端都 import。
 *
 *   概览名称   = 当前进程|项目区域|项目显名|需求类型，空的段跳过；进程以外三段全空 → 当前进程|项目ID
 *   客户显名   = 简称 → 全称 → 客户编号（库里没有客户编号这一列，用 id 尾巴截的短号代替，见 短号）
 *   引用联系人 = 隶属客户|显示姓名；显示姓名 = 单字姓 + 先生 / 女士，名字不像人名 → 🔥姓名暂未核实
 *
 * 引用联系人的写法对方还没确认：要换只改 引用联系人 这一个函数（显示姓名、姓名像人名 是它用的零件），调用方都只认它
 */
import { 阶段与进程, 团队版字典, type 阶段字典 } from "./stage-dict";
import { 项目区域, 读产品需求 } from "./profile-rules";
import type { 客户地址 } from "@/lib/enterprise/customer-v2";

/** 段与段之间的分隔符 */
export const 名称分隔 = "|";
/** 名字不像人名时显示的字 */
export const 姓名未核实 = "🔥姓名暂未核实";
/** 新建项目没起名时的默认名：项目显名里当没名字 */
export const 潜在项目名 = "潜在项目";

/**
 * 短号：库里的 id 是 cuid（一长串），客户没有编号这一列、项目也没有，要显示「编号」时取 id 末 6 位、转大写，前面加 #。
 * 只为了看着能分开，不保证全局唯一（同一页上撞号的概率很小），也不能拿来查
 */
export function 短号(id: string): string {
  const t = (id ?? "").trim();
  return t ? `#${t.slice(-6).toUpperCase()}` : "";
}

/** 项目显名：有简称用简称、没有用全称；全称是「潜在项目」当空；空白全去掉。项目表只有 name 一列（没有简称列），所以就是 name 去空白 */
export function 项目显名(p: { name?: string | null; shortName?: string | null }): string {
  const 去空白 = (x: string | null | undefined) => (x ?? "").replace(/\s+/g, "");
  const 简 = 去空白(p.shortName);
  if (简) return 简;
  const 全 = 去空白(p.name);
  return 全 === 潜在项目名 ? "" : 全;
}

export type 概览项目 = {
  id: string;
  name: string;
  phase: string;
  node: string;
  result?: string | null;
  productNeeds?: string | null;
} & Partial<客户地址>;

/**
 * 概览名称：当前进程|项目区域|项目显名|需求类型（列 productNeeds），空的段跳过。
 * 当前进程 = 有结局写结局、没有写节点（同项目名单 ProjectRoster），按传进来的阶段字典叫（后台改了出口叫法就用改的）；
 * 项目区域、产品需求用 P11 的 项目区域 / 读产品需求，产品需求多选用「、」连。
 * 进程以外三段全空 → 当前进程|项目ID（项目ID 用 短号）
 */
export function 概览名称(p: 概览项目, 字典: 阶段字典 = 团队版字典): string {
  const { 进程, 结局 } = 阶段与进程(p, 字典);
  const 当前进程 = (结局 ?? 进程 ?? "").trim();
  const 其余 = [项目区域(p), 项目显名(p), 读产品需求(p.productNeeds).join("、")].filter(Boolean);
  const 段 = 其余.length ? [当前进程, ...其余] : [当前进程, 短号(p.id)];
  return 段.filter(Boolean).join(名称分隔);
}

/** 客户显名：简称 → 全称 → 短号（没有客户编号列，见 短号）。都去首尾空白 */
export function 客户显名(c: { id: string; name?: string | null; shortName?: string | null }): string {
  return (c.shortName ?? "").trim() || (c.name ?? "").trim() || 短号(c.id);
}

/** 一个字的称谓：只跟在单字姓后面才算（「张总」「王工」）；两个字以上的跟在一两个字后面都算（「李经理」「欧阳先生」） */
const 单字称谓 = "总|工|董|哥|姐|叔|姨|老|师|生";
const 多字称谓 = "先生|女士|小姐|太太|老板|老总|经理|总监|主任|主管|老师|师傅|董事长|总经理|局长|处长|科长|部长|厂长|校长|院长|阿姨";
const 是称谓 = new RegExp(`^(\\p{Script=Han}(${单字称谓})|\\p{Script=Han}{1,2}(${多字称谓}))$`, "u");
/** 一看就是占位的：未知、待补、测试、某某之类 */
const 是占位 = /^(未知|不详|无|暂无|没有|待定|待补|待核实|客户|联系人|负责人|测试|test|null|undefined|n\/a|na|xx+|某+)$/iu;
/** 中文名：汉字，少数民族名中间可以带间隔号；去掉间隔号 2–12 个字 */
const 中文名 = /^\p{Script=Han}+([·•・]\p{Script=Han}+)*$/u;
/** 外文名：拉丁字母开头，字母、空格、点、连字符、撇号 */
const 外文名 = /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ .'-]*$/;

/**
 * 名字像不像个人名：空、带数字或符号、中英混写、只写了姓（一个字）、「张总」「李经理」这种姓 + 称谓、「张某」「未知」「测试」这种占位，都不像。
 * 外文名（John Smith）算像
 */
export function 姓名像人名(name: string | null | undefined): boolean {
  const 原 = (name ?? "").trim().replace(/\s+/g, " ");
  if (!原) return false;
  if (是占位.test(原.replace(/\s/g, ""))) return false;
  if (外文名.test(原)) return 原.replace(/[^A-Za-zÀ-ɏ]/g, "").length >= 2;
  const t = 原.replace(/\s/g, "");
  if (!中文名.test(t)) return false;
  const 字数 = [...t.replace(/[·•・]/g, "")].length;
  if (字数 < 2 || 字数 > 12) return false;
  if (是称谓.test(t)) return false;
  // 「张某」「张某某」「王某人」
  if (/^\p{Script=Han}某/u.test(t)) return false;
  return true;
}

/**
 * 显示姓名：单字姓 + 先生 / 女士（按性别）。
 * 性别没填（或不是男 / 女）→ 「先生/女士」：不替人猜性别，叫错比多两个字难看；看到这串也提醒去补性别。
 * 外文名原样显示（套不上「姓 + 先生」）。名字不像人名 → 🔥姓名暂未核实
 */
export function 显示姓名(c: { name?: string | null; gender?: string | null }): string {
  const 名 = (c.name ?? "").trim().replace(/\s+/g, " ");
  if (!姓名像人名(名)) return 姓名未核实;
  if (外文名.test(名)) return 名;
  const 姓 = [...名][0];
  const 称 = c.gender === "男" ? "先生" : c.gender === "女" ? "女士" : "先生/女士";
  return `${姓}${称}`;
}

/**
 * 引用联系人：隶属客户|显示姓名。隶属客户 = 联系人的主客户（Contact.customerId）按 客户显名 叫；没给客户就只写显示姓名。
 * 写法待对方确认，要换只改这一个函数
 */
export function 引用联系人(c: { name?: string | null; gender?: string | null; customer?: { id: string; name?: string | null; shortName?: string | null } | null }): string {
  const 人 = 显示姓名(c);
  return c.customer ? `${客户显名(c.customer)}${名称分隔}${人}` : 人;
}
