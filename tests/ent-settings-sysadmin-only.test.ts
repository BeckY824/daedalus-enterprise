/**
 * 设置页只给系统管理员（11-03 D3-1）：后台设置、成员管理只有系统管理员看得到、改得了；
 * 别人（条线总管、销售管理、只读管理员、销售）只剩个人资料、登录与密码、快捷键、外观（回收站副手另有回收站）。
 *
 * 钉的是：服务端成员、业务配置的入口别人调一律 FORBIDDEN、一行不写；系统管理员照旧能改；
 * 页面上 只个人 = 企业版且进不了设置，只个人时目录只留那几栏、成员和日志都不往浏览器送。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFile } from "node:fs/promises";

const mocks = vi.hoisted(() => ({
  user: { id: "", name: "", email: "a@x", role: "SALES", title: "", avatar: null },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveUser, saveBusinessSettings } from "@/app/(app)/settings/actions";
import { getBusiness } from "@/lib/business";

let 系统: string, 条线总管: string, 销管: string, 只读: string, 销售: string;
const 当 = (id: string, role = "SALES") => { mocks.user = { ...mocks.user, id, role }; };
const 新成员 = { name: "张三", email: "zhangsan", title: "", role: "SALES", active: true, password: "pass12345" };

beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  invalidateSettingsCache();
  const 建人 = async (email: string, bizRole: string, line: string | null = null, role = "SALES") => {
    const id = (await prisma.user.create({ data: { email, name: email, title: "", role, password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line } });
    return id;
  };
  系统 = await 建人("sys", "director");
  条线总管 = await 建人("linedir", "director", "外贸");
  销管 = await 建人("smgr", "sales_mgr", null, "ADMIN");
  只读 = await 建人("adm", "admin", null, "ADMIN");
  销售 = await 建人("s", "sales");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("服务端", () => {
  it("条线总管、销售管理（账号 ADMIN 也一样）、只读管理员、销售：加成员、改业务配置都 FORBIDDEN，一行不写", async () => {
    const 原 = await getBusiness();
    for (const id of [条线总管, 销管, 只读, 销售]) {
      当(id, id === 销管 || id === 只读 ? "ADMIN" : "SALES");
      await expect(saveUser(新成员)).rejects.toThrow("FORBIDDEN");
      await expect(saveBusinessSettings({ ...原, customer: "学员" })).rejects.toThrow("FORBIDDEN");
    }
    expect(await prisma.user.count({ where: { email: "zhangsan" } })).toBe(0);
    expect((await getBusiness()).customer).toBe(原.customer);
  });

  it("系统管理员照旧能加成员", async () => {
    当(系统);
    expect(await saveUser(新成员)).toMatchObject({ ok: true });
    expect(await prisma.user.count({ where: { email: "zhangsan" } })).toBe(1);
  });
});

describe("页面", () => {
  it("只个人 = 企业版且进不了设置；只个人时不取项目模式、组织架构，成员和日志给空", async () => {
    const body = await readFile("src/app/(app)/settings/SettingsBody.tsx", "utf8");
    expect(body).toContain("const 只个人 = 企业版() && !可进;");
    expect(body).toContain("const 项目设置底 = business.projectMode && !只个人");
    expect(body).toMatch(/const 组织架构: 组织架构 \| null = org && 开关 && 字段权限 && 改权限 && !只个人/);
    expect(body).toContain("logs={(只个人 ? [] : logs)");
    expect(body).toContain("users={(只个人 ? [] : users)");
    expect(body).toContain("只个人={只个人}");
  });

  it("只个人时目录只留个人资料、登录与密码、快捷键、外观、回收站", async () => {
    const view = await readFile("src/app/(app)/settings/SettingsView.tsx", "utf8");
    expect(view).toContain('.filter((x) => !只个人 || ["profile", "password", "keymap", "appearance", "trash"].includes(x.key))');
    // 没带 ?tab= 时默认 members 不在目录里，落到第一栏（个人资料）
    expect(view).toContain("const 当前 = 目录.some((x) => x.key === tab) ? tab : 目录[0].key;");
  });
});
