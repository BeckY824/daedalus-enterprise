"use server";

import { hasVisibleText } from "@/lib/form-validation";

import { 版本冲突, 版本条件 } from "@/lib/edit-version";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { 认回打码号, 查电话, 号码带着字 } from "@/lib/phone";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 唯一负责人 } from "@/lib/owners";
import { getBusiness } from "@/lib/business";
import { 不在了 } from "@/lib/not-there";
import { 企业版 } from "@/lib/enterprise/switch";
import { 选的原因 } from "@/lib/enterprise/dict";
import { 读组织 } from "@/lib/enterprise/org";
import { 拼全称, 全称上限, 能录投入, 不能录投入, 能管渠道, 不能管渠道 } from "@/lib/enterprise/channel-stats";
import { 看全部 } from "@/lib/team-scope";
import { parseDateInput } from "@/lib/date-input";
import { 规整币种, 是币种 } from "@/lib/currency";

/**
 * 成功时回传渠道 id（新建是新 id，编辑是原 id）。
 * 「新建学员」里就地建渠道后要立刻把它选中，没有 id 就选不上。
 */
/**
 * 企业版里谁能新建、编辑、停用、删除渠道（10-30 B1）：只有老板、总管理员、市场管理（channel-stats.ts 的 能管渠道）。
 * 界面上别人看不到按钮，这里再挡直调；排在校验前面，没权限的人先听到这一句。团队版照旧不挡
 */
async function 挡管(me: { id: string; role: string }): Promise<string | null> {
  if (!企业版()) return null;
  return 能管渠道(await 读组织(), me) ? null : 不能管渠道;
}

