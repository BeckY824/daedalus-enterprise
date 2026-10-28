import { redirect } from "next/navigation";
import { 企业版只用项目 } from "@/lib/enterprise/project-only";

/** 企业版只用项目（2026-10-28）：订单一览、订单详情、老书签都去项目页，同 /opportunities */
export default async function OrdersLayout({ children }: { children: React.ReactNode }) {
  if (await 企业版只用项目()) redirect("/projects");
  return children;
}
