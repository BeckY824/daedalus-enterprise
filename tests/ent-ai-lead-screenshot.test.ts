/**
 * 首页对话框带截图建线索（11-18 员工反馈「录入的时候还是添加不了截图，销售负责人可以添加截图」）。
 *
 * 现场：录入人（市场，不是项目负责人）在首页对话框带一张截图说「新增客户 …」，AI 出一张新线索卡，
 * 指定分配给另一位销售，确认后截图没有任何地方存下来——
 *   - 前端：AskFiles 认完字就把图丢了（附件只留文字），卡片上也没有截图区
 *   - 服务端：建成项目（dashboard/apply.ts）调建档向导时不交 要传附件，不回首条附件票；
 *     录入人建好就不是负责人，按沟通附件的原规矩传不上（403）
 * 修：卡上勾了「存成这条线索的附件」，确认时 applyProposal 交 首条附件，建成项目照建档向导同一套签首条附件票给录入人，
 *     浏览器凭票把截图原件传到这条新线索的首条沟通上。票只认录入人 + 这条首条沟通，旁人拿着 403、别的沟通 403（不放宽原规矩）。
 * 号码全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "t", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/card-scan/ocr", () => ({
  切成块: async (f: Blob) => ({ 块们: [f], 截了: false }),
  认图里的字: async () => [{ text: "咨询大空间开店", score: 0.9, side: 0, cx: 10, cy: 10, w: 80, h: 20 }],
}));
vi.mock("@/lib/card-scan/cloud", () => ({ 走网页登录: () => undefined, 服务器预热: async () => true }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { applyProposal } from "@/app/(app)/dashboard/apply";
import { POST as 传 } from "@/app/api/attachments/route";
import { 首条附件票头 } from "@/lib/attachment-rules";
import { 读一个 } from "@/components/AskFiles";
import { 记下对话截图, 对话截图 } from "@/lib/card-scan/originals";

const 附件夹 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-aishot-"));
const 原数据夹 = process.env.CRM_DATA_DIR;
process.env.CRM_DATA_DIR = 附件夹;
afterAll(async () => {
  if (原数据夹 === undefined) delete process.env.CRM_DATA_DIR;
  else process.env.CRM_DATA_DIR = 原数据夹;
  fs.rmSync(附件夹, { recursive: true, force: true });
  await prisma.$disconnect();
});

let 录入: string, 销售: string, 旁人: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };
let 序 = 0;
/** 现场那张卡：指定分配给另一位销售 */
const 卡 = (补: Record<string, unknown> = {}) => ({
  id: `p${++序}`, kind: "add_lead" as const, customerId: "", customerName: "", reason: "测试",
  name: "大空间开店客户", contact: "", phone: "13500000001", source: "展会", status: "待跟进", remark: "",
  分配方式: 0, ownerId: 销售, 业务线: "内贸", 节点: "潜客培育", ...补,
});

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  忘掉企业版范围();
  await setSetting("business", { projectMode: true });
  const 人 = async (email: string, bizRole: string, role = "SALES") => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  录入 = await 人("shot-a", "marketing_mgr");
  销售 = await 人("shot-b", "sales");
  旁人 = await 人("shot-c", "sales");
  const 老板 = await 人("shot-boss", "director", "ADMIN");
  await prisma.channel.create({ data: { name: "展会", channelOwnerId: 老板 } });
  当(录入);
});
afterEach(() => { vi.unstubAllEnvs(); });

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
function 传一个(followUpId: string, 票?: string) {
  const 体 = 字节("\x89PNG 截图");
  const headers: Record<string, string> = { "Content-Length": String(体.byteLength), "Content-Type": "image/png" };
  if (票) headers[首条附件票头] = 票;
  return 传(new Request(`http://x/api/attachments?followUpId=${followUpId}&name=${encodeURIComponent("微信截图.png")}`, { method: "POST", body: 体, headers }));
}

describe("新线索卡带截图：确认时给录入人签首条附件票", () => {
  it("市场录入、指定分配给别的销售：回首条附件票，凭票把截图挂到新线索的首条沟通；不带票、旁人拿票 403", async () => {
    const r = await applyProposal(卡() as never, { 首条附件: true });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok || !r.首条附件票) throw new Error("没回首条附件票");
    const { followUpId, 票 } = r.首条附件票;
    // 项目归指定的销售，首条沟通是录入人记的、挂在这个项目上
    const 挂 = await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId }, include: { project: true } });
    expect(挂.project.ownerId).toBe(销售);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } })).ownerId).toBe(录入);

    // 原规矩不放宽：录入人不是负责人，不带票传不上
    expect((await 传一个(followUpId)).status).toBe(403);
    const 成 = await 传一个(followUpId, 票);
    expect(成.status).toBe(200);
    const a = ((await 成.json()) as { 附件: { id: string } }).附件;
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ followUpId, userId: 录入 });
    // 旁人拿着这张票：不认
    当(旁人);
    expect((await 传一个(followUpId, 票)).status).toBe(403);
    // 销售负责人看得到这张截图（原规矩：负责人能看沟通附件）
    expect(await prisma.attachment.count({ where: { followUpId } })).toBe(1);
  });

  it("没勾（不交 首条附件）：不回票", async () => {
    const r = await applyProposal(卡() as never);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r).not.toHaveProperty("首条附件票");
    const r2 = await applyProposal(卡({ phone: "13500000002" }) as never, { 首条附件: false });
    expect(r2).not.toHaveProperty("首条附件票");
  });
});

describe("对话框带的截图：留着原件，确认建线索时才传", () => {
  it("认图之后附件里还带着原图（只在内存里，发给模型的仍只有字）", async () => {
    const 图 = new File([new Uint8Array(64)], "微信截图.png", { type: "image/png" });
    const r = await 读一个(图);
    if ("错" in r) throw new Error(r.错);
    expect(r.附件.图).toBe(true);
    expect(r.附件.原件).toBe(图);
    expect(r.附件.text).toContain("咨询大空间开店");
  });

  it("按这一问记下截图原件；看一眼不取走（同一轮卡重挂还在）；别的问没有", () => {
    const 图 = new File([new Uint8Array(8)], "a.png", { type: "image/png" });
    记下对话截图("t1", [图]);
    expect(对话截图("t1")).toEqual([图]);
    expect(对话截图("t1")).toEqual([图]);
    expect(对话截图("t2")).toEqual([]);
    记下对话截图("t3", []);
    expect(对话截图("t3")).toEqual([]);
  });
});
