import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { 企业版 } from "@/lib/enterprise/switch";
import { 权限组织 } from "@/lib/enterprise/org";
import { 是系统管理员, 只读角色, 只看的人, 只看某人话, 只读话of } from "@/lib/enterprise/permissions";
import { 疑似重复页, 已标的对, 清单空页 } from "@/lib/enterprise/dupe-groups";
import DupesView from "./DupesView";

export const dynamic = "force-dynamic";

/**
 * 「疑似重复」清单（12-15 第三批 C，P-合并-06）：同名客户每组一行，逐组点「合并」或「不是同一个人」，标过的不再列；另一栏「已标不是同一个人」可撤销。
 * 口径、谁看哪些组在 lib/enterprise/dupe-groups.ts（负责人只看自己名下有份的组，系统管理员看全部；公海组是 12-15 D 加的、只系统管理员有：?tab=pool）。只在企业版有。
 * 入口：客户列表页头「疑似重复」、客户详情顶上「还有 N 家客户和这位同名」。
 * 只读身份（只读管理员、销售教练、设了「只看某人」；切换视图在看别人由界面按 useViewAs 判）：清单照看，按钮置灰写原因；服务端 dupe-groups 本来就拦
 */
export default async function DupesPage({ searchParams }: { searchParams: Promise<{ page?: string; tab?: string }> }) {
  const [me, sp] = await Promise.all([requireUser(), searchParams]);
  if (!企业版()) notFound();
  const org = await 权限组织();
  if (!org) notFound();
  const 只读原因 = 只读角色(me, org) ? 只读话of(me, org) : 只看的人(org, me.id) ? 只看某人话 : null;
  const 看已标 = sp.tab === "marked";
  // 公海组一栏只有系统管理员有；别的角色带 tab=pool 进来当普通栏看（疑似重复页里公海组本来就只给管理员）
  const 栏 = sp.tab === "pool" && 是系统管理员(me, org) ? "公海" as const : "普通" as const;
  const [清单, 已标] = await Promise.all([
    // 「已标」页签不成组（建议 3）：只要「管」一个字段
    看已标 ? Promise.resolve(清单空页(me, org)) : 疑似重复页(prisma, me, org, Number(sp.page) || 1, 栏),
    看已标 ? 已标的对(prisma, me, org) : Promise.resolve(null),
  ]);
  return <DupesView 清单={清单} 已标={已标} 只读原因={只读原因} 栏={栏} />;
}
