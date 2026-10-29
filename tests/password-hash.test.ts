/**
 * 密码哈希（src/lib/password.ts）。
 *
 * 钉三件事：
 *   新串能核、错的不过、占位串永远不过；
 *   老 bcrypt 串照样能登（换写法不能把老账号锁在门外），并且被标成要升级；
 *   30 个并发核对不排队——这就是换掉 bcryptjs 的原因（S6 登录 p95 线 800 ms）。
 */
import bcrypt from "bcryptjs";
import { describe, expect, it } from "vitest";
import { 哈希密码, 核对密码串, 要升级 } from "@/lib/password";

describe("密码哈希", () => {
  it("新串：对的过、错的不过，每次盐不同", async () => {
    const a = await 哈希密码("abc12345");
    const b = await 哈希密码("abc12345");
    expect(a.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(a).not.toBe(b);
    expect(await 核对密码串("abc12345", a)).toBe(true);
    expect(await 核对密码串("abc12346", a)).toBe(false);
    expect(要升级(a)).toBe(false);
  });

  it("老 bcrypt 串照样能登，并且要升级", async () => {
    const old = await bcrypt.hash("abc12345", 10);
    expect(await 核对密码串("abc12345", old)).toBe(true);
    expect(await 核对密码串("abc12346", old)).toBe(false);
    expect(要升级(old)).toBe(true);
  });

  it("占位串、空串、坏掉的 scrypt 串一律不过", async () => {
    for (const s of ["!", "!managed", "not-a-login", "", null, undefined, "scrypt$16384$8$1$", "scrypt$16384$8$1$AAAA$"]) {
      expect(await 核对密码串("abc12345", s)).toBe(false);
    }
  });

  it("30 个并发核对不排在主线程上", async () => {
    const h = await 哈希密码("abc12345");
    let t = performance.now();
    await 核对密码串("abc12345", h);
    const 一次 = performance.now() - t;
    t = performance.now();
    const r = await Promise.all(Array.from({ length: 30 }, () => 核对密码串("abc12345", h)));
    const 三十次 = performance.now() - t;
    expect(r.every(Boolean)).toBe(true);
    // 串行就是约 30 倍（bcryptjs 本机 53 ms → 1605 ms）；线程池 4 条，2 核的 CI 机器也在 15 倍上下。只防退回串行，不卡绝对时间
    expect(三十次 / 一次).toBeLessThan(22);
  });
});
