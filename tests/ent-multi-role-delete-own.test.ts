/**
 * 一人多个角色，任一角色放行就放行（客户 11-18 第 11 题选 A，P-判定-01）：
 * 条线总管理兼销售管理（或兼销售、渠运这类能删本人负责的角色）能软删自己负责的客户和项目；别人负责的仍按原规则（不能删）。
 * 只是条线总管理（没兼能删的角色）照旧不能删，系统管理员照旧都能删。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 建组织, 填组织设置, type 组织 } from "@/lib/enterprise/org-core";
import { 能删除, 能删一些 } from "@/lib/enterprise/permissions";

type 行 = { id: string; bizRole: string; line?: string | null; managerId?: string | null };
function 组织of(们: 行[]): 组织 {
  const org = 建组织(
    们.map((m) => ({ id: m.id, role: "SALES", active: true })),
    们.map((m) => ({ userId: m.id, deptId: null, bizRole: m.bizRole, line: m.line ?? null, managerId: m.managerId ?? null, dottedManagerId: null })),
    [],
  );
  return 填组织设置(org, null, null);
}

beforeEach(() => vi.stubEnv("CRM_ENTERPRISE", "1"));
afterEach(() => void vi.unstubAllEnvs());

describe("条线总管理兼能删的角色：自己负责的能删，别人负责的不能", () => {
  const org = 组织of([
    { id: "兼", bizRole: "director,sales_mgr,marketing_mgr", line: "外贸" },
    { id: "兼销售", bizRole: "director,sales", line: "内贸" },
    { id: "兼渠运", bizRole: "director,channel_ops", line: "外贸" },
    { id: "线总", bizRole: "director", line: "外贸" },
    { id: "线总兼市管", bizRole: "director,marketing_mgr", line: "外贸" },
    { id: "下属", bizRole: "sales", line: "外贸", managerId: "兼" },
    { id: "总管", bizRole: "director" },
  ]);
  it("兼销售管理：自己负责的客户 / 项目能删", () => {
    expect(能删除({ id: "兼" }, org, "兼")).toBe(true);
    expect(能删一些({ id: "兼" }, org)).toBe(true);
  });
  it("兼销售、兼渠运：自己负责的也能删", () => {
    expect(能删除({ id: "兼销售" }, org, "兼销售")).toBe(true);
    expect(能删除({ id: "兼渠运" }, org, "兼渠运")).toBe(true);
  });
  it("别人负责的（含自己下属的）仍不能删；公海（没负责人）不能删", () => {
    expect(能删除({ id: "兼" }, org, "下属")).toBe(false);
    expect(能删除({ id: "兼" }, org, "线总")).toBe(false);
    expect(能删除({ id: "兼" }, org, null)).toBe(false);
  });
  it("只是条线总管理、或只兼市场管理（都不能删）：照旧不能删", () => {
    expect(能删除({ id: "线总" }, org, "线总")).toBe(false);
    expect(能删一些({ id: "线总" }, org)).toBe(false);
    expect(能删除({ id: "线总兼市管" }, org, "线总兼市管")).toBe(false);
  });
  it("系统管理员（总管理、没设业务线）照旧都能删", () => {
    expect(能删除({ id: "总管" }, org, "下属")).toBe(true);
  });
});
