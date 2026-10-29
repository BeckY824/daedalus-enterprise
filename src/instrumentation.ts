/**
 * Next.js 服务启动时调一次。企业版开着时起两个钟：飞书 / 钉钉增量同步（见 enterprise-import/sync.ts）、
 * 每天 00:05 的超时回收（见 project/nightly.ts）；再排着做四件只做一次的老数据活：清掉企业版用不到的商机 / 合同老数据（enterprise/legacy-cleanup.ts）、
 * 老线索转线索阶段的项目（enterprise/lead-to-project.ts）、预计成交日期回填（project/expected-deal.ts）、客户级别 D 改 C（enterprise/customer-v2-db.ts）；
 * 最后补联系人主客户的挂靠行（同一文件，每次启动都跑、只补没有的）。
 * 桌面端、团队版服务器不设 CRM_ENTERPRISE，这里什么都不做，也不加载这些代码。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CRM_ENTERPRISE !== "1") return;
  const { 启动定时 } = await import("./lib/enterprise-import/sync");
  启动定时();
  const { 启动夜扫 } = await import("./lib/project/nightly");
  启动夜扫();
  // 几件只做一次的老数据活排着跑、不同时开事务：SQLite 只有一个写锁，3000 条老商机的清理会占住它，
  // 同时开的转项目等不到锁就失败、要等下次重启（10-29 3 倍数据压测里撞上：清理期间别的写也全超时）
  const { 清理一次 } = await import("./lib/enterprise/legacy-cleanup");
  const { 转项目一次 } = await import("./lib/enterprise/lead-to-project");
  const { 回填一次 } = await import("./lib/project/expected-deal");
  const { 级别D改C一次, 联系人挂靠回填一次 } = await import("./lib/enterprise/customer-v2-db");
  // 一件做完再开下一件；每件自己接住错误（下次启动再试），前一件失败不挡后一件
  void (async () => {
    for (const 做 of [清理一次, 转项目一次, 回填一次, 级别D改C一次, 联系人挂靠回填一次]) await 做().catch(() => null);
  })();
}
