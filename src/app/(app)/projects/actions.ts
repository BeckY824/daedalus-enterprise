"use server";

/**
 * 团队版项目模式 1a 的写（2026-10-23，D-31）。开关关着时每个动作都直接拦，一行不写。
 * 规矩在 lib/project/nodes.ts、读写在 lib/project/db.ts、建档向导在 lib/project/wizard.ts，这里只管登录、开关、操作日志和刷新。
 */
import { revalidatePath } from "next/cache";
import { prisma, defaultClient } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { getBusiness } from "@/lib/business";
import { 读的我 } from "@/lib/team-scope";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 验联系人号码, 企业号码查重, 全公司查号, 撞号结论, 记号码, 联系人号码撞了 } from "@/lib/enterprise/contact-dedupe";
import { 登记接着建 } from "@/lib/project/hook";
import { 规整向导, 向导接着建, 项目来源默认, type 建好的, type 向导联系人, type 向导项目, type 向导跟进 } from "@/lib/project/wizard";
import { 改节点, 勾交付, 加角色, 改角色, 加异常类别, 改异常类别, 删项目, 交付项们, 改项目, 加组员, 回邀请, 换组员角色, 移出组员, 放回公海, 领取公海项目, 超上限, 记项目沟通, 超时预览, 公海超时收回, type 交付项 } from "@/lib/project/db";
import { 合上改动, 是不限, type 规则改动 } from "@/lib/project/org-rules";
import { 读组织规则, 生效组织规则, 存组织规则 } from "@/lib/project/org-rules-store";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 挡改设置, 读改权限, 能改时限的节点, 挡时限改动, type 设置项名 } from "@/lib/enterprise/edit-perm";
import { 读组织 } from "@/lib/enterprise/org";
import { 记这个项目的自动推进, 客户存了推项目 } from "@/lib/project/auto-advance";
import { 读团队 } from "@/lib/sync/client";
import { 要写原因, type 位置 } from "@/lib/project/nodes";
import { 判MQL, MQL合格去, MQL不合格去 } from "@/lib/project/mql";
import { 销售初判, 市场复核, 销售终验, 总管理终判, 销售认领, type 初判 } from "@/lib/project/lead-verify";
import { saveCustomer, type CustomerInput } from "../customers/actions";
import { 向导自动分配 } from "../leads/assign-actions";
import { 我能用的分配方式, 挡分配方式, 是分配方式序号, type 分配方式序号 } from "@/lib/enterprise/dict";

const 没开 = { ok: false as const, error: "项目模式没开：请老板在「设置 → 业务配置」里打开" };

async function 开着(): Promise<boolean> {
  return (await getBusiness()).projectMode === true;
}

function 刷新项目(projectId?: string, customerId?: string) {
  revalidatePath("/projects");
  if (projectId) revalidatePath(`/projects/${projectId}`);
  if (customerId) revalidatePath(`/customers/${customerId}`);
}

export type 建档向导输入 = { 客户: CustomerInput; 联系人: 向导联系人; 项目: 向导项目; 跟进: 向导跟进 };

/**
 * 建档向导的最后一步：客户、主要联系人、项目、首条跟进一笔建好。
 * 客户查重撞了、哪一步写失败了，整笔都不留；中途关掉向导时根本没走到这里
 */
