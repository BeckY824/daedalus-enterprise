import RenderedVersionMark from "@/components/RenderedVersionMark";

/**
 * 页面渲染时的版本号（跳转优化 PR-D 审查修复 1）：服务端页面一进来就开算（promise），渲染时在这里等出来，
 * 交给客户端小组件登记。PageFreshness 用它和现在的版本比，不再用客户端「取于」猜缓存多旧。
 */
export default async function RenderedVersion({ 版 }: { 版: Promise<string | null> }) {
  const v = await 版;
  if (!v) return null;
  return <RenderedVersionMark v={v} />;
}
