"use server";

/**
 * 企业版建档向导的「查重」按钮（2026-10-26，测试清单 B2–B8）：选号码类型 → 验格式 → 全公司查重，回一句对方系统原样的提示。
 * 规矩在 lib/enterprise/contact-format.ts，查重在 lib/enterprise/contact-dedupe.ts；保存时 saveCustomer 再按同一套挡一次。
 * 手机号顺带回归属地（B7，lib/enterprise/phone-region.ts，离线）。
 * 开关关着不认（向导也不显示类型下拉，照旧走 checkDuplicate）
 * 从回收站捞回（客户 11-05：「可以捞回且只有查重触发时可以捞回」）：查重说「回收站里有」时向导 / 首页查重框 / AI 建档卡片给的那颗键
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { 权限组织 } from "@/lib/enterprise/org";
import { 没设业务角色, 只读角色, 只读角色话 } from "@/lib/enterprise/permissions";
import { 查重捞回, 回收站叫法 } from "@/lib/enterprise/soft-delete";
import { prisma, defaultClient } from "@/lib/prisma";
import { 读的我 } from "@/lib/team-scope";
import { 企业版 } from "@/lib/enterprise/switch";
import { 恢复到停用负责人通知 } from "@/lib/enterprise/notice-sources";
import { 验号码 } from "@/lib/enterprise/contact-format";
import { 企业号码查重, type 撞到的人 } from "@/lib/enterprise/contact-dedupe";
import { 号码归属地 } from "@/lib/enterprise/phone-region";
import { 同号协同情况, type 协同情况 } from "@/lib/enterprise/same-number-collab";
import { 号码撞上, 客户名查重, 名撞说法, 申请挂靠 as 记申请挂靠, type 撞号露出, type 名撞结论 } from "@/lib/enterprise/dupe-ledger";

export type 查号码结果 =
  /** 没过格式：未选类型 / 无法识别 / 格式错误 / 待上传 */
  | { ok: false; 状态: string; 提示: string }
  /**
   * 值 = 规整后的号码（手机号去掉 +86 和分隔符），向导拿去填联系人那一格。
   * 归属地 = 只有手机号有（B7）：国内「广东 深圳 中国移动」、国外「英国」；离线表里查不到、别的类型都是 null
   * 可协同 = 撞到有负责人在跟的客户：向导摆「把这次记录写进现有项目」（lib/enterprise/same-number-collab.ts）
   * 原负责人是我 = 撞的是我自己退回公海的（企业版原负责人看不到也领不回），向导不给「打开它」「去领取」（11-03 B7-3）
   * 协同 = 同时带上有没有项目、是不是自己负责、是否已在组，向导按它说那段话（11-03 B6-8 / B7-4）
   * 回收站里有 = 在用的没撞、回收站里撞了（客户 11-05（X-10））：拦下，向导给「从回收站捞回」（从回收站捞回）
   * 挂靠 = 「重复」时露出负责人（姓名 · 级别 · 状态）、台账那一行的 id（给「申请挂靠」）、是否同组（P-挂靠-01，lib/enterprise/dupe-ledger.ts）
   */
  | { ok: true; 状态: "首次录入" | "公海待捞" | "我的通讯录已有" | "重复" | "回收站里有"; 提示: string; 值: string; 撞: 撞到的人 | null; 归属地: string | null; 可协同?: true; 协同?: 协同情况; 原负责人是我?: true; 挂靠?: 撞号露出 };

export async function 查号码(类型: string, 值: string): Promise<查号码结果> {
  const me = await requireUser();
  if (!企业版()) return { ok: false, 状态: "没开", 提示: "企业版才有号码类型" };
  const 号 = 验号码(类型, 值);
  if (!号.ok) return { ok: false, 状态: 号.状态, 提示: 号.提示 };
  const 我 = await 读的我(defaultClient);
  const 结论 = await 企业号码查重(prisma, 号, me.id, 我);
  const 协同 = 结论.状态 !== "首次录入" ? await 同号协同情况(号, me.id) : null;
  // 撞了有人在跟的：露出负责人 + 记撞号台账（问同事撞的本机没这位客户，号码撞上 回 null）
  const 挂靠 = 结论.状态 === "重复" ? await 号码撞上(me.id, 我, 号) : null;
  return { ok: true, 状态: 结论.状态, 提示: 结论.提示, 值: 号.值, 撞: 结论.撞, 归属地: 号码归属地(号.类型, 号.值)?.文字 ?? null, ...(结论.状态 === "公海待捞" && 结论.原负责人是我 ? { 原负责人是我: true as const } : {}), ...(协同 ? { 可协同: true as const, 协同 } : {}), ...(挂靠 ? { 挂靠 } : {}) };
}

export type 查客户名结果 = { ok: true; 撞: null } | { ok: true; 撞: 名撞结论; 提示: string } | { ok: false; error: string };

