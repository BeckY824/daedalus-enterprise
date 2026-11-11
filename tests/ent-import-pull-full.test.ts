/**
 * 「从飞书/钉钉拉全量试跑」没填凭据（11-03 完成度 D7-3）：
 * 生产构建里 server action 抛错到界面只剩「Minified React error #441」，要回 {ok:false,error} 带原话；
 * 概况里带 接好了，没填凭据时按钮灰着。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: { id: "", name: "总管", email: "dir@x", role: "SALES", title: "", avatar: null } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => mocks.user }));
vi.mock("@/lib/enterprise/switch", () => ({ 企业版: () => true }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { 从接口拉全量, 企业版导入概况 } from "@/app/(app)/settings/enterprise-import-actions";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  mocks.user.id = (await prisma.user.create({ data: { email: "dir", name: "总管", title: "", role: "SALES", password: "x" } })).id;
  await prisma.entMember.create({ data: { userId: mocks.user.id, bizRole: "director" } });
});

describe("没填凭据拉全量", () => {
  it("回原话，不抛错", async () => {
    const r = await 从接口拉全量("feishu");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("飞书接口还没接");
  });
  it("概况里飞书、钉钉都没接好", async () => {
    const 概况 = await 企业版导入概况();
    expect(概况.同步.filter((s) => s.能同步).map((s) => [s.来源, s.接好了])).toEqual([["feishu", false], ["dingtalk", false]]);
  });
});
