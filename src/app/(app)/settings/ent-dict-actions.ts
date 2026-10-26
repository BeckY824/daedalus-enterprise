"use server";
/**
 * 企业版选项字典的写操作（2026-10-26）：加、改名、停用 / 启用。谁能改、规矩都在 lib/enterprise/dict.ts，这里只留痕、刷新设置页
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { 不在了 } from "@/lib/not-there";
import { 加字典项, 改字典项, 字典定义, type 字典种类 } from "@/lib/enterprise/dict";

export async function 加企业选项(kind: 字典种类, name: string) {
  try {
    const me = await requireUser();
    const r = await 加字典项(me, kind, name);
    if (r.ok) {
      await recordAudit({ user: me, action: "create", entity: "EntDictItem", entityId: r.id, summary: `加了${字典定义[kind].名}「${String(name).trim()}」` });
      revalidatePath("/settings");
    }
    return r;
  } catch (e) { return 不在了(e); }
}

export async function 改企业选项(id: string, patch: { name?: string; active?: boolean }) {
  try {
    const me = await requireUser();
    const r = await 改字典项(me, id, patch ?? {});
    if (r.ok && r.kind) {
      const 做了 = patch.active === false ? "停用" : patch.active === true ? "启用" : "改名";
      await recordAudit({
        user: me, action: "update", entity: "EntDictItem", entityId: id,
        summary: `${做了}${字典定义[r.kind].名}「${r.原名 ?? ""}」${patch.name ? ` → 「${String(patch.name).trim()}」` : ""}`,
      });
      revalidatePath("/settings");
    }
    return r.ok ? { ok: true as const } : r;
  } catch (e) { return 不在了(e); }
}
