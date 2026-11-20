"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 放弃线索, type 放弃结果 } from "@/lib/enterprise/lead-giveup";

/**
 * 项目页「放弃（豁免）」（32H，lib/enterprise/lead-giveup.ts）：负责人本人点，原因必填；能不能点、挑人、扣次数、待补、通知都在 放弃线索 里。
 * 成了刷新项目、客户页（线索已经不在他名下）
 */
export async function 放弃线索Action(projectId: string, 原因: string, 补充?: string): Promise<放弃结果> {
  const me = await requireUser();
  const r = await 放弃线索(me, String(projectId ?? ""), 原因, 补充 ?? null);
  if (r.ok) {
    revalidatePath("/projects");
    revalidatePath(`/projects/${projectId}`);
    revalidatePath("/customers");
  }
  return r;
}
