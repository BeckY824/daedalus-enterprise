import { prisma } from "@/lib/prisma";
import { 成员选项 } from "@/lib/utils";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织, 实线下属, 虚线下属, 管理员类别们of, type 组织 } from "@/lib/enterprise/org";
import { 组织范围of } from "@/lib/enterprise/visibility";
import { 规则开着 } from "@/lib/enterprise/rules";

/**
 * 企业版复盘页按成员看（P15）：管理层能选看哪个人，业务员只看自己的。
 *
 * 管理层 = 老板 / 主管（账号 ADMIN / MANAGER）、组织里有管理员类别的（总管理员 / 销售管理 / 市场管理）、或者手下有人（实线、虚线下属）。
 * 能选谁 = 数据那层本来就让他看得到的人，不另起一套范围：
 *   - 「按组织看客户」开着：组织范围of 的 读（没有就 写）；返回 null（老板、总管理员）= 组织里在职的全部人；
 *   - 没开：团队版那层只限业务员（lib/team-scope），老板 / 主管看全部 → 全部人；账号是业务员的只看得到自己。
 * 选的人不在能选的里面（改了地址栏、人调走了）就当没选，看他范围里的全部——查库那层照旧兜着，选了也看不到范围外的。
 */

const 无人 = "__无";

/** 纯函数（测试直接用）：是不是管理层、能选看谁（id，含自己） */
export function 看板范围of(org: 组织, 账号角色: string | null, 我: string, 按组织: boolean): { 管理层: boolean; 可选: string[] } {
  const 管理层 =
    账号角色 === "ADMIN" ||
    账号角色 === "MANAGER" ||
    管理员类别们of(org, 我).size > 0 ||
    实线下属(org, 我).size > 0 ||
    虚线下属(org, 我).size > 0;
  if (!管理层) return { 管理层, 可选: [我] };
  const 全部 = () => [...org.成员.keys()];
  if (!按组织) return { 管理层, 可选: 账号角色 === "ADMIN" || 账号角色 === "MANAGER" ? 全部() : [我] };
  const 范围 = 组织范围of(org, 账号角色, 我);
  if (!范围) return { 管理层, 可选: 全部() };
  return { 管理层, 可选: (范围.读 ?? 范围.写).filter((id) => id !== 无人) };
}

export type 看板的人 = {
  /** 只数这个人负责的项目；undefined = 看自己范围里的全部 */
  只看?: string;
  /** 下拉里的人（同名带邮箱）；null = 不给选（业务员、能选的只有自己、不是企业版） */
  选项: { value: string; label: string }[] | null;
};

/** 复盘页这一次按谁算。管理层默认看全部（待用户定：要不要默认看本人） */
export async function 看板的人(user: { id: string; role: string }, 要看?: string | null): Promise<看板的人> {
  if (!企业版()) return { 选项: null };
  const [org, 按组织] = await Promise.all([读组织(), 规则开着("按组织看客户")]);
  const { 管理层, 可选 } = 看板范围of(org, user.role, user.id, 按组织);
  if (!管理层) return { 只看: user.id, 选项: null };
  const 只看 = 要看 && 可选.includes(要看) ? 要看 : undefined;
  if (可选.length <= 1) return { 只看, 选项: null };
  const users = await prisma.user.findMany({ where: { id: { in: 可选 } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  // 自己排第一个，管理层最常看的是自己和全部
  users.sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id));
  return { 只看, 选项: 成员选项(users) };
}
