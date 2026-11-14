/**
 * antd 样式外链路由（11-15，app/api/antd-css/[id]/route.ts）和落盘兜底（lib/antd-css-disk.ts）：
 * 记过的号回正文、长期缓存；要 gzip 就压（q=0 不压）；进程里没有就读盘（重启 / 部署后旧页面）；号不合法不读盘；没有的 404
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GET } from "@/app/api/antd-css/[id]/route";
import { 记样式, 正文号, 取样式 } from "@/lib/antd-css-store";
import { 落盘, 读盘, 清理, 上限个数, 最久天数, 装样式落盘 } from "@/lib/antd-css-disk";

const 取 = (id: string, enc?: string) => GET(new Request(`http://x/api/antd-css/${id}`, { headers: enc ? { "accept-encoding": enc } : {} }), { params: Promise.resolve({ id }) });
let 目录: string;
beforeAll(() => {
  目录 = fs.mkdtempSync(path.join(os.tmpdir(), "antd-css-test-"));
  process.env.CRM_ANTD_CSS_DIR = 目录;
});
afterAll(() => {
  delete process.env.CRM_ANTD_CSS_DIR;
  fs.rmSync(目录, { recursive: true, force: true });
});

it("记过的号：回正文、text/css、immutable；带 gzip 就压，解开和正文一样；gzip;q=0 不压", async () => {
  const 正文 = ".a{color:red}".repeat(500);
  const 号 = 记样式("签名一", 正文);
  const 原 = await 取(号);
  expect(原.status).toBe(200);
  expect(原.headers.get("content-type")).toContain("text/css");
  expect(原.headers.get("cache-control")).toContain("immutable");
  expect(原.headers.get("content-encoding")).toBeNull();
  expect(await 原.text()).toBe(正文);
  const 压 = await 取(号, "gzip, deflate, br");
  expect(压.headers.get("content-encoding")).toBe("gzip");
  const 字节 = Buffer.from(await 压.arrayBuffer());
  expect(字节.length).toBeLessThan(正文.length / 10);
  expect(gunzipSync(字节).toString("utf8")).toBe(正文);
  const 不要 = await 取(号, "gzip;q=0, identity");
  expect(不要.headers.get("content-encoding")).toBeNull();
  expect(await 不要.text()).toBe(正文);
});

it("装了落盘：登记时落一份；进程里没有的号从盘上读回（模拟重启 / 部署后旧页面）", async () => {
  装样式落盘();
  const 正文 = ".b{color:blue}".repeat(300);
  const 号 = 记样式("签名二", 正文);
  expect(fs.readFileSync(path.join(目录, `${号}.css`), "utf8")).toBe(正文);
  // 另一个进程落的（这个进程里没记过）
  const 别的 = ".c{color:green}".repeat(300);
  const 别号 = 正文号(别的);
  落盘(别号, 别的);
  expect(取样式(别号)).toBeUndefined();
  const r = await 取(别号);
  expect(r.status).toBe(200);
  expect(await r.text()).toBe(别的);
  // 读回来记进进程了
  expect(取样式(别号)).toBe(别的);
  // 目录里没有留下临时文件
  expect(fs.readdirSync(目录).filter((n) => n.endsWith(".tmp"))).toEqual([]);
});

it("号不合法不读盘（杜绝路径穿越）；盘上也没有 = 404 不缓存", async () => {
  fs.writeFileSync(path.join(目录, "..", "evil.css"), "x{}");
  expect(读盘("../evil")).toBeUndefined();
  expect(读盘("EVIL")).toBeUndefined();
  const 坏 = await 取("..%2Fevil");
  expect(坏.status).toBe(404);
  expect(坏.headers.get("cache-control")).toBe("no-store");
  expect((await 取("nope12345")).status).toBe(404);
  fs.rmSync(path.join(目录, "..", "evil.css"), { force: true });
});

it("清理：超过上限按时间从旧删、太久没写的删、一小时前的临时文件删", () => {
  const 清 = fs.mkdtempSync(path.join(os.tmpdir(), "antd-css-clean-"));
  const 现在 = Date.now();
  const 写 = (n: string, 前: number) => { const f = path.join(清, n); fs.writeFileSync(f, "a"); const t = new Date(现在 - 前); fs.utimesSync(f, t, t); };
  for (let i = 0; i < 上限个数 + 5; i++) 写(`n${String(i).padStart(4, "0")}aaaa.css`, i * 1000);
  写("oldoldold.css", (最久天数 + 1) * 86400_000);
  写("x.css.1.abc.tmp", 2 * 3600_000);
  写("y.css.1.abc.tmp", 60_000);
  清理(清, 现在);
  const 剩 = fs.readdirSync(清);
  expect(剩.filter((n) => n.endsWith(".css")).length).toBe(上限个数);
  expect(剩).toContain("n0000aaaa.css");
  expect(剩).not.toContain(`n${String(上限个数 + 4).padStart(4, "0")}aaaa.css`);
  expect(剩).not.toContain("oldoldold.css");
  expect(剩).not.toContain("x.css.1.abc.tmp");
  expect(剩).toContain("y.css.1.abc.tmp");
  fs.rmSync(清, { recursive: true, force: true });
});
