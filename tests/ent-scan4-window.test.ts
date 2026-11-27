/**
 * ④ 扫库检测 · 备份避让（E-387：避开 c2 北京 00:30 / 03:30 备份）：00:15–00:50、03:15–03:50 不开始扫和清理；早 8 点发不受影响。
 */
import { describe, it, expect } from "vitest";
import { 在备份窗口 } from "@/lib/enterprise/scan-notice";

const 时 = (hm: string) => new Date(`2026-11-28T${hm}:00+08:00`);

describe("在备份窗口（北京时间，两头都含）", () => {
  it.each([
    ["00:14", false], ["00:15", true], ["00:30", true], ["00:50", true], ["00:51", false],
    ["03:14", false], ["03:15", true], ["03:30", true], ["03:50", true], ["03:51", false],
    ["00:05", false], ["08:00", false], ["12:00", false],
  ])("%s -> %s", (hm, 期望) => {
    expect(在备份窗口(时(hm))).toBe(期望);
  });
  it("按北京时间判，不按 UTC：UTC 16:30 = 北京 00:30", () => {
    expect(在备份窗口(new Date("2026-11-27T16:30:00Z"))).toBe(true);
    expect(在备份窗口(new Date("2026-11-27T00:30:00Z"))).toBe(false);
  });
});
