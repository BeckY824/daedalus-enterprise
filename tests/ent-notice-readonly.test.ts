/**
 * 只读账号（业务角色 admin）能标已读（2026-11-02，team-scope 只读也能写 加 EntNotice）：
 * 铃铛自己的通知能标已读、全部已读；别的写照样被 只读拦 拒，库里没动；别人的通知标不到。
 * 走真 加上限定 + 真会话票（同 ent-full-perm-bugs），用拷出来的一份库、单连接，不碰共用测试库。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-notice-ro-"));
  fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db"), path.join(dir, "A.db"));
  if (fs.existsSync(path.resolve(__dirname, "../prisma/test.db-wal"))) fs.copyFileSync(path.resolve(__dirname, "../prisma/test.db-wal"), path.join(dir, "A.db-wal"));
  return { dir, 票: undefined as string | undefined };
});
vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@/generated/prisma");
  const { 加上限定 } = await import("@/lib/team-scope");
  const raw = new PrismaClient({ datasourceUrl: `file:${path.join(临时.dir, "A.db")}?connection_limit=1` });
  return { prisma: 加上限定(raw), defaultClient: raw };
});
const 假头 = vi.hoisted(() => () => ({
  cookies: async () => ({ get: (n: string) => (n === "crm_session" && 临时.票 ? { value: 临时.票 } : undefined) }),
  headers: async () => new Headers(),
}));
vi.mock("next/headers", 假头);
vi.mock("next/headers.js", 假头);
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { SignJWT } from "jose";
import { prisma, defaultClient as raw } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { 只读错误 } from "@/lib/team-scope";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 标已读, 全部标已读, 读未读通知数 } from "@/app/(app)/notice-actions";

const 只读 = "p_ro";
const 同事 = "p_other";

const 签票 = (sub: string) => new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(sub).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(readSecret()));
async function 作为<R>(id: string, f: () => Promise<R>): Promise<R> {
  临时.票 = await 签票(id);
  忘掉企业版范围();
  try {
    return await f();
  } finally {
    临时.票 = undefined;
  }
}
const 记 = (userId: string, key: string) => raw.entNotice.create({ data: { userId, kind: "分配", title: key, dedupeKey: key } });

beforeEach(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  for (const t of ["EntNotice", "AuditLog", "EntMember", "Customer", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.user.create({ data: { id: 只读, email: "ro@x.com", name: "只读号", password: "x", role: "SALES", active: true } });
  await raw.user.create({ data: { id: 同事, email: "other@x.com", name: "同事", password: "x", role: "SALES", active: true } });
  await raw.entMember.createMany({ data: [{ userId: 只读, bizRole: "admin" }, { userId: 同事, bizRole: "sales" }] });
});
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("只读账号的铃铛", () => {
  it("能标自己的一条已读", async () => {
    const a = await 记(只读, "k1");
    await 记(只读, "k2");
    expect(await 作为(只读, () => 标已读(a.id))).toBe(1);
    expect((await raw.entNotice.findUniqueOrThrow({ where: { id: a.id } })).readAt).not.toBeNull();
    expect(await 作为(只读, () => 读未读通知数())).toBe(1);
  });

  it("能全部已读，只动自己的", async () => {
    await 记(只读, "k1");
    await 记(只读, "k2");
    await 记(同事, "k3");
    await 作为(只读, () => 全部标已读());
    expect(await raw.entNotice.count({ where: { userId: 只读, readAt: null } })).toBe(0);
    expect(await raw.entNotice.count({ where: { userId: 同事, readAt: null } })).toBe(1);
  });

  it("标不到别人的通知", async () => {
    const b = await 记(同事, "k3");
    await 作为(只读, () => 标已读(b.id));
    expect((await raw.entNotice.findUniqueOrThrow({ where: { id: b.id } })).readAt).toBeNull();
  });

  it("别的写照样被拒，库里没动", async () => {
    await expect(作为(只读, () => prisma.customer.create({ data: { name: "不该建", phone: "", salesOwnerId: 只读 } }))).rejects.toBeInstanceOf(只读错误);
    await expect(作为(只读, () => prisma.setting.upsert({ where: { key: "只读试写" }, update: { value: "1" }, create: { key: "只读试写", value: "1" } }))).rejects.toBeInstanceOf(只读错误);
    expect(await raw.customer.count({ where: { name: "不该建" } })).toBe(0);
    expect(await raw.setting.count({ where: { key: "只读试写" } })).toBe(0);
  });

  it("普通同事不受影响：能标已读、能写", async () => {
    const b = await 记(同事, "k3");
    expect(await 作为(同事, () => 标已读(b.id))).toBe(0);
    await 作为(同事, () => prisma.customer.create({ data: { name: "同事建的", phone: "", salesOwnerId: 同事 } }));
    expect(await raw.customer.count({ where: { name: "同事建的" } })).toBe(1);
  });
});
