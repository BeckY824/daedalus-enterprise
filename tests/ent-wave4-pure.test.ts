/**
 * 11-18 审核第四波（纯函数，不碰库）：前三波没排进的发现。
 *   - 权限 P1-1：条线总管理的列表范围（组织范围of）看本线成员和下属（含别线下属），同详情 能看项目
 *   - 权限 P1-7：更正已固定提成只给系统管理员（同 能改提成比例），条线总管理不行
 *   - 权限 P1-8：填底价 / 改提成分配要负责人本人且按角色能编辑（市场管理当负责人也不行，P-判定-02 例外）
 *   - 权限 P2-2：设了「只看某人」又兼销管的，不能管公海（P-看-09）
 *   - 新建入口 P2-1：新建线索弹窗的联系人电话存规整值（企业版）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 建组织, 填组织设置, type 组织 } from "@/lib/enterprise/org-core";
import { 能看项目, 能管公海 } from "@/lib/enterprise/permissions";
import { 组织范围of } from "@/lib/enterprise/visibility";
import { 能更正提成, 能填底价, 能改提成 } from "@/lib/project/commission-db";
import { 规整只建客户 } from "@/lib/project/wizard";

type 行 = { id: string; bizRole: string; line?: string | null; managerId?: string | null };
function 组织of(们: 行[], 只看?: Record<string, string>): 组织 {
  const org = 建组织(
    们.map((m) => ({ id: m.id, role: "SALES", active: true })),
    们.map((m) => ({ userId: m.id, deptId: null, bizRole: m.bizRole, line: m.line ?? null, managerId: m.managerId ?? null, dottedManagerId: null })),
    [],
  );
  return 只看 ? 填组织设置(org, null, JSON.stringify(只看)) : org;
}

beforeEach(() => vi.stubEnv("CRM_ENTERPRISE", "1"));
afterEach(() => void vi.unstubAllEnvs());

describe("权限 P1-1 条线总管理的列表范围", () => {
  // 线总：外贸条线总管理；外甲：外贸销售、上级是别人（不在线总的下属链上）；内乙：线总的实线下属、在内贸线；内丙：别线别人的下属
  const org = 组织of([
    { id: "线总", bizRole: "director", line: "外贸" },
    { id: "外经理", bizRole: "sales_mgr", line: "外贸" },
    { id: "外甲", bizRole: "sales", line: "外贸", managerId: "外经理" },
    { id: "内乙", bizRole: "sales", line: "内贸", managerId: "线总" },
    { id: "内丙", bizRole: "sales", line: "内贸" },
  ]);
  const 读 = () => { const r = 组织范围of(org, null, "线总"); return r === null ? null : (r.读 ?? r.写); };

  it("看得到本线成员（不在下属链上的外甲），也看得到别线的下属（内乙），和 能看项目 一致", () => {
    expect(读()).toEqual(expect.arrayContaining(["线总", "外经理", "外甲", "内乙"]));
    for (const 谁 of ["外甲", "内乙", "内丙"]) expect(读()!.includes(谁)).toBe(能看项目({ id: "线总" }, { ownerId: 谁 }, org));
  });
  it("别线、又不是下属的看不到；改的范围不扩（本线别人负责的只看）", () => {
    expect(读()).not.toContain("内丙");
    expect(组织范围of(org, null, "线总")!.写).not.toContain("外甲");
  });
  it("对照：普通销管范围不变（只有自己 + 同线实线下属）", () => {
    expect(组织范围of(org, null, "外经理")).toEqual({ 写: ["外经理", "外甲"] });
  });
});

describe("权限 P1-7 / P1-8 提成", () => {
  const org = 组织of([
    { id: "系管", bizRole: "director" },
    { id: "线总", bizRole: "director", line: "内贸" },
    { id: "市管", bizRole: "marketing_mgr" },
    { id: "销售", bizRole: "sales" },
    { id: "渠运市管", bizRole: "channel_ops,marketing_mgr" },
  ]);
  it("更正实际提成：系统管理员能，条线总管理不能", () => {
    expect(能更正提成({ id: "系管", role: "SALES" }, org)).toBe(true);
    expect(能更正提成({ id: "线总", role: "SALES" }, org)).toBe(false);
  });
  it("市场管理当负责人：不能填底价、不能改分配；销售负责人照旧能", () => {
    expect(能填底价({ id: "市管", role: "SALES" }, { ownerId: "市管" }, org)).toBe(false);
    expect(能改提成({ id: "市管", role: "SALES" }, { ownerId: "市管" }, org)).toBe(false);
    expect(能填底价({ id: "销售", role: "SALES" }, { ownerId: "销售" }, org)).toBe(true);
    expect(能改提成({ id: "销售", role: "SALES" }, { ownerId: "销售" }, org)).toBe(true);
  });
  it("多角色取并集：渠运兼市管当负责人能填；不是负责人、在公海的照旧不能；系统管理员不代填底价但能改分配", () => {
    expect(能填底价({ id: "渠运市管", role: "SALES" }, { ownerId: "渠运市管" }, org)).toBe(true);
    expect(能填底价({ id: "销售", role: "SALES" }, { ownerId: "销售", pooledAt: new Date() }, org)).toBe(false);
    expect(能填底价({ id: "系管", role: "SALES" }, { ownerId: "销售" }, org)).toBe(false);
    expect(能改提成({ id: "系管", role: "SALES" }, { ownerId: "销售" }, org)).toBe(true);
  });
});

describe("权限 P2-2 只看某人兼销管", () => {
  it("能管公海 = false；对照：不设只看某人的销管 = true", () => {
    const 们 = [{ id: "看", bizRole: "sales_mgr" }, { id: "目标", bizRole: "sales" }];
    expect(能管公海({ id: "看", role: "SALES" }, 组织of(们, { 看: "目标" }))).toBe(false);
    expect(能管公海({ id: "看", role: "SALES" }, 组织of(们))).toBe(true);
  });
});

describe("新建入口 P2-1 新建线索弹窗联系人电话存规整值", () => {
  const 跟进 = { type: "PHONE", content: "聊过", occurredAt: new Date().toISOString() };
  const 电话of = (phone: string, 企业: boolean) => {
    const r = 规整只建客户({ 联系人: { name: "张三", phone }, 跟进 } as never, new Date(), 企业);
    return "error" in r ? r.error : r.联系人.phone;
  };
  it("企业版：+86 带空格的存 11 位；国外号留 +；座机照存", () => {
    expect(电话of("+86 138 0000 1111", true)).toBe("13800001111");
    expect(电话of("138-0000-1111", true)).toBe("13800001111");
    expect(电话of("+1 415 555 0132", true)).toBe("+14155550132");
    expect(电话of("0571-88888888", true)).toBe("057188888888");
  });
  it("不是企业版照原样", () => {
    expect(电话of("+86 138 0000 1111", false)).toBe("+86 138 0000 1111");
  });
});