export async function saveChannel(input: {
  id?: string;
  name: string;
  phone: string | null;
  remark: string | null;
  /** 一个人的工作区里界面上不问这一项，留空由服务端填成那唯一的人 */
  channelOwnerId?: string | null;
  /** 打开编辑框那一刻的 updatedAt。给了就当闸门：期间有人改过不盖掉（排查 D3） */
  版本?: string | null;
  /**
   * 企业版渠道表单（2026-10-29）交这几样：渠道属性、渠道名称、来源必填，name（渠道全称）一律拼成「渠道名称|来源」，
   * 交来的 name 不看（P16：全称不让手填，界面上只给预览）。
   * 不交 attr（客户表单里就地建渠道、首页 AI 建渠道、老测试）照原来只要 name，这几列不动
   */
  attr?: string | null;
  platform?: string | null;
  source?: string | null;
  /** YYYY-MM-DD，空 = 没有结束日期 */
  endDate?: string | null;
  active?: boolean;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  const 挡 = await 挡管(me);
  if (挡) return { ok: false, error: 挡 };
  const 企业表单 = input.attr !== undefined;
  let 企业列: { attr: string | null; platform: string; endDate: Date | null } | null = null;
  if (企业表单) {
    const 原 = input.id ? await prisma.channel.findUnique({ where: { id: input.id }, select: { attr: true } }) : null;
    const 属性 = (input.attr ?? "").trim();
    if (!属性) return { ok: false, error: "请选择渠道属性" };
    // 编辑老渠道时属性没动：那一项后来停用了也照旧收
    let attr: string | null = 属性;
    if (属性 !== 原?.attr) {
      const 查 = await 选的原因("channelAttr", 属性);
      if (!查.ok) return 查;
      attr = 查.值 ?? (企业版() ? null : 属性);
    }
    const platform = (input.platform ?? "").trim();
    if (!platform) return { ok: false, error: "请填写渠道名称" };
    const 来源 = (input.source ?? "").trim();
    if (!来源) return { ok: false, error: "请填写来源" };
    const 结束 = input.endDate ? parseDateInput(input.endDate) : null;
    if (input.endDate && !结束) return { ok: false, error: "结束日期不对，请重新选" };
    input = { ...input, name: 拼全称(platform, 来源) };
    if (input.name.length > 全称上限) return { ok: false, error: `渠道名称加来源拼成的全称最多 ${全称上限} 个字，请缩短` };
    企业列 = { attr, platform, endDate: 结束 };
  }
  // 名字只有空格不收（第二轮 r2-data：原来存出一条没有名字的）
  if (!hasVisibleText(input.name)) return { ok: false, error: "请填写渠道名称" };
  const b = await getBusiness();
  const name = input.name.trim();
  const channelOwnerId = input.channelOwnerId || (await 唯一负责人());
  if (!channelOwnerId) return { ok: false, error: "请选择渠道负责人" };

  const dup = await prisma.channel.findFirst({
    where: { name, ...(input.id ? { id: { not: input.id } } : {}) },
    select: { id: true },
  });
  if (dup) return { ok: false, error: `渠道「${name}」已存在` };

  // 共享试用区的渠道页给的是打码号码：交回来的正是原号打码的样子就认回原号，别的带 * 的不收（2026-10-02 排查 A6）
  const 原号 = input.id ? (await prisma.channel.findUnique({ where: { id: input.id }, select: { phone: true } }))?.phone : null;
  const 号 = 认回打码号(input.phone?.trim() || null, 原号);
  if (号 && 号.includes("*")) return { ok: false as const, error: "电话里不能有 *" };
  // 未改的历史号码与准确打码返回保持原文；只规范新填写/更改的号码。
  const 电话 = 号 === 原号 ? { ok: true as const, phone: 号 ?? "" } : 查电话(号, { 必填: false });
  if (!电话.ok) return { ok: false as const, error: 电话.error };
  const 原文 = 号 && 号 !== 原号 && 号码带着字(号) ? `原始电话：${号}` : "";
  const 备注 = input.remark?.trim() || "";
  const remark = 原文 && !备注.includes(原文) ? [备注, 原文].filter(Boolean).join("\n") : 备注;
  const data = {
    name,
    phone: 电话.phone || null,
    remark: remark || null,
    channelOwnerId,
    ...(企业列 ?? {}),
    ...(typeof input.active === "boolean" ? { active: input.active } : {}),
  };

  let 新建id: string | undefined;

  if (input.id) {
    const 改前 = await prisma.channel.findUnique({ where: { id: input.id }, select: { channelOwnerId: true } });
    if (!改前) return { ok: false, error: "这个渠道已经不在了（可能已删除）" };
    const 写了 = await prisma.channel.updateMany({ where: { id: input.id, ...版本条件(input.版本) }, data });
    if (写了.count === 0) return { ok: false, error: 版本冲突 };
    /**
     * 改渠道负责人**不再**连带改写已有学员。
     *
     * 原来这里有一条 updateMany 把该渠道名下所有学员的 channelOwnerId 一起换掉——
     * 张沁做了一年的渠道换李蔚然接手，改一下负责人，张沁过去一年的业绩就全划走了，
     * 而且是静默的。这和 attribution.ts 的「归属固化」（改上游不追溯改写下游）
     * 是同一条原则：没动那个学员的数据，他的归属就不该变。
     * 新负责人只对**之后新增**的学员生效；个别登记错的学员，到他档案里单独改。
     */
    const 换人 = Boolean(改前 && 改前.channelOwnerId !== channelOwnerId);
    // 审计里记的是渠道下的全部客户，不按「按组织看客户」只数自己看得见的
    const 已有 = 换人 ? await 看全部(() => prisma.customer.count({ where: { channelId: input.id } })) : 0;
    await recordAudit({
      user: me, action: "update", entity: "Channel", entityId: input.id,
      summary: `修改渠道「${name}」` +
        (换人 ? `，渠道负责人变更，仅影响之后新增的${b.customer}；已有 ${已有} 名保持原归属` : ""),
      detail: { name, 原负责人: 改前?.channelOwnerId, 新负责人: channelOwnerId, 已有学员不受影响: 已有 },
    });
  } else {
    const c = await prisma.channel.create({ data: { ...data, createdById: me.id } });
    新建id = c.id;
    await recordAudit({
      user: me, action: "create", entity: "Channel", entityId: c.id,
      summary: `新建渠道「${name}」`,
    });
  }

  revalidatePath("/channels");
  revalidatePath("/customers");
  return { ok: true, id: 新建id ?? input.id! };
}

export async function toggleChannel(id: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const 挡 = await 挡管(me);
  if (挡) return { ok: false, error: 挡 };
  /*
    另一个窗口已经删了这个渠道：原来 update 直接抛 P2025，界面上点了没反应（2026-10-04 第 2 期 2a，r2-data 那条【下一版】）。
    说一句「已经不在了」
  */
  let c: { name: string };
  try {
    c = await prisma.channel.update({ where: { id }, data: { active } });
  } catch (e) {
    return 不在了(e);
  }
  await recordAudit({
    user: me, action: "update", entity: "Channel", entityId: id,
    summary: `${active ? "启用" : "停用"}渠道「${c.name}」`,
  });
  revalidatePath("/channels");
  return { ok: true };
}

export async function deleteChannel(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const 挡 = await 挡管(me);
  if (挡) return { ok: false, error: 挡 };
  const b = await getBusiness();
  // 已带来学员的渠道不能删，否则推荐链会断、归属数据变成孤儿。
  // attributionChannelId 也要算进来：归属落在该渠道上的学员同样会被置空。
  // 要数全部客户：开了「按组织看客户」只数自己看得见的，别人名下有客户也会被当成空渠道删掉
  const used = await 看全部(() => prisma.customer.count({
    where: { OR: [{ channelId: id }, { attributionChannelId: id }] },
  }));
  if (used > 0) {
    return { ok: false, error: `该渠道名下已有 ${used} 名${b.customer}，不能删除。如需停用请点「停用」` };
  }
  // 录过投入的也不删：投入跟着渠道级联删掉，钱的记录就没了
  const 投入 = await prisma.entChannelInvest.count({ where: { channelId: id } });
  if (投入 > 0) return { ok: false, error: `该渠道已录了 ${投入} 笔投入，不能删除。如需停用请点「停用」` };
  const 待删 = await prisma.channel.findUnique({ where: { id }, select: { name: true } });
  // 另一个窗口已经删了：说一句，不抛（2026-10-04 第 2 期 2a）。查完到删之间又被删的那一下也接住
  if (!待删) return { ok: false, error: "这个渠道已经不在了（可能在别处删了），刷新看看" };
  try {
    await prisma.channel.delete({ where: { id } });
  } catch (e) {
    return 不在了(e);
  }
  await recordAudit({
    user: me, action: "delete", entity: "Channel", entityId: id,
    summary: `删除渠道「${待删.name}」`,
  });
  revalidatePath("/channels");
  return { ok: true };
}

/* ───────────── 企业版渠道投入（2026-10-29） ───────────── */

export type 投入行 = { id: string; amount: number; currency: string; date: string; remark: string | null; userName: string | null; createdAt: string };

/**
 * 能不能给这个渠道录 / 删投入：只有老板、总管理员、市场管理（10-29 P16，channel-stats.ts 的 能录投入）。
 * 渠道负责人也不行了；按钮藏了，这里再挡直调。不是企业版（没有业务角色）只认老板
 */
async function 挡投入(me: { id: string; role: string }, channelId: string): Promise<{ 名: string } | { error: string; 不在?: true }> {
  const c = await prisma.channel.findUnique({ where: { id: channelId }, select: { name: true } });
  if (!c) return { error: "这个渠道已经不在了（可能在别处删了），刷新看看", 不在: true };
  const 能 = me.role === "ADMIN" || (企业版() && 能录投入(await 读组织(), me));
  return 能 ? { 名: c.name } : { error: 不能录投入 };
}

/** 渠道详情抽屉里的投入记录，新的在前。谁都能看（列表上的投入合计本来就人人看得到）；能不能录一并带回去，不能录的带那句为什么 */
export async function listChannelInvests(channelId: string): Promise<{ ok: true; rows: 投入行[]; 能录: boolean; 不能录因?: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (typeof channelId !== "string" || !channelId) return { ok: false, error: "缺渠道" };
  const 查 = await 挡投入(me, channelId);
  if ("error" in 查 && 查.不在) return { ok: false, error: 查.error };
  const 行 = await prisma.entChannelInvest.findMany({ where: { channelId }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  const 人 = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(行.map((r) => r.userId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return {
    ok: true,
    能录: !("error" in 查),
    ...("error" in 查 ? { 不能录因: 查.error } : {}),
    rows: 行.map((r) => ({ id: r.id, amount: r.amount, currency: r.currency, date: r.date.toISOString(), remark: r.remark, userName: 人.get(r.userId) ?? null, createdAt: r.createdAt.toISOString() })),
  };
}

// "use server" 文件只许导出 async 函数，上限不导出；表单那边写同一个数
const 投入备注上限 = 200;

export async function addChannelInvest(input: { channelId: string; amount: number; currency?: string | null; date: string; remark?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const me = await requireUser();
  if (!input || typeof input.channelId !== "string" || !input.channelId) return { ok: false, error: "缺渠道" };
  const 查 = await 挡投入(me, input.channelId);
  if ("error" in 查) return { ok: false, error: 查.error };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "投入金额要大于 0" };
  if (amount >= 1e12) return { ok: false, error: "投入金额太大了，检查一下位数" };
  const date = parseDateInput(input.date);
  if (!date) return { ok: false, error: "请选投入日期" };
  if (input.currency && !是币种(input.currency)) return { ok: false, error: "币种不对" };
  const currency = 规整币种(input.currency, (await getBusiness()).currency);
  const remark = typeof input.remark === "string" ? input.remark.trim() : "";
  if (remark.length > 投入备注上限) return { ok: false, error: `备注最多 ${投入备注上限} 个字` };
  const r = await prisma.entChannelInvest.create({
    data: { channelId: input.channelId, amount: Math.round(amount * 100) / 100, currency, date, remark: remark || null, userId: me.id },
  });
  await recordAudit({
    user: me, action: "update", entity: "Channel", entityId: input.channelId,
    summary: `给渠道「${查.名}」录入投入 ${currency} ${r.amount}`,
    detail: { 投入id: r.id, 金额: r.amount, 币种: currency, 日期: input.date, 备注: remark || null },
  });
  revalidatePath("/channels");
  return { ok: true, id: r.id };
}

export async function deleteChannelInvest(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  if (typeof id !== "string" || !id) return { ok: false, error: "缺投入记录" };
  const r = await prisma.entChannelInvest.findUnique({ where: { id } });
  if (!r) return { ok: false, error: "这笔投入已经不在了（可能在别处删了），刷新看看" };
  const 查 = await 挡投入(me, r.channelId);
  if ("error" in 查) return { ok: false, error: 查.error };
  try {
    await prisma.entChannelInvest.delete({ where: { id } });
  } catch (e) {
    return 不在了(e);
  }
  await recordAudit({
    user: me, action: "update", entity: "Channel", entityId: r.channelId,
    summary: `删除渠道「${查.名}」的一笔投入 ${r.currency} ${r.amount}`,
    detail: { 投入id: id, 金额: r.amount, 币种: r.currency, 日期: r.date.toISOString(), 备注: r.remark },
  });
  revalidatePath("/channels");
  return { ok: true };
}
