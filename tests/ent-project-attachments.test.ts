/**
 * 企业版项目附件（P11，10-29，迁移 086）。
 *
 * 钉的是：
 *   - 负责人：?projectId= 传（不限图片，合同、表格都行）、列、取、删都通；入口 = 合同、方案、其它各几个 + 能改（没打标签的算其它）
 *   - 分两格（10-31）：&tag=合同 记成合同、列合同只列合同；列其它连没打标签的；认不出的 tag 400
 *   - 节点必填配了「合同附件」：传合同附件那一下就推，回 自动推到；传别的不推
 *   - 项目方案（10-31，迁移 101 那批）：&tag=方案 记成方案、列方案只列方案、删了个数跟着减；同事只读传不了；
 *     节点必填配了「项目方案」：传方案那一下就推；只有合同附件不算
 *   - 老板：别人负责的项目也能传
 *   - 同事（看得到项目、不是负责人）：列、取 200；传、删 403，附件原样还在；入口只读
 *   - 公海里、同事客户的项目（客户信息不露）：列、取 403，入口 null
 *   - 项目不在了：传 404；项目模式关着：传 404、入口 null；不是企业版：projectId 参数 400、入口 null
 *   - 清孤儿：项目还在，项目附件不动
 * 「看得到哪些客户」这一层 mock 掉（真组织架构的范围在 contact-attachments-scope.test.ts 钉过），这里只钉附件接口按项目挡不挡
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "QA", email: "qa-patt", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
  项目模式: true,
  藏起来的客户: new Set<string>(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: mocks.项目模式 }) };
});
vi.mock("@/lib/project/db", async (原) => {
  const m = await 原<typeof import("@/lib/project/db")>();
  return { ...m, 看得到的客户: async (ids: string[]) => new Set(ids.filter((x) => !mocks.藏起来的客户.has(x))) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 清孤儿 } from "@/lib/attachments";
import { GET as 列, POST as 传 } from "@/app/api/attachments/route";
import { GET as 取, DELETE as 删 } from "@/app/api/attachments/[id]/route";
import { 项目附件入口 } from "@/app/api/attachments/access";

const 附件夹 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-patt-"));
const 原数据夹 = process.env.CRM_DATA_DIR;
process.env.CRM_DATA_DIR = 附件夹;
afterAll(() => {
  if (原数据夹 === undefined) delete process.env.CRM_DATA_DIR;
  else process.env.CRM_DATA_DIR = 原数据夹;
  fs.rmSync(附件夹, { recursive: true, force: true });
});

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
const 传一个 = (projectId: string, 名字 = "合同.pdf", 类型 = "application/pdf", tag = "") => {
  const 体 = 字节(`%PDF-1.4 ${名字}`);
  return 传(new Request(`http://x/api/attachments?projectId=${projectId}&name=${encodeURIComponent(名字)}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`, {
    method: "POST",
    body: 体,
    headers: { "Content-Type": 类型, "Content-Length": String(体.byteLength) },
  }));
};
const 列出 = (projectId: string, tag = "") => 列(new Request(`http://x/api/attachments?projectId=${projectId}${tag ? `&tag=${encodeURIComponent(tag)}` : ""}`));
const 带编号 = (id: string) => ({ params: Promise.resolve({ id }) });
const 取一个 = (id: string) => 取(new Request(`http://x/api/attachments/${id}`), 带编号(id));
const 删一个 = (id: string) => 删(new Request(`http://x/api/attachments/${id}`, { method: "DELETE" }), 带编号(id));
const 还在 = async (id: string) => !!(await prisma.attachment.findUnique({ where: { id } }));

let 老板: string, 乙: string, 丙: string, 客户id: string, 项目id: string;
const 作为 = (id: string, role: string) => { mocks.user = { ...mocks.user, id, role, name: id }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  mocks.项目模式 = true;
  mocks.藏起来的客户.clear();
  await resetDb();
  const 人 = async (email: string, role: string) => (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
  老板 = await 人("p11a-boss", "ADMIN");
  乙 = await 人("p11a-yi", "SALES");
  丙 = await 人("p11a-bing", "SALES");
  客户id = (await prisma.customer.create({ data: { name: "QA-附件客户", phone: "13800001086", salesOwnerId: 乙 } })).id;
  项目id = (await prisma.project.create({ data: { name: "QA-附件项目", customerId: 客户id, ownerId: 乙, creatorId: 乙 } })).id;
  作为(乙, "SALES");
});
afterEach(() => vi.unstubAllEnvs());

describe("企业版项目附件：看 = 看得到项目，传 / 删 = 能改项目", () => {
  it("负责人：传 pdf、列、取、删都通；入口跟着个数走、能改", async () => {
    const r = await 传一个(项目id);
    expect(r.status).toBe(200);
    const id = ((await r.json()) as { 附件: { id: string } }).附件.id;
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id } })).projectId).toBe(项目id);
    const 列表 = await 列出(项目id);
    expect(列表.status).toBe(200);
    expect(((await 列表.json()) as { 附件: unknown[] }).附件).toHaveLength(1);
    expect((await 取一个(id)).status).toBe(200);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 0, 方案: 0, 其它: 1, 只读: false });
    expect((await 删一个(id)).status).toBe(200);
    expect(await 还在(id)).toBe(false);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 0, 方案: 0, 其它: 0, 只读: false });
  });

  it("分两格：tag=合同 记成合同；列合同只列合同，列其它连没打标签的；认不出的 tag 400", async () => {
    expect((await 传一个(项目id, "合同.pdf", "application/pdf", "合同")).status).toBe(200);
    expect((await 传一个(项目id, "图纸.pdf")).status).toBe(200);
    expect((await 传一个(项目id, "报价.pdf", "application/pdf", "其它")).status).toBe(200);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 1, 方案: 0, 其它: 2, 只读: false });
    const 名们 = async (tag: string) => ((await (await 列出(项目id, tag)).json()) as { 附件: { name: string }[] }).附件.map((x) => x.name).sort();
    expect(await 名们("合同")).toEqual(["合同.pdf"]);
    expect(await 名们("其它")).toEqual(["图纸.pdf", "报价.pdf"].sort());
    expect((await 列出(项目id, "名片")).status).toBe(400);
    expect((await 传一个(项目id, "x.pdf", "application/pdf", "名片")).status).toBe(400);
  });

  it("节点必填配了「合同附件」：传别的不推；传合同附件那一下就推，回 自动推到", async () => {
    const { setSetting, invalidateSettingsCache } = await import("@/lib/settings");
    const { 默认组织规则 } = await import("@/lib/project/org-rules");
    const 节点 = async () => (await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).node;
    const 起 = await 节点();
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { [起]: ["合同附件"] } } });
    invalidateSettingsCache();
    const 别的 = (await (await 传一个(项目id, "图纸.pdf")).json()) as { 自动推到?: string[] };
    expect(别的.自动推到).toBeUndefined();
    expect(await 节点()).toBe(起);
    const 合同 = (await (await 传一个(项目id, "合同.pdf", "application/pdf", "合同")).json()) as { 自动推到?: string[] };
    expect(合同.自动推到?.length).toBeGreaterThan(0);
    expect(await 节点()).not.toBe(起);
  });

  it("项目方案：tag=方案 记成方案，列方案只列方案（不连没打标签的）；删了个数跟着减", async () => {
    expect((await 传一个(项目id, "合同.pdf", "application/pdf", "合同")).status).toBe(200);
    expect((await 传一个(项目id, "图纸.pdf")).status).toBe(200);
    const 一 = ((await (await 传一个(项目id, "方案一.pdf", "application/pdf", "方案")).json()) as { 附件: { id: string } }).附件.id;
    const 二 = ((await (await 传一个(项目id, "方案二.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "方案")).json()) as { 附件: { id: string } }).附件.id;
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: 一 } })).tag).toBe("方案");
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 1, 方案: 2, 其它: 1, 只读: false });
    const 名们 = async (tag: string) => ((await (await 列出(项目id, tag)).json()) as { 附件: { name: string }[] }).附件.map((x) => x.name).sort();
    expect(await 名们("方案")).toEqual(["方案一.pdf", "方案二.docx"].sort());
    expect(await 名们("其它")).toEqual(["图纸.pdf"]);
    expect(await 名们("合同")).toEqual(["合同.pdf"]);
    expect((await 删一个(一)).status).toBe(200);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 1, 方案: 1, 其它: 1, 只读: false });
    expect((await 删一个(二)).status).toBe(200);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 1, 方案: 0, 其它: 1, 只读: false });
  });

  it("项目方案：同事传、删都 403（照合同附件的权限）", async () => {
    const id = ((await (await 传一个(项目id, "方案.pdf", "application/pdf", "方案")).json()) as { 附件: { id: string } }).附件.id;
    作为(丙, "SALES");
    expect((await 列出(项目id, "方案")).status).toBe(200);
    expect((await 传一个(项目id, "我也传.pdf", "application/pdf", "方案")).status).toBe(403);
    expect((await 删一个(id)).status).toBe(403);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 0, 方案: 1, 其它: 0, 只读: true });
  });

  it("节点必填配了「项目方案」：只有合同附件不推；传项目方案那一下就推", async () => {
    const { setSetting, invalidateSettingsCache } = await import("@/lib/settings");
    const { 默认组织规则 } = await import("@/lib/project/org-rules");
    const 节点 = async () => (await prisma.project.findUniqueOrThrow({ where: { id: 项目id } })).node;
    const 起 = await 节点();
    await setSetting("orgRules", { ...默认组织规则, 节点推进: { 开: true, 必填: { [起]: ["项目方案"] } } });
    invalidateSettingsCache();
    const 合同 = (await (await 传一个(项目id, "合同.pdf", "application/pdf", "合同")).json()) as { 自动推到?: string[] };
    expect(合同.自动推到).toBeUndefined();
    expect(await 节点()).toBe(起);
    const 方案 = (await (await 传一个(项目id, "方案.pdf", "application/pdf", "方案")).json()) as { 自动推到?: string[] };
    expect(方案.自动推到?.length).toBeGreaterThan(0);
    expect(await 节点()).not.toBe(起);
  });

  it("老板：别人负责的项目也能传；表格之类不是图片的照收", async () => {
    作为(老板, "ADMIN");
    const r = await 传一个(项目id, "报价单.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.status).toBe(200);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 0, 方案: 0, 其它: 1, 只读: false });
  });

  it("同事：列、取得到；传、删 403，附件原样还在；入口只读", async () => {
    const id = ((await (await 传一个(项目id)).json()) as { 附件: { id: string } }).附件.id;
    作为(丙, "SALES");
    expect((await 列出(项目id)).status).toBe(200);
    expect((await 取一个(id)).status).toBe(200);
    const 传了 = await 传一个(项目id, "我也传.pdf");
    expect(传了.status).toBe(403);
    expect(((await 传了.json()) as { error: string }).error).toMatch(/项目负责人/);
    expect((await 删一个(id)).status).toBe(403);
    expect(await 还在(id)).toBe(true);
    expect(await 项目附件入口(项目id)).toEqual({ 合同: 0, 方案: 0, 其它: 1, 只读: true });
    expect(await prisma.attachment.count()).toBe(1);
  });

  it("公海里、同事客户的项目：客户信息不露，附件也列不出、取不到，入口 null", async () => {
    const id = ((await (await 传一个(项目id)).json()) as { 附件: { id: string } }).附件.id;
    await prisma.project.update({ where: { id: 项目id }, data: { pooledAt: new Date() } });
    mocks.藏起来的客户.add(客户id);
    作为(丙, "SALES");
    expect((await 列出(项目id)).status).toBe(403);
    expect((await 取一个(id)).status).toBe(403);
    expect((await 删一个(id)).status).toBe(403);
    expect(await 项目附件入口(项目id)).toBeNull();
    // 原负责人放回公海以后也只能看、不能传
    作为(乙, "SALES");
    mocks.藏起来的客户.clear();
    expect((await 传一个(项目id)).status).toBe(403);
    expect(await 还在(id)).toBe(true);
  });

  it("项目不在了 404；项目模式关着 404、入口 null；不是企业版参数 400、入口 null", async () => {
    expect((await 传一个("no-such-project")).status).toBe(404);
    mocks.项目模式 = false;
    expect((await 传一个(项目id)).status).toBe(404);
    expect((await 列出(项目id)).status).toBe(404);
    expect(await 项目附件入口(项目id)).toBeNull();
    mocks.项目模式 = true;
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect((await 传一个(项目id)).status).toBe(400);
    expect((await 列出(项目id)).status).toBe(400);
    expect(await 项目附件入口(项目id)).toBeNull();
    expect(await prisma.attachment.count()).toBe(0);
  });

  it("清孤儿：项目还在，项目附件不动", async () => {
    const id = ((await (await 传一个(项目id)).json()) as { 附件: { id: string } }).附件.id;
    await 清孤儿(prisma, 附件夹, Date.now() + 48 * 3600 * 1000, true);
    expect(await 还在(id)).toBe(true);
  });
});
