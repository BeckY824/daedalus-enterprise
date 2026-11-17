import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * 这一份服务端是哪一次发版（发版提示用，lib/stale-deploy.ts）。按顺序取第一个有的：
 *   1. <distDir>/required-server-files.json 里的 config.deploymentId（构建时写进去的 Next deploymentId）
 *   2. 环境变量 NEXT_DEPLOYMENT_ID
 *   3. <distDir>/BUILD_ID
 * 为什么 deploymentId 在前：配了 deploymentId（版本偏差保护）时，Next 16.4 的 BUILD_ID 是写死的同一串
 * （node_modules/next/dist/build/index.js getBuildId：`build-TfctsWXpff2fKS`），每次发版都一样，拿它比横幅永远不亮；
 * 没配时 deploymentId 是空串，退回 BUILD_ID（每次构建都不同）。
 *
 * next start（3702 这类）在项目根目录起；standalone 的 server.js 先 chdir 到自己那一层，那里也带一份 .next/（两个文件都在）。
 * 多进程（WORKERS=N）几个进程读的是同一份构建，编号一样；升级是全停 → 换 → 全起，不会新老混着回。
 *
 * 进程里第一次问时读一次，之后就用这个值：文件被下一次发版换掉了，这个进程跑的照样是老代码，报老编号才对。
 * 开发模式（next dev，e2e 也是）固定回 "dev"：dev 重启不算发版，不提示；测试里要看横幅就把 /api/version 打桩成别的。
 * 都读不到 / 不像样回 null：横幅整个不问。编号是公开的（静态资源路径、页面数据里本来就带），不算秘密
 */
let 记下的: string | null | undefined;

const 像编号 = (v: unknown): v is string => typeof v === "string" && /^[\w-]{1,128}$/.test(v);

function 读文件(文件: string): string | null {
  try {
    return readFileSync(path.join(process.cwd(), process.env.NEXT_DIST_DIR || ".next", 文件), "utf8");
  } catch {
    return null;
  }
}

function 读一遍(): string | null {
  // 1. 构建时记下的 deploymentId（没配是空串 / 没这个键）
  const 清单 = 读文件("required-server-files.json");
  if (清单) {
    try {
      const id = (JSON.parse(清单) as { config?: { deploymentId?: unknown } })?.config?.deploymentId;
      if (typeof id === "string" && id.trim()) return 像编号(id.trim()) ? id.trim() : null;
    } catch {
      /* 坏了：往下找 */
    }
  }
  // 2. 运行时给的
  const 环境 = process.env.NEXT_DEPLOYMENT_ID?.trim();
  if (环境) return 像编号(环境) ? 环境 : null;
  // 3. 构建号
  const 原 = 读文件("BUILD_ID")?.trim();
  return 像编号(原) ? 原 : null;
}

export function 本次构建号(): string | null {
  if (记下的 !== undefined) return 记下的;
  if (process.env.NODE_ENV !== "production") return (记下的 = "dev");
  return (记下的 = 读一遍());
}

/** 只给单测用：换了 NODE_ENV / cwd 之后重读 */
export function 重读构建号(): void {
  记下的 = undefined;
}
