import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";

/**
 * 扫名片的识别运行库（public/ocr/v1，scripts/build-ocr.mjs 从 node_modules 打出来，不进仓库）。
 * 放在这里而不是 package.json 的 build：next dev / next build 有好几处直接调（e2e、桌面打包、Dockerfile），
 * 哪一处起服务都先补上；已经有了就不动（认 manifest.json 和服务器识别的 ocr-server/worker.mjs：2026-10-20 起才有，老副本里的旧产物会重打一遍）
 */
if (!["public/ocr/v1/manifest.json", "ocr-server/worker.mjs"].every((f) => existsSync(path.join(process.cwd(), f)))) {
  execFileSync(process.execPath, [path.join(process.cwd(), "scripts/build-ocr.mjs")], { stdio: "inherit" });
}

/**
 * 安全响应头放在这里而不是反代里：托管版前面是 Caddy，自部署的人多半直接裸露 3000 端口，
 * 写进 Next 两边都吃到，而且能单测（tests/security-headers.test.ts）。
 *
 * 没加 CSP——Next 的内联脚本要走 nonce，改起来是另一件事。
 * HSTS 只有走 HTTPS 时浏览器才认，纯 HTTP 的自部署会被忽略，放着无害；
 * 不带 preload：那是提交给浏览器厂商的名单，撤不回来。
 */
const 安全头 = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=15552000" },
  /*
    麦克风只放本站（11-21 录音点评 PR1）：microphone=(self) = 本站页面能申请话筒（浏览器照旧弹框问人），
    别的来源（嵌进来的 iframe）一律不行。https（或 localhost）下才拿得到，http 的 IP 地址浏览器自己就不给。
    相机、定位照旧全关：手机拍名片走 <input capture>（系统相机），不靠这个头
  */
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
];

/**
 * 静态资源（`/_next/static/*`）换一个域名发。**只在构建镜像时生效**，运行时设它没有用。
 *
 * 2026-09-20 花了一下午确认这件事：我们托管的那份跑在香港、用户在国内，一个登录页
 * 压缩后 758 KB 里有 729 KB 是 JS/CSS，把它们指到国内节点能省掉四成时间。
 * 但 `output: "standalone"` 会把这份配置**烤进 server.js**，所以当时试着在容器启动时
 * 改那一处——结果是：服务端发出的 HTML 用了新地址，而客户端那半仍按原地址工作，
 * 两边对不上，React 水合失败。**不报错、结构都在、入场动画停在透明，就是一片纯白。**
 * 开→白、关→好，两台设备来回验了四次。那段启动时改写已经删掉了。
 *
 * 所以要用它，只能**构建时**传 `ASSET_PREFIX=...`——而那意味着托管版得单独出一个镜像：
 * 同一个镜像还要给自部署的人（凭什么去我们的服务器取 JS）和桌面端（断网就白屏）用。
 * 我们暂时不做，等国内节点备案通过，整个应用搬过去，这件事自然就不存在了。
 */
const 静态资源前缀 = process.env.ASSET_PREFIX?.trim() || undefined;

