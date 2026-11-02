/**
 * 企业版权限只认业务角色（lib/enterprise/permissions.ts，11-01 用户定）。纯函数，不碰库。
 *
 *   「账号只保持姓名，角色才是他们的实际权限」「兜底不留，没设业务角色就没权限」
 *
 * 钉的是：
 *   - 每个业务角色 × 每个动作的一张表（含管理员 admin：看全部、任何写都拒）
 *   - 账号角色（ADMIN / MANAGER）不再放行：账号 ADMIN 没设业务角色 = 什么都不能做
 *   - 销售（sales）对外叫「销售成员」
 *   - 管理类成员按自己的业务线（EntMember.line）过滤下属的项目
 *   - 总管理勾了「不管设置」进不了设置、改不了后台设置，别的照旧
 *   - 切换视图只有总管理、管理员
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 建组织, type 组织 } from "@/lib/enterprise/org-core";
import {
  能看项目, 能编辑项目, 能转让项目, 能放回公海, 能分配线索, 能管公海, 能删除, 能恢复, 能进设置, 能改后台设置,
  只读角色, 能看全部, 是总管理, 没设业务角色, type 权限项目,
} from "@/lib/enterprise/permissions";
import { 能切换视图 } from "@/lib/enterprise/view-as";
import { 角色名 } from "@/lib/sync/dept-policy";

type 行 = { id: string; role?: string; bizRole?: string; line?: string | null; managerId?: string | null; dottedManagerId?: string | null; noSettings?: boolean };

function 组织of(们: 行[], 没行的: { id: string; role: string }[] = []): 组织 {
  return 建组织(
    [...们.map((m) => ({ id: m.id, role: m.role ?? "SALES", active: true })), ...没行的.map((u) => ({ ...u, active: true }))],
    们.map((m) => ({
      userId: m.id, deptId: null, bizRole: m.bizRole ?? "", line: m.line ?? null,
      managerId: m.managerId ?? null, dottedManagerId: m.dottedManagerId ?? null, noSettings: m.noSettings ?? false,
    })),
    [],
  );
}

const 人们: 行[] = [
  { id: "dir", role: "ADMIN", bizRole: "director" },
  { id: "adm", role: "ADMIN", bizRole: "admin" },
  { id: "mgr", role: "MANAGER", bizRole: "sales_mgr" },
  { id: "s", bizRole: "sales", managerId: "mgr" },
  { id: "s2", bizRole: "sales" },
  { id: "mkt", bizRole: "marketing_mgr" },
  { id: "ops", bizRole: "project_ops" },
  { id: "空串", role: "ADMIN", bizRole: "" },
];
const 账号ADMIN没行 = { id: "bare", role: "ADMIN" };
const org = 组织of(人们, [账号ADMIN没行]);
const 当 = (id: string) => ({ id, role: [...人们, 账号ADMIN没行].find((x) => x.id === id)?.role ?? "SALES" });

/** 销售 s 负责、市场 mkt 建的项目 */
const 项目: 权限项目 = { ownerId: "s", creatorId: "mkt", pooledAt: null, 已加入: ["ops"] };
const 公海项目: 权限项目 = { ownerId: "s", creatorId: "mkt", pooledAt: new Date() };

beforeEach(() => vi.stubEnv("CRM_ENTERPRISE", "1"));
afterEach(() => vi.unstubAllEnvs());

describe("角色 × 动作（项目：负责人 s、市场 mkt 建的、项目运营 ops 已加入）", () => {
  const T = true, F = false;
  //                看     编辑  转让  放回公海 分线索 管公海 删除  回收站 进设置 改设置 切视图
  const 表: Record<string, boolean[]> = {
    dir: [T, F, T, T, T, T, T, T, T, T, T],
    adm: [T, F, F, F, F, F, F, F, T, F, T],
    mgr: [T, F, T, T, T, T, F, F, F, F, F],
    s: [T, T, T, T, F, F, F, F, F, F, F], // 11-02 负责人转出自己的
    s2: [F, F, F, F, F, F, F, F, F, F, F],
    mkt: [T, F, F, F, T, F, F, F, F, F, F],
    ops: [T, F, F, F, F, F, F, F, F, F, F],
    空串: [F, F, F, F, F, F, F, F, F, F, F],
    bare: [F, F, F, F, F, F, F, F, F, F, F],
  };
  it.each(Object.entries(表))("%s", (id, 期望) => {
    const me = 当(id);
    expect([
      能看项目(me, 项目, org), 能编辑项目(me, 项目, org), 能转让项目(me, 项目, org), 能放回公海(me, 项目, org),
      能分配线索(me, org), 能管公海(me, org), 能删除(me, org), 能恢复(me, org), 能进设置(me, org), 能改后台设置(me, org),
      能切换视图(org, id),
    ]).toEqual(期望);
  });
});

