/**
 * 骨架条：一块区域在等数据时先摆几条灰条（PR2 外壳；原型 g.tabswitch「立刻切、先出骨架，不再整页变灰」）。
 *
 * 只管长相，不管什么时候出现：页签 / 页面切换时先换上它、数据回来再换成正文，由用的地方决定（后续 PR 接）。
 * 条宽三档轮着（100 / 86 / 72%，globals.css 的 .skel-bar），看着像一段文字；一道很淡的光扫过去说「在加载」，
 * 系统开了「减弱动态」就不扫，静止的灰条。出现时只淡入（--t-fast），不位移。
 *
 * 读屏：整块是一个 role="status"，念「正在加载」；灰条本身对读屏不存在。
 * `静默`：一屏里摆很多块的（列表取数时每一格一条，DataList），各块不念，由用的地方自己说一次「正在加载」。
 */
export default function Skeleton({
  行 = 4,
  高,
  间距,
  说法 = "正在加载",
  className,
  静默 = false,
}: {
  /** 几条 */
  行?: number;
  /** 每条多高（px），默认 12 */
  高?: number;
  /** 条与条之间（px），默认 10 */
  间距?: number;
  /** 读屏念的那句 */
  说法?: string;
  className?: string;
  /** 不念：读屏看不见这一块（一屏很多块时由外面统一念一次） */
  静默?: boolean;
}) {
  const 尺寸 = {
    ...(高 ? { "--skel-h": `${高}px` } : {}),
    ...(间距 ? { "--skel-gap": `${间距}px` } : {}),
  } as React.CSSProperties;
  return (
    <div className={className ? `skel ${className}` : "skel"} {...(静默 ? { "aria-hidden": true } : { role: "status", "aria-label": 说法, "aria-busy": true })} style={尺寸}>
      {Array.from({ length: Math.max(1, 行) }, (_, i) => (
        <span key={i} className="skel-bar" aria-hidden />
      ))}
    </div>
  );
}
