/**
 * 未归属联系人的电话（11-18 员工反馈 22A）：联系人页上改一位未归属的人，电话和联系人卡号码几行的「手机」同一套规矩（验一行号码）。
 *   像微信号、像座机、港号没带 +852、占位假号：拦；新填的存规整值；原样没动的老号照存（同 验联系人号码们「只验新加、改过的」）
 * 号码全是编造的
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({ id: "tester-id", name: "测试员", email: "t", role: "ADMIN", title: "" }),
}));

import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { invalidateSettingsCache } from "@/lib/settings";
import { saveUnassignedContact } from "@/app/(app)/customers/[id]/actions";
import { 未归属联系人电话 } from "@/app/(app)/customers/[id]/contact-input";

beforeEach(async () => {
  await resetDb();
  invalidateSettingsCache();
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  await prisma.entMember.create({ data: { userId: "tester-id", bizRole: "sales" } });
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => prisma.$disconnect());

describe("未归属联系人电话（纯函数）", () => {
  it("企业版：新填的按 验一行号码 手机号；原样没动的老号照存；空 = 不填", () => {
    expect(未归属联系人电话("+86 139 1234 5678", null, true)).toEqual({ ok: true, phone: "13912345678" });
    expect(未归属联系人电话("+852 9123 4567", null, true)).toEqual({ ok: true, phone: "+85291234567" });
    expect(未归属联系人电话("87654321", "87654321", true)).toEqual({ ok: true, phone: "87654321" });
    expect(未归属联系人电话("", "13912345678", true)).toEqual({ ok: true, phone: null });
    for (const [号, 话] of [["sqin17548955941", /像微信号/], ["010-12345678", /像座机/], ["91234567", /香港/], ["12345678901", /占位/], ["748392", /格式错误/]] as const) {
      const r = 未归属联系人电话(号, null, true);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(话);
    }
  });
  it("打码交回认回原号；认不回的带 * 拦", () => {
    expect(未归属联系人电话("139****5678", "13912345678", true)).toEqual({ ok: true, phone: "13912345678" });
    expect(未归属联系人电话("137****5678", "13912345678", true).ok).toBe(false);
  });
  it("非企业版照旧不验格式（座机、分机都收），只拦打码和占位", () => {
    expect(未归属联系人电话("010-12345678 转 8", null, false)).toEqual({ ok: true, phone: "010-12345678 转 8" });
    expect(未归属联系人电话("12345678901", null, false).ok).toBe(false);
  });
});

describe("saveUnassignedContact", () => {
  async function 造未归属(phone: string | null) {
    return prisma.unassignedContact.create({ data: { id: `u-${phone ?? "空"}`, name: "王经理", phone, ownerId: "tester-id" } });
  }

  it("格式不对的拦、库里不动；改别的格时原样的老号照存", async () => {
    const u = await 造未归属("87654321");
    expect(await saveUnassignedContact({ id: u.id, name: "王经理", phone: "87654321", remark: "只改备注" })).toMatchObject({ ok: true });
    for (const 号 of ["sqin17548955941", "0755-12345678", "61234567"]) {
      const r = await saveUnassignedContact({ id: u.id, name: "王经理", phone: 号 });
      expect(r.ok).toBe(false);
    }
    expect(await prisma.unassignedContact.findUniqueOrThrow({ where: { id: u.id } })).toMatchObject({ phone: "87654321", remark: "只改备注" });
  });

  it("新填的存规整值", async () => {
    const u = await 造未归属(null);
    expect(await saveUnassignedContact({ id: u.id, name: "王经理", phone: "0086 139-1234-5678" })).toMatchObject({ ok: true });
    expect((await prisma.unassignedContact.findUniqueOrThrow({ where: { id: u.id } })).phone).toBe("13912345678");
  });
});
