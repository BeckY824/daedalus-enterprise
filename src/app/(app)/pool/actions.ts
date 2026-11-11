"use server";

/**
 * 企业版统一公海的两个新动作（2026-10-29，P7）：标无效客户、恢复有效客户。领取照用原来的（客户公海 领取、项目公海 领取项目）。
 * 10-30 交互改版补两个：老板、主管把项目行分给同事（分配公海项目，客户行照用 分配公海）；领 / 分项目行的撤销（撤销公海项目，规则 B）。
 * 规矩：老板、主管能标无效；恢复 = 系统管理员、回收站副手（V3.5.1）。只认还在客户公海里的客户（项目行的客户归别人，不在这里标）。
 * 先拦权限、再看参数：权限矩阵拿空参数调，得先说「无权」（tests/permissions/matrix.test.ts）
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { 公海分不给 } from "@/lib/owners";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 权限组织 } from "@/lib/enterprise/org";
import { 能管公海, 能恢复 } from "@/lib/enterprise/permissions";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import { 看全部 } from "@/lib/team-scope";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 查完再写 } from "@/lib/check-then-write";
import { 持有上限起点, 整批核上限, 整批或不做 } from "@/lib/project/db";
import { 生效组织规则 } from "@/lib/project/org-rules-store";
import { 钉住老签约 } from "@/lib/contract-owner";
import { 撤回项目公海 } from "@/lib/enterprise/pool-undo";
import { 带待办勾 } from "@/lib/project/carry-tasks";
import { 公海分配通知, 同事待分配随客户通知 } from "@/lib/enterprise/notice-sources";
import { 分配方式叫法 } from "@/lib/enterprise/dict";
import { 撤销公海 } from "@/app/(app)/customers/pool-actions";
import { 在事务里分公海项目们, type 整包撤销 } from "@/lib/enterprise/pool-assign-projects";
import { 公海按线拦 } from "@/lib/enterprise/pool-line-guard";

export type 标记结果 = { ok: true; updated: number; unchanged: number } | { ok: false; error: string };

const 只企业版项目模式 = { ok: false as const, error: "统一公海只在企业版项目模式里有" };

async function 开着(): Promise<boolean> {
  return 企业版() && (await getBusiness()).projectMode === true;
}

/** 参数规整：只认字符串 id，去重，最多 500 个（一页最多 100 行，留余量给以后批量） */
function 规整ids(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && x.length > 0))].slice(0, 500);
}

function 刷新() {
  revalidatePath("/pool");
  revalidatePath("/customers");
  revalidatePath("/projects");
}

