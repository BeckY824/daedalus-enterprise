/**
 * Next.js 服务启动时调一次。企业版开着时起两个钟：飞书 / 钉钉增量同步（见 enterprise-import/sync.ts）、
 * 每天 00:05 的超时回收（见 project/nightly.ts；起钟时等下面的老数据活做完马上跑一遍，补服务停着时漏的提醒和回收）；再排着做四件只做一次的老数据活：清掉企业版用不到的商机 / 合同老数据（enterprise/legacy-cleanup.ts）、
 * 老线索转线索阶段的项目（enterprise/lead-to-project.ts）、预计成交日期回填（project/expected-deal.ts）、客户级别 D 改 C（enterprise/customer-v2-db.ts）、卡点 11-01 改版的老数据（project/blocker-migrate.ts）；
 * 最后补联系人主客户的挂靠行（同一文件，每次启动都跑、只补没有的）。
 * 桌面端、团队版服务器不设 CRM_ENTERPRISE，这里什么都不做，也不加载这些代码。
 * 另：CRM_REQ_LOG=1 时先开慢请求日志（lib/request-log.ts）。
 * 多进程部署（11-16）：上面的钟和老数据活只在 CRM_JOBS 开着、并且占到「jobs」跨进程锁的那个进程跑（lib/jobs.ts）；样式落盘和慢请求日志每个进程都开。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // antd 样式外链落盘（11-15，lib/antd-css-disk.ts）：哪个版本都装，重启 / 部署后旧页面引用的样式照样取得到
  (await import("./lib/antd-css-disk")).装样式落盘();
  // 慢请求日志（CRM_REQ_LOG=1 才开，见 lib/request-log.ts）：不看企业版开关，开着就记
  if (process.env.CRM_REQ_LOG === "1") await (await import("./lib/request-log")).开请求日志();
  if (process.env.CRM_ENTERPRISE !== "1") return;
  // 多进程（11-16）：钟和老数据活只许一个进程跑。CRM_JOBS=0 的不跑；开着的先占「jobs」跨进程锁，占不到也不跑（lib/jobs.ts）
  const { 起后台任务 } = await import("./lib/jobs");
  await 起后台任务(跑后台任务);
}

async function 跑后台任务() {
  const { 启动定时 } = await import("./lib/enterprise-import/sync");
  启动定时();
  const { 启动夜扫 } = await import("./lib/project/nightly");
  // 几件只做一次的老数据活排着跑、不同时开事务：SQLite 只有一个写锁，3000 条老商机的清理会占住它，
  // 同时开的转项目等不到锁就失败、要等下次重启（10-29 3 倍数据压测里撞上：清理期间别的写也全超时）
  const { 清理一次 } = await import("./lib/enterprise/legacy-cleanup");
  const { 转项目一次 } = await import("./lib/enterprise/lead-to-project");
  const { 回填一次 } = await import("./lib/project/expected-deal");
  const { 级别D改C一次, 联系人挂靠回填一次 } = await import("./lib/enterprise/customer-v2-db");
  const { 卡点改版一次 } = await import("./lib/project/blocker-migrate");
  // 一件做完再开下一件；每件自己接住错误（下次启动再试），前一件失败不挡后一件
  const 老数据活 = (async () => {
    for (const 做 of [清理一次, 转项目一次, 回填一次, 级别D改C一次, 卡点改版一次, 联系人挂靠回填一次]) await 做().catch(() => null);
  })();
  // 钟照常每分钟一遍；起钟那遍补跑等老数据活做完（最多等一分钟），不和它们抢写锁
  启动夜扫(60_000, 老数据活);
}

/**
 * 服务器动作报错记服务端日志（25C，复盘第 1 类）：Next 每个请求出错都会调这里（渲染、路由、动作）；只记动作那一种，
 * 一行带路由、动作编号、digest（浏览器那头兜底提示里给人看的编号）、原文，不带 cookie 等请求头（lib/action-error.ts）。
 * 浏览器那头给人看的是一句中文（components/UpdateBanner.tsx 接没人接住的、各处 catch 用 给人看的错）
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routeType: string; routePath: string; routerKind?: string; revalidateReason?: string },
) {
  try {
    const { 动作出错日志行 } = await import("./lib/action-error");
    const 行 = 动作出错日志行(err, request, context);
    if (行) console.error(行, err instanceof Error && err.stack ? `\n${err.stack.split("\n").slice(1, 6).join("\n")}` : "");
  } catch {
    /* 记日志自己出错不能再往外抛 */
  }
}
