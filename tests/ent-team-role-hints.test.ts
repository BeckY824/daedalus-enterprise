/**
 * 项目组卡片（11-03 B5-2 / B5-4）：换角色后说「已改成 X」；拒绝过的人再邀，角色默认带上次的。
 */
import { describe, it, expect } from "vitest";
import { 换角色提示, 再邀默认角色 } from "@/lib/project/team-ui";

const 角色们 = [
  { id: "r1", name: "技术支持", active: true },
  { id: "r2", name: "商务", active: true },
  { id: "r3", name: "老角色", active: false },
];

describe("换角色提示（B5-2）", () => {
  it("换成某个角色：已改成 + 角色名", () => {
    expect(换角色提示(角色们, "r2")).toBe("已改成商务");
  });
  it("清掉角色", () => {
    expect(换角色提示(角色们, null)).toBe("已清掉角色");
    expect(换角色提示(角色们, undefined)).toBe("已清掉角色");
  });
  it("角色找不到时不瞎写名字", () => {
    expect(换角色提示(角色们, "不存在")).toBe("已换角色");
  });
});

describe("再邀默认角色（B5-4）", () => {
  const 组员们 = [
    { userId: "u1", roleId: "r1", inviteStatus: "DECLINED" },
    { userId: "u2", roleId: "r2", inviteStatus: "JOINED" },
    { userId: "u3", roleId: "r3", inviteStatus: "DECLINED" },
    { userId: "u4", roleId: null, inviteStatus: "DECLINED" },
  ];
  it("拒绝过的人：带上次邀请的角色", () => {
    expect(再邀默认角色(组员们, 角色们, "u1")).toBe("r1");
  });
  it("没拒绝过 / 没在组里的人：不带", () => {
    expect(再邀默认角色(组员们, 角色们, "u2")).toBeUndefined();
    expect(再邀默认角色(组员们, 角色们, "u9")).toBeUndefined();
    expect(再邀默认角色(组员们, 角色们, undefined)).toBeUndefined();
  });
  it("上次的角色已停用或没选：不带", () => {
    expect(再邀默认角色(组员们, 角色们, "u3")).toBeUndefined();
    expect(再邀默认角色(组员们, 角色们, "u4")).toBeUndefined();
  });
});
