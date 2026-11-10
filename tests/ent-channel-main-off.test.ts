/**
 * 主渠道停用连带（P-渠道-13）：主渠道停用后，它下面的子渠道也不出现在来源选择里（客户表单 可选渠道、
 * 建档向导 / 项目编辑 可选渠道们）。子渠道自己的启用不改；没挂主渠道的照旧；编辑时「现在选着的那个」照样带上，名字不丢。
 * 渠道名全是编造的
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { 可选渠道 } from "@/lib/options";
import { 可选渠道们 } from "@/lib/enterprise/channel-options";

let 开着子: string;
let 停主子: string;
let 散的: string;

beforeEach(async () => {
  await resetDb();
  await prisma.user.create({ data: { id: "tester-id", email: "t@t", name: "测试员", role: "ADMIN", password: "x" } });
  const 开主 = await prisma.entChannelMain.create({ data: { name: "示例主渠道甲" } });
  const 停主 = await prisma.entChannelMain.create({ data: { name: "示例主渠道乙", active: false } });
  开着子 = (await prisma.channel.create({ data: { name: "甲下子渠道", mainId: 开主.id, channelOwnerId: "tester-id" } })).id;
  停主子 = (await prisma.channel.create({ data: { name: "乙下子渠道", mainId: 停主.id, channelOwnerId: "tester-id" } })).id;
  散的 = (await prisma.channel.create({ data: { name: "没挂主渠道", channelOwnerId: "tester-id" } })).id;
});
afterAll(() => prisma.$disconnect());

describe("主渠道停用，子渠道不出现在来源选择里", () => {
  it("客户表单的渠道候选（可选渠道）：停用主渠道下的子渠道不列，其余照列", async () => {
    const ids = (await 可选渠道()).map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining([开着子, 散的]));
    expect(ids).not.toContain(停主子);
  });

  it("建档向导 / 项目编辑（可选渠道们）：同样不列；编辑时现在选着的那个照样带上", async () => {
    expect((await 可选渠道们()).map((c) => c.id)).not.toContain(停主子);
    expect((await 可选渠道们(停主子)).map((c) => c.id)).toContain(停主子);
  });

  it("主渠道重新启用：子渠道回到候选里", async () => {
    await prisma.entChannelMain.updateMany({ where: { name: "示例主渠道乙" }, data: { active: true } });
    expect((await 可选渠道()).map((c) => c.id)).toContain(停主子);
    expect((await 可选渠道们()).map((c) => c.id)).toContain(停主子);
  });
});
