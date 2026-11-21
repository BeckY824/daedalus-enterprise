/**
 * 企业版主动放弃（豁免）（2026-11-20，32H）的纯规则：原因选项、原因怎么认、「新分配给我」怎么认。不碰库，界面也引。
 * 整套说明见 lead-giveup.ts 文件头。
 */

/** 每人每月（北京自然月）几次 */
export const 每月放弃次数 = 1;

/**
 * 放弃原因选项（用户 11-20：原因必填，不含「线索无效 / 质量不达标」——那种走判无效）。
 * 选「其他」要补一句
 */
export const 放弃原因们 = ["外出", "忙不过来", "其他"] as const;
export type 放弃原因 = (typeof 放弃原因们)[number];
export const 其他原因 = "其他" satisfies 放弃原因;
/** 补充那句最长几个字 */
export const 放弃补充上限 = 100;

/** 框里那句：线索本身有问题不该走放弃 */
export const 走判无效话 = "线索无效请走判无效（项目里「线索验证」判无效，复核通过后记 1 条判无效待补）";
/**
 * 「其他」里写的像是在说线索无效 / 质量不达标：不收，引去判无效。
 * 只挡说线索本身坏的几种说法，「客户没空」这类照收
 */
const 无效说法 = /无效|质量|不达标|空号|假号|假线索|错号|停机|不是客户|没需求|无需求/;
export const 像判无效 = (s: string): boolean => 无效说法.test(s);

/**
 * 认框里交来的原因：只认选项里的；选「其他」要补一句（不超过 放弃补充上限 字、不能是在说线索无效）。
 * 回 文字 = 记进留痕、通知的那句（「外出」「其他：xxx」）
 */
export function 认放弃原因(原因: unknown, 补充: unknown): { ok: true; 原因: 放弃原因; 补充: string | null; 文字: string } | { ok: false; error: string } {
  if (typeof 原因 !== "string" || !(放弃原因们 as readonly string[]).includes(原因)) {
    if (typeof 原因 === "string" && 像判无效(原因)) return { ok: false, error: 走判无效话 };
    return { ok: false, error: "先选放弃原因" };
  }
  const 话 = typeof 补充 === "string" ? 补充.trim() : "";
  if (话.length > 放弃补充上限) return { ok: false, error: `补充说明最多 ${放弃补充上限} 个字` };
  if (像判无效(话)) return { ok: false, error: 走判无效话 };
  if (原因 === 其他原因 && !话) return { ok: false, error: "选「其他」要写一句为什么" };
  const 选 = 原因 as 放弃原因;
  return { ok: true, 原因: 选, 补充: 话 || null, 文字: 话 ? `${选}：${话}` : 选 };
}

/** 新分配多久以内能放弃（同超时转没填回复时间往回看的 7 天；超时转开着时 1.5 小时就转走了，这条只在开关关着时兜底） */
export const 放弃窗口天 = 7;

/** 认「新分配给我」要看的留痕（ProjectNodeLog kind transfer / pool-claim） */
export type 放弃看的痕 = { kind: string; userId: string; reason: string | null; toOwnerId: string | null; at: Date };
/** 认「新分配给我」要看的分配记录（EntLeadAssign） */
export type 放弃看的分配 = { toUserId: string; byUserId: string; createdAt: Date };

/** 分配入口（assign-actions.ts 分项目给）写的转让留痕原因开头，同 reply-overdue.ts 分配方式痕头 */
const 分配方式头 = "分配方式：";

/**
 * 这条线索是不是「新分配给我」的、哪一刻到我手上（用户 11-20：市场分配（自动 / 指定）或超时转来的）；不是 = null。
 *   - 最近一行换人留痕（转让 / 公海领取分配）是把它给我的、操作人不是我、原因以「分配方式：」开头
 *     （自动分配、指定分配、定时分配到点、超时自动转、别人主动放弃转来的都写这一行）= 那一刻
 *   - 一行换人留痕都没有、不是我建的：市场新建时直接给了我（只有分配记录）= 给我的那条分配记录的时刻
 *   - 别的（手动转让、管理从公海分、跟着客户转来、自己领的、自己建的）= 不是新分配
 */
