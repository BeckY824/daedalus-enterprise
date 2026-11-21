import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import { 企业版 } from "@/lib/enterprise/switch";
import ProjectDetail from "./ProjectDetail";
import SameNumberBanner from "./SameNumberBanner";
import { 读项目详情, 项目页去向 } from "./load";
import { 客户页项目地址 } from "@/lib/project/customer-detail-href";
import { 放弃参数, 带放弃参数 } from "@/lib/enterprise/lead-giveup-core";
import { GiveUpGone } from "./GiveUpBanner";

export const dynamic = "force-dynamic";

/** 项目详情（团队版项目模式 1a）：改节点、勾尾款 / 验收、节点变更和挂在项目上的沟通。开关关着时不存在 */
export default async function ProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  const [{ id }, sp = {}] = await Promise.all([params, searchParams]);
  // 从通知点「放弃（豁免）」来的（?giveup=1，11-21）：跳客户页时带过去；这条已经进不去了，说一句为什么，不落 404
  const 放弃来 = 企业版() && sp[放弃参数] === "1";
  const 带上 = (到: string) => (放弃来 ? 带放弃参数(到) : 到);
  // 先轻判断跳不跳（审查 #3）：跳去客户页的不读整份详情
  const 去 = await 项目页去向(me, id);
  if (去.种 === "无") return 放弃来 ? <GiveUpGone /> : notFound();
  if (去.种 === "转向") redirect(去.到);
  if (去.种 === "客户页") redirect(带上(去.到));
  const r = await 读项目详情(me, id);
  // 进不了的照原样：找不到 / 回避 404，市场成员已分出去的那条转回项目页高亮那一行（P-界面-11）
  if (r.种 === "无") return 放弃来 ? <GiveUpGone /> : notFound();
  if (r.种 === "转向") redirect(r.到);
  // 客户详情合并（11-12 第 2 批）：企业版里看得到客户、进得了客户详情的，项目详情就在客户详情的项目区里，跳过去停在这个项目的页签上。
  // 客户看不到的（只读卡、只露名字、公海里没领的同事客户）留在这页，照原样
  if (企业版() && r.露 && r.客户入口 === "详情") redirect(带上(客户页项目地址(r.customerId, id)));
  const { p } = r.props;
  return <>{企业版() && r.露 ? <SameNumberBanner projectId={p.id} /> : null}<ProjectDetail key={p.id} {...r.props} /></>;
}
