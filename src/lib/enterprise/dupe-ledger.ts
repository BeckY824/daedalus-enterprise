/**
 * 企业版新建客户查重的「同一套」（2026-11-10，机制表 P-挂靠-01 / X-48 / X-23）：客户名或号码撞上已有客户，
 * 都露出现有负责人（姓名 · 级别 · 状态）＋「申请挂靠」入口，记撞号台账（EntDupeHit），按台账数三档预警。
 *
 * - 号码那一半的查重、拦截、同号协同照旧在 contact-dedupe.ts / same-number-collab.ts；这里只在撞了「有人在跟」的客户时补露出 + 台账。
 * - 客户名那一半是新的：名字按 名键 比（全角转半角、去空白、不分大小写，和导入查重同一个口径）；公司（school 列）填了的也按 名键 比公司。
 *   只比全称（name）和公司：抬头（显示名，现算）、简称都不参与（P-抬头-17 / P-抬头-04）；全称空着的不比名字，空全称的老客户也撞不上
 * - 公海客户、没负责人（占位）的客户不提示（P-挂靠-01「公海客户、要回避的客户不提示」）；撞的是我自己名下的，只说「你名下已有」，不记台账、不给申请挂靠。
 * - 查询人在那位客户的项目组里（负责人或已加入的组员）= 同组：提示「同组协作」带项目名和组员，台账照记但标同组、不算预警（回执 X6「不记风险」）。
 * - 第一期不做强录：命中只拦截提示 + 台账留痕；第三档（绕过强录）随强录推迟，常量留着、不触发。
 * - 申请挂靠记下来、定审批人（客户现在的负责人，换负责人时跟着换）、在职就通知他；审批、24 小时转实线上级、批准后的只读卡在 attach-approval.ts（P-挂靠-02 / P-看-13）。
 */
import { prisma } from "@/lib/prisma";
import { 企业版 } from "./switch";
import { 看全部, 看得到, type 谁 } from "@/lib/team-scope";
import { 名键 } from "@/lib/enterprise-import/clean";
import { 名键必含字 } from "@/lib/search-keyword";
import { 角色名 } from "@/lib/sync/dept-policy";
import { 无负责人占位邮箱 } from "@/lib/pool";
import { 拆角色, 直属上级of } from "./org-core";
import { 读组织 } from "./org";
import { notify } from "./notify";
import { 通知里的客户名, 撞的写法 } from "./notice-mask";
import { 全称或显名 } from "./customer-title";
import { 挂靠超时小时, 挂靠页 } from "./attach-approval";
import { 挂靠进公海状态 } from "@/lib/owner-log-db";
import { 离职负责人找谁 } from "./departed-owner";
import { 全公司查号, 首条撞的, type 验好的号 } from "./contact-dedupe";
import { 读未建线索, type 未建线索记录 } from "./unbuilt-record";

/** 台账的键类型：号码四种照 号码类型 的叫法，名字两种 */
export type 撞号键类型 = "手机号" | "邮箱" | "微信" | "旺旺ID" | "客户名" | "公司名";

/** 三档预警的口子（回执 X6）。第三档（绕过强录）随强录推迟：开着 = false，代码里不触发 */
export const 撞号预警 = {
  天数: 7,
  /** 第一档：同一人同一客户 7 天内撞上 ≥ 这么多次 → 告诉那位客户的负责人 */
  第一档次数: 3,
  /** 第二档：同一客户 7 天内被 ≥ 这么多个不同的人撞上 → 告诉负责人的直属上级 */
  第二档人数: 3,
  第三档开着: false,
  /** 同一人同一客户同一键这么多分钟内再查（查重按钮 → 保存再挡一次）只算一行 */
  合并分钟: 10,
} as const;

export type 负责人露出 = { 姓名: string; 级别: string | null; 状态: "在职" | "已离职"; 离职找?: string };
export type 同组情况 = { 项目: string; 成员: string[] };

