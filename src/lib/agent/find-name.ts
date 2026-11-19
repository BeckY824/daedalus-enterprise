/**
 * 一个名字在库里到底在哪张表。
 *
 * **「找一个人」原来只有 `search_customers` 一条路。** 客户表搜空之后模型手上一条线索都没有，
 * 只能反过来问人：「你给个更完整的姓名或公司名，我再查一次」——而那个人可能就好好地
 * 躺在渠道表里。2026-09-19 报上来的：首页问「明杰哥的电话是多少」，明杰哥是一个渠道，
 * 客户库里当然没有，于是连问两次都是「没找到」。
 *
 * 页面上下文（lib/ai-context-page.ts）只在渠道页上盖住了这个洞——首页没有页面上下文，
 * 而首页正是这个 agent 的主场。所以修在工具层：**搜空这件事本身要带上答案。**
 *
 * 不是给模型一句「你去别处看看」的提示，而是直接把别处那几条记录连电话一起给它：
 * 一次工具调用就够，不用第二次往返，也不依赖模型愿不愿意跟进那句提示。
 *
 * 只查有人名、且人会问「他电话多少」的四张表。商机、合同不查——那不是人。
 */
import { prisma } from "../prisma";
import { 负责人显示名, 无负责人占位邮箱 } from "@/lib/pool";
import { 包含模式, 号码片段, 号码藏着, 客户关键词条件, 客户号码条件, 线索关键词条件 } from "@/lib/search-keyword";
import { 号键SQL } from "@/lib/phone-dedupe";
import { 渠道启用 } from "@/lib/enterprise/channel-main-core";
import { 客户显名, 显名列 } from "@/lib/enterprise/customer-title";

/** 一张表里的命中 */
export type 别处命中 = {
  表: string;
  条数: number;
  /** 前几条，带电话（已过脱敏器）。给模型直接作答用 */
  记录: Record<string, unknown>[];
  /** 要更多 / 要详情时该用哪个工具 */
  怎么查: string;
};

const 每表最多 = 5;

/**
 * 问的是不是一段号码（批次 20a）：只有数字、空格、横杠、括号、+，去掉明写的 +86 / 0086 后至少 4 位数字。
 * 是就给那串数字（拿去按号键包含比），不是给 null。3 位太短，谁的号里都有
 */
export function 像号码(q: string): string | null {
  const p = 号码片段(q.trim());
  return p && p.length >= 4 ? p : null;
}

/**
 * 按号码找时，各张表里号键（去空格、横杠、括号、+，全角转半角）包含这串数字的行 id（批次 20a）。
 * 裸 SQL 只取 id，行照旧经 prisma 限定层取，可见范围不放宽；每张最多先取 200 个候选。
 * 联系人连号码子表（ContactMethod 的手机号 / WhatsApp）一起比：老 Contact.phone 只存一个号，多出来的号只在子表里
 */
async function 号码命中的id(片段: string): Promise<{ 联系人: string[]; 散的: string[]; 渠道: string[] }> {
  const p = 包含模式(片段);
  const 取 = async (sql: string, ...v: string[]) => (await prisma.$queryRawUnsafe<{ id: string }[]>(sql, ...v)).map((r) => r.id);
  const [联系人, 散的, 渠道] = await Promise.all([
    取(
      `SELECT t.id FROM "Contact" t WHERE t."deletedAt" IS NULL AND (${号键SQL('t."phone"')} GLOB ? OR t.id IN (SELECT m."contactId" FROM "ContactMethod" m WHERE m."contactId" IS NOT NULL AND m.kind IN ('phone', 'whatsapp') AND ${号键SQL("m.value")} GLOB ?)) LIMIT 200`,
      p,
      p,
    ),
    取(`SELECT id FROM "UnassignedContact" WHERE ${号键SQL('"phone"')} GLOB ? LIMIT 200`, p),
    取(`SELECT id FROM "Channel" WHERE ${号键SQL('"phone"')} GLOB ? LIMIT 200`, p),
  ]);
  return { 联系人, 散的, 渠道 };
}

export type 怎么找 = {
  /** 按号码找（给的是去掉分隔符和国家码后的那串数字）；不给 = 按名字 */
  号码?: string;
  /** 名字只按开头比（模糊找时只剩一个字的姓：「王总」→「王」） */
  开头?: boolean;
  /** 问的人（号码藏不藏按他算；不走 cookie 的入口必须传） */
  我?: string;
};

/**
 * @param 名 用户问的那个词。空串直接返回空
 * @param 号 号码脱敏器（共享工作区打码）。**必须传**，否则会绕开那道闸
 * @param 法 按号码还是按名字、名字是包含还是开头（批次 20a）。不给 = 按名字包含，同原来
 */
