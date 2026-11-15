"use client";
/**
 * 进场：淡入 + 6px 上浮。**整站只有这一种进场**。
 *
 * 用 `第几个` 排队：0、1、2、3，每档一个 `间隔`（70ms，--stagger）。40ms 那一版排是排了，
 * 但人看不出来（2026-09-18 装到机器上的反馈：「没感觉到哪里不一样」）——间隔要读得出先后，
 * 又不能读出"它在等"，70 是这两者之间。
 * 超过五六档就该让整组一起出来，那时排队只剩下拖沓。
 *
 * 2026-11 PR2 外壳（原型 g.empty，P-界面-38）：位移 16px 减到 6px、时长曲线换成 ui 那档不回弹弹簧
 * （lib/motion 的 默认过渡；换了曲线的主题照它的曲线 + --t）。16px 是在「托上来」，6px 只是「到位」——
 * 空状态、出错页这种本来就让人等过一下的地方，再托一大截像在弹。
 * 空状态把标题、说明、按钮各包一层 Rise 依次排进来（EmptyState / StatePage）。
 *
 * 开了「减弱动态」：不位移，只留透明度淡入（P-界面-38「减弱动态只留透明度」）。
 * MotionTheme 的 reducedMotion="user" 本来就会把位移跳到位，这里再把起点的位移写成 0、排队取消，
 * 免得一串字分几拍才出全。
 *
 * 名字是英文的：eslint 的 react-hooks 规则按「首字母大写」认组件，
 * 中文名的函数里调 hook 会被判成非组件。属性名照旧用中文。
 */
import { motion, useReducedMotion } from "motion/react";
import { useMotionTheme } from "@/components/MotionTheme";
import { 默认过渡 } from "@/lib/motion";

export default function Rise({
  第几个 = 0,
  className,
  style,
  children,
}: {
  第几个?: number;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const 动效值 = useMotionTheme();
  const 少动 = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={{ opacity: 0, y: 少动 ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...默认过渡(动效值), delay: 少动 ? 0 : 第几个 * 动效值.间隔 }}
    >
      {children}
    </motion.div>
  );
}