export async function 建档向导(输入: 建档向导输入) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!输入 || typeof 输入 !== "object" || !输入.客户 || typeof 输入.客户 !== "object") return { ok: false as const, error: "建档信息不完整，请从头再走一遍" };
    // 企业版分配方式（A7，10-27）：只能用分配方式字典里这个人能用、还启用着的那几种（assign-use.ts）。
    // 指定分配 = 负责人是选的那位；另外四种都先建在我名下，自动分配建好后按自动分配转出去、公海捞取建好后放进项目公海
    const 分配 = 企业版() ? await 定分配方式(me, 输入.项目) : null;
    if (分配 && "error" in 分配) return { ok: false as const, error: 分配.error };
    const input = 分配 && 分配.i !== 0
      ? { ...输入, 客户: { ...输入.客户, salesOwnerId: me.id }, 项目: { ...输入.项目, ownerId: me.id } }
      : 输入;
    // 开了超时回收：项目建在线索阶段，首条跟进也得填下一步时间
    const 规则 = await 生效组织规则();
    // 下一步时间：开了超时回收必填；企业版没开也能选填（验收 #4）；不是企业版没有这格，老草稿里留着的也不认、不写，和原来一样
    const 要下一步 = 规则.超时回收.开;
    const 好 = 规整向导(me, 要下一步 || 企业版() || !input.跟进 ? input : { ...input, 跟进: { ...input.跟进, 下一步时间: null } }, new Date(), 要下一步, 企业版());
    if ("error" in 好) return { ok: false as const, error: 好.error };
    // 企业版新建线索要选渠道（10-26：直接选渠道，不是来源类型）
    if (企业版()) {
      const 渠道 = input.客户.channelId ? await prisma.channel.findUnique({ where: { id: String(input.客户.channelId) }, select: { active: true } }) : null;
      if (!渠道?.active) return { ok: false as const, error: input.客户.channelId ? "这个渠道不存在或已停用，换一个" : "请选渠道" };
      // 项目来源（迁移 077）：没另选 = 跟客户来源；另选了也得是还启用着的渠道
      const 来源 = 项目来源默认(input.项目?.channelId, String(input.客户.channelId));
      if (来源 !== String(input.客户.channelId)) {
        const 项目渠道 = await prisma.channel.findUnique({ where: { id: 来源! }, select: { active: true } });
        if (!项目渠道?.active) return { ok: false as const, error: "项目来源这个渠道不存在或已停用，换一个" };
      }
      if (好.企业) 好.企业.项目来源 = 来源;
    }
    const 负责人 = await prisma.user.findUnique({ where: { id: 好.项目.ownerId }, select: { name: true, active: true } });
    if (!负责人?.active) return { ok: false as const, error: "项目负责人不存在或已停用，请选一位在职成员" };
    // 负责人选了别人 = 指派，开了持有上限的要算；自己建给自己不拦（lib/project/db.ts 超上限）
    if (好.项目.ownerId !== me.id) {
      const 超 = await 超上限(prisma, 规则, 好.项目.ownerId, { phase: "线索", result: null });
      if (超) return { ok: false as const, error: 超 };
    }

    /*
      企业版：联系人那一步的电话 / 邮箱 / 微信也按类型验格式、全公司查重（QA #3「邮箱不去重」），
      和第一步选了号码类型的那个号同一套；事务里再比一次（查完再写），建好后记进联系方式子表、挂在这位联系人上。
      开关关着不走：联系人的号和原来一样不查
    */
    const 企 = 企业版();
    const 第一步 = 企 && input.客户.企业号码 ? 验号码(input.客户.企业号码.类型, input.客户.企业号码.值) : null;
    const 联号 = 企 ? 验联系人号码(好.联系人, 第一步?.ok ? 第一步 : null) : [];
    if ("error" in 联号) return { ok: false as const, error: 联号.error };
    const 要查 = 联号.filter((号) => !号.同第一步);
    for (const 号 of 要查) {
      const 结论 = await 企业号码查重(prisma, 号, me.id, await 读的我(defaultClient));
      if (结论.状态 !== "首次录入") return { ok: false as const, error: `${号.格}：${结论.提示}` };
    }

    const 建了: Partial<建好的> = {};
    const 向导 = 向导接着建(me, 好, 建了);
    const 接着 = !企 ? 向导 : 登记接着建(async (tx, customerId) => {
      for (const 号 of 要查) {
        const ids = await 全公司查号(tx, 号.类型, 号.值, 号.键, customerId);
        if (ids.length) throw new 联系人号码撞了(ids, 号.格);
      }
      await 向导(tx, customerId);
      for (const 号 of 联号) await 记号码(tx, { 刚建的: customerId }, 建了.contactId ?? null, 号);
    });
    let r: Awaited<ReturnType<typeof saveCustomer>>;
    try {
      r = await saveCustomer({ ...input.客户, id: undefined, updatedAt: null, base: null }, 接着);
    } catch (e) {
      if (!(e instanceof 联系人号码撞了)) throw e;
      return { ok: false as const, error: `${e.格}：${(await 撞号结论(prisma, e.ids, me.id, await 读的我(defaultClient))).提示}` };
    }
    if (!r.ok) return r;
    await recordAudit({
      user: me, action: "create", entity: "Project", entityId: 建了.projectId,
      summary: `建档：新建项目「${好.项目.name}」（负责人 ${负责人.name}${分配 ? `，分配方式「${分配.名}」` : ""}），连同主要联系人「${好.联系人.name}」和首条跟进`,
      detail: { 项目: 好.项目.name, 负责人: 负责人.name, 金额: 好.项目.amount, 币种: 好.项目.currency, 联系人: 好.联系人.name, ...(分配 ? { 分配方式: 分配.名 } : {}) },
    });
    // 首条跟进记在潜客培育上：配的必填建档时就齐了的，接着往前推
    await 客户存了推项目(me, r.id);
    刷新项目(建了.projectId, r.id);
    revalidatePath("/follow-ups");
    const 分了 = 分配 ? await 建好再分(me, 分配, 建了.projectId!) : null;
    // contactId：名片原图存到这位联系人的附件上（企业版才有联系人附件；开关关着返回和原来逐字段一样）
    return { ok: true as const, customerId: r.id, projectId: 建了.projectId!, ...(企业版() ? { contactId: 建了.contactId ?? null } : {}), ...(分了 ?? {}) };
  } catch (e) { return 不在了(e); }
}