export const nextConfig: NextConfig = {
  // 容器部署：产出自带最小 node_modules 的独立 server.js
  output: "standalone",
  // Prisma 生成的客户端里有动态路径，Turbopack 会把整个项目追进 standalone（含 public/）；Dockerfile 另外再拷一遍 public，
  // 扫名片的 115 MB 识别文件就会在镜像里出现两份。public/ocr 不追，只走 COPY public 那一份；服务器识别的 ocr-server 也是 Dockerfile 单独拷
  outputFileTracingExcludes: { "*": ["public/ocr/**", "ocr-server/**"] },
  // 全项目没有一处用 next/image；关掉图片优化，/_next/image 那条路就不走了，运行时也就用不到 sharp
  images: { unoptimized: true },

  /*
    只给 e2e 用（playwright.layout.config.ts 开发模式）：同一个工作树里自己开着的 next dev 和排版闸门那个 next dev 不抢目录。
    Next 16 一个构建目录只许一个 dev（<distDir>/dev/lock），所以闸门那个换个目录；
    tsconfig 也换成一个 extends 主配置的，免得 next dev 往 tsconfig.json 的 include 里加那个目录。不设就是默认
  */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  typescript: process.env.NEXT_TSCONFIG_PATH ? { tsconfigPath: process.env.NEXT_TSCONFIG_PATH } : undefined,

  assetPrefix: 静态资源前缀,

  // 不报框架名——对外少说一句是一句
  poweredByHeader: false,

  /**
   * 压缩交给前面的 nginx（11-14 体验优化）：正式服务器只有一个共享核，Node 里现压 gzip 和出页抢同一个核。
   * `CRM_NO_COMPRESS=1` 时 Next 不压，默认照旧压。
   * **只在构建时生效**：standalone 的 server.js 把这份配置原样烤进去（.next/required-server-files.json 同），
   * 运行时再设这个变量没有用；`next start` 起的（3702 这类）启动时会重读本文件，跟着启动时的变量走。
   * 打开之前 nginx 必须已对 text/html、text/x-component（RSC）、application/javascript、text/css、application/json 开 gzip，
   * 否则就成了全程不压
   */
  ...(process.env.CRM_NO_COMPRESS === "1" ? { compress: false } : {}),

  /**
   * 扫名片识别文件不让 Next 当 public 文件现压 gzip（不带长度、香港到伦敦约 90 KB/s，2026-10-20），
   * 在找 public 文件之前改写到 app/ocr-files，直接给预先压好的 .br / .gz
   */
  async rewrites() {
    return { beforeFiles: [{ source: "/ocr/:path*", destination: "/ocr-files/:path*" }], afterFiles: [], fallback: [] };
  },

  /**
   * 商机列表和商机管道两页 10-28 删了（企业版只用项目，lib/enterprise/project-only.ts）。
   * 旧书签、跟进里存着的老链接（/opportunities?opportunity=…、/opportunities/pipeline）都转到项目，不落 404。
   * 不永久：浏览器不记死，哪天这个地址另有用处不用等缓存过期。
   * 外贸订单、供应商两页 10-28 删了、表 10-29 也删了（迁移 066）：老书签同样转到项目
   */
  async redirects() {
    return [
      { source: "/opportunities", destination: "/projects", permanent: false },
      { source: "/opportunities/:path*", destination: "/projects", permanent: false },
      { source: "/orders", destination: "/projects", permanent: false },
      { source: "/orders/:path*", destination: "/projects", permanent: false },
      { source: "/suppliers", destination: "/projects", permanent: false },
      { source: "/suppliers/:path*", destination: "/projects", permanent: false },
      /*
        11-15 清理没用到的页面（tests/route-cleanup-redirects.test.ts）：页面删了，老书签、通知、AI 回答里存着的链接照样不落 404。
        /start 原来就只是转去首页的跳板；/customers/recent 是桌面端左栏「客户」的跳板，企业版网页走不到；
        盯盘清单就在首页。/reports 的跳转在 proxy.ts（目标带中文，这里写会 500）
      */
      { source: "/start", destination: "/dashboard", permanent: false },
      { source: "/customers/recent", destination: "/customers", permanent: false },
      { source: "/follow-ups/watchlist", destination: "/dashboard", permanent: false },
      /*
        新建整页（PR11b）：新建都改成了弹窗（ProjectWizard 单表），老链接落到列表页、带 new=1 进来就弹向导框
        （projects/ProjectsView.tsx 读到 new=1 开框、开了从地址上抹掉）。/follow-ups 沟通记录主页的跳转看 proxy.ts（按带不带客户分去处）
      */
      { source: "/leads/new", destination: "/leads?new=1", permanent: false },
      { source: "/projects/new", destination: "/projects?new=1", permanent: false },
    ];
  },

  async headers() {
    return [
      { source: "/:path*", headers: 安全头 },
      /*
        [O2] 站点图标长缓存。Next 给 app/ 下的 favicon.ico、icon.svg、apple-icon.png 回的是 `public, max-age=0, must-revalidate`
        （node_modules/next/dist/build/webpack/loaders/next-metadata-route-loader.js 的 CACHE_HEADERS.REVALIDATE），
        浏览器每开一页都要回源问一次，c2 nginx 日志 11-16~11-28 这两个地址占全部请求的 42%。
        出现在 <head> 里的图标地址带内容哈希（?xxxx），换图标地址就变；直接请求 /favicon.ico 的没有，所以不用 immutable，给 7 天。
        配置里的头先写进响应，Next 往回拷路由响应头时同名头已存在就不再写（send-response.js），所以这条能盖过路由自己的头
        */
      { source: "/:icon(favicon\\.ico|icon\\.svg|apple-icon\\.png)", headers: [{ key: "Cache-Control", value: "public, max-age=604800" }] },
      // 扫名片的模型和运行库的缓存头由 app/ocr-files 自己给（一年不变；manifest.json 每次问一下）
    ];
  },

  experimental: {
    /**
     * 客户端路由缓存。默认动态页面为 0，意味着每次切换（包括切回刚看过的页面）
     * 都要重新请求服务器；跨境链路上这一次往返就是肉眼可见的卡顿。
     * 设为 60 秒后，一分钟内重复访问同一页面直接走本地缓存，切换是瞬时的。
     * 代价是数据最多滞后 60 秒——对 CRM 这种低频变更场景可以接受，
     * 且新建/修改后我们本来就会主动 router.refresh()。
     *
     * static 管的是「整页预取」（悬停预取、左栏空闲时预热，见 lib/prefetch-full）存多久。
     * 原来 300 秒：预热进来的页五分钟内不再问服务器，比点进去看的页还旧。改成和 dynamic 一样 60 秒（10-27）
     */
    staleTimes: {
      dynamic: 60,
      static: 60,
    },
  },
};

