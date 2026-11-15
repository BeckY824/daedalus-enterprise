/**
 * 设置页按登录身份（P-界面-46）+ PR10b ④：原来 SettingsBody 里 只读 = 可进 && !可改，而 可进 和 可改 是同一个判断，只读恒为 false。
 * 现在身份只认业务角色（lib/enterprise/settings-scope.ts）：
 *   系统管理员 全看全改；只读管理员（admin、没设线）看得见、改不了（只读 = true）；设了线的管理员、条线总管理、销管、市管、销售 只个人；
 *   勾了「不管设置」的系统管理员 只个人
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 读组织 } from "@/lib/enterprise/org";
import { 设置范围of } from "@/lib/enterprise/settings-scope";

const ids: Record<string, string> = {};
beforeEach(async () => {
  vi.stubEnv("CRM_ENTERPRISE", "1");
  await resetDb();
  const 建人 = async (k: string, bizRole: string, line: string | null = null, noSettings = false) => {
    const id = (await prisma.user.create({ data: { email: k, name: k, title: "", role: "SALES", password: "x" } })).id;
    await prisma.entMember.create({ data: { userId: id, bizRole, line, noSettings } });
    ids[k] = id;
  };
  await 建人("sys", "director");
  await 建人("sysOff", "director", null, true);
  await 建人("linedir", "director", "外贸");
  await 建人("adm", "admin");
  await 建人("admLine", "admin", "内贸");
  await 建人("smgr", "sales_mgr");
  await 建人("mmgr", "marketing_mgr");
  await 建人("s", "sales");
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("设置范围of", () => {
  it("各身份：看不看得到后台设置、改不改得了、是不是只读", async () => {
    const org = await 读组织();
    const 看 = (k: string) => 设置范围of({ id: ids[k], role: "SALES" }, org, true);
    expect(看("sys")).toEqual({ 身份: "系统管理员", 可看: true, 可改: true, 只读: false, 只个人: false });
    // ④ 只读管理员：看得见、改不了——只读不再恒为 false
    expect(看("adm")).toEqual({ 身份: "只读管理员", 可看: true, 可改: false, 只读: true, 只个人: false });
    for (const k of ["sysOff", "linedir", "admLine", "smgr", "mmgr", "s"]) {
      expect(看(k), k).toEqual({ 身份: "成员", 可看: false, 可改: false, 只读: false, 只个人: true });
    }
  });

  it("不是企业版：账号 ADMIN 全看全改，别人不只个人（老规矩）", () => {
    expect(设置范围of({ id: "x", role: "ADMIN" }, null, false)).toMatchObject({ 可看: true, 可改: true, 只读: false });
    expect(设置范围of({ id: "x", role: "SALES" }, null, false)).toMatchObject({ 可看: false, 只个人: false });
  });
});
