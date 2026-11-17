/**
 * 建档向导「首条沟通」的截图 / 附件（11-18，22D）：上传发生在创建这一步、由录入人提交。
 *   - 建档向导 / 客户页新增项目：交了 要传附件 才回一张附件票（只认这位录入人 + 这条首条沟通，15 分钟），不交不回
 *   - 带票传：录入人指定分配给了别人、自己已经管不了这个项目，照样挂得上（大小、类型、条数照原来的）
 *   - 不带票 / 票不对（别人拿着、别的沟通、过期、会话票冒充）：照原来的规矩，组员只能看（access.ts 不放宽）
 * 号码全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "甲", email: "a@x", role: "SALES", title: "", avatar: null } as { id: string; name: string; email: string; role: string; title: string; avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => mocks.user, requireUser: async () => mocks.user }));
vi.mock("@/lib/sync/client", () => ({ 读团队: () => null }));
vi.mock("@/lib/sync/dedupe-client", async (原) => ({ ...(await 原<object>()), 问同事: async () => null }));
vi.mock("@/lib/business", async (原) => {
  const m = await 原<typeof import("@/lib/business")>();
  return { ...m, getBusiness: async () => ({ ...(await m.getBusiness()), projectMode: true }) };
});

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 建档向导, 建档只建客户, type 建档向导输入 } from "@/app/(app)/projects/actions";
import { 给客户建项目 } from "@/app/(app)/customers/[id]/project-actions";
import { POST as 传 } from "@/app/api/attachments/route";
import { 签首条附件票, 验首条附件票 } from "@/lib/enterprise/first-follow-ticket";
import { 首条附件票头 } from "@/lib/attachment-rules";
import { readSecret } from "@/lib/secret";

const 附件夹 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ffatt-"));
const 原数据夹 = process.env.CRM_DATA_DIR;
process.env.CRM_DATA_DIR = 附件夹;
afterAll(async () => {
  if (原数据夹 === undefined) delete process.env.CRM_DATA_DIR;
  else process.env.CRM_DATA_DIR = 原数据夹;
  fs.rmSync(附件夹, { recursive: true, force: true });
  await prisma.$disconnect();
});

let 录入: string, 接手: string, 旁人: string;
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 人 = async (email: string, bizRole: string) => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole } });
    return id;
  };
  录入 = await 人("ff-a", "marketing_mgr");
  接手 = await 人("ff-b", "sales");
  旁人 = await 人("ff-c", "sales");
  当(录入);
});
afterEach(() => { vi.unstubAllEnvs(); });

const 字节 = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
function 传一个(followUpId: string, 票?: string, 名字 = "截图.png", 类型 = "image/png") {
  const 体 = 字节(`\x89PNG ${名字}`);
  const headers: Record<string, string> = { "Content-Length": String(体.byteLength), "Content-Type": 类型 };
  if (票) headers[首条附件票头] = 票;
  return 传(new Request(`http://x/api/attachments?followUpId=${followUpId}&name=${encodeURIComponent(名字)}`, { method: "POST", body: 体, headers }));
}

function 输入(ownerId: string, 补: Partial<建档向导输入> = {}): 建档向导输入 {
  return {
    客户: {
      name: "向导客户", phone: "13900000001", school: null, grade: null, major: null,
      followStatus: "待跟进", decisionStatus: "了解中", expectedSignAt: null, remark: null,
      salesOwnerId: 录入, channelId: null, referrerCustomerId: null, touchpoint: "公司资源",
    },
    联系人: { name: "王经理", position: "采购", phone: "13900000002" },
    项目: { name: "一期", amount: 0, currency: "CNY", ownerId, 业务线: "内贸" },
    跟进: { type: "PHONE", content: "电话聊了需求", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false },
    ...补,
  } as 建档向导输入;
}

describe("附件票", () => {
  it("只认签给的这位 + 这条沟通；会话票（带 sub）、别的密钥签的不认", async () => {
    const 票 = await 签首条附件票("u1", "f1");
    expect(await 验首条附件票(票, "u1", "f1")).toBe(true);
    expect(await 验首条附件票(票, "u2", "f1")).toBe(false);
    expect(await 验首条附件票(票, "u1", "f2")).toBe(false);
    expect(await 验首条附件票("", "u1", "f1")).toBe(false);
    const 钥 = new TextEncoder().encode(readSecret());
    const 会话票 = await new SignJWT({ sub: "u1", ims: 1 }).setProtectedHeader({ alg: "HS256" }).setExpirationTime("1h").sign(钥);
    expect(await 验首条附件票(会话票, "u1", "f1")).toBe(false);
    const 过期 = await new SignJWT({ typ: "first-follow-att", fb: "u1", ff: "f1" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2).sign(钥);
    expect(await 验首条附件票(过期, "u1", "f1")).toBe(false);
  });

  it("附件票上不带 sub：拿去当会话票认不出是谁", async () => {
    const 票 = await 签首条附件票("u1", "f1");
    const 身 = JSON.parse(Buffer.from(票.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    expect(身.sub).toBeUndefined();
  });
});

describe("建档向导：要传附件才回票", () => {
  it("不交 要传附件：不回票", async () => {
    const r = await 建档向导(输入(录入));
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(r).not.toHaveProperty("附件票");
  });

  it("指定给别人、自己管不了这个项目：带票挂得上首条沟通；不带票、旁人拿着票、票配别的沟通照原规矩 403", async () => {
    const r = await 建档向导({ ...输入(接手), 要传附件: true });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok || !("附件票" in r) || !r.附件票) throw new Error("没回附件票");
    const { followUpId, 票 } = r.附件票;
    const 首条 = await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId } });
    expect(首条.projectId).toBe(r.projectId);
    expect((await prisma.followUp.findUniqueOrThrow({ where: { id: followUpId } })).ownerId).toBe(录入);

    // 原规矩：录入人不是负责人，不带票传不上（组员只能看，不放宽）
    expect((await 传一个(followUpId)).status).toBe(403);
    const 成 = await 传一个(followUpId, 票);
    expect(成.status).toBe(200);
    const a = ((await 成.json()) as { 附件: { id: string } }).附件;
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ followUpId, userId: 录入 });
    // 类型照原来的：不收的照样 415
    expect((await 传一个(followUpId, 票, "合同.pdf", "application/pdf")).status).toBe(415);
    // 旁人拿着这张票：不认，照原规矩
    当(旁人);
    expect((await 传一个(followUpId, 票)).status).toBe(403);
    // 票配别的沟通：不认
    当(录入);
    const 别的 = await prisma.followUp.create({ data: { customerId: r.customerId, ownerId: 录入, type: "PHONE", title: "", content: "另一条", status: "已完成", occurredAt: new Date() } });
    await prisma.followUpProject.create({ data: { followUpId: 别的.id, projectId: r.projectId, node: "潜客培育" } });
    expect((await 传一个(别的.id, 票)).status).toBe(403);
  });
});

describe("客户页新增项目：要传附件才回票", () => {
  it("回的票配这次的首条沟通，带票挂得上", async () => {
    const c = await prisma.customer.create({ data: { name: "老客户", phone: "13900000011", salesOwnerId: 录入 } });
    const r = await 给客户建项目({
      customerId: c.id,
      项目: { name: "二期", amount: 0, currency: "CNY", ownerId: 接手, 业务线: "内贸" } as never,
      跟进: { type: "PHONE", content: "电话聊了二期", occurredAt: "2026-10-20 10:00", 节点: "潜客培育", 明确回复: false } as never,
      要传附件: true,
    });
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (!r.ok || !r.附件票) throw new Error("没回附件票");
    expect((await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId: r.附件票.followUpId } })).projectId).toBe(r.projectId);
    expect((await 传一个(r.附件票.followUpId, r.附件票.票)).status).toBe(200);
  });
});

describe("没开项目只建客户：首条沟通挂潜客培育项目（11-17），附件票照旧只在有项目建档时签", () => {
  it("硬塞 要传附件 也不回票；首条沟通挂在这位客户自带的潜客培育项目上", async () => {
    const { 项目: _不要, ...只客户 } = 输入(录入);
    const r = await 建档只建客户({ ...只客户, 客户: { ...只客户.客户, 企业资料: { bizLine: "内贸" } }, 要传附件: true } as never);
    expect(r.ok, r.ok ? "" : "error" in r ? String(r.error) : "").toBe(true);
    if (!r.ok) return;
    expect(r).not.toHaveProperty("附件票");
    const 首条 = await prisma.followUp.findFirstOrThrow({ where: { customerId: r.customerId, deletedAt: null }, select: { id: true } });
    const 挂 = await prisma.followUpProject.findUniqueOrThrow({ where: { followUpId: 首条.id }, select: { project: { select: { customerId: true } } } });
    expect(挂.project.customerId).toBe(r.customerId);
  });
});
