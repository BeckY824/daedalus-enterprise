import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getBusiness } from "@/lib/business";
import ProjectWizard from "./ProjectWizard";
import { 建档向导数据 } from "./wizard-data";

/** 企业版从「新线索」页进来走 /leads/new（10-27）：同一个向导，标题叫「新线索」、左栏亮「新线索」 */
export async function 建档页(新线索 = false) {
  const me = await requireUser();
  if ((await getBusiness()).projectMode !== true) notFound();
  const 数据 = await 建档向导数据(me);
  return <ProjectWizard users={数据.users} 要下一步={数据.要下一步} 企业={数据.企业} 新线索={新线索} />;
}
