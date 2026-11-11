/**
 * 公海操作按业务线（P-公海-07，X-34）：公海分配、撤销分配、标无效、恢复有效时，销管、条线总管理只能动本业务线的客户和项目；系统管理员不限。
 * 放公海不在这条里（P-公海-02）。
 *
 * 操作人限哪条线：不是系统管理员、自己设了业务线的，按自己的线；没设线不限。限的是动哪条线的客户、项目，接手人不限线（P-转-08，permissions.ts 公海分不给话）。
 * 客户 / 项目算哪条线：复用按线只读那份条件（line-viewer.ts 客户属线条件 / 项目属线条件）——先看业务线标签；
 * 标签空时按放进公海的历史负责人判（#201 的做法，曾由外贸的人放进来的算外贸，写不出「最近一次」）；标签空又从没进过公海的说不清，放行。
 *
 * 批量里混了别线的：整批不做，回一句点名哪几个不是本线（同 整批或不做 的风格），不悄悄跳过。
 */
import type { Prisma } from "@/generated/prisma";
import { prisma } from "../prisma";
import { 企业版 } from "./switch";
import { 是系统管理员, type 谁 } from "./permissions";
import type { 组织 } from "./org-core";
import type { 业务线 } from "@/lib/sync/dept-policy";
import { 客户属线条件, 客户说不清线, 项目属线条件, 项目说不清线 } from "./line-viewer";
import { 看全部 } from "@/lib/team-scope";

type 库 = Prisma.TransactionClient | typeof prisma;

/** 公海操作限哪条线：null = 不限（系统管理员、没设业务线、不是企业版） */
export function 公海操作限线(me: 谁, org: 组织 | null): 业务线 | null {
  if (!企业版() || !org || 是系统管理员(me, org)) return null;
  return org.成员.get(me.id)?.line ?? null;
}

const 外贸成员们 = (org: 组织): string[] => [...org.成员].filter(([, m]) => m.line === "外贸").map(([id]) => id);

export type 别线的 = { 客户: { id: string; name: string }[]; 项目: { id: string; name: string }[] };

/**
 * 这批客户、项目里哪些不是操作人这条线的。不限线的人回两个空数组。
 * 包 看全部：公海里的客户、项目对原负责人回避，范围限定着会查漏，漏了就等于放行
 */
export async function 公海别线的(
  db: 库, me: 谁, org: 组织 | null, ids: { 客户?: readonly string[]; 项目?: readonly string[] },
): Promise<别线的> {
  const 线 = 公海操作限线(me, org);
  const 客户ids = [...new Set(ids.客户 ?? [])];
  const 项目ids = [...new Set(ids.项目 ?? [])];
  if (!线 || !org || (!客户ids.length && !项目ids.length)) return { 客户: [], 项目: [] };
  const 外贸们 = 外贸成员们(org);
  // 正着查本线 / 说不清的，再拿全部去减：标签空时 bizLine = '内贸' 在 SQL 里是 NULL，套 NOT 会把这几行连带滤掉（等于放行）
  const 差 = <T extends { id: string }>(全: T[], 放行: { id: string }[]) => {
    const 行 = new Set(放行.map((x) => x.id));
    return 全.filter((x) => !行.has(x.id));
  };
  const [客户, 项目] = await 看全部(() => Promise.all([
    客户ids.length
      ? Promise.all([
          db.customer.findMany({ where: { id: { in: 客户ids } }, select: { id: true, name: true } }),
          db.customer.findMany({ where: { id: { in: 客户ids }, OR: [客户属线条件(线, 外贸们), 客户说不清线] }, select: { id: true } }),
        ]).then(([全, 放行]) => 差(全, 放行))
      : Promise.resolve([]),
    项目ids.length
      ? Promise.all([
          db.project.findMany({ where: { id: { in: 项目ids } }, select: { id: true, name: true } }),
          db.project.findMany({ where: { id: { in: 项目ids }, OR: [项目属线条件(线, 外贸们), 项目说不清线] }, select: { id: true } }),
        ]).then(([全, 放行]) => 差(全, 放行))
      : Promise.resolve([]),
  ]));
  return { 客户, 项目 };
}

/** 整批拦下时的话：点名前 5 个，多的说个数 */
export function 别线话(别: 别线的, 线: 业务线 | null, 动作: string): string | null {
  const 名们 = [...别.客户.map((x) => `「${x.name}」`), ...别.项目.map((x) => `项目「${x.name}」`)];
  if (!名们.length) return null;
  const 点名 = 名们.slice(0, 5).join("、") + (名们.length > 5 ? ` 等 ${名们.length} 个` : "");
  return `${点名}不是${线 ? `${线}线` : "你这条业务线"}的，只能${动作}本业务线的客户和项目，整批没有${动作}`;
}

/** 一步到位：有别线的回那句话，全是本线（或不限线）回 null */
export async function 公海按线拦(
  db: 库, me: 谁, org: 组织 | null, ids: { 客户?: readonly string[]; 项目?: readonly string[] }, 动作: string,
): Promise<string | null> {
  const 线 = 公海操作限线(me, org);
  if (!线) return null;
  return 别线话(await 公海别线的(db, me, org, ids), 线, 动作);
}
