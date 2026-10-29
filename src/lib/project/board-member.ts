import { prisma } from "@/lib/prisma";
import { 成员选项 } from "@/lib/utils";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织, 实线下属, 虚线下属, 管理员类别们of, type 组织 } from "@/lib/enterprise/org";
import { 组织范围of } from "@/lib/enterprise/visibility";

/**
 * 企业版复盘页、首页指标卡按人看（P15，10-29 定稿）：看谁的数，范围只按组织架构定，不看「按组织看客户」开没开。
 *
 *   - 老板（账号 ADMIN）、总管理员：看全部人，默认「全部」；
 *   - 别的上级（主管账号、销售管理 / 市场管理、手下有人的）：只能在 自己 + 直接 / 间接下属 里选，「全部」= 这些人；
 *     下属 = 实线下属整条链 + 虚线下属（虚线是只读的下属，看数够得着），同 组织范围of 的「读」；
 *   - 业务员：只看自己，地址栏带了别人也不认。
 *
 * **服务端兜底**：看板的人 给出 谁（这次数哪些负责人），取数那层按 ownerId in 谁 筛——
 * 不靠「按组织看客户」那层限定（它关着时数据层不拦人，原来经理选「全部」会数到全公司）。
 * 选的人不在能选的里面（改了地址栏、人调走了）就当没选，看他能看的全部。
 */

const 无人 = "__无";

/** 纯函数（测试直接用）：是不是管理层、能不能看全部、能选看谁（id，含自己） */
export function 看板范围of(org: 组织, 账号角色: string | null, 我: string): { 管理层: boolean; 全看: boolean; 可选: string[] } {
  const 管理层 =
    账号角色 === "ADMIN" ||
    账号角色 === "MANAGER" ||
    管理员类别们of(org, 我).size > 0 ||
    实线下属(org, 我).size > 0 ||
    虚线下属(org, 我).size > 0;
  if (!管理层) return { 管理层, 全看: false, 可选: [我] };
  const 范围 = 组织范围of(org, 账号角色, 我);
  // null = 老板、总管理员：组织里的全部人
  if (!范围) return { 管理层, 全看: true, 可选: [...new Set([我, ...org.成员.keys()])] };
  return { 管理层, 全看: false, 可选: [...new Set([我, ...(范围.读 ?? 范围.写)])].filter((id) => id !== 无人) };
}

export type 看板的人 = {
  /** 选了看哪一个人；undefined = 看「全部」（全部 = 谁） */
  只看?: string;
  /** 这次数哪些负责人的：选了人 = [只看]；全部 = 能选的这些人；undefined = 不限（老板、总管理员看全部，或不是企业版） */
  谁?: readonly string[];
  /** 下拉里的人（同名带邮箱）；null = 不给选（业务员、能选的只有自己、不是企业版） */
  选项: { value: string; label: string }[] | null;
};

/** 复盘页、首页卡这一次按谁算。管理层默认看全部（10-29 定稿） */
export async function 看板的人(user: { id: string; role: string }, 要看?: string | null): Promise<看板的人> {
  if (!企业版()) return { 选项: null };
  const { 管理层, 全看, 可选 } = 看板范围of(await 读组织(), user.role, user.id);
  if (!管理层) return { 只看: user.id, 谁: [user.id], 选项: null };
  const 只看 = 要看 && 可选.includes(要看) ? 要看 : undefined;
  const 谁 = 只看 ? [只看] : 全看 ? undefined : 可选;
  if (可选.length <= 1) return { 只看, 谁, 选项: null };
  const users = await prisma.user.findMany({ where: { id: { in: 可选 } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  // 自己排第一个，管理层最常看的是自己和全部
  users.sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id));
  return { 只看, 谁, 选项: 成员选项(users) };
}
