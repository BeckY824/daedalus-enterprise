import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma, defaultClient } from "@/lib/prisma";
import { recordAudit } from "@/lib/audit";
import { 看全部 } from "@/lib/team-scope";
import { 列附件, 存附件, 清孤儿 } from "@/lib/attachments";
import { 附件上限字节, 每条最多, 超限说明, 规整文件名, 读大小, 不收说明 } from "@/lib/attachment-rules";
import { 读归属, 认父记录 } from "./access";
import { 企业版 } from "@/lib/enterprise/switch";
import { 是附件分类 } from "@/lib/enterprise/customer-v2";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 商机的附件（2026-10-22 D-24），企业版还有线索 / 联系人（联系人附件 10-28）。这一版只收图片（不是图片回 415，见 attachment-rules 只收图片）。
 *   GET  ?opportunityId=|leadId=|contactId=  → { 附件: [...] }
 *   POST ?opportunityId=|leadId=|contactId=&name=&w=&h=  body = 文件原始字节（图片在界面上已经压过），Content-Type = 文件类型
 * 取文件、删除在 [id]/route.ts。
 * 企业版联系人附件分两格（2026-10-29 定稿 P5 第 24 条）：再带 &tag=名片|相册。GET 只列这一格（相册连没分类的老附件），
 * POST 记上这一格。别的父记录、个人版不认 tag（带了也不管）
 */

/** 这次请求认的分类：企业版、挂在联系人上、且是 名片 / 相册 之一；否则 null。带了认不出的值 → 错 */
function 读分类(q: URLSearchParams, 挂在: object): { 值: string | null } | { 错: string } {
  const t = q.get("tag");
  if (!t || !企业版() || !("contactId" in 挂在)) return { 值: null };
  return 是附件分类(t) ? { 值: t } : { 错: "附件分类不对" };
}

const 不存 = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const 我 = await getCurrentUser();
  if (!我) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const 挂在 = 读归属(new URL(req.url).searchParams);
  if (!挂在) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const 父 = await 认父记录(挂在, false);
  if ("错" in 父) return NextResponse.json({ error: 父.错 }, { status: 父.状态 });
  // 顺手清一下孤儿（一小时最多一次）：看全部——业务员看不到的商机不等于没了
  void 看全部(() => 清孤儿(defaultClient));
  const 分类 = 读分类(new URL(req.url).searchParams, 挂在);
  if ("错" in 分类) return NextResponse.json({ error: 分类.错 }, { status: 400 });
  return NextResponse.json({ 附件: await 列附件(prisma, 挂在, undefined, 分类.值) }, { headers: 不存 });
}

/** 读请求体，超过上限就不读了：回 超了 = 读到的字节数（至少超了这么多） */
async function 读体(req: Request): Promise<Uint8Array | { 超了: number } | null> {
  if (!req.body) return null;
  const 读 = req.body.getReader();
  const 块们: Uint8Array[] = [];
  let 共 = 0;
  for (;;) {
    const { done, value } = await 读.read();
    if (done) break;
    共 += value.byteLength;
    if (共 > 附件上限字节) { await 读.cancel().catch(() => undefined); return { 超了: 共 }; }
    块们.push(value);
  }
  if (!共) return null;
  const 体 = new Uint8Array(共);
  let i = 0;
  for (const b of 块们) { 体.set(b, i); i += b.byteLength; }
  return 体;
}

const 整数 = (s: string | null) => {
  const n = Number(s);
  return s && Number.isInteger(n) && n > 0 && n < 100000 ? n : null;
};

export async function POST(req: Request) {
  const 我 = await getCurrentUser();
  if (!我) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const q = new URL(req.url).searchParams;
  const 挂在 = 读归属(q);
  if (!挂在) return NextResponse.json({ error: "参数不对" }, { status: 400 });
  const 分类 = 读分类(q, 挂在);
  if ("错" in 分类) return NextResponse.json({ error: 分类.错 }, { status: 400 });
  const 名 = 规整文件名(q.get("name") ?? "");
  // 先看它自己报的大小：超了直接说超了多少，不用等传完
  const 说的 = Number(req.headers.get("content-length") ?? 0);
  const 超 = 超限说明(名, 说的);
  if (超) return NextResponse.json({ error: 超 }, { status: 413 });
  const mime = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
  const 不收 = 不收说明(名, mime);
  if (不收) return NextResponse.json({ error: 不收 }, { status: 415 });

  const 父 = await 认父记录(挂在, true);
  if ("错" in 父) return NextResponse.json({ error: 父.错 }, { status: 父.状态 });
  if (await prisma.attachment.count({ where: 挂在 }) >= 每条最多) {
    return NextResponse.json({ error: `一条最多挂 ${每条最多} 张图片，先删掉几张不要的` }, { status: 400 });
  }

  const 体 = await 读体(req);
  if (!体) return NextResponse.json({ error: `「${名}」是空文件` }, { status: 400 });
  if ("超了" in 体) return NextResponse.json({ error: `「${名}」超过 ${读大小(附件上限字节)}，传不上去` }, { status: 413 });

  const a = await 存附件(prisma, { 挂在, name: 名, mime, 字节: 体, width: 整数(q.get("w")), height: 整数(q.get("h")), userId: 我.id, tag: 分类.值 });
  await recordAudit({ user: 我, action: "create", entity: "Attachment", entityId: a.id, summary: `给${父.叫法}加了${分类.值 ? `${分类.值}「${名}」` : `图片「${名}」`}（${读大小(a.size)}）`, detail: { ...挂在, 名字: 名, 大小: a.size, ...(分类.值 ? { 分类: 分类.值 } : {}) } });
  return NextResponse.json({ 附件: a }, { headers: 不存 });
}
