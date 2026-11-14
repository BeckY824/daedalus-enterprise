import { afterAll, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath() {} }));
const 登录 = vi.hoisted(() => ({ 停用: false }));
vi.mock("@/lib/auth", () => ({ requireUser: async () => { if (登录.停用) throw new Error("NEXT_REDIRECT"); return { id: "export-user", name: "导出测试", role: "ADMIN" }; } }));
import { prisma } from "@/lib/prisma";
import { resetDb } from "./reset";
import { createHash } from "node:crypto";
import { 开始完整导出, 读取完整导出批次, 校验完整导出, 导出客户 } from "@/app/(app)/customers/export-action";

beforeEach(async () => {
  登录.停用 = false;
  await resetDb();
  await prisma.user.create({ data: { id: "export-user", name: "导出测试", email: "export@local", password: "x", role: "ADMIN" } });
});
afterAll(() => prisma.$disconnect());

async function 收全(条件 = {}) {
  const start = await 开始完整导出(条件);
  const fingerprints: { 类别: "客户" | "跟进"; 指纹: string }[] = [];
  const customers: string[] = [], follows: string[] = [];
  for (const kind of ["客户", "跟进"] as const) {
    let cursor: string | undefined;
    do {
      const r = await 读取完整导出批次(条件, start.截止, kind, cursor);
      (kind === "客户" ? customers : follows).push(...r.rows.map((x) => x.id));
      expect(r.rows.length).toBeLessThanOrEqual(kind === "客户" ? 5000 : 10000);
      fingerprints.push({ 类别: kind, 指纹: r.指纹 });
      cursor = r.游标 ?? undefined;
    } while (cursor);
  }
  return { start, fingerprints, customers, follows };
}

it("W025：超过旧2万客户/5万跟进上限，分批无遗漏无重复且只含筛选客户", async () => {
  const at = new Date("2026-01-01");
  for (let i = 0; i < 20_002; i += 500) await prisma.customer.createMany({ data: Array.from({ length: Math.min(500, 20_002 - i) }, (_, k) => ({ id: `c${String(i+k).padStart(5, "0")}`, name: `客户${i+k}`, phone: String(i+k), school: i+k === 20001 ? "排除" : "目标", salesOwnerId: "export-user", createdAt: at, updatedAt: at })) });
  for (let i = 0; i < 50_002; i += 1000) await prisma.followUp.createMany({ data: Array.from({ length: Math.min(1000, 50_002 - i) }, (_, k) => ({ id: `f${String(i+k).padStart(5, "0")}`, customerId: i+k === 50001 ? "c20001" : `c${String((i+k)%20001).padStart(5,"0")}`, ownerId: "export-user", type: "PHONE", title: "回电", content: "内容", createdAt: at, updatedAt: at })) });
  const result = await 收全({ keyword: "目标" });
  expect(result.start).toMatchObject({ 客户数: 20001, 跟进数: 50001 });
  expect(new Set(result.customers).size).toBe(20001);
  expect(new Set(result.follows).size).toBe(50001);
  expect(result.customers).not.toContain("c20001");
  expect(result.follows).not.toContain("f50001");
  expect(await 校验完整导出({ keyword: "目标" }, result.start, result.fingerprints)).toEqual({ ok: true });
}, 120_000);

it("W025：旧有界出口只读取实际入选客户的跟进，未入选客户不挤占额度", async () => {
  const at = new Date("2026-01-01");
  for (let i = 0; i < 20001; i += 500) await prisma.customer.createMany({ data: Array.from({ length: Math.min(500, 20001-i) }, (_, k) => ({ id: `c${String(i+k).padStart(5,"0")}`, name: "客户", phone: String(i+k), salesOwnerId: "export-user", createdAt: i+k === 0 ? new Date("2019-01-01") : at, updatedAt: at })) });
  // c00000是旧入口未入选的最后一位，它的较新跟进不能把选中客户的旧跟进挤掉。
  for (let i = 0; i < 50001; i += 1000) await prisma.followUp.createMany({ data: Array.from({ length: Math.min(1000, 50001-i) }, (_, k) => ({ customerId: "c00000", ownerId: "export-user", type: "PHONE", title: "不应入选", content: String(i+k), occurredAt: new Date("2026-08-01") })) });
  await prisma.followUp.create({ data: { customerId: "c00001", ownerId: "export-user", type: "PHONE", title: "必须保留", content: "选中客户", occurredAt: at } });
  const r = await 导出客户({});
  expect(r).toMatchObject({ ok: true, 截断了: true, 跟进截断了: false, 跟进: [{ title: "必须保留" }] });
}, 120_000);

