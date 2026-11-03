/**
 * 企业版权限只认业务角色（lib/enterprise/permissions.ts，11-01 用户定），规则按 V3.5.1 四权矩阵（11-03）。纯函数，不碰库。
 *
 *   「账号只保持姓名，角色才是他们的实际权限」「兜底不留，没设业务角色就没权限」
 *
 * 钉的是：
 *   - 每个业务角色 × 每个动作的一张表（含管理员 admin：看全部、任何写都拒；系统管理员 = 总管理没设业务线）
 *   - 账号角色（ADMIN / MANAGER）不再放行：账号 ADMIN 没设业务角色 = 什么都不能做
 *   - 销售（sales）对外叫「销售成员」
 *   - 管理类成员按自己的业务线（EntMember.line）过滤下属的项目
 *   - 总管理勾了「不管设置」进不了设置、改不了后台设置，别的照旧
 *   - 切换视图、进设置、回收站、真删只有系统管理员；回收站副手能恢复
 *   - 条线总管理（总管理设了业务线）：看本线、条线内转让，不编辑、不删、不进设置
 *   - 转让只到直属一级；项目组员当负责人能编辑、不能转、不能删
 *   - 没设业务角色只看公海；领公海：销售、销管、总管理
 *   - 只看某人：只看那个人的、公海照常、什么都不能改；角色挂着市场管理也不算管理员（不收提醒、不管渠道、不做市场复核）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { 建组织, 规整只看某人, 上级设置问题, 填组织设置, 管理员类别们of, type 组织 } from "@/lib/enterprise/org-core";
import { 能管渠道, 能录投入 } from "@/lib/enterprise/channel-stats";
import { 满额提醒收件人 } from "@/lib/enterprise/lead-full-notice";
import { 能拍板, 有市场管理 } from "@/lib/project/lead-verify";
import {
  能看项目, 能编辑项目, 能转让项目, 能放回公海, 能分配线索, 能管公海, 能删除, 能恢复, 能进设置, 能改后台设置,
  只读角色, 能看全部, 是总管理, 没设业务角色, 能真删, 能领公海, 能删一些, 能转让客户, 能改客户, 只看的人, 是管理层, type 权限项目,
} from "@/lib/enterprise/permissions";
import { 能切换视图 } from "@/lib/enterprise/view-as";
import { 能加组员 } from "@/lib/project/db";
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

describe("角色 × 动作（项目：负责人 s、市场 mkt 建的、项目组员 ops 已加入）", () => {
  const T = true, F = false;
  //                看     编辑  转让  放回公海 分线索 管公海 删除  回收站 进设置 改设置 切视图
  const 表: Record<string, boolean[]> = {
    dir: [T, T, T, T, T, T, T, T, T, T, T], // 系统管理员（V3.5.1）：四权全有
    adm: [T, F, F, F, F, F, F, F, F, F, F], // 只读：设置、切视图也只给系统管理员
    mgr: [T, F, T, T, T, T, F, F, F, F, F], // s 的直属上级：能转、不能编辑、不能删别人的
    s: [T, T, T, T, F, F, T, F, F, F, F], // 负责人：编辑、转出、软删自己的
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
      能分配线索(me, org), 能管公海(me, org), 能删除(me, org, 项目.ownerId), 能恢复(me, org), 能进设置(me, org), 能改后台设置(me, org),
      能切换视图(org, id),
    ]).toEqual(期望);
  });
});

describe("没设业务角色 = 只看公海（QA #2、V3.5.1）", () => {
  it("没有组织那一行、角色串空着、全是不认识的角色：都算没设，账号 ADMIN / MANAGER 也一样；只看得到公海、领不了", () => {
    const o = 组织of([{ id: "怪", role: "MANAGER", bizRole: "boss,root" }, { id: "空", role: "ADMIN", bizRole: "" }], [{ id: "无行", role: "ADMIN" }]);
    for (const id of ["怪", "空", "无行"]) {
      expect(没设业务角色(o, id), id).toBe(true);
      const me = { id, role: "ADMIN" };
      expect([能看全部(me, o), 是总管理(me, o), 能看项目(me, 项目, o), 能删除(me, o, id), 能进设置(me, o), 能切换视图(o, id), 能领公海(me, o)], id).toEqual([false, false, false, false, false, false, false]);
      expect(能看项目(me, 公海项目, o), id).toBe(true);
    }
  });
  it("企业版里没传组织（读不到）一律拒，不留后门", () => {
    const me = { id: "dir", role: "ADMIN" };
    expect([能看全部(me, null), 能看项目(me, 公海项目, null), 能删除(me, null, "dir"), 能进设置(me, null), 能分配线索(me, null), 能恢复(me, null), 能领公海(me, null)]).toEqual([false, false, false, false, false, false, false]);
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
    expect([能看全部(me, o), 能删除(me, o, "没勾"), 能恢复(me, o), 能转让项目(me, { ownerId: "没勾" }, o), 能分配线索(me, o), 能切换视图(o, "勾了")]).toEqual([true, true, true, true, true, true]);
    expect(能改后台设置({ id: "没勾" }, o)).toBe(true);
  });
});

describe("能管公海（分给同事、撤销分配、放回别人的、标无效）", () => {
  it("只有总管理、销售管理；市场管理、管理员、销售、没角色都不行", () => {
    expect(["dir", "mgr", "mkt", "adm", "s", "bare"].map((id) => 能管公海(当(id), org))).toEqual([true, true, false, false, false, false]);
  });
});

describe("公海里的项目", () => {
  it("谁都看得到（没设角色的也只看公海）；谁都改不了（先领）；只有总管理、销售管理能指给人", () => {
    expect(["dir", "mgr", "s", "s2", "mkt", "ops", "bare"].map((id) => 能看项目(当(id), 公海项目, org))).toEqual([true, true, true, true, true, true, true]);
    expect(["dir", "s"].map((id) => 能编辑项目(当(id), 公海项目, org))).toEqual([false, false]);
    expect(["dir", "mgr", "s", "adm"].map((id) => 能转让项目(当(id), 公海项目, org))).toEqual([true, true, false, false]);
    expect(能放回公海(当("dir"), 公海项目, org)).toBe(false);
  });
});

describe("条线总管理（总管理设了业务线，V3.5.1）", () => {
  const o = 组织of([
    { id: "系统", bizRole: "director" },
    { id: "线总", bizRole: "director", line: "外贸" },
    { id: "外贸经理", bizRole: "sales_mgr", line: "外贸", managerId: "线总" },
    { id: "外贸销售", bizRole: "sales", line: "外贸", managerId: "外贸经理" },
    { id: "内贸销售", bizRole: "sales", line: "内贸" },
  ]);
  const me = { id: "线总" };
  const 外贸项目: 权限项目 = { ownerId: "外贸销售" };
  const 内贸项目: 权限项目 = { ownerId: "内贸销售" };
  it("看本线人员的项目、看不到线外的；不编辑；条线内能转、线外不能", () => {
    expect([能看项目(me, 外贸项目, o), 能看项目(me, 内贸项目, o), 能看全部(me, o)]).toEqual([true, false, false]);
    expect([能编辑项目(me, 外贸项目, o), 能编辑项目(me, { ownerId: "线总" }, o)]).toEqual([false, false]);
    expect([能转让项目(me, 外贸项目, o), 能转让项目(me, 内贸项目, o), 能放回公海(me, 外贸项目, o)]).toEqual([true, false, true]);
    expect(能转让客户(me, { salesOwnerId: "外贸销售", 在公海: false }, o)).toBe(true);
    expect(能改客户(me, { salesOwnerId: "外贸销售", 在公海: false }, o)).toBe(false);
  });
  it("不能删（自己名下的也不行）、不进设置、不切视图、不进回收站；能领公海", () => {
    expect([能删除(me, o, "外贸销售"), 能删除(me, o, "线总"), 能删一些(me, o), 能真删(me, o), 能恢复(me, o)]).toEqual([false, false, false, false, false]);
    expect([是总管理(me, o), 能进设置(me, o), 能切换视图(o, "线总"), 能领公海(me, o)]).toEqual([false, false, false, true]);
  });
  it("没设业务线的总管理才是系统管理员", () => {
    expect([是总管理({ id: "系统" }, o), 能切换视图(o, "系统"), 能真删({ id: "系统" }, o)]).toEqual([true, true, true]);
  });
});

describe("转让只到直属一级（V3.5.1 白名单）", () => {
  const o = 组织of([
    { id: "mgr2", bizRole: "sales_mgr" },
    { id: "mgr", bizRole: "sales_mgr", managerId: "mgr2" },
    { id: "s", bizRole: "sales", managerId: "mgr" },
    { id: "s2", bizRole: "sales" },
  ]);
  it("直属上级能转；二级上级看得到、转不了；同事转不了", () => {
    const p: 权限项目 = { ownerId: "s" };
    expect([能转让项目({ id: "mgr" }, p, o), 能转让项目({ id: "mgr2" }, p, o), 能转让项目({ id: "s2" }, p, o)]).toEqual([true, false, false]);
    expect(能看项目({ id: "mgr2" }, p, o)).toBe(true);
    expect([能转让客户({ id: "mgr" }, { salesOwnerId: "s", 在公海: false }, o), 能转让客户({ id: "mgr2" }, { salesOwnerId: "s", 在公海: false }, o)]).toEqual([true, false]);
  });
  it("销管只能删自己负责的", () => {
    expect([能删除({ id: "mgr" }, o, "mgr"), 能删除({ id: "mgr" }, o, "s"), 能删一些({ id: "mgr" }, o)]).toEqual([true, false, true]);
  });
});

describe("项目组员（project_ops）", () => {
  const p: 权限项目 = { ownerId: "ops" };
  it("被指定为负责人能编辑，不能转、不能删、不能领公海", () => {
    expect([能编辑项目(当("ops"), p, org), 能转让项目(当("ops"), p, org), 能删除(当("ops"), org, "ops"), 能删一些(当("ops"), org), 能领公海(当("ops"), org)]).toEqual([true, false, false, false, false]);
    expect(能改客户(当("ops"), { salesOwnerId: "ops", 在公海: false }, org)).toBe(true);
  });
  it("加入了的项目能往里加人；没加入、项目在公海、别的角色只是加入了都不行", () => {
    const 别人的 = { ownerId: "s", pooledAt: null };
    expect([能加组员(当("ops"), 别人的, org, true), 能加组员(当("ops"), 别人的, org, false), 能加组员(当("ops"), { ...别人的, pooledAt: new Date() }, org, true)]).toEqual([true, false, false]);
    expect([能加组员(当("s2"), 别人的, org, true), 能加组员(当("adm"), 别人的, org, true), 能加组员(当("s"), 别人的, org, false)]).toEqual([false, false, true]);
  });
});

describe("回收站副手、真删", () => {
  it("副手能恢复，不能真删；不在组织里的副手不算", () => {
    const o: 组织 = { ...org, 回收站副手: new Set(["adm", "已离职"]) };
    expect([能恢复(当("adm"), o), 能真删(当("adm"), o), 能恢复({ id: "已离职" }, o)]).toEqual([true, false, false]);
    expect(能恢复(当("adm"), org)).toBe(false);
  });
  it("真删只有系统管理员", () => {
    expect(["dir", "adm", "mgr", "s", "mkt", "ops", "bare"].map((id) => 能真删(当(id), org))).toEqual([true, false, false, false, false, false, false]);
  });
});

describe("领公海（V3.5.1）", () => {
  it("销售、销管、总管理能领；管理员只读、市管、项目组员、没设角色的不能", () => {
    expect(["dir", "mgr", "s", "s2", "adm", "mkt", "ops", "bare"].map((id) => 能领公海(当(id), org))).toEqual([true, true, true, true, false, false, false, false]);
  });
});

describe("渠运（channel_ops，V3.5.1）", () => {
  const o = 组织of([{ id: "ch", bizRole: "channel_ops", managerId: "mkt" }, { id: "mkt", bizRole: "marketing_mgr" }, { id: "s", bizRole: "sales" }]);
  it("自己负责的能编辑、转出、软删；不领公海；别人的改不了", () => {
    const 自持: 权限项目 = { ownerId: "ch", creatorId: "ch" };
    expect([能编辑项目({ id: "ch" }, 自持, o), 能转让项目({ id: "ch" }, 自持, o), 能删除({ id: "ch" }, o, "ch"), 能领公海({ id: "ch" }, o)]).toEqual([true, true, true, false]);
    expect(能编辑项目({ id: "ch" }, { ownerId: "s", creatorId: "ch" }, o)).toBe(false);
    expect([能改客户({ id: "ch" }, { salesOwnerId: "ch", 在公海: false }, o), 能转让客户({ id: "ch" }, { salesOwnerId: "ch", 在公海: false }, o)]).toEqual([true, true]);
  });
});

describe("只看某人（V3.5.1 特例）", () => {
  const 基 = 组织of([{ id: "w", bizRole: "marketing_mgr" }, { id: "t", bizRole: "sales" }, { id: "s", bizRole: "sales" }]);
  const o: 组织 = { ...基, 只看某人: 规整只看某人(JSON.stringify({ w: "t" }), 基) };
  it("规整：坏 JSON、数组、自己看自己、不在职的都丢掉", () => {
    expect(规整只看某人("{坏", 基).size).toBe(0);
    expect(规整只看某人("[1]", 基).size).toBe(0);
    expect([...规整只看某人(JSON.stringify({ w: "w", t: "已离职", 已离职: "s", s: "t" }), 基)]).toEqual([["s", "t"]]);
    expect(只看的人(o, "w")).toBe("t");
    expect(只看的人(o, "t")).toBe(null);
  });
  it("存法：设置页存 JSON（数组 / 对象，包了两层也认），手写的逗号串也认", () => {
    const 填 = (副手: string | null, 只看: string | null) => 填组织设置({ ...基, 回收站副手: new Set(), 只看某人: new Map() }, 副手, 只看);
    expect([...填(JSON.stringify(["w", "已离职", 1]), null).回收站副手!]).toEqual(["w"]);
    expect([...填(" w , t ", null).回收站副手!]).toEqual(["w", "t"]);
    expect([...填(null, JSON.stringify(JSON.stringify({ w: "t" }))).只看某人!]).toEqual([["w", "t"]]);
    expect([填(null, null).回收站副手?.size, 填(null, null).只看某人?.size]).toEqual([0, 0]);
  });
  it("看得到 那个人 负责 / 创建的；编辑、转让、删除、领公海一律不行", () => {
    const p: 权限项目 = { ownerId: "t", creatorId: "s" };
    const 自建: 权限项目 = { ownerId: "s", creatorId: "w" };
    expect([能看项目({ id: "w" }, p, o), 能看项目({ id: "w" }, 自建, o), 能看项目({ id: "w" }, { ownerId: "s", creatorId: "s" }, o), 能看项目({ id: "w" }, 公海项目, o)]).toEqual([true, true, false, true]);
    expect([能编辑项目({ id: "w" }, { ownerId: "w" }, o), 能转让项目({ id: "w" }, { ownerId: "w" }, o), 能删除({ id: "w" }, o, "w"), 能删一些({ id: "w" }, o), 能领公海({ id: "w" }, o)]).toEqual([false, false, false, false, false]);
    expect([能改客户({ id: "w" }, { salesOwnerId: "w", 在公海: false }, o), 能转让客户({ id: "w" }, { salesOwnerId: "w", 在公海: false }, o)]).toEqual([false, false]);
  });
  it("角色挂着市场管理也不算管理员：不收满额 / 待分配提醒，不管渠道、不录投入、不做市场复核、不分线索（11-03）", () => {
    expect([管理员类别们of(基, "w").has("市场管理"), 管理员类别们of(o, "w").size]).toEqual([true, 0]);
    expect([满额提醒收件人(o), 满额提醒收件人(o, "待分配"), 满额提醒收件人(基)]).toEqual([[], [], ["w"]]);
    expect([能管渠道(o, { id: "w", role: "SALES" }), 能录投入(o, { id: "w", role: "SALES" }), 能管渠道(基, { id: "w", role: "SALES" })]).toEqual([false, false, true]);
    expect([能拍板({ id: "w", role: "SALES" }, "市场复核", { ownerId: "s" }, o), 有市场管理(o), 有市场管理(基)]).toEqual([false, false, true]);
    expect([能分配线索({ id: "w" }, o), 是管理层({ id: "w" }, o), 能分配线索({ id: "w" }, 基), 是管理层({ id: "w" }, 基)]).toEqual([false, false, true, true]);
  });
  it("不能当别人的实线上级；虚线照旧", () => {
    expect(上级设置问题(o, "s", "w", "直属")).toMatch("只看某人");
    expect(上级设置问题(o, "s", "w", "虚线")).toBe(null);
    expect(上级设置问题(o, "s", "t", "直属")).toBe(null);
  });
});