export async function 名字在别处(名: string, 号: (p: string | null) => string | null, 法: 怎么找 = {}): Promise<别处命中[]> {
  const q = 名.trim();
  if (!q) return [];
  const 名条件 = 法.开头 ? { startsWith: q } : { contains: q };
  // 按号码找：电话字段对这个人藏着（字段权限）时一条都不比，免得从号码试出是谁（同 Y27）
  const 片段 = 法.号码 ?? null;
  if (片段 && (await 号码藏着(法.我))) return [];
  const 号中 = 片段 ? await 号码命中的id(片段) : null;
  const 线索条件 = 片段 ? await 线索关键词条件(片段, 法.我) : { OR: [{ name: 名条件 }, { contact: 名条件 }] };

  const [渠道, 联系人, 散的, 线索, 成员] = await Promise.all([
    prisma.channel.findMany({
      where: 号中 ? { id: { in: 号中.渠道 } } : { name: 名条件 },
      take: 每表最多,
      select: { name: true, phone: true, active: true, remark: true, main: { select: { active: true } }, channelOwner: { select: { name: true } } },
    }),
    prisma.contact.findMany({
      where: 号中 ? { id: { in: 号中.联系人 } } : { name: 名条件 },
      take: 每表最多,
      select: { name: true, phone: true, position: true, wechat: true, customerId: true, customer: { select: 显名列 } },
    }),
    // 从客户上移出、人留着的那些（未归属）。不查的话 AI 会说「库里没有这个人」，其实人在联系人页里
    prisma.unassignedContact.findMany({
      where: 号中 ? { id: { in: 号中.散的 } } : { name: 名条件 },
      take: 每表最多,
      select: { name: true, phone: true, position: true, wechat: true, fromCustomerName: true },
    }),
    prisma.lead.findMany({
      // 线索有两个人名字段：线索本身的名称（多半是公司）和它的联系人；按号码时比电话（号键）
      where: 线索条件,
      take: 每表最多,
      select: { name: true, contact: true, phone: true, status: true },
    }),
    // 同事只按名字找：成员不给电话，按号码找到同事等于把私人号码对上了人
    片段
      ? Promise.resolve([] as { name: string; title: string | null; role: string; active: boolean }[])
      : prisma.user.findMany({
          where: { name: 名条件, email: { not: 无负责人占位邮箱 } },
          take: 每表最多,
          select: { name: true, title: true, role: true, active: true },
        }),
  ]);

  const out: 别处命中[] = [];
  if (渠道.length)
    out.push({
      表: "渠道",
      条数: 渠道.length,
      记录: 渠道.map((c) => ({ 名称: c.name, 电话: 号(c.phone), 渠道负责人: c.channelOwner?.name ?? "未指定", 状态: 渠道启用(c) ? "在用" : "已停用", 备注: c.remark ?? null })),
      怎么查: `list_channels（keyword="${q}"）`,
    });
  if (联系人.length || 散的.length)
    out.push({
      表: "联系人",
      条数: 联系人.length + 散的.length,
      记录: [
        // 带上所属客户的 id：人问的多半是「这个人是哪家的、谁在跟」，拿它直接 get_customer（批次 20a 跨联系人查）
        ...联系人.map((c) => ({ 姓名: c.name, 电话: 号(c.phone), 职位: c.position ?? null, 微信: c.wechat ?? null, 属于: c.customer ? 客户显名(c.customer) : null, 客户id: c.customerId })),
        ...散的.map((c) => ({
          姓名: c.name, 电话: 号(c.phone), 职位: c.position ?? null, 微信: c.wechat ?? null,
          属于: c.fromCustomerName ? `未归属（原来在${c.fromCustomerName}下面）` : "未归属",
        })),
      ],
      怎么查: `属于哪位客户、谁在跟：用 客户id 调 get_customer；更多联系人用 query_records（表=联系人）`,
    });
  if (线索.length)
    out.push({
      表: "线索",
      条数: 线索.length,
      记录: 线索.map((l) => ({ 线索: l.name, 联系人: l.contact ?? null, 电话: 号(l.phone), 状态: l.status })),
      怎么查: `list_leads（keyword="${q}"）`,
    });
  if (成员.length)
    out.push({
      表: "团队成员",
      条数: 成员.length,
      // 成员不给电话：那是同事的私人号码，不是客户资料
      记录: 成员.map((u) => ({ 姓名: u.name, 职务: u.title ?? null, 角色: u.role, 状态: u.active ? "在职" : "已停用" })),
      怎么查: `list_users（keyword="${q}"）`,
    });
  return out;
}