it.each(["修改", "删除", "外贸旁表", "跟进", "遗漏批次"])("完整导出拒绝%s造成的不一致", async (kind) => {
  const at = new Date("2026-01-01");
  await prisma.customer.create({ data: { id: "c", name: "客户", phone: "13800000001", salesOwnerId: "export-user", createdAt: at, updatedAt: at } });
  await prisma.followUp.create({ data: { id: "f", customerId: "c", ownerId: "export-user", type: "PHONE", title: "原值", content: "内容", createdAt: at, updatedAt: at } });
  const result = await 收全();
  if (kind === "修改") await prisma.customer.update({ where: { id: "c" }, data: { remark: "改动", updatedAt: new Date(Date.now()+10) } });
  if (kind === "删除") await prisma.customer.delete({ where: { id: "c" } });
  if (kind === "外贸旁表") await prisma.customerExtra.create({ data: { customerId: "c", source: "展会" } });
  if (kind === "跟进") await prisma.followUp.update({ where: { id: "f" }, data: { content: "新内容", updatedAt: new Date(Date.now()+10) } });
  if (kind === "遗漏批次") result.fingerprints.pop();
  await expect(校验完整导出({}, result.start, result.fingerprints)).rejects.toThrow(/变化|不完整/);
});

it("创建时间写在未来的旧记录（导入 / 迁移来的）照样导出，和列表条数一致（D8-2）", async () => {
  const at = new Date("2026-01-01");
  const 未来 = new Date(Date.now() + 30 * 86400_000);
  await prisma.customer.create({ data: { id: "old", name: "旧", phone: "1", salesOwnerId: "export-user", createdAt: at, updatedAt: at } });
  await prisma.customer.create({ data: { id: "future", name: "未来", phone: "2", salesOwnerId: "export-user", createdAt: 未来, updatedAt: at } });
  await prisma.followUp.create({ data: { id: "ff", customerId: "future", ownerId: "export-user", type: "PHONE", title: "回电", content: "内容", createdAt: 未来, updatedAt: at } });
  const result = await 收全();
  expect(result.start).toMatchObject({ 客户数: 2, 跟进数: 1 });
  expect(result.customers.sort()).toEqual(["future", "old"]);
  expect(result.follows).toEqual(["ff"]);
  expect(await 校验完整导出({}, result.start, result.fingerprints)).toEqual({ ok: true });
});

it("非法参数不查询；开始后新增的客户不悄悄少一位，校验报变化请人重导（11-03 客户条件和列表同一份）", async () => {
  const result = await 收全();
  await prisma.customer.create({ data: { id: "new", name: "新", phone: "1", salesOwnerId: "export-user", createdAt: new Date(Date.now()+100) } });
  await expect(校验完整导出({}, result.start, result.fingerprints)).rejects.toThrow(/变化/);
  await expect(读取完整导出批次({}, "bad", "客户")).rejects.toThrow(/参数/);
  await expect(读取完整导出批次({}, result.start.截止, "客户", "x".repeat(129))).rejects.toThrow(/参数/);
});