export function 新分配时刻(我: string, p: { ownerId: string; creatorId: string }, 痕们: readonly 放弃看的痕[], 分配们: readonly 放弃看的分配[]): Date | null {
  if (!我 || p.ownerId !== 我) return null;
  const 痕 = 痕们.filter((l) => l.kind === "transfer" || l.kind === "pool-claim").sort((a, b) => b.at.getTime() - a.at.getTime());
  if (痕.length) {
    const l = 痕[0];
    return l.kind === "transfer" && l.toOwnerId === 我 && l.userId !== 我 && (l.reason ?? "").startsWith(分配方式头) ? l.at : null;
  }
  if (p.creatorId === 我) return null;
  const 分 = 分配们.filter((a) => a.toUserId === 我 && a.byUserId !== 我).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return 分?.createdAt ?? null;
}

/** 新分配时刻还在能放弃的窗口里（往回 放弃窗口天 天） */
export const 在放弃窗口 = (接手: Date, 现在: Date): boolean => 接手.getTime() >= 现在.getTime() - 放弃窗口天 * 86_400_000 && 接手.getTime() <= 现在.getTime() + 60_000;

/** 本月用过了的那句 */
/**
 * 「待补 N 条」按来源说（快轮到提醒、首页那一行）：总 = 待补几条，放弃 = 其中主动放弃（豁免）记的几条，余下是判无效记的。
 * 没有待补回空串
 */
export function 待补来源话(总: number, 放弃 = 0): string {
  const 放 = Math.min(Math.max(放弃, 0), 总);
  const 判 = 总 - 放;
  return [判 > 0 ? `判无效待补 ${判} 条` : "", 放 > 0 ? `放弃记的待补 ${放} 条` : ""].filter(Boolean).join("、");
}

export const 本月用过话 = `每人每月只能放弃 ${每月放弃次数} 次，本月已经用过了，下月 1 日起可再用`;

/**
 * 项目页给的放弃入口状态：不给（开关关、不是新分配给我的、记过有效沟通……）就不带这一格；
 * 可 = false 时按钮灰着、旁边写 为什么（验证中、本月用过）
 */
export type 放弃入口 = { 可: boolean; 为什么?: string; 本月已用: boolean };

/* ───────────────── 从通知直达放弃框（32H 续，用户 11-21「通知里面直接加上这个按钮」） ─────────────────
 * 分到我的线索（自动 / 指定分配、超时转来、同事放弃转来）和超时提醒：发通知那一刻对收件人能放弃（放弃资格 可 = true），
 * 通知链接带 ?giveup=1。飞书消息里多一个「放弃（豁免）」链接（feishu-push.ts 消息体），铃铛里同一条多一颗「放弃（豁免）」（NoticeBell）；
 * 「打开 CRM 查看」、点铃铛那一条照旧去不带参数的地址。
 * 项目页（含客户详情项目区）带着参数打开：此刻还能放弃 → 自动弹放弃框；不能 → 弹一句为什么；弹过把参数从地址里去掉（GiveUpBanner）
 */

/** 地址里的参数名（值固定 1） */
export const 放弃参数 = "giveup";
const 放弃参数段 = `${放弃参数}=1`;

const 分井号 = (link: string): [string, string] => {
  const i = link.indexOf("#");
  return i < 0 ? [link, ""] : [link.slice(0, i), link.slice(i)];
};

/** 链接里带没带 ?giveup=1 */
export function 有放弃参数(link: string | null | undefined): boolean {
  if (!link) return false;
  const [主] = 分井号(link);
  const i = 主.indexOf("?");
  return i >= 0 && 主.slice(i + 1).split("&").includes(放弃参数段);
}

/** 加上 giveup=1（已有不重复加；# 之前） */
export function 带放弃参数(link: string): string {
  if (有放弃参数(link)) return link;
  const [主, 井] = 分井号(link);
  return `${主}${主.includes("?") ? "&" : "?"}${放弃参数段}${井}`;
}

