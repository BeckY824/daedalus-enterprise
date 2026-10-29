import { prisma } from "../prisma";
import { 查完再写 } from "../check-then-write";
import { 企业版 } from "@/lib/enterprise/switch";
import { 可选项, 选的原因 } from "@/lib/enterprise/dict";
import { 项目画像项, type 项目画像键 } from "@/lib/enterprise/dict-kinds";
import { 能管项目 } from "./db";
import { 读产品需求, 存产品需求 } from "./profile-rules";

type 谁 = { id: string; role: string };

/** 改画像传的：五项，没传的不动；单选传 null / 空 = 清掉，多选传 [] = 清掉 */
export type 画像改动 = Partial<Record<Exclude<项目画像键, "productNeeds">, string | null>> & { productNeeds?: string[] | null };
export type 画像字段 = 项目画像键;

/**
 * 项目画像（企业版 P11，迁移 087）：预算能力、价格感知、决策链路、需求状态（单选）、产品需求（多选）。
 * 所在地（地址四格 + 详细地址）定稿 -2 版改成和客户地址一套，挪到「编辑项目」里（db.ts 改项目），不走这里。
 * 谁能改同 改项目：能管项目（负责人本人、老板、主管；公海里的先领取）。
 * 选项来自企业字典（设置 → 项目模式 里改）：新选的得是启用着的；已经存着、后来停用的那项不动它就留着（多选里也是），
 * 免得别人改了一项把停用的那项顺手抹掉。字典校验要读库，放在事务外（同 改项目 的 字段权限of）
 */
export async function 改项目画像(me: 谁, projectId: string, patch: 画像改动): Promise<{ ok: true; 变了: 画像字段[] } | { ok: false; error: string }> {
  if (!企业版()) return { ok: false, error: "此版本没有项目画像" };
  if (!patch || typeof patch !== "object") return { ok: false, error: "要改什么？" };
  const id = String(projectId ?? "");
  // 事务外先按可见范围读一遍：看不到的项目和不存在一样
  const 原 = await prisma.project.findFirst({ where: { id }, select: { budgetLevel: true, priceSense: true, decisionChain: true, demandStatus: true, productNeeds: true } });
  if (!原) return { ok: false, error: "这个项目已经不在了，刷新看看" };

  const 新: Partial<Record<画像字段, string | null>> = {};
  for (const 项 of 项目画像项) {
    if (!(项.键 in patch)) continue;
    if (项.多选) {
      const v = patch.productNeeds;
      if (v != null && (!Array.isArray(v) || v.some((x) => typeof x !== "string"))) return { ok: false, error: "产品需求要选列表里的项" };
      const 选的 = (v ?? []).map((x) => x.trim()).filter(Boolean);
      const 已有 = 读产品需求(原.productNeeds);
      const 能选 = await 可选项(项.种类);
      const 不认 = 选的.find((x) => !已有.includes(x) && !能选.includes(x));
      if (不认) return { ok: false, error: `「${不认}」不在产品需求里（可能刚被停用），刷新后再选` };
      新.productNeeds = 存产品需求(选的);
    } else {
      const v = (patch as Record<string, unknown>)[项.键];
      if (v != null && typeof v !== "string") return { ok: false, error: "要选列表里的项" };
      const t = typeof v === "string" ? v.trim() : "";
      // 没换（含停用了还留着的那项）原样留，不再对字典
      if (t && t === 原[项.键]) { 新[项.键] = t; continue; }
      const 对 = await 选的原因(项.种类, t);
      if (!对.ok) return 对;
      新[项.键] = 对.值;
    }
  }
  const 变了 = (Object.keys(新) as 画像字段[]).filter((k) => (新[k] ?? null) !== (原[k] ?? null));
  if (!变了.length) return { ok: true, 变了 };

  return 查完再写(async (tx) => {
    const p = await tx.project.findUnique({ where: { id }, select: { id: true, ownerId: true, pooledAt: true } });
    if (!p) return { ok: false as const, error: "这个项目已经不在了，刷新看看" };
    if (!能管项目(me, p)) return { ok: false as const, error: p.pooledAt ? "这个项目在公海里，先领取再改" : "只有项目负责人、老板或主管能改" };
    await tx.project.update({ where: { id }, data: Object.fromEntries(变了.map((k) => [k, 新[k] ?? null])) });
    return { ok: true as const, 变了 };
  });
}