it("单人导出全范围按ID隐藏负责人列，同名停用成员的末批旧归属必须保留",async()=>{
 const at=new Date("2026-01-01");
 await prisma.customer.createMany({data:Array.from({length:5001},(_,i)=>({id:`solo-${String(i).padStart(5,"0")}`,name:"导出客户",phone:"",salesOwnerId:"export-user",createdAt:at,updatedAt:at}))});
 expect(await 开始完整导出({})).toMatchObject({客户数:5001,隐藏负责人:true});
 const other=await prisma.user.create({data:{name:"导出测试",email:"inactive@local",password:"x",active:false}});
 await prisma.customer.update({where:{id:"solo-05000"},data:{channelOwnerId:other.id}});
 expect(await 开始完整导出({})).toMatchObject({隐藏负责人:false});
 await prisma.customer.update({where:{id:"solo-05000"},data:{channelOwnerId:null,salesOwnerId:other.id}});
 expect(await 开始完整导出({})).toMatchObject({隐藏负责人:false});
 expect(await 开始完整导出({salesOwnerId:"export-user"})).toMatchObject({客户数:5000,隐藏负责人:true});
 await prisma.user.update({where:{id:other.id},data:{active:true}});
 expect(await 开始完整导出({salesOwnerId:"export-user"})).toMatchObject({隐藏负责人:false});
 // Two active sales candidates must retain the dimension even if this filtered export is all one owner.
 await prisma.user.create({data:{name:"销售二",email:"active-sales@local",password:"x"}});
 expect(await 开始完整导出({salesOwnerId:"export-user"})).toMatchObject({隐藏负责人:false});
});

it("导出中成员范围变化不生成省略归属的旧结构文件",async()=>{
 await prisma.customer.create({data:{name:"客户",phone:"",salesOwnerId:"export-user"}});
 const result=await 收全();expect(result.start.隐藏负责人).toBe(true);
 await prisma.user.create({data:{name:"新销售",email:"new-sales@local",password:"x"}});
 await expect(校验完整导出({},result.start,result.fingerprints)).rejects.toThrow("负责人范围发生变化");
});

it("空导出或唯一候选换成另一个人也核对身份指纹，不能仅比较隐藏布尔值",async()=>{
 const result=await 收全();expect(result.start.客户数).toBe(0);expect(result.start.隐藏负责人).toBe(true);
 await prisma.user.create({data:{name:"新销售",email:"empty-new-sales@local",password:"x"}});
 await expect(校验完整导出({},result.start,result.fingerprints)).rejects.toThrow("负责人范围发生变化");
});

it("小批 + 分段整理（每段 1000 行、段间让出事件循环）后指纹仍等于整批 JSON 的 sha256；两份导出同时跑排队不互锁（11-14）", async () => {
  const at = new Date("2026-01-01");
  await prisma.customer.createMany({ data: Array.from({ length: 2500 }, (_, i) => ({ id: `s${String(i).padStart(5, "0")}`, name: `客户${i}`, phone: String(i), salesOwnerId: "export-user", createdAt: at, updatedAt: at })) });
  await prisma.followUp.createMany({ data: Array.from({ length: 2500 }, (_, i) => ({ id: `g${String(i).padStart(5, "0")}`, customerId: `s${String(i % 2500).padStart(5, "0")}`, ownerId: "export-user", type: "PHONE", title: "回电", content: `内容${i}`, createdAt: at, updatedAt: at })) });
  const start = await 开始完整导出({});
  for (const kind of ["客户", "跟进"] as const) {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const r = await 读取完整导出批次({}, start.截止, kind, cursor);
      // 每批：客户 1000、跟进 2500（小批，单批整理和回包不长时间占主线程）
      expect(r.rows.length).toBeLessThanOrEqual(kind === "客户" ? 1000 : 2500);
      expect(r.指纹).toBe(createHash("sha256").update(JSON.stringify(r.rows)).digest("hex"));
      ids.push(...r.rows.map((x) => x.id));
      cursor = r.游标 ?? undefined;
    } while (cursor);
    expect(ids).toEqual(Array.from({ length: 2500 }, (_, i) => `${kind === "客户" ? "s" : "g"}${String(i).padStart(5, "0")}`));
  }
  const [a, b] = await Promise.all([收全(), 收全()]);
  expect(a.fingerprints).toEqual(b.fingerprints);
  await expect(Promise.all([校验完整导出({}, a.start, a.fingerprints), 校验完整导出({}, b.start, b.fingerprints), 读取完整导出批次({}, a.start.截止, "客户")])).resolves.toMatchObject([{ ok: true }, { ok: true }, { 类别: "客户" }]);
}, 120_000);

