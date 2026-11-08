/**
 * 只读管理员（业务角色 admin）打开渠道页（2026-11-08 渠道两层）：页面加载时 补主渠道 是系统补数据，
 * 包在 系统写 里——只读的人打开也补得上、不整页崩；不包就被 只读拦 拒（CRM_READONLY）。
 * 走真 加上限定 + 真会话票（同 ent-notice-readonly），用拷出来的一份库、单连接，不碰共用测试库。
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const 临时 = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs") as typeof import("node:fs");
  const os = process.getBuiltinModule("node:os") as typeof import("node:os");
  const path = process.getBuiltinModule("node:path") as typeof import("node:path");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-ent-chmain-ro-"));
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
import { defaultClient as raw } from "@/lib/prisma";
import { readSecret } from "@/lib/secret";
import { 只读错误 } from "@/lib/team-scope";
import { 忘掉企业版范围 } from "@/lib/enterprise/visibility";
import { 补主渠道 } from "@/lib/enterprise/channel-main";

const 只读 = "p_ro";

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

beforeEach(async () => {
  process.env.CRM_ENTERPRISE = "1";
  delete process.env.DESKTOP_LOCAL;
  await raw.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
  for (const t of ["EntChannelInvest", "Channel", "EntChannelMain", "EntDictItem", "AuditLog", "EntMember", "Customer", "User"]) await raw.$executeRawUnsafe(`DELETE FROM "${t}"`);
  await raw.$executeRawUnsafe("PRAGMA foreign_keys = ON");
  await raw.user.create({ data: { id: 只读, email: "ro@x.com", name: "只读号", password: "x", role: "SALES", active: true } });
  await raw.entMember.create({ data: { userId: 只读, bizRole: "admin" } });
  await raw.channel.createMany({
    data: [
      { name: "阿里国际站|店铺甲", platform: "阿里国际站", channelOwnerId: 只读 },
      { name: "老渠道｜子乙", channelOwnerId: 只读 },
    ],
  });
});
afterAll(async () => {
  delete process.env.CRM_ENTERPRISE;
  await raw.$disconnect();
  fs.rmSync(临时.dir, { recursive: true, force: true });
});

describe("只读管理员打开渠道页", () => {
  it("页面照常出来，没挂主渠道的渠道补挂上", async () => {
    await expect(作为(只读, () => import("@/app/(app)/channels/page").then((m) => m.default()))).resolves.toBeTruthy();
    const 渠道们 = await raw.channel.findMany({ select: { name: true, platform: true, main: { select: { name: true } } }, orderBy: { name: "asc" } });
    expect(渠道们.map((c) => [c.name, c.platform, c.main?.name])).toEqual([
      ["老渠道｜子乙", "老渠道", "老渠道"],
      ["阿里国际站|店铺甲", "阿里国际站", "阿里国际站"],
    ]);
  });

  it("不包 系统写 时只读拦会拒（守住页面里那层包装是必要的）", async () => {
    await expect(作为(只读, () => 补主渠道())).rejects.toBeInstanceOf(只读错误);
    expect(await raw.channel.count({ where: { mainId: { not: null } } })).toBe(0);
  });
});