/**
 * 建档向导填完客户名那一步的查重（P-挂靠-01，和号码同一套）：名字（和公司）撞上有人在跟的客户，露出负责人 + 申请挂靠，记台账；
 * 撞的是我名下的只说「你名下已有」。公海、没负责人的不提示。保存时 saveCustomer 再按同一套挡一次
 */
export async function 查客户名(名: string, 公司?: string | null): Promise<查客户名结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: true, 撞: null };
    const r = await 客户名查重(me.id, await 读的我(defaultClient), 名, 公司);
    return r ? { ok: true, 撞: r, 提示: 名撞说法(r) } : { ok: true, 撞: null };
  } catch (e) { return 不在了(e); }
}

/**
 * 「申请挂靠」（P-挂靠-01）：撞号台账那一行记上申请、定审批人、通知他；审批在「挂靠申请」页（P-挂靠-02，lib/enterprise/attach-approval.ts）。
 * 和新建同一道挡：没业务角色、只读管理员不行
 */
export async function 申请挂靠(撞号id: string): Promise<{ ok: true; 提示: string } | { ok: false; error: string }> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: "企业版才有申请挂靠" };
    const org = await 权限组织();
    if (!org || 没设业务角色(org, me.id)) return { ok: false, error: "你还没有业务角色，不能改数据，请找总管理设置" };
    if (只读角色(me, org)) return { ok: false, error: 只读角色话 };
    return await 记申请挂靠(me, 撞号id);
  } catch (e) { return 不在了(e); }
}

/** 已不在 = 没捞成：号码已不在回收站（被别人先捞回 / 已彻底删除），按 查 摆新结论，键上用提醒样式、不用成功样式 */
export type 捞回结果 = { ok: true; 提示: string; 查: 查号码结果; 已不在?: true } | { ok: false; error: string };

const 已不在话 = "这个号码已不在回收站里了（可能刚被别人捞回，或已彻底删除），按最新的查重结果来";

/**
 * 查重撞上回收站里的号码，就地捞回（lib/enterprise/soft-delete.ts 查重捞回）。只认号码不认 id：服务端重查一遍，
 * 在用的已经有了（别人先捞了 / 新建了）就不捞，回新的查重结论。谁查重撞上谁能捞，只挡没业务角色、只读管理员（和新建同一道）。
 * 每条回来的记一笔审计 restore；回完再查一遍号，把新结论交回去（客户回到原负责人 / 公海，向导照新结论摆）
 */
export async function 从回收站捞回(类型: string, 值: string): Promise<捞回结果> {
  try {
    const me = await requireUser();
    if (!企业版()) return { ok: false, error: "回收站只在企业版里有" };
    const org = await 权限组织();
    if (!org || 没设业务角色(org, me.id)) return { ok: false, error: "你还没有业务角色，不能改数据，请找总管理设置" };
    if (只读角色(me, org)) return { ok: false, error: 只读角色话 };
    const 号 = 验号码(类型, 值);
    if (!号.ok) return { ok: false, error: 号.提示 };
    const 先查 = await 查号码(类型, 值);
    if (!先查.ok || 先查.状态 !== "回收站里有") return { ok: true, 已不在: true, 提示: 已不在话, 查: 先查 };
    const r = await 查重捞回(号, me.id);
    if (!r.ok) {
      // 先查到捞之间被别人捞走 / 彻底删了：一样按「已不在」回新结论，不报成出错
      const 再查 = await 查号码(类型, 值);
      if (!再查.ok || 再查.状态 !== "回收站里有") return { ok: true, 已不在: true, 提示: 已不在话, 查: 再查 };
      return r;
    }
    for (const x of r.回来的) {
      await recordAudit({
        user: me, action: "restore", entity: x.t, entityId: x.id,
        summary: `查重时从回收站捞回${回收站叫法[x.t]}「${x.名}」${x.连带 ? `（连同 ${x.连带} 条一起）` : ""}${x.停用负责人?.进了公海 ? "，原负责人已停用，放进了客户公海" : ""}`,
      });
    }
    // P-删-06：捞回的客户原负责人已停用，进了客户公海 / 例外留在他名下，告诉他的直属上级（没有就系统管理员），几位合成一条
    await 恢复到停用负责人通知(me, r.回来的.flatMap((x) => (x.停用负责人 ? [{ id: x.id, ...x.停用负责人 }] : [])));
    for (const p of ["/customers", "/contacts", "/projects", "/follow-ups", "/settings"]) revalidatePath(p);
    const 客户 = r.回来的.filter((x) => x.t === "Customer").length;
    const 联系人 = r.回来的.length - 客户;
    const 提示 = `已从回收站捞回${客户 ? ` ${客户} 位客户（连同联系人、项目、跟进）` : ""}${客户 && 联系人 ? "、" : ""}${联系人 ? ` ${联系人} 位联系人` : ""}`;
    return { ok: true, 提示, 查: await 查号码(类型, 值) };
  } catch (e) { return 不在了(e); }
}