/**
 * 部署号（deploymentId，11-17 无感更新）：一版构建一个号，取这次构建的 commit（前 12 位）。
 *
 * 设了它 Next 会（16.4.6，node_modules/next/dist 里核过）：
 *   - 页面 <html data-dpl-id> 带上这个号，浏览器端记下（shared/lib/deployment-id.js）
 *   - 浏览器发 server action、RSC 导航请求都带 `x-deployment-id: <号>` 头
 *     （client/components/router-reducer/reducers/server-action-reducer.js、fetch-server-response.js 的 createFetch）
 *   - 服务器回 RSC 时带 `x-nextjs-deployment-id`；浏览器发现和自己的号不同就整页跳转（doMpaNavigation），不再报错
 *   - /_next/static 的地址后面带 `?dpl=<号>`
 * 部署时 nginx 按这个头把「上一版标签页发来的 server action」转给留着的上一版进程（见 deploy/enterprise/tools/skew-check.mjs
 * 和 02-开发与发版/无感更新-草案/），上一版标签页不刷新也能保存。
 *
 * 号从哪来（先到先用）：
 *   1. 构建时的环境变量 CRM_DEPLOYMENT_ID（off = 不设部署号，和以前一样）
 *   2. deploy/enterprise/COMMIT：git archive 导出的目录（3702 的 rebuild.sh 就是这样建的，没有 .git）里被 export-subst 换成 commit
 *   3. git：cwd 本身是仓库根目录时的 HEAD（不认父进程带的 GIT_DIR，也不认外层仓库，见 本目录的commit）
 *   都拿不到就不设（等于没有无感更新，其余照旧）。
 * next start（3702）启动时会再读一遍本文件：这时不重新算，用构建产物 required-server-files.json 里记的号，
 * 免得构建后 HEAD 动过、页面里的号和服务器回的号对不上（对不上 = 每次点链接都整页刷新）。
 * next dev 不设。
 */
export function 部署号(
  phase: string,
  opts: { env?: Record<string, string | undefined>; cwd?: string } = {},
): string | undefined {
  const env = opts.env ?? process.env;
  const cwd = opts.cwd ?? process.cwd();
  const 合法 = (v: string | undefined) => (v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : undefined);
  if (phase === PHASE_PRODUCTION_SERVER) {
    try {
      const f = path.join(cwd, env.NEXT_DIST_DIR || ".next", "required-server-files.json");
      return 合法(JSON.parse(readFileSync(f, "utf8"))?.config?.deploymentId);
    } catch {
      return undefined;
    }
  }
  if (phase !== PHASE_PRODUCTION_BUILD) return undefined;
  const 指定 = env.CRM_DEPLOYMENT_ID?.trim();
  if (指定 === "off") return undefined;
  if (指定) {
    if (!合法(指定)) throw new Error(`CRM_DEPLOYMENT_ID 只许字母、数字、- 和 _（最长 64）：${指定}`);
    return 指定;
  }
  try {
    const 导出的 = readFileSync(path.join(cwd, "deploy/enterprise/COMMIT"), "utf8").trim();
    if (/^[0-9a-f]{40}$/.test(导出的)) return 导出的.slice(0, 12);
  } catch {
    // 没这个文件：往下用 git
  }
  return 本目录的commit(cwd);
}

/**
 * cwd 自己是 git 仓库（或 worktree）根目录时取它的 HEAD，否则 undefined。
 * 两处不能信 git 默认找仓库的办法（11-17 pre-push 里测试挂过）：
 *   - 父进程带着 GIT_DIR / GIT_WORK_TREE 等（git 钩子里跑、别的工具套着跑）：git 不看 cwd，直接报那个仓库的 HEAD。
 *     所以子进程把这些定位仓库的变量去掉
 *   - cwd 不是仓库、但在别的仓库里面（导出目录放在某个仓库下面）：git 往上找到外层仓库，报的是外层的 commit。
 *     所以要求仓库根目录就是 cwd
 */
const 定位仓库的变量 = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
];
function 本目录的commit(cwd: string): string | undefined {
  const env = { ...process.env };
  for (const k of 定位仓库的变量) delete env[k];
  try {
    const [根, sha] = execFileSync("git", ["rev-parse", "--show-toplevel", "HEAD"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
      .split("\n");
    if (!根 || realpathSync(根) !== realpathSync(cwd)) return undefined;
    if (sha && /^[0-9a-f]{40}$/.test(sha)) return sha.slice(0, 12);
  } catch {
    // 不是 git 目录、没装 git、HEAD 还没有提交
  }
  return undefined;
}

export default function config(phase: string): NextConfig {
  const id = 部署号(phase);
  return id ? { ...nextConfig, deploymentId: id } : nextConfig;
}