/** 给界面的那一块：撞号id 是台账那一行，「申请挂靠」拿它；同组的、没记上的没有 */
export type 撞号露出 = {
  撞号id: string | null;
  键类型: 撞号键类型;
  /** 看得到才给（同 撞号结论） */
  客户id: string | null;
  /** 看得到、或者撞的就是客户名（录的人自己打的）才给 */
  客户名: string | null;
  负责人: 负责人露出;
  同组?: 同组情况;
  已申请?: true;
};

/** 「小甲 · 销售成员 · 在职」 */
export const 负责人一行 = (r: 负责人露出) => [r.姓名, r.级别, r.状态].filter(Boolean).join(" · ");

/** 负责人的姓名 · 级别（主业务角色）· 状态；占位负责人（公海）、找不到人 = null */
export async function 露出负责人(ownerId: string): Promise<负责人露出 | null> {
  const [u, m] = await Promise.all([
    prisma.user.findUnique({ where: { id: ownerId }, select: { name: true, active: true, email: true } }),
    prisma.entMember.findUnique({ where: { userId: ownerId }, select: { bizRole: true } }),
  ]);
  if (!u || u.email === 无负责人占位邮箱) return null;
  const 主 = 拆角色(m?.bizRole)[0];
  const 找谁 = u.active ? null : await 离职负责人找谁(ownerId);
  return { 姓名: u.name, 级别: 主 ? 角色名[主] : null, 状态: u.active ? "在职" : "已离职", ...(找谁 ? { 离职找: 找谁 } : {}) };
}

