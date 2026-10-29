/**
 * 企业版项目附件（P11，10-29，迁移 086）。
 *
 * 钉的是：
 *   - 负责人：?projectId= 传（不限图片，合同、表格都行）、列、取、删都通；入口 = 个数 + 能改
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
const 传一个 = (projectId: string, 名字 = "合同.pdf", 类型 = "application/pdf") => {
  const 体 = 字节(`%PDF-1.4 ${名字}`);
  return 传(new Request(`http://x/api/attachments?projectId=${projectId}&name=${encodeURIComponent(名字)}`, {
    method: "POST",
    body: 体,
    headers: { "Content-Type": 类型, "Content-Length": String(体.byteLength) },
  }));
};
const 列出 = (projectId: string) => 列(new Request(`http://x/api/attachments?projectId=${projectId}`));
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
    expect(await 项目附件入口(项目id)).toEqual({ 个数: 1, 只读: false });
    expect((await 删一个(id)).status).toBe(200);
    expect(await 还在(id)).toBe(false);
    expect(await 项目附件入口(项目id)).toEqual({ 个数: 0, 只读: false });
  });

  it("老板：别人负责的项目也能传；表格之类不是图片的照收", async () => {
    作为(老板, "ADMIN");
    const r = await 传一个(项目id, "报价单.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(r.status).toBe(200);
    expect(await 项目附件入口(项目id)).toEqual({ 个数: 1, 只读: false });
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
    expect(await 项目附件入口(项目id)).toEqual({ 个数: 1, 只读: true });
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
