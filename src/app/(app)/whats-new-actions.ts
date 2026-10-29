"use server";

import fs from "node:fs/promises";
import path from "node:path";
import { requireUser } from "@/lib/auth";
import { 切更新记录, 只留桌面端, 并成段, type 一版 } from "@/lib/changelog";
import { version as 仓库版本 } from "../../../package.json";

/** 左栏「更新记录」：每一版更新了什么。读的是服务目录里的 CHANGELOG.md */
function 现在的版本(): string {
  // 壳启动时写进环境变量（desktop/main.js），本地服务继承下来；开发时没有，用仓库里的
  return process.env.CRM_APP_VERSION || 仓库版本;
}

/** 读不出 CHANGELOG 时回 null（和「读到了、但里面没有」分开：读失败不能当成「没写这一版」记成看过） */
async function 读全部(): Promise<一版[] | null> {
  // 桌面端本地服务的 cwd 就是服务包目录，build-server.mjs 把 CHANGELOG.md 拷在那儿；开发时是仓库根
  try {
    return 切更新记录(await fs.readFile(path.join(process.cwd(), "CHANGELOG.md"), "utf8")).map((s) => ({
      ...s,
      正文: 并成段(只留桌面端(s.正文, process.platform)),
    }));
  } catch {
    return null;
  }
}

/** 账号菜单「更新记录」：最近 30 版，新的在前 */
export async function 全部更新记录(): Promise<{ 现在: string; 段: 一版[] }> {
  await requireUser();
  const 段 = ((await 读全部()) ?? []).slice(0, 30);
  return { 现在: 现在的版本(), 段 };
}
