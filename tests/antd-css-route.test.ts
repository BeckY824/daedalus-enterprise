/** antd 样式外链路由（11-15，app/api/antd-css/[id]/route.ts）：记过的号回正文、长期缓存；要 gzip 就压；没记过 / 乱写的 404 */
import { expect, it } from "vitest";
import { gunzipSync } from "node:zlib";
import { GET } from "@/app/api/antd-css/[id]/route";
import { 记样式 } from "@/lib/antd-css-store";

const 取 = (id: string, enc?: string) => GET(new Request(`http://x/api/antd-css/${id}`, { headers: enc ? { "accept-encoding": enc } : {} }), { params: Promise.resolve({ id }) });

it("记过的号：回正文、text/css、immutable；带 gzip 就压，解开和正文一样", async () => {
  const 正文 = ".a{color:red}".repeat(500);
  记样式("abc123xyz", 正文);
  const 原 = await 取("abc123xyz");
  expect(原.status).toBe(200);
  expect(原.headers.get("content-type")).toContain("text/css");
  expect(原.headers.get("cache-control")).toContain("immutable");
  expect(原.headers.get("content-encoding")).toBeNull();
  expect(await 原.text()).toBe(正文);
  const 压 = await 取("abc123xyz", "gzip, deflate, br");
  expect(压.headers.get("content-encoding")).toBe("gzip");
  const 字节 = Buffer.from(await 压.arrayBuffer());
  expect(字节.length).toBeLessThan(正文.length / 10);
  expect(gunzipSync(字节).toString("utf8")).toBe(正文);
});

it("没记过的号、乱写的：404 不缓存", async () => {
  expect((await 取("nope12345")).status).toBe(404);
  const 坏 = await 取("..%2Fetc");
  expect(坏.status).toBe(404);
  expect(坏.headers.get("cache-control")).toBe("no-store");
});