/** 我在不在这位客户的项目组里（项目负责人或已加入的组员）：在就回最早那个项目的名字和组员 */
async function 同组(customerId: string, 我: string): Promise<同组情况 | null> {
  const p = await 看全部(() => prisma.project.findFirst({
    where: { customerId, OR: [{ ownerId: 我 }, { members: { some: { userId: 我, inviteStatus: "JOINED" } } }] },
    select: { name: true, ownerId: true, members: { where: { inviteStatus: "JOINED" }, select: { userId: true } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  }));
  if (!p) return null;
  const ids = [...new Set([p.ownerId, ...p.members.map((m) => m.userId)])];
  const 人 = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const 名 = new Map(人.map((u) => [u.id, u.name]));
  return { 项目: p.name, 成员: ids.map((id) => 名.get(id)).filter((x): x is string => !!x) };
}

type 台账行 = {
  userId: string; keyType: 撞号键类型; keyValue: string; customerId: string; ownerId: string;
  sameGroup: boolean; result: 撞号结果;
};

/**
 * 台账「结果」：查重按钮、保存被拦 = 拦截；同号协同写进了现有项目（出口 A）= 写进现有项目；市场成员在负责人名下新建了线索（出口 C，重复咨询第一步）= 新建线索；
 * 出口 C 交销售挑不到人、整笔没建 = 没人接：原因（台账没有原因列，原因跟在结果后面，没人接结果 拼）；查的人在同一个项目组 = 同组提示
 */
export type 撞号结果 = "拦截" | "写进现有项目" | "新建线索" | "同组提示" | `${typeof 没人接前缀}${string}`;
export const 没人接前缀 = "没人接：";
export const 没人接结果 = (为什么: string) => `${没人接前缀}${为什么}`.slice(0, 200) as `${typeof 没人接前缀}${string}`;

/**
 * 「未建线索」待补建记录（机制总表 P-公海-15 后半，客户 E-223「从第一天起挑不到人的咨询都留得下来」，迁移 165 EntDupeHit.unbuilt）：
 * 出口 C 整笔没建的两种——交销售挑不到人（没人接）、主路径客户负责人到持有上限（到上限，用户 11-23 定照挑不到人处理）——
 * 台账这一行存补建要用的字段。记录的样子和读写在 unbuilt-record.ts；「挂靠申请」页「重复咨询待补建」一栏、补建 / 不补建在 repeat-unbuilt.ts
 */
export { 读未建线索, type 未建线索记录 } from "./unbuilt-record";

/** 往一行上记待补建：原来没有 = 存成一个对象；已有 = 追加成数组（不盖掉前一次，同一人 10 分钟内再交两次都留得下） */
function 追加未建(原: string | null | undefined, 记录: 未建线索记录): string {
  const 已有 = 读未建线索(原);
  // 原来有字却读不出（不该有）：原样包进数组留着，不丢
  if (原 && !已有.length) return JSON.stringify([原, 记录]);
  return JSON.stringify(已有.length ? [...已有, 记录] : 记录);
}

/**
 * 记「未建线索」（兜底那一路）：落在这次撞号那一行上（同一人、同一客户、同一键、10 分钟内最新的）；
 * 找不到（这一刻撞不上：客户刚进公海、负责人是占位）就补一行（结果 = 没人接：原因）。那一行已有待补建 = 追加，不盖掉。
 * 平常走 没建记台账（和撞号那一次写在一起），它没写成才来这里。从不抛：没记上回 null、记错误日志，调用方要让人知道
 */
export async function 记未建线索(
  d: { userId: string; keyType: string; keyValue: string; customerId: string; ownerId: string }, 记录: 未建线索记录,
): Promise<string | null> {
  try {
    return await prisma.$transaction(async (tx) => {
      const 有 = await tx.entDupeHit.findFirst({
        where: { userId: d.userId, customerId: d.customerId, keyType: d.keyType, keyValue: d.keyValue.slice(0, 200), createdAt: { gte: new Date(Date.now() - 撞号预警.合并分钟 * 60_000) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, unbuilt: true },
      });
      if (有) {
        await tx.entDupeHit.update({ where: { id: 有.id }, data: { unbuilt: 追加未建(有.unbuilt, 记录) } });
        return 有.id;
      }
      const 行 = await tx.entDupeHit.create({
        data: { userId: d.userId, keyType: d.keyType, keyValue: d.keyValue.slice(0, 200), customerId: d.customerId, ownerId: d.ownerId, result: 没人接结果(记录.没建原因), unbuilt: JSON.stringify(记录) },
        select: { id: true },
      });
      return 行.id;
    });
  } catch (e) {
    console.error("[撞号台账] 未建线索没记上：", e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * 出口 C 整笔没建（交销售没人接 / 主路径负责人到持有上限）：撞号台账这一行记「没人接：原因」，待补建记录在同一次写入里一起存
 *（查号码时记的那一行 10 分钟内并进去；那一行已有待补建 = 追加成数组）。这一刻撞不上（客户刚进公海、负责人是占位）、
 * 或这一次没写成 = 走 记未建线索 再补一行。返回存了待补建的台账行 id；都没写成 = null（调用方让人知道，不能悄悄丢）
 */
export async function 没建记台账(我: string, 读的我: 谁 | null, 号: 验好的号, customerId: string, ownerId: string, 记录: 未建线索记录): Promise<string | null> {
  if (企业版() && ["手机号", "邮箱", "微信", "旺旺ID"].includes(号.类型)) {
    const r = await 撞上客户记(我, 读的我, 号.类型 as 撞号键类型, 号.值, customerId, 没人接结果(记录.没建原因), 记录);
    if (r.行?.未建记上) return r.行.id;
  }
  return 记未建线索({ userId: 我, keyType: 号.类型, keyValue: 号.值, customerId, ownerId }, 记录);
}

/**
 * 记一行（10 分钟内同一人同一客户同一键的并进上一行），新记的看要不要预警。带 未建 = 同一次写入存待补建记录（并进的那一行已有 = 追加）。
 * 从不抛：台账没记上不挡查重（回 null）；预警没发出去不算没记上
 */
async function 记撞号(d: 台账行, 未建?: 未建线索记录): Promise<{ id: string; action: string | null; 未建记上: boolean } | null> {
  let 行: { id: string; action: string | null; 新: boolean };
  try {
    const 近 = new Date(Date.now() - 撞号预警.合并分钟 * 60_000);
    const 写 = async (tx: Pick<typeof prisma, "entDupeHit">) => {
      const 有 = await tx.entDupeHit.findFirst({
        where: { userId: d.userId, customerId: d.customerId, keyType: d.keyType, keyValue: d.keyValue, createdAt: { gte: 近 } },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true, result: true, unbuilt: true },
      });
      if (有) {
        // 查重按钮记的「拦截」，保存时写进了现有项目 / 新建了线索：改成后者
        const data = {
          ...(d.result !== "拦截" && 有.result !== d.result ? { result: d.result } : {}),
          ...(未建 ? { unbuilt: 追加未建(有.unbuilt, 未建) } : {}),
        };
        if (Object.keys(data).length) await tx.entDupeHit.update({ where: { id: 有.id }, data });
        return { id: 有.id, action: 有.action, 新: false };
      }
      const 建 = await tx.entDupeHit.create({ data: { ...d, ...(未建 ? { unbuilt: JSON.stringify(未建) } : {}) }, select: { id: true, action: true } });
      return { ...建, 新: true };
    };
    // 带待补建：找那一行和改它放一个事务里（两次几乎同时交，不让后一次读到旧值盖掉前一次）
    行 = 未建 ? await prisma.$transaction((tx) => 写(tx)) : await 写(prisma);
  } catch (e) {
    console.warn("[撞号台账] 没记上：", e instanceof Error ? e.message : e);
    return null;
  }
  if (行.新 && !d.sameGroup) await 看预警(行.id, d).catch((e) => console.warn("[撞号台账] 预警没发出去：", e instanceof Error ? e.message : e));
  return { id: 行.id, action: 行.action, 未建记上: !!未建 };
}

/**
 * 第一档、第二档：数够了就发，同一对象 7 天内同一档只发一次（按 warnTier 的位看发没发过）。
 * 结果是「新建线索」「没人接：…」的不算次数（出口 C 是正常承接，没人接也是正常承接没接上，不是试探；重复咨询研判 11-21 默认）
 */
async function 看预警(行id: string, d: 台账行): Promise<void> {
  const 起 = new Date(Date.now() - 撞号预警.天数 * 86_400_000);
  const 不同组 = { customerId: d.customerId, sameGroup: false, createdAt: { gte: 起 }, NOT: [{ result: "新建线索" }, { result: { startsWith: 没人接前缀 } }] };
  const [org, 客户, 查的人] = await Promise.all([
    读组织(),
    看全部(() => prisma.customer.findUnique({ where: { id: d.customerId }, select: { id: true, name: true, shortName: true, customerNo: true } })),
    prisma.user.findUnique({ where: { id: d.userId }, select: { name: true } }),
  ]);
  const 客户名 = 客户 ? 通知里的客户名(客户) : "";
  const link = `/customers/${d.customerId}`;
  let 位 = 0;

  const 我查几次 = await prisma.entDupeHit.count({ where: { ...不同组, userId: d.userId } });
  if (我查几次 >= 撞号预警.第一档次数 && org.成员.has(d.ownerId)) {
    const 发过 = await prisma.entDupeHit.findFirst({ where: { ...不同组, userId: d.userId, id: { not: 行id }, warnTier: { in: [1, 3] } }, select: { id: true } });
    if (!发过) {
      const n = await notify([d.ownerId], {
        kind: "撞号预警",
        title: `撞号预警：${查的人?.name ?? "同事"} ${撞号预警.天数} 天内第 ${我查几次} 次撞上你负责的客户「${客户名}」`,
        // 撞上的号码打码（P-转-12 提醒里不带手机号，审核 11-18 P1-2）
        body: `新建客户时按${撞的写法(d.keyType, d.keyValue)} 撞上。第一档预警：同一人 ${撞号预警.天数} 天内撞同一位客户 ${撞号预警.第一档次数} 次`,
        link, key: `撞号预警1:${行id}`,
      });
      if (n) 位 |= 1;
    }
  }

  const 们 = await prisma.entDupeHit.findMany({ where: 不同组, distinct: ["userId"], select: { userId: true } });
  if (们.length >= 撞号预警.第二档人数) {
    const 上级 = 直属上级of(org, d.ownerId);
    const 发过 = 上级 ? await prisma.entDupeHit.findFirst({ where: { ...不同组, id: { not: 行id }, warnTier: { in: [2, 3] } }, select: { id: true } }) : null;
    if (上级 && !发过) {
      const 名们 = await prisma.user.findMany({ where: { id: { in: [d.ownerId, ...们.map((r) => r.userId)] } }, select: { id: true, name: true } });
      const 名 = new Map(名们.map((u) => [u.id, u.name]));
      const n = await notify([上级], {
        kind: "撞号预警",
        title: `撞号预警：${撞号预警.天数} 天内 ${们.length} 个人撞上 ${名.get(d.ownerId) ?? "下属"} 负责的客户「${客户名}」`,
        body: `撞上的人：${们.map((r) => 名.get(r.userId) ?? "同事").join("、")}。第二档预警：同一位客户 ${撞号预警.天数} 天内被 ${撞号预警.第二档人数} 个不同的人撞上`,
        link, key: `撞号预警2:${行id}`,
      });
      if (n) 位 |= 2;
    }
  }
  if (位) await prisma.entDupeHit.update({ where: { id: 行id }, data: { warnTier: 位 } });
}

/**
 * 撞上这位客户：露出负责人、记台账。公海 / 没负责人 / 占位负责人 / 我自己名下的 = null（不提示、不记）。
 * 结果 = 这次怎么处理的：查重按钮、保存被拦都是「拦截」，同号协同写进了现有项目是「写进现有项目」，出口 C 建了线索是「新建线索」、交销售没人接是「没人接：原因」
 */
export async function 撞上客户(
  我: string, 读的我: 谁 | null, 键类型: 撞号键类型, 键值: string, customerId: string, 结果: Exclude<撞号结果, "同组提示"> = "拦截",
): Promise<撞号露出 | null> {
  return (await 撞上客户记(我, 读的我, 键类型, 键值, customerId, 结果)).露;
}

/** 撞上客户 的本体；带 未建 = 台账这一行同一次写入存待补建记录（没建记台账 用），行 = 台账写下的那一行（没撞上 / 没记上 = null） */
async function 撞上客户记(
  我: string, 读的我: 谁 | null, 键类型: 撞号键类型, 键值: string, customerId: string, 结果: Exclude<撞号结果, "同组提示">, 未建?: 未建线索记录,
): Promise<{ 露: 撞号露出 | null; 行: { id: string; 未建记上: boolean } | null }> {
  const 无 = { 露: null, 行: null };
  if (!企业版()) return 无;
  const c = await 看全部(() => prisma.customer.findUnique({
    where: { id: customerId },
    select: { id: true, name: true, shortName: true, customerNo: true, salesOwnerId: true, channelOwnerId: true, pool: { select: { customerId: true } } },
  }));
  if (!c || c.pool || !c.salesOwnerId || c.salesOwnerId === 我) return 无;
  const 负责人 = await 露出负责人(c.salesOwnerId);
  if (!负责人) return 无;
  const 组 = await 同组(c.id, 我);
  const 行 = await 记撞号({
    userId: 我, keyType: 键类型, keyValue: 键值.slice(0, 200), customerId: c.id, ownerId: c.salesOwnerId,
    sameGroup: !!组, result: 组 ? "同组提示" : 结果,
  }, 未建);
  const 看得见 = 看得到(c, 读的我);
  const 露: 撞号露出 = {
    撞号id: 组 ? null : 行?.id ?? null,
    键类型,
    客户id: 看得见 ? c.id : null,
    // 查重提示里叫 全称或显名（11-19 口径：按公司名撞上、对方没全称时叫出显名，不出空白）
    客户名: 看得见 || 键类型 === "客户名" ? 全称或显名(c) : null,
    负责人,
    ...(组 ? { 同组: 组 } : {}),
    ...(行?.action === "申请挂靠" ? { 已申请: true as const } : {}),
  };
  return { 露, 行: 行 ? { id: 行.id, 未建记上: 行.未建记上 } : null };
}

/** 号码撞了（查号结论「重复」）：认首条（同 撞号结论），露出 + 记台账 */
export async function 号码撞上(我: string, 读的我: 谁 | null, 号: 验好的号, 结果: Exclude<撞号结果, "同组提示"> = "拦截"): Promise<撞号露出 | null> {
  if (!企业版() || !["手机号", "邮箱", "微信", "旺旺ID"].includes(号.类型)) return null;
  const 挑 = await 首条撞的(prisma, await 全公司查号(prisma, 号.类型, 号.值, 号.键));
  return 挑 ? 撞上客户(我, 读的我, 号.类型 as 撞号键类型, 号.值, 挑.id, 结果) : null;
}

/** 我名下.按：按全称撞上还是按公司撞上（11-19 复审：说法按它选「同名 / 同公司」，客户名照用全称或显名） */
export type 名撞结论 = { 我名下: { 客户名: string; 客户id: string; 按: "客户名" | "公司名" } } | { 撞: 撞号露出 };

/** 名键太短（一个字）的不比：撞得太多、多半不是同一位 */
const 够长 = (k: string) => k.length >= 2;

type 名查重行 = { id: string; name: string; shortName: string | null; customerNo: number | null; school: string | null; salesOwnerId: string };

/**
 * 客户名查重要比的客户：全公司在用、不在公海的，按建档先后（同一刻按 id）。原来整批 1.9 万位经 Prisma 取回来在内存里比名键（单人 70 ms，11-14）；
 * 现在先在库里用 名键必含字 筛（名键对上的原名一定含这几个字，见 search-keyword.ts），只取回几位，再在内存里照旧比名键——结果一样，顺序一样。
 * 名键（或公司名键）够长却挑不出这种字（全是字母数字的名字）时照旧整批取
 */
async function 名查重候选(名k: string, 公k: string): Promise<名查重行[]> {
  const 名字 = 够长(名k) ? 名键必含字(名k) : [];
  const 公字 = 够长(公k) ? 名键必含字(公k) : [];
  if ((够长(名k) && !名字.length) || (够长(公k) && !公字.length)) {
    return 看全部(() => prisma.customer.findMany({
      where: { pool: { is: null } },
      select: { id: true, name: true, shortName: true, customerNo: true, school: true, salesOwnerId: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }));
  }
  const 或: string[] = [];
  if (名字.length) 或.push(`(${名字.map(() => `instr(c."name", ?) > 0`).join(" AND ")})`);
  if (公字.length) 或.push(`(${公字.map(() => `instr(c."school", ?) > 0`).join(" AND ")})`);
  // NOT INDEXED：顺表扫一遍（7 ms）；没统计信息的 SQLite 会挑 deletedAt / createdAt 索引逐行回表（26 ms）。命中的几位再排序
  // 裸 SQL 不过软删扩展，自己带 deletedAt IS NULL（同 看全部 + 扩展的口径：没删、不在公海）
  // 简称、客户编号一起取（11-19 客户名称选填）：提示里叫 全称或显名，对方没全称时兜得到；编号裸 SQL 可能回 BigInt，转成数
  const 行 = await prisma.$queryRawUnsafe<(Omit<名查重行, "customerNo"> & { customerNo: number | bigint | null })[]>(
    `SELECT c.id, c."name", c."shortName", c."customerNo", c."school", c."salesOwnerId" FROM "Customer" c NOT INDEXED WHERE (${或.join(" OR ")}) AND c."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "CustomerPool" p WHERE p."customerId" = c.id) ORDER BY c."createdAt" ASC, c.id ASC`,
    ...名字, ...公字,
  );
  return 行.map((r) => ({ ...r, customerNo: r.customerNo == null ? null : Number(r.customerNo) }));
}

/**
 * 新建客户按客户名（和填了的公司）查重：全公司在用的客户都比（看全部；回收站里的软删扩展已经滤掉）。
 * 公海、没负责人的不算；撞了好几位认建档最早的，先认我名下的
 */
export async function 客户名查重(我: string, 读的我: 谁 | null, 名: string, 公司?: string | null): Promise<名撞结论 | null> {
  if (!企业版()) return null;
  const 名k = 名键(名 ?? "");
  const 公k = 名键(公司 ?? "");
  if (!够长(名k) && !够长(公k)) return null;
  const 们 = await 名查重候选(名k, 公k);
  const 撞名 = (c: { name: string }) => 够长(名k) && 名键(c.name) === 名k;
  const 撞公司 = (c: { school: string | null }) => 够长(公k) && !!c.school && 名键(c.school) === 公k;
  const 命中 = 们.filter((c) => 撞名(c) || 撞公司(c));
  if (!命中.length) return null;
  const 我的 = 命中.find((c) => c.salesOwnerId === 我);
  if (我的) return { 我名下: { 客户名: 全称或显名(我的), 客户id: 我的.id, 按: 撞名(我的) ? "客户名" : "公司名" } };
  for (const c of 命中) {
    const 按名 = 撞名(c);
    const 露 = await 撞上客户(我, 读的我, 按名 ? "客户名" : "公司名", 按名 ? 名.trim() : (公司 ?? "").trim(), c.id);
    if (露) return { 撞: 露 };
  }
  return null;
}

/** 名字撞了拦下的那句话（保存被拦、向导面板共用） */
export function 名撞说法(r: 名撞结论, 客户叫法 = "客户"): string {
  // 按名撞上说「同名」，按公司撞上说「同公司」（11-19 复审：原来靠客户名空不空判，有全称的按公司撞上也说成同名）；客户名是全称或显名，不会空
  if ("我名下" in r) {
    const 名 = r.我名下.客户名 ? `「${r.我名下.客户名}」` : "";
    return r.我名下.按 === "公司名" ? `你名下已有同公司的${客户叫法}${名}，请勿重复录入` : `你名下已有同名${客户叫法}${名}，请勿重复录入`;
  }
  const { 撞 } = r;
  const 谁的 = 撞.客户名 ? `${客户叫法}「${撞.客户名}」` : `同事名下的${客户叫法}`;
  const 按 = 撞.键类型 === "公司名" ? "公司名重复" : `${客户叫法}名重复`;
  if (撞.同组) return `${按}：${谁的}你已在项目「${撞.同组.项目}」组里（同组协作），不用重建`;
  const 找 = 撞.负责人.离职找 ? `，负责人已离职，请联系 ${撞.负责人.离职找}` : "";
  return `${按}：${谁的}已由 ${负责人一行(撞.负责人)} 负责，本次录入已拦截${找}；需要一起跟可以申请挂靠`;
}

export type 挂靠结果 = { ok: true; 提示: string } | { ok: false; error: string };

/**
 * 申请挂靠：台账那一行记上动作。这家客户还没有我在等的 / 已批准的申请（拒绝过的 7 天内也算）= 一条新申请：
 * 改成待处理、定审批人（客户现在的负责人；离职了也是他、不另找兜底，24 小时后转他的实线上级），在职就通知他去「挂靠申请」页处理（P-挂靠-02，attach-approval.ts）。
 * 已有的只记动作、状态留无需处置，不再通知
 */
export async function 申请挂靠(我: { id: string; name: string }, 撞号id: string): Promise<挂靠结果> {
  if (!企业版()) return { ok: false, error: "企业版才有申请挂靠" };
  const 行 = await prisma.entDupeHit.findUnique({ where: { id: 撞号id } });
  if (!行 || 行.userId !== 我.id) return { ok: false, error: "找不到这条撞号记录" };
  if (行.sameGroup) return { ok: false, error: "你已在这位客户的项目组里，不用申请挂靠" };
  const 已有话 = (status: string) =>
    status === "已批准" ? "这位客户的挂靠已批准，到「挂靠申请」里打开只读卡"
      : status === "已拒绝" ? "这位客户的挂靠申请刚没批准，过几天再申请"
        : status === 挂靠进公海状态 ? "这位客户已进公海，挂靠申请已关闭，可去公海领取"
        : "已经申请过了，等负责人处理";
  if (行.action === "申请挂靠") return { ok: true, 提示: 已有话(行.status) };
  const 起 = new Date(Date.now() - 撞号预警.天数 * 86_400_000);
  const 早 = await prisma.entDupeHit.findFirst({
    where: {
      userId: 我.id, customerId: 行.customerId, action: "申请挂靠", id: { not: 行.id },
      OR: [{ status: { in: ["待处理", "已批准"] } }, { status: "已拒绝", decidedAt: { gte: 起 } }],
    },
    orderBy: { actionAt: "desc" },
    select: { status: true },
  });
  if (早) {
    await prisma.entDupeHit.update({ where: { id: 行.id }, data: { action: "申请挂靠", actionAt: new Date() } });
    return { ok: true, 提示: 已有话(早.status) };
  }

  // 审批人 = 客户现在的负责人（P-挂靠-02；之后客户换负责人，审批人跟着换，见 owner-log-db.ts）。离职了也还是他、不另找人，24 小时后转他的实线上级
  const 客户 = await 看全部(() => prisma.customer.findUnique({ where: { id: 行.customerId }, select: { id: true, name: true, shortName: true, customerNo: true, salesOwnerId: true } }));
  const 收 = 客户?.salesOwnerId ?? null;
  // 条件写：只有这行还没申请过才写；连点两下后到的写不进（count 0），按已申请回话、不再发第二次审批通知
  const 写 = await prisma.entDupeHit.updateMany({ where: { id: 行.id, OR: [{ action: null }, { action: { not: "申请挂靠" } }] }, data: { action: "申请挂靠", actionAt: new Date(), status: "待处理", approverId: 收 } });
  if (写.count === 0) {
    const 现 = await prisma.entDupeHit.findUnique({ where: { id: 行.id }, select: { status: true } });
    return { ok: true, 提示: 已有话(现?.status ?? "待处理") };
  }
  const org = await 读组织();
  const n = 收 && org.成员.has(收) ? await notify([收], {
    kind: "挂靠",
    title: `${我.name} 申请挂靠你负责的客户「${客户 ? 通知里的客户名(客户) : ""}」`,
    body: `新建客户时按${撞的写法(行.keyType, 行.keyValue)} 撞上，申请一起跟这位客户。到「挂靠申请」里批准或拒绝；批准后客户负责人不变，对方只拿到这家客户的只读卡。`
      + `${挂靠超时小时} 小时没处理会转给你的直属上级`,
    link: 挂靠页,
    key: `挂靠:${行.id}`,
  }) : 0;
  return { ok: true, 提示: n ? "已申请挂靠，等负责人处理" : `已记下申请挂靠；负责人现在收不到通知，${挂靠超时小时} 小时没人处理会转给他的直属上级` };
}
