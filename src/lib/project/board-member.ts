import { prisma } from "@/lib/prisma";
import { 成员选项 } from "@/lib/utils";
import { 企业版 } from "@/lib/enterprise/switch";
import { 读组织, type 组织 } from "@/lib/enterprise/org";
import { 组织范围of } from "@/lib/enterprise/visibility";

/**
 * 企业版复盘页（任务 / 卡点 / 沟通 / 数据四个页签）、首页指标卡按人看（P15，10-29 定稿；11-01 改成和项目列表同一条范围）。
 *
 * 数谁负责的项目 = 项目列表按负责人能看到的那一圈（lib/enterprise/visibility.ts 组织范围of，同一个函数，只认业务角色）：
 *   - 总管理、管理员（业务角色）：看全部人，默认「全部」
 *   - 别人：自己 + 实线下属整条链 + 虚线下属（按业务线筛过）；没有下属的最下级只有自己
 *   - 没设业务角色：谁都不数（不兜底）
 * 项目列表里另外两种「看得到」不算进复盘：公海里的项目（为了能领）、组员 / 市场只读看到的同事项目。
 * 复盘只按负责人数，取数那层按 ownerId in 谁 筛（公海里的各页签另外排除）。
 * 选的人不在能选的里面（改了地址栏、人调走了）就当没选，看他能看的全部。
 */

const 无人 = "__无";

/**
 * 纯函数（测试直接用）：复盘按哪些负责人数。null = 全部人（总管理、管理员）；[] = 谁都不数（没设业务角色）。
 * 和项目列表用同一个 组织范围of（读 ?? 写），不另写一套
 */
export function 复盘负责人of(org: 组织, 我: string): string[] | null {
  const 范围 = 组织范围of(org, null, 我);
  if (!范围) return null;
  return [...new Set(范围.读 ?? 范围.写)].filter((id) => id !== 无人);
}

/** 纯函数（测试直接用）：能不能选人、能不能看全部、能选看谁（id，含自己）。账号角色不看（11-01 只认业务角色） */
export function 看板范围of(org: 组织, _账号角色: string | null, 我: string): { 管理层: boolean; 全看: boolean; 可选: string[] } {
  const 人们 = 复盘负责人of(org, 我);
  if (!人们) return { 管理层: true, 全看: true, 可选: [...new Set([我, ...org.成员.keys()])] };
  return { 管理层: 人们.length > 1, 全看: false, 可选: 人们 };
}

export type 看板的人 = {
  /** 选了看哪一个人；undefined = 看「全部」（全部 = 谁） */
  只看?: string;
  /** 这次数哪些负责人的：选了人 = [只看]；全部 = 能选的这些人；[] = 谁都不数（没设业务角色）；undefined = 不限（总管理、管理员看全部，或不是企业版） */
  谁?: readonly string[];
  /** 下拉里的人（同名带邮箱）；null = 不给选（业务员、能选的只有自己、不是企业版） */
  选项: { value: string; label: string }[] | null;
};

/** 复盘页、首页卡这一次按谁算。管理层默认看全部（10-29 定稿） */
export async function 看板的人(user: { id: string; role: string }, 要看?: string | null): Promise<看板的人> {
  if (!企业版()) return { 选项: null };
  const { 管理层, 全看, 可选 } = 看板范围of(await 读组织(), user.role, user.id);
  if (!可选.length) return { 谁: [], 选项: null };
  if (!管理层) return { 只看: user.id, 谁: [user.id], 选项: null };
  const 只看 = 要看 && 可选.includes(要看) ? 要看 : undefined;
  const 谁 = 只看 ? [只看] : 全看 ? undefined : 可选;
  if (可选.length <= 1) return { 只看, 谁, 选项: null };
  const users = await prisma.user.findMany({ where: { id: { in: 可选 } }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  // 自己排第一个，管理层最常看的是自己和全部
  users.sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id));
  return { 只看, 谁, 选项: 成员选项(users) };
}
