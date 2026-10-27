/**
 * 企业版选项字典「其他」要写一句（10-27 批注，dict-kinds.ts 合其他 / 拆其他 / 其他没写好 + dict.ts 选的原因）：
 *   - 选了「其他」没写 → 拦；写了 → 存成「其他：xxx」（前后空格去掉）；写太长 → 拦
 *   - 「其他」被停用了 → 「其他：xxx」也不认
 *   - 别的选项照旧：启用的认、停用的 / 没有的不认
 *   - 开关关着：不管传什么都当没选
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 选的原因, 企业字典, 合其他, 拆其他, 其他没写好, 其他补充上限 } from "@/lib/enterprise/dict";

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("CRM_ENTERPRISE", "1");
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("选「其他」要写一句", () => {
  it("合 / 拆：选的 + 写的 ↔ 提交值", () => {
    expect(合其他(null, "x")).toBeNull();
    expect(合其他("离职交接", "忽略")).toBe("离职交接");
    expect(合其他("其他", "  ")).toBe("其他");
    expect(合其他("其他", " 客户搬家 ")).toBe("其他：客户搬家");
    expect(拆其他("其他：客户搬家")).toEqual({ 选: "其他", 写: "客户搬家" });
    expect(拆其他("离职交接")).toEqual({ 选: "离职交接", 写: "" });
    expect(拆其他(null)).toEqual({ 选: null, 写: "" });
    expect(其他没写好("其他")).toContain("具体");
    expect(其他没写好("其他：" + "长".repeat(其他补充上限 + 1))).toContain(String(其他补充上限));
    expect(其他没写好("其他：客户搬家")).toBeNull();
    expect(其他没写好("离职交接")).toBeNull();
  });

  it("服务端：没写拦、写了存「其他：xxx」、太长拦；别的选项照旧", async () => {
    expect(await 选的原因("transfer", "其他")).toMatchObject({ ok: false, error: expect.stringContaining("具体") });
    expect(await 选的原因("transfer", "其他：  ")).toMatchObject({ ok: false });
    expect(await 选的原因("transfer", " 其他： 客户搬家 ")).toEqual({ ok: true, 值: "其他：客户搬家" });
    expect(await 选的原因("recycle", "其他：" + "长".repeat(其他补充上限 + 1))).toMatchObject({ ok: false });
    expect(await 选的原因("transfer", "离职交接")).toEqual({ ok: true, 值: "离职交接" });
    expect(await 选的原因("transfer", "乱写的")).toMatchObject({ ok: false, error: expect.stringContaining("不在") });
    expect(await 选的原因("transfer", "")).toEqual({ ok: true, 值: null });
    // 没有「其他」这一项的种类：「其他：xxx」不认
    expect(await 选的原因("verify", "其他：随便")).toMatchObject({ ok: false, error: expect.stringContaining("不在") });
  });

  it("「其他」停用了：「其他：xxx」也不认", async () => {
    const 其他 = (await 企业字典("invalid")).find((x) => x.name === "其他")!;
    await prisma.entDictItem.update({ where: { id: 其他.id }, data: { active: false } });
    expect(await 选的原因("invalid", "其他：写了")).toMatchObject({ ok: false, error: expect.stringContaining("「其他」不在") });
  });

  it("开关关着：传什么都当没选", async () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(await 选的原因("transfer", "其他")).toEqual({ ok: true, 值: null });
    expect(await 选的原因("transfer", "其他：x")).toEqual({ ok: true, 值: null });
    expect(await prisma.entDictItem.count()).toBe(0);
  });
});
