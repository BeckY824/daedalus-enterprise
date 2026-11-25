/**
 * 企业版售后回访（11-25，E-283）× 切换视图（M-权限-08）：总管理员以业务员的视图查看期间服务端一律只读（lib/team-scope.ts 视图拦），
 * 交付结清项目上记售后回访也一样——客户页（saveFollowUp）、项目页（记项目沟通Action）两条路都回一句话、一条不存，项目不动。
 * 退出视图后被看的那位自己照常能记（证明拦的是视图，不是售后回访本身）
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

const 罐 = vi.hoisted(() => ({ 票: new Map<string, string>() }));
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({
    get: (n: string) => (罐.票.has(n) ? { name: n, value: 罐.票.get(n)! } : undefined),
    set: (n: string, v: string) => void 罐.票.set(n, v),
    delete: (n: string) => void 罐.票.delete(n),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SignJWT } from "jose";
import { prisma, defaultClient } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { resetDb } from "./reset";
import { setSetting, invalidateSettingsCache } from "@/lib/settings";
import { 规则 } from "@/lib/enterprise/rules";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 开始视图, 退出视图 } from "@/app/(app)/view-as-actions";
import { saveFollowUp } from "@/app/(app)/customers/[id]/actions";
import { 记项目沟通Action } from "@/app/(app)/projects/actions";
import { dayjs } from "@/lib/utils";
import { POST as 传附件 } from "@/app/api/attachments/route";
import { DEFAULT_BUSINESS } from "@/lib/business-config";

// 附件 POST 那条真写文件：落到临时目录，不进仓库
const 原数据目录 = process.env.CRM_DATA_DIR;
const 临时目录 = fs.mkdtempSync(path.join(os.tmpdir(), "crm-after-sale-viewas-"));
process.env.CRM_DATA_DIR = 临时目录;

const 签会话 = (sub: string) =>
  new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
async function 登录成(id: string) {
  罐.票.clear();
  罐.票.set("crm_session", await 签会话(id));
  忘掉企业版范围();
}

const 人 = { 总管: "", 甲: "" };
let 客户 = "";
let 项目 = "";
const 内容 = "回访了使用情况，客户说设备运行稳定";
const 客户页记 = () => saveFollowUp({ customerId: 客户, type: "PHONE", content: 内容, status: "已完成", occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), projectId: 项目, 售后回访: true });
/** 本人限时改：客户页那条点「修改」走 saveFollowUp 带 id */
const 改这条 = async (id: string, content: string) => {
  const f = await defaultClient.followUp.findUniqueOrThrow({ where: { id } });
  return saveFollowUp({ id, customerId: 客户, type: f.type, method: f.method, initiator: f.initiator, content, status: f.status, occurredAt: dayjs(f.occurredAt).format("YYYY-MM-DD HH:mm"), title: f.title });
};
const 传一张 = (followUpId: string) => {
  const 体 = new TextEncoder().encode("图");
  return 传附件(new Request(`http://x/api/attachments?followUpId=${followUpId}&name=a.png`, {
    method: "POST", body: 体, headers: { "Content-Type": "image/png", "Content-Length": String(体.byteLength) },
  }));
};
const 项目页记 = () => 记项目沟通Action(项目, { type: "PHONE", content: 内容, occurredAt: dayjs().format("YYYY-MM-DD HH:mm"), 售后回访: true });

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  罐.票.clear();
  invalidateSettingsCache();
  await setSetting(规则.无意义沟通拦.key, false);
  const 部 = (await prisma.entDept.create({ data: { name: "销售一部" } })).id;
  const 建 = async (名: string, bizRole: string) => {
    const u = await prisma.user.create({ data: { email: `${名}@t`, name: 名, title: "", role: "SALES", password: "x" } });
    await prisma.entMember.create({ data: { userId: u.id, deptId: bizRole === "sales" ? 部 : null, bizRole } });
    return u.id;
  };
  人.总管 = await 建("总管", "director");
  人.甲 = await 建("业务员甲", "sales");
  客户 = (await prisma.customer.create({ data: { name: "客户甲", phone: "", salesOwnerId: 人.甲, contacts: { create: { name: "联系人甲", phone: "13900000001", isPrimary: true } } } })).id;
  项目 = (await prisma.project.create({ data: { name: "交付项目", customerId: 客户, ownerId: 人.甲, creatorId: 人.甲, phase: "订单", node: "交付", result: "交付结清" } })).id;
});
afterEach(() => {
  vi.unstubAllEnvs();
  罐.票.clear();
  忘掉企业版范围();
});
afterAll(async () => {
  if (原数据目录 === undefined) delete process.env.CRM_DATA_DIR;
  else process.env.CRM_DATA_DIR = 原数据目录;
  fs.rmSync(临时目录, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("切换视图时记售后回访", () => {
  it("客户页、项目页两条路都被拦：回一句话、不抛错，一条不存，项目不动；退出视图后被看的那位自己照常能记", async () => {
    const 前 = await defaultClient.project.findUniqueOrThrow({ where: { id: 项目 } });
    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    for (const 记 of [客户页记, 项目页记]) {
      const r = await 记();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("切换视图");
    }
    expect(await defaultClient.followUp.count()).toBe(0);
    const 后 = await defaultClient.project.findUniqueOrThrow({ where: { id: 项目 } });
    expect(后.updatedAt.getTime()).toBe(前.updatedAt.getTime());
    expect(后.result).toBe("交付结清");
    await 退出视图();

    await 登录成(人.甲);
    expect(await 客户页记()).toMatchObject({ ok: true });
    expect(await defaultClient.followUp.count({ where: { afterSale: true, ownerId: 人.甲 } })).toBe(1);
  });
});

describe("切换视图时动被看那位记的售后回访", () => {
  it("本人限时改（saveFollowUp 带 id）、附件 POST 都被拦：内容不变、一张不存；退出视图后本人照常能改能传", async () => {
    await setSetting("business", { ...DEFAULT_BUSINESS, projectMode: true });
    invalidateSettingsCache();
    await 登录成(人.甲);
    const 记了 = await 客户页记();
    expect(记了).toMatchObject({ ok: true });
    const id = (记了 as { id: string }).id;

    await 登录成(人.总管);
    expect(await 开始视图(人.甲)).toEqual({ ok: true });
    忘掉企业版范围();
    const 改 = await 改这条(id, "视图里想改");
    expect(改.ok).toBe(false);
    if (!改.ok) expect(改.error).toContain("切换视图");
    const 拒 = await 传一张(id);
    expect(拒.status).toBe(403);
    expect((await 拒.json()).error).toContain("切换视图");
    expect((await defaultClient.followUp.findUniqueOrThrow({ where: { id } })).content).toBe(内容);
    expect(await defaultClient.attachment.count()).toBe(0);
    await 退出视图();

    await 登录成(人.甲);
    expect(await 改这条(id, "回访了使用情况，下季度要加一台")).toMatchObject({ ok: true });
    expect((await 传一张(id)).status).toBe(200);
    expect(await defaultClient.attachment.count()).toBe(1);
  });
});
