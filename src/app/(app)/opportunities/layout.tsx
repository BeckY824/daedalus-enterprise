import { redirect } from "next/navigation";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";

/**
 * 企业版只用项目（10-26）：没有商机这一页，旧书签、跟进里的老链接都转到项目。
 * 商机列表和商机管道两页都在这一层下面，一处拦住；个人版、团队版直接放行
 */
export default async function OpportunitiesLayout({ children }: { children: React.ReactNode }) {
  if (await 企业版只用项目()) redirect("/projects");
  return children;
}
