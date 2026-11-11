/**
 * 系统管理员和业务线并存（P-判定-06）。
 *
 * 钉的是：
 *   - 总管理带「系统管理员」标记又设了业务线：系统管理员的全局权限全在（设置、真删、回收站、切换视图、导入导出那一档、别线的看 / 改 / 转 / 删、
 *     公海不限线、改后台设置每一项、市场复核兜底），同时还是这条线的条线总管理（条线的线、条线范围of）
 *   - 总管理没标记、设了线：只是条线总管理（照旧）
 *   - 老数据：总管理没设线、库里没有标记：仍是系统管理员（读时兼容，不用跑迁移）
 *   - 标记里的人不是总管理 / 已停用：不算
 *   - 写操作：给系统管理员设业务线自动带上标记、权限不掉；成员管理的开关只有系统管理员能拨；不能关掉最后一位；没设线的关不掉；去掉总管理角色摘标记
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { 建组织, 填组织设置, 是系统管理员of, 能市场复核, type 组织 } from "@/lib/enterprise/org-core";
import {
  是系统管理员, 能进设置, 能改后台设置, 能真删, 能恢复, 能看全部, 能看项目, 能编辑项目, 能转让项目, 能删除, 能删一些, 能改客户, 能转让客户,
  转自己客户要申请, 业务线放行, type 权限项目,
} from "@/lib/enterprise/permissions";
import { 条线的线, 条线范围of } from "@/lib/enterprise/line-viewer";
import { 能切换视图 } from "@/lib/enterprise/view-as";
import { 能改设置, 设置项们 } from "@/lib/enterprise/edit-perm-table";
import { 公海操作限线 } from "@/lib/enterprise/pool-line-guard";

type 行 = { id: string; bizRole: string; line?: string | null; managerId?: string | null; active?: boolean };

function 组织of(们: 行[], 标记?: string[] | null): 组织 {
  const org = 建组织(
    们.map((m) => ({ id: m.id, role: "SALES", active: m.active ?? true })),
    们.map((m) => ({ userId: m.id, deptId: null, bizRole: m.bizRole, line: m.line ?? null, managerId: m.managerId ?? null, dottedManagerId: null })),
    [],
  );
  return 填组织设置(org, null, null, 标记 === undefined ? null : JSON.stringify(标记));
}

const 人们: 行[] = [
  { id: "boss", bizRole: "director", line: "内贸" },
  { id: "lineDir", bizRole: "director,sales_mgr", line: "外贸" },
  { id: "oldDir", bizRole: "director" },
  { id: "sIn", bizRole: "sales", line: "内贸" },
  { id: "sOut", bizRole: "sales", line: "外贸", managerId: "lineDir" },
  { id: "mkt", bizRole: "marketing_mgr", line: "外贸" },
];
const 当 = (id: string) => ({ id, role: "SALES" });
/** 外贸销售负责的项目（不是 boss 这条线） */
const 外贸项目: 权限项目 = { ownerId: "sOut", creatorId: "mkt", pooledAt: null, bizLine: "外贸" };
const 外贸客户 = { salesOwnerId: "sOut", 在公海: false };

beforeEach(() => vi.stubEnv("CRM_ENTERPRISE", "1"));