describe("没设业务角色 = 没权限（QA #2）", () => {
  it("没有组织那一行、角色串空着、全是不认识的角色：都算没设，账号 ADMIN / MANAGER 也一样", () => {
    const o = 组织of([{ id: "怪", role: "MANAGER", bizRole: "boss,root" }, { id: "空", role: "ADMIN", bizRole: "" }], [{ id: "无行", role: "ADMIN" }]);
    for (const id of ["怪", "空", "无行"]) {
      expect(没设业务角色(o, id), id).toBe(true);
      const me = { id, role: "ADMIN" };
      expect([能看全部(me, o), 是总管理(me, o), 能看项目(me, 公海项目, o), 能删除(me, o), 能进设置(me, o), 能切换视图(o, id)], id).toEqual([false, false, false, false, false, false]);
    }
  });
  it("企业版里没传组织（读不到）一律拒，不留后门", () => {
    const me = { id: "dir", role: "ADMIN" };
    expect([能看全部(me, null), 能看项目(me, 项目, null), 能删除(me, null), 能进设置(me, null), 能分配线索(me, null)]).toEqual([false, false, false, false, false]);
  });
  it("停用的人不在组织里：有业务角色也没权限", () => {
    const o = 建组织([{ id: "off", role: "ADMIN", active: false }], [{ userId: "off", deptId: null, bizRole: "director", line: null, managerId: null, dottedManagerId: null }], []);
    expect(是总管理({ id: "off" }, o)).toBe(false);
  });
});

describe("管理员（admin）：看全部、任何写都拒", () => {
  it("只读角色：admin 是；兼了别的角色也是；兼了总管理就不是", () => {
    const o = 组织of([{ id: "a", bizRole: "admin" }, { id: "a+s", bizRole: "admin,sales" }, { id: "a+d", bizRole: "admin,director" }]);
    expect(只读角色({ id: "a" }, o)).toBe(true);
    expect(只读角色({ id: "a+s" }, o)).toBe(true);
    expect(只读角色({ id: "a+d" }, o)).toBe(false);
    // 兼了销售、自己是负责人：照样改不了
    expect(能编辑项目({ id: "a+s" }, { ownerId: "a+s" }, o)).toBe(false);
  });
  it("不是企业版没有只读角色", () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    expect(只读角色({ id: "adm", role: "ADMIN" }, org)).toBe(false);
  });
});

describe("销售对外叫「销售成员」", () => {
  it("角色名.sales = 销售成员（库里存的还是 sales，不改数据）", () => {
    expect(角色名.sales).toBe("销售成员");
    expect(组织of([{ id: "x", bizRole: "sales" }]).成员.get("x")?.bizRole).toBe("sales");
  });
});

describe("业务线过滤（EntMember.line）", () => {
  const o = 组织of([
    { id: "外贸经理", bizRole: "sales_mgr", line: "外贸" },
    { id: "外贸销售", bizRole: "sales", line: "外贸", managerId: "外贸经理" },
    { id: "内贸销售", bizRole: "sales", line: "内贸", managerId: "外贸经理" },
    { id: "没设线", bizRole: "sales", managerId: "外贸经理" },
    { id: "通吃经理", bizRole: "sales_mgr", managerId: null },
    { id: "通吃下属", bizRole: "sales", line: "内贸", managerId: "通吃经理" },
  ]);
  it("外贸的经理只看、只转外贸的下属；下属没设业务线不拦", () => {
    const me = { id: "外贸经理" };
    expect(能看项目(me, { ownerId: "外贸销售" }, o)).toBe(true);
    expect(能看项目(me, { ownerId: "内贸销售" }, o)).toBe(false);
    expect(能转让项目(me, { ownerId: "内贸销售" }, o)).toBe(false);
    expect(能看项目(me, { ownerId: "没设线" }, o)).toBe(true);
  });
  it("经理自己没设业务线：不按业务线拦", () => {
    expect(能看项目({ id: "通吃经理" }, { ownerId: "通吃下属" }, o)).toBe(true);
    expect(能转让项目({ id: "通吃经理" }, { ownerId: "通吃下属" }, o)).toBe(true);
  });
});

describe("不管设置（总管理勾上）", () => {
  const o = 组织of([{ id: "勾了", bizRole: "director", noSettings: true }, { id: "没勾", bizRole: "director" }]);
  it("进不了设置、改不了后台设置；看全部、删除、回收站、转让、分线索、切视图照旧", () => {
    const me = { id: "勾了" };
    expect([能进设置(me, o), 能改后台设置(me, o)]).toEqual([false, false]);
    expect([能看全部(me, o), 能删除(me, o), 能恢复(me, o), 能转让项目(me, { ownerId: "没勾" }, o), 能分配线索(me, o), 能切换视图(o, "勾了")]).toEqual([true, true, true, true, true, true]);
    expect(能改后台设置({ id: "没勾" }, o)).toBe(true);
  });
});

describe("能管公海（分给同事、撤销分配、放回别人的、标无效）", () => {
  it("只有总管理、销售管理；市场管理、管理员、销售、没角色都不行", () => {
    expect(["dir", "mgr", "mkt", "adm", "s", "bare"].map((id) => 能管公海(当(id), org))).toEqual([true, true, false, false, false, false]);
  });
});

describe("公海里的项目", () => {
  it("有业务角色的都看得到；谁都改不了（先领）；只有总管理、销售管理能指给人", () => {
    expect(["dir", "mgr", "s", "s2", "mkt", "ops", "bare"].map((id) => 能看项目(当(id), 公海项目, org))).toEqual([true, true, true, true, true, true, false]);
    expect(["dir", "s"].map((id) => 能编辑项目(当(id), 公海项目, org))).toEqual([false, false]);
    expect(["dir", "mgr", "s", "adm"].map((id) => 能转让项目(当(id), 公海项目, org))).toEqual([true, true, false, false]);
    expect(能放回公海(当("dir"), 公海项目, org)).toBe(false);
  });
});