/** 去掉 giveup=1，别的参数、# 原样留着 */
export function 去放弃参数(link: string): string {
  const [主, 井] = 分井号(link);
  const i = 主.indexOf("?");
  if (i < 0) return link;
  const 余 = 主.slice(i + 1).split("&").filter((x) => x && x !== 放弃参数段);
  return `${主.slice(0, i)}${余.length ? `?${余.join("&")}` : ""}${井}`;
}

/** 发通知那一刻：对收件人能放弃（资格在、可点）才带参数；不给、验证中、本月用过的照旧只给原链接 */
export const 通知链接带放弃 = (link: string, 资格: Pick<放弃入口, "可"> | null | undefined): string => (资格?.可 ? 带放弃参数(link) : link);

/** 带着参数打开、但页上不是那一条（客户详情里那条看不到、换了别的页签）/ 那条已经进不去了 */
export const 不在手上话 = "这条线索已经不在你名下了（已转走、已收回或已删除），不能放弃";

/**
 * 不给放弃的那几种说法（放弃资格明细 回的；项目页带参数打开、又没有可点的入口时弹这一句）。
 * 能给但点不了的（验证中、本月用过）用 放弃入口.为什么
 */
export const 不给放弃话 = {
  没开: "组织规则「销售主动放弃线索（豁免）」现在关着，不能放弃",
  切换视图: "切换视图（只读预览）时不能放弃",
  只读: "你是只读身份，不能放弃",
  不在手上: 不在手上话,
  不在线索: "这条已经不在线索阶段（已推进或已有结局），不能放弃",
  在公海: "这条线索在公海里，不能放弃",
  待分配: "这条线索在待分配里，不能放弃",
  不在分配池: "你不在这条线索流转线的自动分配名单里，不能放弃",
  不是新分配: "只有新分配给你的线索（市场分配、超时转来、同事放弃转来）能放弃；自己建的、自己领的、手动转来的不能放弃",
  过了窗口: `分到你手上已超过 ${放弃窗口天} 天，不能放弃`,
  没占名额: "这条没占你的分配名额（如管理从公海分给你的），不能放弃",
  记过沟通: "你已经在这条线索（这位客户）上记过有效沟通，不能放弃了",
} as const;

/** 项目的状态够不够放弃（负责人是我、线索阶段、没结局、不在公海、不在待分配、没删）；够 = null，不够回那一句 */
export function 项目不给放弃(
  我: string,
  p: { ownerId: string; phase: string; result: string | null; pooledAt: Date | null; awaitAssignAt: Date | null; deletedAt: Date | null; 客户在公海: boolean } | null,
): string | null {
  if (!p || p.deletedAt || p.ownerId !== 我) return 不给放弃话.不在手上;
  if (p.phase !== "线索" || p.result) return 不给放弃话.不在线索;
  if (p.pooledAt || p.客户在公海) return 不给放弃话.在公海;
  if (p.awaitAssignAt) return 不给放弃话.待分配;
  return null;
}

/**
 * 项目页带着 ?giveup=1 打开时做什么：
 *   没带参数 = 无；页上不是那一条 = 说「不在你名下」；入口可点 = 弹放弃框；入口在但点不了 = 说为什么；
 *   页上没有入口（不给放弃）= 问服务器为什么（放弃说明Action）
 */
export type 放弃落地 = { 做: "无" } | { 做: "弹框" } | { 做: "说明"; 话: string } | { 做: "问服务器" };
export function 放弃落地of(参数在: boolean, 对得上: boolean, 入口: 放弃入口 | null | undefined): 放弃落地 {
  if (!参数在) return { 做: "无" };
  if (!对得上) return { 做: "说明", 话: 不在手上话 };
  if (入口?.可) return { 做: "弹框" };
  if (入口?.为什么) return { 做: "说明", 话: 入口.为什么 };
  return { 做: "问服务器" };
}