/**
 * 向导这次用哪种分配方式：传了就用传的；没传（老草稿、老调用）照负责人推：选了别人 / 没选 = 指定分配（没选照旧拦「请选项目负责人」），建给自己 = 自拓自持，用不了自拓自持的 = 暂不分配。
 * 推出来的也要过「谁能用」
 */
async function 定分配方式(me: Awaited<ReturnType<typeof requireUser>>, 项目: 建档向导输入["项目"] | undefined): Promise<{ i: 分配方式序号; 名: string } | { error: string }> {
  const 能用 = await 我能用的分配方式(me);
  const 传 = 项目?.分配方式;
  if (传 !== undefined && 传 !== null && !是分配方式序号(传)) return { error: "没有这种分配方式，刷新后再选" };
  const 有 = (i: 分配方式序号) => 能用.some((x) => x.i === i);
  const i: 分配方式序号 = 是分配方式序号(传) ? 传 : 项目?.ownerId !== me.id ? 0 : 有(4) ? 4 : 有(3) ? 3 : 0;
  const 中 = 能用.find((x) => x.i === i);
  if (中) return 中;
  return { error: (await 挡分配方式(me, i)) ?? "这种分配方式已停用，换一种" };
}

/** 建好之后：自动分配转给挑中的人，公海捞取放进项目公海；没成的项目留在我名下，回一句提示（建档本身算成了）。转走 = 项目已不在我名下 */
async function 建好再分(me: Awaited<ReturnType<typeof requireUser>>, 分配: { i: 分配方式序号; 名: string }, projectId: string): Promise<{ 提示: string; 转走: boolean } | null> {
  if (分配.i === 1) {
    const r = await 向导自动分配(projectId);
    return r.ok ? { 提示: `已按「${分配.名}」分给 ${r.接手人}`, 转走: true } : { 提示: `项目先建在你名下，「${分配.名}」没成：${r.error}`, 转走: false };
  }
  if (分配.i === 2) {
    const r = await 放回公海(me, projectId, null);
    if (!r.ok) return { 提示: `项目先建在你名下，没放进公海：${r.error}`, 转走: false };
    刷新项目(projectId);
    return { 提示: "已放进项目公海，等人捞取", 转走: true };
  }
  return null;
}

