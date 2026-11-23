"use server";

/**
 * 「挂靠申请」页「重复咨询待补建」一栏的两颗键（lib/enterprise/repeat-unbuilt.ts）：补建、不补建。
 * 谁能点在 repeat-unbuilt.ts 能管待补建 里判（这条线的销售管理、总管理、系统管理员）；没业务角色、只读管理员不行
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { 不在了 } from "@/lib/not-there";
import { 权限组织 } from "@/lib/enterprise/org";
import { 没设业务角色 } from "@/lib/enterprise/permissions";
import { 挂靠页 } from "@/lib/enterprise/attach-approval";
import { 补建待补建记录, 不补建待补建记录, type 补建结果 } from "@/lib/enterprise/repeat-unbuilt";

const 没角色 = { ok: false as const, error: "你还没有业务角色，不能改数据，请找总管理设置" };

/** 补建：指定 = 前两步挑不到人时销售管理手选的那位（回 要手选 才会带） */
export async function 补建待补建(键: string, 指定?: string | null): Promise<补建结果> {
  try {
    const me = await requireUser();
    if (没设业务角色(await 权限组织(), me.id)) return 没角色;
    const r = await 补建待补建记录(me, 键, 指定 ?? undefined);
    revalidatePath(挂靠页);
    if (!r.ok) return r;
    // 补成了：项目、线索列表和这位客户的详情页（新线索、沟通、客户状态都在上面）
    revalidatePath("/projects");
    revalidatePath("/leads");
    if ("客户id" in r) revalidatePath(`/customers/${r.客户id}`);
    return { ok: true, 提示: r.提示 };
  } catch (e) { return 不在了(e); }
}

export async function 不补建待补建(键: string, 原因: string): Promise<{ ok: true; 提示: string } | { ok: false; error: string; 刷新?: true }> {
  try {
    const me = await requireUser();
    if (没设业务角色(await 权限组织(), me.id)) return 没角色;
    const r = await 不补建待补建记录(me, 键, 原因);
    revalidatePath(挂靠页);
    return r;
  } catch (e) { return 不在了(e); }
}