/** 老板、主管把公海里的客户标成无效：标了的领不了、分不了。已经是无效的算没变 */
export async function 标无效客户(ids: string[]): Promise<标记结果> {
  const me = await requireUser();
  const org = await 权限组织();
  if (!能管公海(me, org)) return { ok: false, error: "只有总管理和销售管理能标无效客户" };
  if (!(await 开着())) return 只企业版项目模式;
  const 们 = 规整ids(ids);
  if (!们.length) return { ok: true, updated: 0, unchanged: 0 };
  // 销管、条线总管理只能标本业务线的（P-公海-07）：混了别线的整批不标
  const 别线 = await 公海按线拦(prisma, me, org, { 客户: 们 }, "标无效");
  if (别线) return { ok: false, error: 别线 };
  // 只改还在公海里、还没标的：领走了的不标（标了也没意义，还会在他以后再进公海时冒出来）
  const r = await prisma.customer.updateMany({ where: { id: { in: 们 }, pool: { isNot: null }, poolInvalidAt: null }, data: { poolInvalidAt: new Date() } });
  if (r.count) {
    await recordAudit({
      user: me, action: "pool-invalid", entity: "Customer", entityId: 们.length === 1 ? 们[0] : null,
      summary: `把公海里 ${r.count} 名客户标成无效客户`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: r.count, unchanged: 们.length - r.count };
}

/** 系统管理员、回收站副手能恢复：清掉无效标记，客户还在公海里，照常能领 */
export async function 恢复有效客户(ids: string[]): Promise<标记结果> {
  const me = await requireUser();
  const org = await 权限组织();
  if (!能恢复(me, org)) return { ok: false, error: "只有系统管理员或回收站副手能恢复无效客户" };
  if (!(await 开着())) return 只企业版项目模式;
  const 们 = 规整ids(ids);
  if (!们.length) return { ok: true, updated: 0, unchanged: 0 };
  // 设了业务线的回收站副手（销管、条线总管理）只能恢复本业务线的（P-公海-07）；系统管理员不限
  const 别线 = await 公海按线拦(prisma, me, org, { 客户: 们 }, "恢复");
  if (别线) return { ok: false, error: 别线 };
  const r = await prisma.customer.updateMany({ where: { id: { in: 们 }, poolInvalidAt: { not: null } }, data: { poolInvalidAt: null } });
  if (r.count) {
    await recordAudit({
      user: me, action: "pool-restore", entity: "Customer", entityId: 们.length === 1 ? 们[0] : null,
      summary: `把 ${r.count} 名无效客户恢复成有效`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: r.count, unchanged: 们.length - r.count };
}

export type { 整包撤销 };

export type 分项目结果 =
  | { ok: true; 分到: string[]; 没分到: { id: string; 原因: string }[]; 给谁: { id: string; name: string }; 整包?: 整包撤销 }
  | { ok: false; error: string };

/**
 * 老板、主管把线索公海里的项目分给同事（10-30，P0 #6）：权限同客户公海的 分配公海，持有上限照拦指派（超上限）。
 * 规矩同 领取公海项目：标了无效的客户的项目分不了、已结束的项目分不了（X-70）；记一行 pool-claim（操作人 = 我，到 = 给的那位），撤销认的就是这一行；
 * 客户不在客户公海里：分到的只换项目负责人，客户负责人不变；客户在客户公海里：客户和名下别的公海项目整包出公海给这位（P-公海-10，11-09 定，
 * 只有能管公海的销售管理、总管理走得到这里）。一个事务里逐个分（在事务里分公海项目们，lib/enterprise/pool-assign-projects.ts），分不了的说原因、不拦别的；
 * 持有上限整批核（M-公海-18，11-10）：这一批分完他会超上限就一个都不分。公海页同时勾了客户行的走 分配公海（带 项目ids），和客户同一个事务
 * 带待办（C-06，公海页页头的勾，没传按默认勾）：进公海时关掉的那批待办重新打开给分到的人
 */
export async function 分配公海项目(ids: string[], userId: string, 带待办?: boolean): Promise<分项目结果> {
  const me = await requireUser();
  const org = await 权限组织();
  if (!能管公海(me, org)) return { ok: false, error: "只有总管理和销售管理能把公海里的项目分给同事" };
  if (!(await 开着())) return 只企业版项目模式;
  const 给 = await prisma.user.findFirst({ where: { id: String(userId ?? ""), active: true }, select: { id: true, name: true } });
  if (!给) return { ok: false, error: "这位同事不在了或已停用，换一位" };
  // 只分给能当负责人的，不限业务线（P-转-08）；操作人只能动本线的另在下面拦（P-公海-07）
  const 不行 = await 公海分不给(me, 给.id);
  if (不行) return { ok: false, error: 不行 };
  const 们 = 规整ids(ids);
  // 销管、条线总管理只能分本业务线的（P-公海-07）：混了别线的整批不分
  const 别线 = await 公海按线拦(prisma, me, org, { 项目: 们 }, "分配");
  if (别线) return { ok: false, error: 别线 };
  const 规则 = await 生效组织规则();
  // 客户在客户公海里的会整包换客户负责人（P-公海-10）、客户还在市场手里的整体给这位销售（P-公海-11）：事务外先钉住老签约（没缺的就不写）
  if (企业版()) await 钉住老签约();
  const way = 企业版() ? await 分配方式叫法(0) : "";
  // 一个事务分完（M-公海-18，11-10 用户定）：分不了的（被人领走、已结束、验证中……）各说各的原因、不拦别的；
  // 持有上限整批核：动手前记下他名下原有几个，全部写完再数，超了整个事务回滚、一个都不分，回那句话（并发的后到那次同样整批失败）
  const 整批 = await 整批或不做(() => 看全部(() => 查完再写(async (tx) => {
    const 起 = await 持有上限起点(tx, 规则, 给.id);
    const 结果 = await 在事务里分公海项目们(tx, me.id, 给.id, 们, { org, way, 带: 带待办勾(带待办) });
    await 整批核上限(tx, 起, "接");
    return 结果;
  })));
  if (!整批.ok) return { ok: false, error: 整批.超 };
  const { 分到, 没分到, 跟来, 连客户, 整包, 随客户 } = 整批.值;
  if (分到.length) {
    await recordAudit({
      user: me, action: "pool-assign", entity: "Project", entityId: 分到.length === 1 ? 分到[0] : null,
      summary: `把线索公海里 ${分到.length} 个项目分给 ${给.name}`,
      detail: { ids: 分到, 给: 给.id },
    });
    刷新();
    await 公海分配通知(me, 给.id, "项目", 分到, 跟来, 连客户);
    if (随客户.length) await 同事待分配随客户通知(me.id, 给.id, 随客户);
  }
  return { ok: true, 分到, 没分到, 给谁: 给, ...(整包.原.length ? { 整包 } : {}) };
}

/** 撤销条带回来的 整包 不可信：只留形状对的，id 都是字符串 */
function 规整整包(x: unknown): 整包撤销 | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const 原 = Array.isArray(o.原)
    ? o.原.filter((r): r is { id: string; 值: string } => !!r && typeof r === "object" && typeof (r as { id?: unknown }).id === "string" && typeof (r as { 值?: unknown }).值 === "string")
        .map((r) => ({ id: r.id, 值: r.值 })).slice(0, 500)
    : [];
  if (!原.length) return null;
  const 带 = (o.带过来 ?? {}) as Record<string, unknown>;
  return { 原, 带过来: { 计划: 规整ids(带.计划), 待办: 规整ids(带.待办), 商机: 规整ids(带.商机), 项目: 规整ids(带.项目) }, 公海项目: 规整ids(o.公海项目) };
}

/**
 * 撤销刚才从项目公海领 / 分走的项目（规则 B，6 秒内点）：项目回项目公海，负责人还给原来那位。
 * 认不认看留痕（撤回项目公海）：得是我在撤销时限内领 / 分给 现 的那一下。撤分配只有老板、主管能点
 * 分配时客户整包出了客户公海的（整包，P-公海-10）：整包退回——客户回客户公海、负责人还原，一起带出的项目回线索公海，
 * 带过来的活还回去，被撤的换负责人记录删掉（P-撤销-01、M-公海-01）。走 撤销公海 的分配那一支，认不认按它（得是我刚把客户从原负责人换给 给谁 的）。
 * 只退这次带出的：整包 是这次分配返回的，别的客户、项目不碰
 */
export async function 撤销公海项目(动作: "领取" | "分配", ids: string[], 给谁?: string, 整包?: 整包撤销): Promise<标记结果> {
  const me = await requireUser();
  const org = 动作 === "分配" ? await 权限组织() : null;
  if (动作 === "分配" && (!能管公海(me, org) || !给谁)) return { ok: false, error: "只有总管理和销售管理能撤销分配" };
  if (!(await 开着())) return 只企业版项目模式;
  const 现 = 动作 === "分配" ? String(给谁) : me.id;
  const 们 = 规整ids(ids);
  const 包 = 动作 === "分配" ? 规整整包(整包) : null;
  if (动作 === "分配") {
    // 销管、条线总管理只能撤本业务线的（P-公海-07）：连整包带出的客户、项目一起核
    const 别线 = await 公海按线拦(prisma, me, org, { 项目: [...们, ...(包?.公海项目 ?? [])], 客户: 包?.原.map((x) => x.id) ?? [] }, "撤销分配");
    if (别线) return { ok: false, error: 别线 };
  }
  let 撤了 = 0;
  for (const id of 们) {
    if (await 看全部(() => 查完再写((tx) => 撤回项目公海(tx, id, 现, me.id)))) 撤了++;
  }
  if (包) {
    const r = await 撤销公海("分配", 包.原, 包.带过来, 现, 包.公海项目);
    if (!r.ok) return r;
  }
  if (撤了) {
    忘掉企业版范围(); // 回到公海，原负责人回避名单变了
    await recordAudit({
      user: me, action: "update", entity: "Project", entityId: 们.length === 1 ? 们[0] : null,
      summary: `撤销${动作}：${撤了} 个项目放回线索公海`,
      detail: { ids: 们 },
    });
    刷新();
  }
  return { ok: true, updated: 撤了, unchanged: 们.length - 撤了 };
}