/** 改节点。进异常状态时带上异常类别（必选）和备注（可空）；企业版点线索流失、丢单时 备注 = 原因（必填） */
export async function 改项目节点(projectId: string, 到: 位置, 异常?: { categoryId?: string | null; 备注?: string | null } | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!到 || typeof 到 !== "object") return { ok: false as const, error: "要改到哪个进程？" };
    const 异 = 异常 && typeof 异常 === "object" ? { categoryId: 异常.categoryId ?? null, 备注: 异常.备注 ?? null } : undefined;
    const r = await 改节点(me, projectId, 到, 异);
    if (r.ok && r.变了) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true, exceptionCategory: { select: { name: true } } } });
      const 类别 = 到.result === "异常状态" ? p?.exceptionCategory?.name ?? null : null;
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `项目「${p?.name ?? ""}」改到 ${到.phase}·${到.node}${到.result ? `（${到.result}${类别 ? `：${类别}` : ""}）` : ""}`,
        detail: { 阶段: 到.phase, 节点: 到.node, 结局: 到.result ?? null, 异常类别: 类别, 备注: 类别 || (企业版() && 要写原因(到.result)) ? 异?.备注?.trim() || null : null },
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 负责人把项目放回项目公海（线索 / 商机阶段） */
export async function 放回项目公海(projectId: string, 原因?: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 放回公海(me, projectId, 原因);
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      const 选了 = 企业版() && typeof 原因 === "string" && 原因.trim() ? 原因.trim() : null;
      await recordAudit({ user: me, action: "update", entity: "Project", entityId: projectId, summary: `把项目「${p?.name ?? ""}」放回项目公海${选了 ? `（${选了}）` : ""}`, ...(选了 ? { detail: { 回收原因: 选了 } } : {}) });
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 从项目公海领取：领了就是负责人 */
export async function 领取项目(projectId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 领取公海项目(me, projectId);
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({ user: me, action: "update", entity: "Project", entityId: projectId, summary: `从项目公海领取项目「${p?.name ?? ""}」` });
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 勾项目交付(projectId: string, 项: 交付项, 勾: boolean) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 勾交付(me, projectId, 项, 勾 === true);
    if (r.ok && r.变了) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `项目「${p?.name ?? ""}」${勾 ? "勾上" : "取消"}「${交付项们[项]}」`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 删除项目(projectId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 删项目(me, projectId);
    if (r.ok) {
      await recordAudit({ user: me, action: "delete", entity: "Project", entityId: projectId, summary: `删除项目「${r.name}」` });
      刷新项目(undefined, r.customerId);
    }
    return r.ok ? { ok: true as const } : r;
  } catch (e) { return 不在了(e); }
}

export async function 加组员角色(name: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加角色(me, name);
    if (r.ok) {
      await recordAudit({ user: me, action: "create", entity: "ProjectRole", entityId: r.id, summary: `加了项目组员角色「${String(name).trim()}」` });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 改组员角色(id: string, patch: { name?: string; active?: boolean }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const 原 = await prisma.projectRole.findUnique({ where: { id: String(id ?? "") }, select: { name: true } });
    const r = await 改角色(me, id, patch ?? {});
    if (r.ok) {
      const 做了 = patch.active === false ? "停用" : patch.active === true ? "启用" : "改名";
      await recordAudit({
        user: me, action: "update", entity: "ProjectRole", entityId: id,
        summary: `${做了}项目组员角色「${原?.name ?? ""}」${patch.name ? ` → 「${String(patch.name).trim()}」` : ""}`,
      });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 加项目异常类别(name: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加异常类别(me, name);
    if (r.ok) {
      await recordAudit({ user: me, action: "create", entity: "ProjectExceptionCategory", entityId: r.id, summary: `加了项目异常类别「${String(name).trim()}」` });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 改项目异常类别(id: string, patch: { name?: string; active?: boolean }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const 原 = await prisma.projectExceptionCategory.findUnique({ where: { id: String(id ?? "") }, select: { name: true } });
    const r = await 改异常类别(me, id, patch ?? {});
    if (r.ok) {
      const 做了 = patch.active === false ? "停用" : patch.active === true ? "启用" : "改名";
      await recordAudit({
        user: me, action: "update", entity: "ProjectExceptionCategory", entityId: id,
        summary: `${做了}项目异常类别「${原?.name ?? ""}」${patch.name ? ` → 「${String(patch.name).trim()}」` : ""}`,
      });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

const 项目字段名: Record<string, string> = { name: "名称", ownerId: "负责人", amount: "金额", currency: "币种", remark: "备注", contactId: "主联系人", expectedDealAt: "预计成交日期", channelId: "项目来源" };

/** 编辑项目：名称、负责人、金额、币种、备注、主联系人；企业版还有预计成交日期、项目来源 */
export async function 编辑项目(projectId: string, patch: 向导项目 & { contactId?: string | null; expectedDealAt?: string | null }) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 改项目(me, projectId, patch);
    if (r.ok && r.变了?.length) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: `编辑项目「${p?.name ?? ""}」：改了${r.变了.map((k) => 项目字段名[k] ?? k).join("、")}`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r.ok ? { ok: true as const, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) } : r;
  } catch (e) { return 不在了(e); }
}

/** 企业版 MQL 人工判定：线索验证上判合格（推到线索推进）/ 不合格（退回潜客培育 + 培育跟进计划） */
export async function 判MQLAction(projectId: string, 合格: boolean, 下一步时间?: string | null, 计划内容?: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "MQL 判定只在企业版有" };
    const r = await 判MQL(me, projectId, 合格 === true, 下一步时间 ?? null, new Date(), 计划内容 ?? null);
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "update", entity: "Project", entityId: projectId,
        summary: 合格 ? `项目「${p?.name ?? ""}」MQL 判合格，推到 ${MQL合格去}` : `项目「${p?.name ?? ""}」MQL 判不合格，退回 ${MQL不合格去}，${下一步时间 ?? ""} 再跟进：${String(计划内容 ?? "").trim()}`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 线索验证（P12）五个入口共用：登录、项目模式、企业版，成了记审计（谁判了什么）、刷新列表和详情 */
async function 验证一步(projectId: string, 说法: (项目: string) => string, 做: (me: Awaited<ReturnType<typeof requireUser>>) => Promise<{ ok: true; 自动推到?: string[] } | { ok: false; error: string }>) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "线索验证只在企业版有" };
    const r = await 做(me);
    if (r.ok) {
      const p = await 看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } }));
      await recordAudit({ user: me, action: "update", entity: "EntLeadVerify", entityId: projectId, summary: 说法(p?.name ?? "") });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
      revalidatePath("/leads");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

const 短 = (v: unknown) => String(v ?? "").trim().slice(0, 100);

/** 1. 销售初判：有效 / 无效（要无效原因，交复核）/ 还需培育（同 MQL 不合格，要下一次培育日期和计划） */
export async function 线索初判Action(
  projectId: string, 判: 初判,
  附: { invalidReason?: string | null; verifyNote?: string | null; 下一步时间?: string | null; 计划内容?: string | null } = {},
) {
  return 验证一步(projectId, (名) => `项目「${名}」线索初判：${判}${判 === "无效" ? `，无效原因：${短(附.invalidReason)}` : ""}${附.verifyNote ? `；${短(附.verifyNote)}` : ""}`,
    (me) => 销售初判(me, projectId, 判, 附 ?? {}));
}

/** 2. 市场复核：判有效（回销售终验）/ 判无效（线索流失） */
export async function 市场复核Action(projectId: string, 有效: boolean, reviewNote?: string | null) {
  return 验证一步(projectId, (名) => `项目「${名}」市场复核：判${有效 ? "有效" : "无效"}${reviewNote ? `；${短(reviewNote)}` : ""}`,
    (me) => 市场复核(me, projectId, 有效 === true, reviewNote));
}

/** 3. 销售终验：接受复核（推到线索推进）/ 提交异议（要说明，交总管理终判） */
export async function 销售终验Action(projectId: string, 接受: boolean, disputeNote?: string | null) {
  return 验证一步(projectId, (名) => `项目「${名}」销售终验：${接受 ? "接受复核" : `提交异议；${短(disputeNote)}`}`,
    (me) => 销售终验(me, projectId, 接受 === true, disputeNote));
}

/** 4. 总管理终判：判有效（回销售认领）/ 判无效（线索流失） */
export async function 总管理终判Action(projectId: string, 有效: boolean, finalNote?: string | null) {
  return 验证一步(projectId, (名) => `项目「${名}」总管理终判：判${有效 ? "有效" : "无效"}${finalNote ? `；${短(finalNote)}` : ""}`,
    (me) => 总管理终判(me, projectId, 有效 === true, finalNote));
}

/** 总管理判有效后，销售认领继续推，或自己退回公海（算主动退回） */
export async function 销售认领Action(projectId: string, 继续: boolean) {
  return 验证一步(projectId, (名) => `项目「${名}」终判有效后${继续 ? "认领继续推进" : "退回公海"}`,
    (me) => 销售认领(me, projectId, 继续 === true));
}

async function 组员说法(projectId: string, userId: string) {
  const [p, u] = await Promise.all([
    // 回邀请的人同意前看不到项目：这里只取名字写日志
    看全部(() => prisma.project.findUnique({ where: { id: projectId }, select: { name: true } })),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
  ]);
  return `项目「${p?.name ?? ""}」的项目组：${u?.name ?? "已不在的成员"}`;
}

export async function 加项目组员(projectId: string, userId: string, roleId?: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const r = await 加组员(me, projectId, userId, roleId);
    if (r.ok) {
      const 邀请 = 企业版() && userId !== me.id;
      await recordAudit({ user: me, action: "create", entity: "ProjectMember", entityId: projectId, summary: `${邀请 ? "邀请进" : "加进"}${await 组员说法(projectId, userId)}` });
      刷新项目(projectId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/** 企业版：被邀请的人点同意 / 拒绝 */
export async function 回项目邀请(memberId: string, 同意: boolean) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "项目组邀请是企业版的功能" };
    const r = await 回邀请(me, memberId, 同意 === true);
    if (r.ok && r.projectId) {
      await recordAudit({ user: me, action: "update", entity: "ProjectMember", entityId: r.projectId, summary: `${同意 === true ? "同意加入" : "拒绝加入"}${await 组员说法(r.projectId, me.id)}` });
      刷新项目(r.projectId);
    }
    return r.ok ? { ok: true as const } : r;
  } catch (e) { return 不在了(e); }
}

export async function 换项目组员角色(memberId: string, roleId: string | null) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const m = await prisma.projectMember.findUnique({ where: { id: String(memberId ?? "") }, select: { projectId: true, userId: true, roleId: true } });
    const r = await 换组员角色(me, memberId, roleId);
    if (r.ok && m && (roleId || null) !== m.roleId) {
      const 角色 = roleId ? (await prisma.projectRole.findUnique({ where: { id: roleId }, select: { name: true } }))?.name : null;
      await recordAudit({ user: me, action: "update", entity: "ProjectMember", entityId: m.projectId, summary: `${await 组员说法(m.projectId, m.userId)} 角色改成「${角色 ?? "不填"}」` });
      刷新项目(m.projectId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 移出项目组员(memberId: string) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    const m = await prisma.projectMember.findUnique({ where: { id: String(memberId ?? "") }, select: { projectId: true, userId: true } });
    const r = await 移出组员(me, memberId);
    if (r.ok && m) {
      await recordAudit({ user: me, action: "delete", entity: "ProjectMember", entityId: m.projectId, summary: `移出${await 组员说法(m.projectId, m.userId)}` });
      刷新项目(m.projectId);
    }
    return r;
  } catch (e) { return 不在了(e); }
}

/**
 * 这次改动碰到的每一块都得能改：公海 = 持有上限，超时回收 = 节点时限（再按节点拆），节点推进 = 必填字段
 * （「后台设置谁能改」，lib/enterprise/edit-perm-table.ts；老板总能改）
 */
async function 挡组织规则(me: { id: string; role: string }, 改: 规则改动): Promise<string | null> {
  const 块: [keyof 规则改动, 设置项名, string][] = [["公海", "持有上限", "项目持有上限"], ["超时回收", "节点时限", "各进程时限"], ["节点推进", "必填字段", "进程必填字段"], ["阶段", "阶段规则", "阶段结束状态叫法和往前推权限"]];
  // 一块都没传就不过任何门，不能当「允许」放过去（10-29 权限枚举表扫出：空改动谁都能存一次规则、留审计）
  if (!块.some(([k]) => 改?.[k] !== undefined)) return "没有要改的规则";
  for (const [k, 项, 叫法] of 块) {
    if (改?.[k] === undefined) continue;
    const 挡 = await 挡改设置(me, 项);
    if (挡) return `${叫法}${挡}`;
  }
  // 节点时限再按节点拆：销售管理 / 市场管理只能动自己那几个节点，开关只有老板、总管理员（edit-perm-table.ts 时限可改节点）
  if (改?.超时回收 !== undefined && 企业版()) {
    const [org, 配置, 现在] = await Promise.all([读组织(), 读改权限(), 读组织规则()]);
    const 挡 = 挡时限改动(能改时限的节点(org, me, 配置), 现在.超时回收, 改.超时回收);
    if (挡) return 挡;
  }
  return null;
}

/** 企业版组织规则（持有上限等）：不是企业版改不了；谁能改见 挡组织规则，每条默认关（lib/project/org-rules.ts） */
export async function 改组织规则(改: 规则改动) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "组织规则是企业版的功能" };
    const 挡 = await 挡组织规则(me, 改);
    if (挡) return { ok: false as const, error: 挡 };
    const 新 = 合上改动(await 读组织规则(), 改);
    if ("error" in 新) return { ok: false as const, error: 新.error };
    await 存组织规则(新);
    const g = 新.公海, t = 新.超时回收;
    const 推 = 新.节点推进;
    const 说 = 改.阶段 !== undefined
      ? `组织规则：往前推权限 ${新.阶段.推进权限}，改了 ${Object.keys(新.阶段.出口叫法).length} 个阶段的结束状态叫法`
      : 改.节点推进 !== undefined
      ? 推.开 ? `组织规则：进程推进开，${Object.keys(推.必填).length} 个进程配了必填` : "组织规则：进程推进关"
      : 改.超时回收 !== undefined
      ? t.开 ? `组织规则：超时回收开，设了 ${Object.keys(t.节点天数).length} 个进程的处理时长` : "组织规则：超时回收关"
      : 改.公海?.多项目客户 !== undefined
      ? `组织规则：多项目客户公海走法 ${g.多项目客户}`
      : g.持有上限开 ? `组织规则：项目持有上限开，默认 ${是不限(g.默认上限) ? "不限" : `${g.默认上限} 个`}，单独设了 ${Object.keys(g.每人上限).length} 人` : "组织规则：项目持有上限关";
    await recordAudit({ user: me, action: "update", entity: "Setting", entityId: "orgRules", summary: 说, detail: 新 });
    // 改了时长当场按新的扫一遍（老板保存前已经看过会回收几个）
    const 收回 = 改.超时回收 !== undefined ? await 公海超时收回(me) : 0;
    revalidatePath("/settings");
    if (收回) revalidatePath("/projects");
    return { ok: true as const, 收回 };
  } catch (e) { return 不在了(e); }
}

