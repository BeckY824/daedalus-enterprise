/**
 * 企业版联系人附件（2026-10-28，migrations/062、063）。
 *
 * 钉的是：
 *   - 企业版：?leadId= / ?contactId= 传、列、取、删都通；线索 / 联系人不在了 404；只读客户（互看同事的、虚线下属的）不能传不能删、照样能看
 *   - 线索转客户：线索上的附件补挂到新建的联系人上（leadId 留着）；并进老客户：挂到电话对得上的那位
 *   - 清孤儿：线索删了、联系人还在 → 不动；两边都不在 → 先不动，满 1 天才删
 *   - 导出：含联系人时数联系人和挂在已转化线索上的；不含时没有这一项；「联系人 N 张」
 *   - 项目页联系人那一行的入口（联系人附件入口）：个数跟库里一样，只读客户只给看
 *   - 开关关着（个人版、团队版）：leadId / contactId 参数一律 400，转客户不补 contactId，项目页没有入口
 * 真库、不 mock 身份的越权用例在 contact-attachments-scope.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "QA", email: "qa-catt", role: "ADMIN", title: "管理员", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
  只读: new Set<string>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/app/(app)/leads/LeadsView", () => ({ default: function LeadsView() { return null; } }));
vi.mock("@/app/(app)/projects/ProjectsView", () => ({ default: function ProjectsView() { return null; } }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: false }) };
});
// 只读客户靠团队名单认，这里直接给一份「同事的客户」名单，只钉附件接口挡不挡
vi.mock("@/lib/team-scope", async (原) => {
  const m = await 原<typeof import("@/lib/team-scope")>();
  return { ...m, 同事的客户: async (_db: unknown, id: string) => mocks.只读.has(id), 只读话: async () => "这位客户只能看，不能改" };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 客户附件个数, 清孤儿, 附件文件 } from "@/lib/attachments";
import { GET as 列, POST as 传 } from "@/app/api/attachments/route";
import { GET as 取, DELETE as 删 } from "@/app/api/attachments/[id]/route";
import { convertLead, mergeLeadInto, saveLead } from "@/app/(app)/leads/actions";
import { 附件个数说法 } from "@/app/(app)/customers/export-table";
import { 联系人附件入口 } from "@/app/api/attachments/access";

const 目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-catt-"));
process.env.CRM_DATA_DIR = 目录;
const 附件夹 = path.join(目录, "attachments");

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const 传一个 = (q: string, 体: Uint8Array<ArrayBuffer>, 名字 = "名片.jpg") =>
  传(new Request(`http://x/api/attachments?${q}&name=${encodeURIComponent(名字)}`, {
    method: "POST",
    body: 体,
    headers: { "Content-Type": "image/jpeg", "Content-Length": String(体.byteLength) },
  }));
const 列出 = async (q: string) => (await (await 列(new Request(`http://x/api/attachments?${q}`))).json()) as { 附件: { id: string; name: string }[] };
const 带编号 = (id: string) => ({ params: Promise.resolve({ id }) });

let 我: string;
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  await prisma.attachment.deleteMany();
  fs.rmSync(附件夹, { recursive: true, force: true });
  mocks.只读.clear();
  我 = (await prisma.user.create({ data: { email: "qa-catt", name: "QA", role: "ADMIN", password: "unused" } })).id;
  mocks.user = { ...mocks.user, id: 我 };
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await prisma.attachment.deleteMany();
  await prisma.$disconnect();
  fs.rmSync(目录, { recursive: true, force: true });
  delete process.env.CRM_DATA_DIR;
});

const 线索 = (data: { phone?: string; contact?: string | null; email?: string | null } = {}) =>
  prisma.lead.create({ data: { name: "QA-名片线索", phone: "13900001111", contact: "QA-联系人", ownerId: 我, ...data } });

describe("企业版：线索、联系人上的附件", () => {
  it("线索上传两张、列出来、取回来字节一样、删一张", async () => {
    const l = await 线索();
    const 一 = await 传一个(`leadId=${l.id}`, 字节("正面"), "正面.jpg");
    const 二 = await 传一个(`leadId=${l.id}`, 字节("背面"), "背面.jpg");
    expect(一.status).toBe(200);
    expect(二.status).toBe(200);
    const 列表 = await 列出(`leadId=${l.id}`);
    expect(列表.附件.map((a) => a.name).sort()).toEqual(["正面.jpg", "背面.jpg"].sort());
    const 行 = await prisma.attachment.findMany({ where: { leadId: l.id } });
    expect(行).toHaveLength(2);
    expect(行.every((a) => a.contactId === null && a.opportunityId === null && a.orderId === null)).toBe(true);

    const 正面 = 行.find((a) => a.name === "正面.jpg")!;
    const r = await 取(new Request(`http://x/api/attachments/${正面.id}`), 带编号(正面.id));
    expect(r.status).toBe(200);
    expect(new TextDecoder().decode(await r.arrayBuffer())).toBe("正面");

    const d = await 删(new Request(`http://x/api/attachments/${正面.id}`, { method: "DELETE" }), 带编号(正面.id));
    expect(d.status).toBe(200);
    expect(fs.existsSync(附件文件(正面.id, 附件夹))).toBe(false);
    expect((await 列出(`leadId=${l.id}`)).附件.map((a) => a.name)).toEqual(["背面.jpg"]);
  });

  it("联系人上传、列、删；线索 / 联系人不在了 404；两个归属一起给 400", async () => {
    const c = await prisma.customer.create({ data: { name: "QA-客户", phone: "", salesOwnerId: 我 } });
    const p = await prisma.contact.create({ data: { name: "QA-张", customerId: c.id } });
    expect((await 传一个(`contactId=${p.id}`, 字节("卡"))).status).toBe(200);
    const 列表 = await 列出(`contactId=${p.id}`);
    expect(列表.附件).toHaveLength(1);
    expect((await 删(new Request("http://x", { method: "DELETE" }), 带编号(列表.附件[0].id))).status).toBe(200);
    expect((await 列出(`contactId=${p.id}`)).附件).toHaveLength(0);

    expect((await 传一个("contactId=cmissing0000000000", 字节("卡"))).status).toBe(404);
    expect((await 传一个("leadId=cmissing0000000000", 字节("卡"))).status).toBe(404);
    expect((await 列(new Request("http://x/api/attachments?leadId=cmissing0000000000"))).status).toBe(404);
    expect((await 传一个(`contactId=${p.id}&leadId=x`, 字节("卡"))).status).toBe(400);
  });

  it("只读客户的联系人、已转化线索：能看，不能传、不能删（403）", async () => {
    const c = await prisma.customer.create({ data: { name: "QA-同事的客户", phone: "", salesOwnerId: 我 } });
    const p = await prisma.contact.create({ data: { name: "QA-李", customerId: c.id } });
    const l = await 线索();
    await prisma.lead.update({ where: { id: l.id }, data: { customerId: c.id, status: "已转化" } });
    expect((await 传一个(`contactId=${p.id}`, 字节("卡"))).status).toBe(200);
    const id = (await 列出(`contactId=${p.id}`)).附件[0].id;

    mocks.只读.add(c.id);
    const 挡 = await 传一个(`contactId=${p.id}`, 字节("卡"));
    expect(挡.status).toBe(403);
    expect(((await 挡.json()) as { error: string }).error).toContain("只能看");
    expect((await 传一个(`leadId=${l.id}`, 字节("卡"))).status).toBe(403);
    expect((await 删(new Request("http://x", { method: "DELETE" }), 带编号(id))).status).toBe(403);
    expect((await 列出(`contactId=${p.id}`)).附件).toHaveLength(1);
    expect((await 取(new Request("http://x"), 带编号(id))).status).toBe(200);
  });

  it("新建线索 saveLead 回新线索的编号（名片原图靠它挂上去）", async () => {
    const r = await saveLead({ name: "QA-新线索", phone: "13900002222", contact: "QA-王", source: "官网注册", status: "待跟进" });
    if (!r.ok) throw Error(r.error);
    expect(r.id).toBeTruthy();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: r.id! } })).name).toBe("QA-新线索");
  });
});

describe("企业版：转客户、并进老客户", () => {
  it("转客户：附件补挂到新建的联系人上，leadId 留着；联系人页、线索页都列得到", async () => {
    const l = await 线索();
    await 传一个(`leadId=${l.id}`, 字节("正面"), "正面.jpg");
    await 传一个(`leadId=${l.id}`, 字节("背面"), "背面.jpg");
    const r = await convertLead(l.id);
    if (!r.ok) throw Error(r.error);
    const 联系人 = await prisma.contact.findFirstOrThrow({ where: { customerId: r.customerId } });
    const 行 = await prisma.attachment.findMany({ where: { leadId: l.id } });
    expect(行).toHaveLength(2);
    expect(行.every((a) => a.contactId === 联系人.id)).toBe(true);
    expect((await 列出(`contactId=${联系人.id}`)).附件).toHaveLength(2);
    expect((await 列出(`leadId=${l.id}`)).附件).toHaveLength(2);

    const 数 = await 客户附件个数(prisma, [r.customerId], true, true);
    expect(数.get(r.customerId)).toEqual({ 商机: 0, 订单: 0, 联系人: 2 });
    expect((await 客户附件个数(prisma, [r.customerId], true, false)).get(r.customerId)).toBeUndefined();
  });

  it("线索没写联系人就转：附件只留在线索上，导出按客户照样数到", async () => {
    const l = await 线索({ contact: null });
    await 传一个(`leadId=${l.id}`, 字节("卡"));
    const r = await convertLead(l.id);
    if (!r.ok) throw Error(r.error);
    expect((await prisma.attachment.findFirstOrThrow({ where: { leadId: l.id } })).contactId).toBeNull();
    expect((await 客户附件个数(prisma, [r.customerId], true, true)).get(r.customerId)?.联系人).toBe(1);
  });

  it("并进老客户：挂到电话对得上的那位联系人，不挂关键联系人", async () => {
    const c = await prisma.customer.create({ data: { name: "QA-老客户", phone: "13700000000", salesOwnerId: 我 } });
    const 关键 = await prisma.contact.create({ data: { name: "QA-关键", customerId: c.id, isPrimary: true, phone: "13600000000" } });
    const 对上 = await prisma.contact.create({ data: { name: "QA-对上", customerId: c.id, phone: "13700000000" } });
    const l = await 线索({ phone: "13700000000" });
    await 传一个(`leadId=${l.id}`, 字节("卡"));
    const r = await mergeLeadInto(l.id, c.id);
    if (!r.ok) throw Error(r.error);
    const a = await prisma.attachment.findFirstOrThrow({ where: { leadId: l.id } });
    expect(a.contactId).toBe(对上.id);
    expect(a.contactId).not.toBe(关键.id);
  });
});

describe("清孤儿", () => {
  it("线索删了、联系人还在：满 1 天也不删；两边都不在：先不动，满 1 天连文件删", async () => {
    const c = await prisma.customer.create({ data: { name: "QA-客户", phone: "", salesOwnerId: 我 } });
    const p = await prisma.contact.create({ data: { name: "QA-赵", customerId: c.id } });
    const l = await 线索();
    await 传一个(`leadId=${l.id}`, 字节("卡"));
    const 只挂线索 = await 传一个(`leadId=${l.id}`, 字节("卡二"));
    expect(只挂线索.status).toBe(200);
    const 行 = await prisma.attachment.findMany({ where: { leadId: l.id }, orderBy: { createdAt: "asc" } });
    await prisma.attachment.update({ where: { id: 行[0].id }, data: { contactId: p.id } });
    await prisma.lead.delete({ where: { id: l.id } });

    const 现在 = Date.now();
    await 清孤儿(prisma, 附件夹, 现在, true);
    expect(await prisma.attachment.count()).toBe(2);
    await 清孤儿(prisma, 附件夹, 现在 + 25 * 3600 * 1000, true);
    const 剩 = await prisma.attachment.findMany();
    expect(剩.map((a) => a.id)).toEqual([行[0].id]);
    expect(fs.existsSync(附件文件(行[0].id, 附件夹))).toBe(true);
    expect(fs.existsSync(附件文件(行[1].id, 附件夹))).toBe(false);

    // 联系人也删了：再满 1 天才删
    await prisma.contact.delete({ where: { id: p.id } });
    const 后来 = 现在 + 26 * 3600 * 1000;
    await 清孤儿(prisma, 附件夹, 后来, true);
    expect(await prisma.attachment.count()).toBe(1);
    await 清孤儿(prisma, 附件夹, 后来 + 25 * 3600 * 1000, true);
    expect(await prisma.attachment.count()).toBe(0);
  });
});

describe("导出", () => {
  it("附件个数说法带上联系人", () => {
    expect(附件个数说法({ 商机: 1, 订单: 0, 联系人: 2 })).toBe("商机 1 张、联系人 2 张");
    expect(附件个数说法({ 商机: 0, 订单: 0 })).toBe("");
  });
});

describe("企业版：项目页联系人附件入口", () => {
  it("个数跟库里一样；只读客户只给看；联系人不在了没有入口", async () => {
    const c = await prisma.customer.create({ data: { name: "QA-客户", phone: "", salesOwnerId: 我 } });
    const p = await prisma.contact.create({ data: { name: "QA-孙", customerId: c.id } });
    expect(await 联系人附件入口(p.id)).toEqual({ 个数: 0, 只读: false });
    await 传一个(`contactId=${p.id}`, 字节("一"));
    await 传一个(`contactId=${p.id}`, 字节("二"));
    expect(await 联系人附件入口(p.id)).toEqual({ 个数: 2, 只读: false });
    mocks.只读.add(c.id);
    expect(await 联系人附件入口(p.id)).toEqual({ 个数: 2, 只读: true });
    expect(await 联系人附件入口("nope-contact")).toBeNull();
  });
});

describe("开关关着（个人版、团队版）", () => {
  it("项目页没有联系人附件入口", async () => {
    const c = await prisma.customer.create({ data: { name: "QA-客户", phone: "", salesOwnerId: 我 } });
    const p = await prisma.contact.create({ data: { name: "QA-周", customerId: c.id } });
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 联系人附件入口(p.id)).toBeNull();
  });

  it("leadId / contactId 参数一律 400，转客户不补 contactId", async () => {
    const l = await 线索();
    // 开着时传一张，关掉再看
    await 传一个(`leadId=${l.id}`, 字节("卡"));
    const id = (await prisma.attachment.findFirstOrThrow({ where: { leadId: l.id } })).id;
    vi.unstubAllEnvs();
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await 传一个(`leadId=${l.id}`, 字节("卡"))).status).toBe(400);
    expect((await 列(new Request(`http://x/api/attachments?leadId=${l.id}`))).status).toBe(400);
    const c = await prisma.customer.create({ data: { name: "QA-客户", phone: "", salesOwnerId: 我 } });
    const p = await prisma.contact.create({ data: { name: "QA-钱", customerId: c.id } });
    expect((await 传一个(`contactId=${p.id}`, 字节("卡"))).status).toBe(400);
    // 库里已有的那张也取不到、删不掉
    expect((await 取(new Request("http://x"), 带编号(id))).status).toBe(404);
    expect((await 删(new Request("http://x", { method: "DELETE" }), 带编号(id))).status).toBe(404);

    const r = await convertLead(l.id);
    if (!r.ok) throw Error(r.error);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id } })).contactId).toBeNull();
    // 导出也不数
    expect((await 客户附件个数(prisma, [r.customerId], true, false)).get(r.customerId)).toBeUndefined();
  });
});