/** 通知链接带 ?giveup=1、指向项目页的：那条项目 id（铃铛按它对「此刻还能放弃」那一批）；别的 = null */
export function 放弃链接项目(link: string | null | undefined): string | null {
  if (!link || !有放弃参数(link)) return null;
  const m = /^\/projects\/([^/?#]+)/.exec(link);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/**
 * 在别处（铃铛）放弃成了以后，当前页是不是还停在这条线索 / 这位客户上（项目页 /projects/<id>、客户详情 ?project=<id>、
 * 客户跟着转走了的客户详情 /customers/<客户>）：是 = 别刷新（刷新他已不是负责人，整页 404），去项目列表；不是 = 照旧刷新
 */
export function 放弃后要离开(pathname: string, search: string, projectId: string, 客户?: { customerId?: string; 客户跟走?: boolean }): boolean {
  if (落地对得上(projectId, pathname, null)) return true;
  if (new URLSearchParams(search).get("project") === projectId) return true;
  if (客户?.客户跟走 && 客户.customerId) {
    const m = /^\/customers\/([^/?#]+)\/?$/.exec(pathname);
    try {
      if (m && decodeURIComponent(m[1]) === 客户.customerId) return true;
    } catch {
      /* 地址坏的当不是 */
    }
  }
  return false;
}

/** 带参数打开的这一页是不是那一条：项目页 /projects/<id>，或客户详情 ?project=<id> */
export function 落地对得上(projectId: string, pathname: string, 选中项目: string | null): boolean {
  if (选中项目 != null) return 选中项目 === projectId;
  const m = /^\/projects\/([^/?#]+)\/?$/.exec(pathname);
  if (!m) return false;
  try {
    return decodeURIComponent(m[1]) === projectId;
  } catch {
    return false;
  }
}

/* ───────────────── 首页置顶条、铃铛按钮（11-21，客户「用最短的路径让销售触达」） ───────────────── */

/** 首页最多摆几条（一个月只能放弃 1 次，多了没用；超出的在线索页照样看得到） */
export const 首页放弃最多 = 5;

/**
 * 首页一条「有放弃资格的新分到我的线索」（lead-giveup.ts 我能放弃的）：线索名 + 离超时还剩多久。
 * 接手于 ISO；时限话 服务端算好（首页 force-dynamic，不在浏览器里再算，免得两边钟对不上）
 */
export type 我能放弃的线索 = { projectId: string; name: string; 接手于: string; 时限话: string };

/** 剩多久（向上取整到分钟）：不到 1 分钟 / N 分钟 / H 小时 M 分钟 / D 天 H 小时 */
export function 剩多久(毫秒: number): string {
  const 分 = Math.ceil(Math.max(0, 毫秒) / 60_000);
  if (分 <= 1) return "不到 1 分钟";
  if (分 < 60) return `${分} 分钟`;
  const 时 = Math.floor(分 / 60);
  if (时 < 24) return 分 % 60 ? `${时} 小时 ${分 % 60} 分钟` : `${时} 小时`;
  const 天 = Math.floor(时 / 24);
  return 时 % 24 ? `${天} 天 ${时 % 24} 小时` : `${天} 天`;
}

/**
 * 首页条目上那句时限：
 *   超时 = 超时链在走、还没发超时提醒：「还剩 X 超时」（过了点、钟还没扫到：「已到超时时间」）
 *   转走 = 已发超时提醒、等自动转：「已超时，还剩 X 自动转走」（过了点：「已超时，马上自动转走」）
 *   窗口 = 不按超时计时（超时转关着、生效前分的）：「还剩 X 可放弃」
 */
export function 放弃时限话(种: "超时" | "转走" | "窗口", 截止: Date, 现在: Date): string {
  const 余 = 截止.getTime() - 现在.getTime();
  if (种 === "转走") return 余 > 0 ? `已超时，还剩 ${剩多久(余)} 自动转走` : "已超时，马上自动转走";
  if (种 === "超时") return 余 > 0 ? `还剩 ${剩多久(余)} 超时` : "已到超时时间";
  return `还剩 ${剩多久(余)} 可放弃`;
}