describe("有标记 + 设了线：系统管理员权限全在，同时是本线条线总管理", () => {
  const org = 组织of(人们, ["boss"]);
  const me = 当("boss");

  it("系统管理员那一档全在", () => {
    expect(是系统管理员of(org, "boss")).toBe(true);
    expect(是系统管理员(me, org)).toBe(true);
    expect(能进设置(me, org)).toBe(true);
    expect(能改后台设置(me, org)).toBe(true);
    expect(能真删(me, org)).toBe(true);
    expect(能恢复(me, org)).toBe(true);
    expect(能切换视图(org, "boss")).toBe(true);
    expect(能看全部(me, org)).toBe(true);
    expect(转自己客户要申请(me, org)).toBe(false);
    for (const 项 of 设置项们) expect(能改设置(org, me, 项, {})).toBe(true);
    // 没人能复核时兜底到系统管理员
    expect(能市场复核(org, "boss", { creatorId: null, ownerId: "sOut" })).toBe(true);
  });

  it("别的线不被收窄：看、改、转、删外贸的，公海不限线，下属不按线滤", () => {
    expect(能看项目(me, 外贸项目, org)).toBe(true);
    expect(能编辑项目(me, 外贸项目, org)).toBe(true);
    expect(能转让项目(me, 外贸项目, org)).toBe(true);
    expect(能删除(me, org, "sOut")).toBe(true);
    expect(能删一些(me, org)).toBe(true);
    expect(能改客户(me, 外贸客户, org)).toBe(true);
    expect(能转让客户(me, 外贸客户, org)).toBe(true);
    expect(能转让项目(me, { ...外贸项目, pooledAt: new Date(), ownerId: "sOut" }, org)).toBe(true);
    expect(公海操作限线(me, org)).toBeNull();
    expect(业务线放行(org, "boss", { ownerId: "sOut" })).toBe(true);
  });

  it("同时是内贸线的条线总管理（三态提醒第三级、只读横幅按这个认）", () => {
    expect(条线的线(org, "boss")).toBe("内贸");
    expect(条线范围of(org, "boss")?.人们).toEqual(expect.arrayContaining(["boss", "sIn"]));
    expect(条线范围of(org, "boss")?.人们).not.toContain("sOut");
  });
});

describe("总管理没标记 + 设了线：只是条线总管理（照旧）", () => {
  const org = 组织of(人们, ["boss"]);
  const me = 当("lineDir");

  it("不是系统管理员，进不了设置、切不了视图、不能真删", () => {
    expect(是系统管理员(me, org)).toBe(false);
    expect(能进设置(me, org)).toBe(false);
    expect(能真删(me, org)).toBe(false);
    expect(能切换视图(org, "lineDir")).toBe(false);
    expect(能看全部(me, org)).toBe(false);
    expect(能改设置(org, me, "线索配额", {})).toBe(true);
    expect(设置项们.filter((项) => 项 !== "线索配额").some((项) => 能改设置(org, me, 项, {}))).toBe(false);
    expect(公海操作限线(me, org)).toBe("外贸");
  });

  it("是外贸线条线总管理：看本线，别线的看不到、改不了", () => {
    expect(条线的线(org, "lineDir")).toBe("外贸");
    expect(能看项目(me, 外贸项目, org)).toBe(true);
    expect(能编辑项目(me, 外贸项目, org)).toBe(false);
    expect(能看项目(me, { ownerId: "sIn", pooledAt: null, bizLine: "内贸" }, org)).toBe(false);
    expect(业务线放行(org, "lineDir", { ownerId: "sIn" })).toBe(false);
  });
});

describe("老数据（读时兼容）", () => {
  it("总管理没设线、库里没有标记：仍是系统管理员，不是条线总管理", () => {
    for (const 标记 of [undefined, null, []] as const) {
      const org = 组织of(人们, 标记 as string[] | null | undefined);
      expect(是系统管理员(当("oldDir"), org)).toBe(true);
      expect(能进设置(当("oldDir"), org)).toBe(true);
      expect(能切换视图(org, "oldDir")).toBe(true);
      expect(条线的线(org, "oldDir")).toBeNull();
      // 没标记时 boss（设了线）只是条线总管理
      expect(是系统管理员(当("boss"), org)).toBe(false);
    }
  });

  it("标记存坏了、标的人不是总管理、已停用：都不算", () => {
    const 坏 = 填组织设置(建组织([{ id: "boss", role: "SALES", active: true }], [{ userId: "boss", deptId: null, bizRole: "director", line: "内贸", managerId: null, dottedManagerId: null }], []), null, null, "{坏");
    expect(是系统管理员of(坏, "boss")).toBe(false);
    const org = 组织of([...人们, { id: "gone", bizRole: "director", line: "内贸", active: false }], ["sIn", "gone", "mkt"]);
    expect(是系统管理员of(org, "sIn")).toBe(false);
    expect(是系统管理员of(org, "mkt")).toBe(false);
    expect(是系统管理员of(org, "gone")).toBe(false);
    expect(能进设置(当("sIn"), org)).toBe(false);
  });

  it("逗号串（手写）也认", () => {
    const org = 填组织设置(组织of(人们), null, null, "boss, lineDir");
    expect(是系统管理员of(org, "boss")).toBe(true);
    expect(是系统管理员of(org, "lineDir")).toBe(true);
  });
});