const 队 = globalThis as unknown as { __完整导出队尾?: Promise<void>; __完整导出排队上限毫秒?: number };
/** 塞一份「一直在跑」的导出占住队头，返回放它走的开关 */
function 占住队头() {
  let 放!: () => void;
  const 前尾 = 队.__完整导出队尾 ?? Promise.resolve();
  队.__完整导出队尾 = 前尾.then(() => new Promise<void>((r) => { 放 = r; }));
  return () => 前尾.then(() => 放());
}

it("排队超过上限报「导出繁忙，请稍后再试」、不读库；前面那份跑完后，后面的导出照常能跑完（11-14）", async () => {
  const at = new Date("2026-01-01");
  await prisma.customer.createMany({ data: Array.from({ length: 3 }, (_, i) => ({ id: `q${i}`, name: `客户${i}`, phone: String(i), salesOwnerId: "export-user", createdAt: at, updatedAt: at })) });
  const 原上限 = 队.__完整导出排队上限毫秒;
  队.__完整导出排队上限毫秒 = 80;
  const 读 = vi.spyOn(prisma.customer, "count");
  try {
    const 放 = 占住队头();
    const 截止 = new Date().toISOString();
    // 两份前后排着，都等过上限：都报繁忙，都不读库
    const [a, b] = await Promise.allSettled([开始完整导出({}), 读取完整导出批次({}, 截止, "客户")]);
    expect(a).toMatchObject({ status: "rejected", reason: { message: "导出繁忙，请稍后再试" } });
    expect(b).toMatchObject({ status: "rejected", reason: { message: "导出繁忙，请稍后再试" } });
    expect(读).not.toHaveBeenCalled();
    await 放();
    队.__完整导出排队上限毫秒 = 原上限;
    const r = await 收全();
    expect(r.customers).toEqual(["q0", "q1", "q2"]);
    expect(读).toHaveBeenCalled(); // 探针确实挂在读库上：上面的「没调用」不是空过
    await expect(校验完整导出({}, r.start, r.fingerprints)).resolves.toEqual({ ok: true });
    expect(await prisma.auditLog.count({ where: { action: "export" } })).toBe(1);
  } finally {
    队.__完整导出排队上限毫秒 = 原上限;
    读.mockRestore();
  }
});

it("排队期间权限被收回（账号停用）：轮到时再查一次，不读库、不记导出（11-14）", async () => {
  const at = new Date("2026-01-01");
  await prisma.customer.create({ data: { id: "p0", name: "客户", phone: "1", salesOwnerId: "export-user", createdAt: at, updatedAt: at } });
  const start = await 收全();
  const 数 = vi.spyOn(prisma.customer, "count");
  const 读 = vi.spyOn(prisma.customer, "findMany");
  try {
    const 放 = 占住队头();
    const 排着 = [开始完整导出({}), 读取完整导出批次({}, start.start.截止, "客户"), 校验完整导出({}, start.start, start.fingerprints)].map((p) => p.then(() => "成了", (e: Error) => e.message));
    await new Promise((r) => setTimeout(r, 20)); // 三份都过了进队前那次权限检查，正排着
    登录.停用 = true;
    await 放();
    expect(await Promise.all(排着)).toEqual(["NEXT_REDIRECT", "NEXT_REDIRECT", "NEXT_REDIRECT"]);
    expect(数).not.toHaveBeenCalled();
    expect(读).not.toHaveBeenCalled();
    expect(await prisma.auditLog.count({ where: { action: "export" } })).toBe(0);
  } finally {
    数.mockRestore();
    读.mockRestore();
  }
});