/**
 * 按名字把**这个库里所有长着人名的表**找一遍：客户、渠道、联系人、线索、团队成员。
 *
 * 这是 `find_person` 工具的身子。为什么非要有这么一个工具：
 * `search_customers` 是「找**客户**」，不是「找人」。而人问「明杰哥的电话是多少」时，
 * 他不知道也不关心明杰哥在这套系统里被登记成了客户、渠道还是联系人——
 * 那是我们的表结构，不是他的问题。
 *
 * 没有这个工具的时候，模型每次都在十一个工具里挑一个最像的：这一次挑了
 * `search_customers`，下一次挑了 `list_users`（还把「李老师」截成「李」去搜团队成员）。
 * 挑错不报错，只是答「没找到」，而那个人好好地躺在另一张表里。
 */
/** 叫：存储值 → 这家的叫法（外贸「已签约」显示成「已下单」，2026-10-06 G.3 实测模型照抄了原值） */
/** 我：问的人。给了就每位客户标归属（我负责的 / 同事或下属负责的 / 公海，P-看-03） */
export async function 找人(名: string, 号: (p: string | null) => string | null, 叫: (v: string) => string = (v) => v, 我?: string): Promise<别处命中[]> {
  return (await 找人详(名, 号, 叫, 我)).命中;
}

export type 找人结果 = {
  命中: 别处命中[];
  /** 按号码找的（去掉分隔符和国家码之后那串数字） */
  号码?: string;
  /** 原样没找到、按这个变体模糊找到的（「王总」→「王」，「某某有限公司」→「某某」） */
  模糊?: { 用的词: string; 开头: boolean };
  /** 问的是号码，但这个人的电话字段是藏着的：没按号码比 */
  号码藏着?: true;
};

/**
 * 一个名字的几种「退一步」的写法（批次 20a：find_person 120 次里 77 次零结果）。原样找不到才按顺序试，命中一种就停：
 *   - 去掉空格和间隔号（「张 三」「Li·Na」）
 *   - 去掉公司后缀（有限公司、集团、Co., Ltd. …）
 *   - 去掉称呼（王总、李老师、陈经理、小李、老王）：剩一个字的姓时只按开头比，免得名字里带这个字的全出来
 * 只是缩小写法，不改字、不猜同音字
 */
export function 名字变体(q: string): { 词: string; 开头: boolean }[] {
  const 出: { 词: string; 开头: boolean }[] = [];
  const 加 = (词: string, 开头 = false) => {
    const w = 词.trim();
    if (w && w !== q && !出.some((x) => x.词 === w)) 出.push({ 词: w, 开头 });
  };
  const 紧 = q.replace(/[\s　·・•]+/g, "");
  加(紧);
  const 去后缀 = 紧
    .replace(/(集团)?(股份)?有限(责任)?公司$|集团$|公司$|工作室$|商行$|厂$/, "")
    .replace(/[,.，]?(co\.?,?ltd\.?|ltd\.?|limited|inc\.?|llc|corp\.?|corporation|company|gmbh)$/i, "");
  if ([...去后缀].length >= 2) 加(去后缀);
  const 去称呼 = 紧
    .replace(/^(小|老|阿)(?=[\u4e00-\u9fff]{1,2}$)/, "")
    .replace(/(总经理|总监|老总|老板|老师|经理|先生|女士|小姐|主任|董事长|姐姐|哥哥|师傅|博士|医生|律师|同学|总|董|哥|姐|姨|叔|工)$/, "");
  if (去称呼 && 去称呼 !== 紧) 加(去称呼, [...去称呼].length === 1);
  return 出;
}

/** 客户这一张：名字 / 公司 / 简称 / 编号，像号码的连电话、联系人号码一起按号键比（同客户列表搜索框，电话藏着的不比号码） */
async function 找客户(词: string, 法: 怎么找) {
  const where = 法.号码
    ? await 客户号码条件(法.号码, 法.我)
    : 法.开头
      ? { name: { startsWith: 词 } }
      : await 客户关键词条件(词, true, 法.我);
  if (!where) return [];
  return prisma.customer.findMany({
    where,
    take: 每表最多,
    orderBy: { lastFollowAt: "desc" },
    select: { ...显名列, phone: true, school: true, grade: true, followStatus: true, salesOwnerId: true, pool: { select: { customerId: true } }, salesOwner: { select: { name: true } } },
  });
}

