/**
 * R2 · 恢复说明（设置页 DesktopTab.tsx）。
 *
 * 备份本身（desktop/backup.js：写库时备份、按新/老说明真演恢复）属于桌面壳，在桌面端仓库里钉；
 * 企业库不带壳，这里只钉设置页那几句说明还在。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("恢复（设置页说明，DesktopTab.tsx）", () => {
  it("设置页的恢复说明写着：先退出、删 -wal 和 -shm", () => {
    const 文 = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/settings/DesktopTab.tsx"), "utf8");
    // 2026-10-04 有了自动备份后这句改成「从自己另存的备份恢复」；要钉的三件事不变
    const 说明 = 文.split("\n").find((l) => /从.*备份恢复/.test(l)) ?? "";
    expect(说明).toMatch(/先退出应用/);
    expect(说明).toMatch(/crm\.db-wal/);
    expect(说明).toMatch(/crm\.db-shm/);
  });

  // 【下一版】回归核对 D-077 后半：Windows 默认藏扩展名，人看到的备份叫「DaedalusCRM-备份」，照说明改名成 crm.db
  // 实际得到 crm.db.db——程序找不到 crm.db 就当新装起一个空库，人以为恢复把数据弄没了（数据其实还在）。
  // 有了设置里的「自动备份 → 恢复」，手动恢复已经不是主路；补一句文案排下一版，补了去掉 skip
  it("D-077 恢复说明提醒 Windows 藏扩展名：改名时别改成 crm.db.db", () => {
    const 文 = fs.readFileSync(path.resolve(__dirname, "../src/app/(app)/settings/DesktopTab.tsx"), "utf8");
    const 说明 = 文.split("\n").find((l) => /从.*备份恢复/.test(l)) ?? "";
    expect(说明).toMatch(/扩展名|crm\.db\.db/);
  });
});
