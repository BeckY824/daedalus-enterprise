/**
 * 录音点评 PR3（11-22）边录边传的片队列和「网络较慢」提示（components/CoachRecorder/uploader.ts）。不连库、不开浏览器（假 fetch + 假时钟）。
 *   - 编号晚到：片先攒着，编号到了按顺序传
 *   - 一片失败按 2 / 5 / 15 秒退着一直重试；429 按 Retry-After；服务器明说不行（4xx）停下报错
 *   - 慢：攒着没传的超过 20 秒的录音量、或者速度跟不上码率；慢话 / 传文件慢话 的写法
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { 建片队列, 慢话, 传文件慢话, type 队列状态 } from "@/components/CoachRecorder/uploader";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const 回 = (状态: number, 体: unknown = {}, 头: Record<string, string> = {}) => new Response(JSON.stringify(体), { status: 状态, headers: { "content-type": "application/json", ...头 } });
const 块 = (n: number) => new Blob([new Uint8Array(n)]);

it("编号晚到：片先攒着；编号到了按顺序传，传完 等传完 = true", async () => {
  const 记: string[] = [];
  const q = 建片队列({ 每秒字节: 3000, 取: (async (url: string) => { 记.push(url); return 回(200); }) as typeof fetch });
  q.放(1, 0, 块(10));
  q.放(1, 1, 块(10));
  await vi.advanceTimersByTimeAsync(10);
  expect(记).toEqual([]);
  expect(q.状态().待传字节).toBe(20);
  q.给编号("crec1");
  const 好 = q.等传完(5_000);
  await vi.advanceTimersByTimeAsync(10);
  expect(await 好).toBe(true);
  expect(记).toEqual(["/api/coach-rec/crec1/chunk/1/0", "/api/coach-rec/crec1/chunk/1/1"]);
  expect(q.状态()).toMatchObject({ 待传字节: 0, 慢: false, 重试中: false, 错: null, 停了: false });
});

it("断网：按 2 / 5 / 15 / 15… 秒一直重试，重试中报出来；网好了接着传", async () => {
  let 断 = true;
  const 次: number[] = [];
  const 状态们: 队列状态[] = [];
  const q = 建片队列({ 每秒字节: 3000, 变了: (s) => 状态们.push(s), 取: (async () => { 次.push(Date.now()); return 断 ? Promise.reject(new TypeError("断网")) : 回(200); }) as typeof fetch });
  q.给编号("c");
  const 起 = Date.now();
  q.放(1, 0, 块(100));
  await vi.advanceTimersByTimeAsync(2_000 + 5_000 + 15_000 + 15_000 + 10);
  expect(次.map((t) => t - 起)).toEqual([0, 2_000, 7_000, 22_000, 37_000]);
  expect(q.状态().重试中).toBe(true);
  expect(慢话(q.状态(), 3000)).toBe("网络断了，还有约 0 秒的录音没传上去，联网后自动补传，先别关页面");
  断 = false;
  await vi.advanceTimersByTimeAsync(15_000);
  expect(q.状态()).toMatchObject({ 待传字节: 0, 重试中: false });
  expect(状态们.some((s) => s.重试中)).toBe(true);
});

it("429 按 Retry-After 秒数等；服务器明说不行（403）停下、报它的话，等传完 = false", async () => {
  const 次: number[] = [];
  let 第 = 0;
  const q = 建片队列({ 每秒字节: 3000, 取: (async () => { 次.push(Date.now()); 第 += 1; return 第 === 1 ? 回(429, { error: "忙" }, { "retry-after": "4" }) : 第 === 2 ? 回(200) : 回(403, { error: "你已经不能对这个项目发点评了" }); }) as typeof fetch });
  const 起 = Date.now();
  q.给编号("c");
  q.放(1, 0, 块(10));
  q.放(1, 1, 块(10));
  const 结 = q.等传完(60_000);
  await vi.advanceTimersByTimeAsync(5_000);
  expect(await 结).toBe(false);
  expect(次.map((t) => t - 起)).toEqual([0, 4_000, 4_000]);
  expect(q.状态().错).toBe("你已经不能对这个项目发点评了");
});

it("服务器拒了（415 补段格式不一样）：剩下没传的不再算慢，「网络较慢」那句收掉（11-22 实操：被拒后一直挂着）", async () => {
  const 报们: 队列状态[] = [];
  const q = 建片队列({ 每秒字节: 3000, 变了: (s) => 报们.push(s), 取: (async () => 回(415, { error: "这一段和前面录的格式不一样" })) as typeof fetch });
  // 先攒够 20 秒以上的录音量（慢），编号再到
  for (let i = 0; i < 5; i++) q.放(2, i, 块(20_000));
  expect(q.状态().慢).toBe(true);
  q.给编号("c");
  expect(await q.等传完(10_000)).toBe(false);
  expect(q.状态()).toMatchObject({ 错: "这一段和前面录的格式不一样", 慢: false });
  expect(慢话(报们.at(-1)!, 3000)).toBeNull();
});

it("停：没传的扔掉、不再发；等传完立刻回 false，状态里 停了 = true", async () => {
  const 记: string[] = [];
  const q = 建片队列({ 每秒字节: 3000, 取: (async (url: string) => { 记.push(url); return 回(503); }) as typeof fetch });
  q.给编号("c");
  q.放(1, 0, 块(10));
  await vi.advanceTimersByTimeAsync(10);
  q.停();
  expect(await q.等传完(1_000)).toBe(false);
  expect(q.状态()).toMatchObject({ 待传字节: 0, 停了: true });
  q.放(1, 1, 块(10));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(记).toEqual(["/api/coach-rec/c/chunk/1/0"]);
});

it("慢：攒着超过 20 秒录音量 = 慢；速度跟不上码率且攒了 5 秒以上 = 慢", () => {
  const 基 = { 重试中: false, 错: null, 停了: false };
  expect(慢话({ ...基, 待传字节: 0, 速度: 1000, 慢: false }, 3000)).toBeNull();
  expect(慢话({ ...基, 待传字节: 90_000, 速度: 1500, 慢: true }, 3000)).toBe("网络较慢：还有约 30 秒的录音没传上去（大约还要 1 分钟），先别关页面");
  expect(慢话({ ...基, 待传字节: 30_000, 速度: 3000, 慢: true }, 3000)).toBe("网络较慢：还有约 10 秒的录音没传上去（大约还要 10 秒），先别关页面");
});

it("慢的判定来自队列：速度低于码率 1.2 倍、攒了 >5 秒录音", async () => {
  let 慢慢 = true;
  const q = 建片队列({ 每秒字节: 3000, 取: (async () => { if (慢慢) await new Promise((r) => setTimeout(r, 10_000)); return 回(200); }) as typeof fetch });
  q.给编号("c");
  q.放(1, 0, 块(3000)); // 3000 字节传了 10 秒 = 300 字节 / 秒
  await vi.advanceTimersByTimeAsync(10_001);
  q.放(1, 1, 块(9_000));
  q.放(1, 2, 块(9_000));
  expect(q.状态().速度).toBeCloseTo(300, -1);
  expect(q.状态().慢).toBe(true);
  慢慢 = false;
  await vi.advanceTimersByTimeAsync(20_000);
  expect(q.状态().慢).toBe(false);
});

it("传文件慢话：按速度估超过 3 分钟才提示、写速度和分钟数、建议连 Wi-Fi", () => {
  expect(传文件慢话(10 * 1024 * 1024, null)).toBeNull();
  expect(传文件慢话(10 * 1024 * 1024, 1024 * 1024)).toBeNull();
  expect(传文件慢话(0, 10)).toBeNull();
  expect(传文件慢话(10 * 1024 * 1024, 40 * 1024)).toBe("网络较慢（约 40KB/秒），传完大约还要 5 分钟，建议连 Wi-Fi；可以先去忙，别关这个页面");
});
