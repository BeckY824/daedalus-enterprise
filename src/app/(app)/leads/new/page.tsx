import { 建档页 } from "../../projects/new/screen";

export const dynamic = "force-dynamic";

/** 企业版「新线索」页的新建：和 /projects/new 同一个向导，只是标题和左栏跟着新线索（10-27） */
export default async function NewLeadPage() {
  return 建档页(true);
}
