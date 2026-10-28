/**
 * Next.js 服务启动时调一次。企业版开着时起两个钟：飞书 / 钉钉增量同步（见 enterprise-import/sync.ts）、
 * 每天 00:05 的超时回收（见 project/nightly.ts）；再把预计成交日期的老数据回填一次（project/expected-deal.ts）、
 * 清掉企业版用不到的商机 / 合同 / 订单 / 供应商老数据一次（enterprise/legacy-cleanup.ts）。
 * 桌面端、团队版服务器不设 CRM_ENTERPRISE，这里什么都不做，也不加载这些代码。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.CRM_ENTERPRISE !== "1") return;
  // 企业版用不到的老表清一次（只做一次，见 enterprise/legacy-cleanup.ts）
  const { 清理一次 } = await import("./lib/enterprise/legacy-cleanup");
  void 清理一次();
  const { 启动定时 } = await import("./lib/enterprise-import/sync");
  启动定时();
  const { 启动夜扫 } = await import("./lib/project/nightly");
  启动夜扫();
  // 预计成交日期从客户挪到项目的老数据回填（只做一次，见 project/expected-deal.ts）
  const { 回填一次 } = await import("./lib/project/expected-deal");
  void 回填一次();
}
