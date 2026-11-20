/**
 * 保存时项目按必填自动推了一格（lib/project/db.ts 按必填推进），给人的那一句（界面、AI 卡共用；不碰库，客户端也能引）。
 * 记沟通、改画像这类保存顺带把节点往前推了，不能悄悄推：每个入口推了都要说「推到了哪」（11-20）。
 *   - 项目上存的（记项目沟通、改项目字段……）回 自动推到：推到的节点名，一次一格
 *   - 客户上存的（客户页记沟通、完成计划、首页 AI 记沟通卡……走 saveFollowUp → 客户存了推项目）回 自动推进：推了哪几个项目、各推到哪
 */
export type 自动推进了 = { id: string; name: string; 到: string[] };

/** 一个项目推到了哪：「必填齐了，自动推进到 X」；给了项目名就带上（客户上存的，可能不是眼前这个项目） */
export function 自动推进话(到: readonly string[] | null | undefined, 项目名?: string): string | null {
  if (!到?.length) return null;
  return `${项目名 ? `项目「${项目名}」` : ""}必填齐了，自动推进到 ${到.join(" → ")}`;
}

/** 保存动作的返回里有 自动推到 / 自动推进 就给那句话，没有回 null（多个项目用「；」接） */
export function 自动推进话of(r: unknown): string | null {
  if (!r || typeof r !== "object") return null;
  const x = r as { 自动推到?: unknown; 自动推进?: unknown };
  if (Array.isArray(x.自动推到) && x.自动推到.length) return 自动推进话(x.自动推到.filter((v): v is string => typeof v === "string"));
  if (!Array.isArray(x.自动推进)) return null;
  const 句 = (x.自动推进 as Partial<自动推进了>[])
    .map((p) => 自动推进话(Array.isArray(p?.到) ? p.到 : null, typeof p?.name === "string" ? p.name : undefined))
    .filter((v): v is string => !!v);
  return 句.length ? 句.join("；") : null;
}
