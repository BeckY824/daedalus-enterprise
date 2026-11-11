/**
 * 停用 / 复职碰上系统管理员标记（P-判定-06）：
 *   - 设了业务线、带标记的系统管理员是最后一位能管设置的：停用拦下，一行不写
 *   - 还有别的系统管理员：能停；标记不摘（复职接受保留），复职时操作记录写「复职，仍是系统管理员」
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "ADMIN", title: "", avatar: null as string | null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { deactivateUser, reactivateUser } from "@/app/(app)/settings/actions";
import { 系统管理员标记键 } from "@/lib/enterprise/org";

let 甲: string;
let 乙: string;
const 建人 = async (email: string, line: string | null) => {
  const id = (await prisma.user.create({ data: { email, name: email, title: "", role: "ADMIN", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: id, bizRole: "director", line } });
  return id;
};
const 当 = (id: string) => { mocks.user = { ...mocks.user, id, name: id }; };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  // 甲：总管理 + 内贸 + 系统管理员标记；乙：总管理 + 外贸、没标记（只是条线总管理）
  甲 = await 建人("jia", "内贸");
  乙 = await 建人("yi", "外贸");
  await prisma.setting.create({ data: { key: 系统管理员标记键, value: JSON.stringify([甲]) } });
  当(甲);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("停用设了线、带标记的系统管理员", () => {
  it("他是最后一位能管设置的：拦下，人还在职", async () => {
    当(甲);
    expect(await deactivateUser(甲, "")).toMatchObject({ ok: false, error: expect.stringContaining("最后一位能管设置") });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 甲 } })).active).toBe(true);
  });

  it("还有别的系统管理员：能停；复职回来仍是系统管理员，操作记录写一句", async () => {
    await prisma.setting.update({ where: { key: 系统管理员标记键 }, data: { value: JSON.stringify([甲, 乙]) } });
    当(乙);
    expect(await deactivateUser(甲, "")).toMatchObject({ ok: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: 甲 } })).active).toBe(false);
    expect(await reactivateUser(甲)).toMatchObject({ ok: true });
    const 记 = await prisma.auditLog.findFirstOrThrow({ where: { action: "reactivate" }, orderBy: { at: "desc" } });
    expect(记.summary).toBe("恢复成员「jia」，复职，仍是系统管理员");
  });

  it("复职的人不是系统管理员：操作记录照旧", async () => {
    await prisma.setting.update({ where: { key: 系统管理员标记键 }, data: { value: JSON.stringify([甲]) } });
    当(甲);
    expect(await deactivateUser(乙, "")).toMatchObject({ ok: true });
    expect(await reactivateUser(乙)).toMatchObject({ ok: true });
    const 记 = await prisma.auditLog.findFirstOrThrow({ where: { action: "reactivate" }, orderBy: { at: "desc" } });
    expect(记.summary).toBe("恢复成员「yi」");
  });
});