async function 一轮(词: string, 号: (p: string | null) => string | null, 叫: (v: string) => string, 法: 怎么找): Promise<别处命中[]> {
  const [客户, 其余] = await Promise.all([找客户(词, 法), 名字在别处(词, 号, 法)]);
  const 我 = 法.我;
  const out: 别处命中[] = [];
  if (客户.length)
    out.push({
      表: "客户",
      条数: 客户.length,
      记录: 客户.map((c) => ({ id: c.id, 姓名: 客户显名(c), 电话: 号(c.phone), 学校或公司: c.school, 年级或职位: c.grade, 跟进状态: 叫(c.followStatus),
        // 公海里的只写「公海」，不露原负责人（公海页签同样不列）
        负责人: c.pool ? "公海" : 负责人显示名(c.salesOwner.name),
        ...(我 ? { 归属: c.pool ? "公海" : c.salesOwnerId === 我 ? "我负责的" : "同事或下属负责的" } : {}) })),
      怎么查: `get_customer（id=…）读这一位的完整档案和跟进时间线`,
    });
  return [...out, ...其余];
}

/**
 * find_person 的身子（批次 20a 起）：
 *   - 给的是号码（「138 1234 5678」「+86-138…」「5678」）：客户电话、联系人电话、联系人号码子表、未归属联系人、线索、渠道一起按号键包含比，
 *     可以只给一段；电话字段藏着的人不按号码比（标 号码藏着）
 *   - 给的是名字：原样包含比；一条都没有再按 名字变体 退一步（标 模糊）
 * 都走限定层，看不到的照样看不到
 */
export async function 找人详(名: string, 号: (p: string | null) => string | null, 叫: (v: string) => string = (v) => v, 我?: string): Promise<找人结果> {
  const q = 名.trim();
  if (!q) return { 命中: [] };
  const 号码 = 像号码(q);
  if (号码) {
    if (await 号码藏着(我)) return { 命中: [], 号码, 号码藏着: true };
    return { 命中: await 一轮(q, 号, 叫, { 号码, 我 }), 号码 };
  }
  const 原样 = await 一轮(q, 号, 叫, { 我 });
  if (原样.length) return { 命中: 原样 };
  for (const v of 名字变体(q)) {
    const 命中 = await 一轮(v.词, 号, 叫, { 我, 开头: v.开头 });
    if (命中.length) return { 命中, 模糊: { 用的词: v.词, 开头: v.开头 } };
  }
  return { 命中: [] };
}

/**
 * find_person 一条都没找到时给人看的那段话（批次 20a）。查重类提问原来只落到一句「无法据此区分」，人不知道查过什么、下一步怎么办。
 * 口径不变：只说「当前可访问范围内」，不说库里没有；但写明比过哪些、要确认全公司有没有人在跟该怎么做。
 * run.ts 搜空时换掉模型那段话用的也是它（模型的话可能带无依据的断言，不流出去）
 */
export function 没找到话(找的: string, 按号码: boolean): string {
  const 查过 = 按号码
    ? "按号码比了客户电话、联系人电话和联系人的其他号码、线索、渠道（已去掉空格、横杠、+86，只给一段也比）"
    : "按名字比了客户（名称、公司、简称）、联系人、渠道、线索、同事，也试了去掉称呼和公司后缀的写法";
  return (
    `当前可访问范围内未找到${找的}（${查过}）。记录可能不存在，也可能不在你的可见范围内，无法据此区分。` +
    `要确认全公司有没有人在跟：用这个${按号码 ? "号码" : "名字"}新建线索时系统会做全公司查重，撞了会提示原负责人。` +
    (按号码 ? "" : "也可以给号码或公司全称再找一次。")
  );
}

/** 给过程条看的一句话（工具 summary 只进界面，不进模型）。没命中返回空串 */
export function 别处说法(名: string, 命中: 别处命中[]): string {
  if (!命中.length) return "";
  const 段 = 命中.map((h) => `**${h.表}**里有 ${h.条数} 条（${h.记录.map((r) => String(Object.values(r)[0])).join("、")}）`).join("；");
  return `——但「${名}」${段}。要的多半就是这个，直接据此回答，不用再问用户。`;
}

/**
 * 塞进工具 `data` 的那一段。**模型只看得见 data**（run.ts 里 tool 消息的内容就是
 * `JSON.stringify(result.data)`，summary 只进过程条），所以「接下来该怎么办」这句话
 * 必须写在这儿——写在 summary 里等于没写。
 */
export function 别处附件(名: string, 命中: 别处命中[]): Record<string, unknown> | null {
  if (!命中.length) return null;
  return {
    这个名字在别的表里: 命中,
    该怎么办: `「${名}」不在客户表里，但上面这几条就是它。直接照这些记录回答（电话、状态、备注都在里面）；` + `不要说「没找到」，也不要反过来让用户给更完整的姓名或公司名。`,
  };
}