/** 老板保存超时回收设置前先看：按改完的规则，现在会有几个项目回到公海 */
export async function 预览超时回收(改: 规则改动) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "组织规则是企业版的功能" };
    const 挡 = await 挡组织规则(me, 改);
    if (挡) return { ok: false as const, error: 挡 };
    const 新 = 合上改动(await 读组织规则(), 改);
    if ("error" in 新) return { ok: false as const, error: 新.error };
    return { ok: true as const, 个数: await 超时预览(新), 团队: !!读团队() };
  } catch (e) { return 不在了(e); }
}

/** 在项目上记一条沟通（项目详情「记一条」）。开了超时回收的线索 / 商机阶段要带下一步时间 */
export async function 记项目沟通Action(projectId: string, input: 向导跟进) {
  try {
    const me = await requireUser();
    if (!(await 开着())) return 没开;
    if (!企业版()) return { ok: false as const, error: "在项目上记沟通是企业版的功能，请去客户页记" };
    const r = await 记项目沟通(me, projectId, input);
    if (r.ok) {
      const p = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true, customerId: true } });
      await recordAudit({
        user: me, action: "create", entity: "FollowUp", entityId: r.followUpId,
        summary: `在项目「${p?.name ?? ""}」上记了一条沟通（${input.阶段 ?? ""}阶段，客户${input.明确回复 ? "明确回复了" : "没有明确回复"}）`,
      });
      await 记这个项目的自动推进(me, projectId, r.自动推到);
      刷新项目(projectId, p?.customerId);
      revalidatePath("/follow-ups");
    }
    return r.ok ? { ok: true as const, ...(r.自动推到 ? { 自动推到: r.自动推到 } : {}) } : r;
  } catch (e) { return 不在了(e); }
}
