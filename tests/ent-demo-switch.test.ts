/**
 * 演示换人（10-28，lib/enterprise/demo-switch.ts + app/login/demo-actions.ts）。
 * 钉的是：只有 CRM_DEMO_SWITCH=1 + 企业版 + 自部署才开（托管版、桌面端、没设开关都关）；
 * 关着时名单是 null、免密登录直接拒、不发会话；停用的人、不存在的人不给进；
 * 名单按主角色分组、组按业务角色固定顺序（总管理最前）、空组不出；说明 = 部门 · 业务线 · 兼的角色 · 职位；同名带登录名。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ 发了: [] as string[] }));
vi.mock("@/lib/auth", async (原) => ({ ...(await 原<object>()), createSession: async (id: string) => void mocks.发了.push(id) }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 建组织 } from "@/lib/enterprise/org-core";
import { 演示切换, 分组演示名单, 读演示名单 } from "@/lib/enterprise/demo-switch";
import { 演示登录 } from "@/app/login/demo-actions";

const 环境 = { ...process.env };
const 开 = () => Object.assign(process.env, { CRM_DEMO_SWITCH: "1", CRM_ENTERPRISE: "1", MULTI_TENANT: "", DESKTOP_LOCAL: "" });
afterEach(() => {
  process.env = { ...环境 };
});

describe("开关", () => {
  it("三个条件都满足才开", () => {
    开();
    expect(演示切换()).toBe(true);
    process.env.CRM_DEMO_SWITCH = "";
    expect(演示切换()).toBe(false);
    开();
    process.env.CRM_ENTERPRISE = "";
    expect(演示切换()).toBe(false);
    开();
    process.env.MULTI_TENANT = "1";
    expect(演示切换()).toBe(false);
    开();
    process.env.DESKTOP_LOCAL = "1";
    expect(演示切换()).toBe(false);
  });
});

describe("分组", () => {
  const 人 = (id: string, name: string, title: string | null = null, email = `${id}@x`) => ({ id, name, email, title });
  it("按主角色分组、固定顺序、空组不出、说明有什么摆什么", () => {
    const org = 建组织(
      [
        { id: "s1", role: "SALES", active: true },
        { id: "boss", role: "ADMIN", active: true },
        { id: "m1", role: "MANAGER", active: true },
        { id: "s2", role: "SALES", active: true },
        { id: "gone", role: "SALES", active: false },
      ],
      [
        { userId: "m1", deptId: "d2", bizRole: "sales,sales_mgr", line: "内贸", managerId: null, dottedManagerId: null },
        { userId: "s2", deptId: null, bizRole: "channel_ops", line: null, managerId: null, dottedManagerId: null },
      ],
      [
        { id: "d1", name: "内贸部", parentId: null, sort: 0 },
        { id: "d2", name: "内贸一组", parentId: "d1", sort: 0 },
      ],
    );
    const 组 = 分组演示名单([人("s1", "王芳"), 人("boss", "周建国", "总经理"), 人("m1", "张伟", "销售组长"), 人("s2", "王芳"), 人("gone", "李四")], org);
    expect(组.map((g) => g.名)).toEqual(["总管理", "销售管理", "销售成员", "渠道运营"]);
    expect(组[0].人).toEqual([{ id: "boss", name: "周建国", 说明: "总经理" }]);
    expect(组[1].人[0].说明).toBe("内贸一组 · 内贸 · 兼销售成员 · 销售组长");
    // 两个王芳：都带登录名；停用的不在名单里
    expect(组[2].人.map((p) => p.name)).toEqual(["王芳（s1@x）"]);
    expect(组[3].人.map((p) => p.name)).toEqual(["王芳（s2@x）"]);
    expect(组.flatMap((g) => g.人).some((p) => p.id === "gone")).toBe(false);
  });
});

describe("免密登录", () => {
  let 在职: string, 停用: string;
  beforeEach(async () => {
    await resetDb();
    mocks.发了 = [];
    在职 = (await prisma.user.create({ data: { name: "在职", email: "on@x", password: "x", role: "SALES" } })).id;
    停用 = (await prisma.user.create({ data: { name: "停用", email: "off@x", password: "x", role: "SALES", active: false } })).id;
  });

  it("开关关着：拒，不发会话；名单是 null", async () => {
    process.env.CRM_DEMO_SWITCH = "";
    process.env.CRM_ENTERPRISE = "1";
    expect((await 演示登录(在职)).ok).toBe(false);
    expect(mocks.发了).toEqual([]);
    expect(await 读演示名单()).toBeNull();
  });

  it("开着：在职的发会话，停用的、不存在的拒", async () => {
    开();
    expect(await 演示登录(在职)).toEqual({ ok: true });
    expect((await 演示登录(停用)).ok).toBe(false);
    expect((await 演示登录("nobody")).ok).toBe(false);
    expect(mocks.发了).toEqual([在职]);
    const 名单 = await 读演示名单();
    expect(名单?.flatMap((g) => g.人.map((p) => p.id))).toEqual([在职]);
  });
});
