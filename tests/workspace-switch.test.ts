import { beforeAll, afterAll, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { 建控制库 } from "./r2-ai-harness";
import { closeTestDatabases } from "./close-databases";
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({
  get: (key: string) => jar.has(key) ? { value: jar.get(key)! } : undefined,
  set: (key: string, value: string) => jar.set(key, value), delete: (key: string) => jar.delete(key),
}) }));
const root = path.join(os.tmpdir(), `crm-workspace-switch-${process.pid}`);
beforeAll(() => {
  建控制库(root); process.env.MULTI_TENANT = "1"; process.env.WORKSPACE_DIR = root;
  process.env.WORKSPACE_TEMPLATE = path.join(root, "_template.db");
  execFileSync(process.execPath, ["--experimental-sqlite", "scripts/build-template.mjs", process.env.WORKSPACE_TEMPLATE], { stdio: "pipe" });
});
afterAll(async () => {
  delete process.env.MULTI_TENANT; delete process.env.WORKSPACE_DIR; delete process.env.WORKSPACE_TEMPLATE;
  await closeTestDatabases(root); fs.rmSync(root, { recursive: true, force: true });
});
async function fixture(prefix: string) {
  const { createAccount } = await import("@/lib/tenant/accounts");
  const { createWorkspace } = await import("@/lib/tenant/workspaces");
  const acc = await createAccount({ target: { kind: "email", value: `${prefix}@example.test` }, password: "test-pass-123", name: prefix });
  const one = await createWorkspace({ name: `${prefix}一`, slug: `${prefix}-one`, account: acc });
  const two = await createWorkspace({ name: `${prefix}二`, slug: `${prefix}-two`, account: acc });
  return { acc, one, two };
}
it("多工作区登录带去选择，不能直接默默进首个", async () => {
  const { acc } = await fixture("login-choice");
  const { login } = await import("@/app/login/actions");
  expect(await login(acc.email!, "test-pass-123")).toMatchObject({ ok: true, 选工作区: true });
});
it("已缓存会话撤销当前成员后立即失效", async () => {
  const { acc, one } = await fixture("revoked");
  const { createSession, getCurrentUser } = await import("@/lib/auth");
  const { control } = await import("@/lib/tenant/control");
  await createSession(acc.id, one.id);
  expect(await getCurrentUser()).not.toBeNull();
  await control.membership.delete({ where: { accountId_workspaceId: { accountId: acc.id, workspaceId: one.id } } });
  expect(await getCurrentUser()).toBeNull();
});

it("同一毫秒改密也撤销旧票，立即重登可用，再次改密仍撤销刚签的新票",async()=>{
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date());
 try{
 const {acc,one}=await fixture("same-ms-cutoff");const {createSession,getCurrentUser}=await import("@/lib/auth");const {记一次改密}=await import("@/lib/tenant/session-cutoff");
 await createSession(acc.id,one.id);expect(await getCurrentUser()).not.toBeNull();
 for(let i=0;i<2;i++){await 记一次改密(acc.id);expect(await getCurrentUser()).toBeNull();await createSession(acc.id,one.id);expect(await getCurrentUser()).not.toBeNull()}
 }finally{vi.useRealTimers()}
});
