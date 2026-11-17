import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 这一份服务端是哪一次构建（发版提示用，lib/stale-deploy.ts）：Next 构建时写的 <distDir>/BUILD_ID。
 * next start（3702 这类）在项目根目录起；standalone 的 server.js 先 chdir 到自己那一层，那里也带一份 .next/BUILD_ID（required-server-files 里有它）。
 * 多进程（WORKERS=N）几个进程读的是同一份构建、同一个文件，编号一样；升级是全停 → 换 → 全起，不会新老混着回。
 *
 * 进程起来后第一次问时读一次，之后就用这个值：文件被下一次发版换掉了，这个进程跑的照样是老代码，报老编号才对。
 * 开发模式（next dev，e2e 也是）固定回 "dev"：dev 重启不算发版，不提示；测试里要看横幅就把 /api/version 打桩成别的。
 * 读不到（没构建过、文件坏了）回 null：横幅整个不问。编号是公开的（静态资源路径、页面数据里本来就带），不算秘密
 */
let 记下的: string | null | undefined;

export function 本次构建号(): string | null {
  if (记下的 !== undefined) return 记下的;
  if (process.env.NODE_ENV !== "production") return (记下的 = "dev");
  try {
    const 原 = readFileSync(path.join(process.cwd(), process.env.NEXT_DIST_DIR || ".next", "BUILD_ID"), "utf8").trim();
    记下的 = /^[\w-]{1,128}$/.test(原) ? 原 : null;
  } catch {
    记下的 = null;
  }
  return 记下的;
}

/** 只给单测用：换了 NODE_ENV / cwd 之后重读 */
export function 重读构建号(): void {
  记下的 = undefined;
}
