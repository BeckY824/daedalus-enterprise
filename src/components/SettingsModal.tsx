"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { 没存数, 清没存 } from "@/lib/settings-dirty";
import ConsequenceDialog from "@/components/ConsequenceDialog";
import { useRouter } from "next/navigation";
import { CloseOutlined } from "@ant-design/icons";
import { motion, useReducedMotion } from "motion/react";
import { useMotionTheme } from "@/components/MotionTheme";

/**
 * 设置的浮层。**设置不是一页，是一层**——照 Claude / Codex 桌面端那样，
 * 它盖在你正看的东西上面，关掉就回到原处，不打断手里的事。
 *
 * 装它的是 Next 的**拦截路由**（app/(app)/@modal/(.)settings），所以：
 *   - 地址仍然是 /settings，能分享、能收藏、后退键就是关闭
 *   - 刷新或者直接敲这个地址，落到的是整页那份（同一个 SettingsBody，不会两套）
 *   - 桌面端菜单里的 ⌘, 是硬导航，也落整页——那时人是奔着设置来的，不需要浮层
 *
 * 没用 antd 的 Modal：这一层里有自己的左目录和滚动区，Modal 那套 padding 和
 * 内置滚动会和它打架；一个 div 加一层遮罩反而更少东西要拆。
 */
export default function SettingsModal({ children }: { children: React.ReactNode }) {
  const { 曲线, 时长 } = useMotionTheme();
  const router = useRouter();
  const 少动 = useReducedMotion();
  // 关之前（原型 st.dirty / st.open）：有没存的先问一句；关的时候放退场（淡出 + 下沉 6px），放完再回上一页
  const [问, set问] = useState(0);
  const [走, set走] = useState(false);
  const 问着 = useRef(false);
  useEffect(() => {
    问着.current = 问 > 0;
  }, [问]);
  const 退场 = useCallback(() => {
    if (少动) return router.back();
    set走(true);
  }, [少动, router]);
  const 关 = useCallback(() => {
    if (问着.current) return;
    const n = 没存数();
    if (n > 0) set问(n);
    else 退场();
  }, [退场]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 后果框开着时 Esc 归它（它自己关），不连带把设置也关了
      if (e.key === "Escape" && !e.defaultPrevented && !问着.current) 关();
    };
    window.addEventListener("keydown", onKey);
    // 浮层开着时底下不跟着滚——两层滚动条会让人不知道自己在滚哪一层
    const 原来的 = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = 原来的;
    };
  }, [关]);

  return (
    <motion.div
      className="setm"
      role="presentation"
      onClick={关}
      /* 遮罩跟着淡，比浮层快一档：先暗下去，再看见设置长出来 */
      initial={{ opacity: 0 }}
      animate={{ opacity: 走 ? 0 : 1 }}
      transition={{ duration: 少动 ? 0 : 时长.base, ease: 曲线.ease }}
    >
      <motion.div
        className="setm-box"
        role="dialog"
        aria-modal="true"
        aria-label="设置"
        /* 它是**长出来的**，不是飞进来的：从 0.985 长到 1，位移只有 6px。
           曲线用形变那条（两头慢、中间快），因为这一层的意思是「当前这一页变成了设置」，
           不是「有个东西飞过来了」。--t-morph（320ms）——再快就看不出它从哪儿来 */
        initial={{ opacity: 0, y: 少动 ? 0 : 6, scale: 少动 ? 1 : 0.985 }}
        animate={走 ? { opacity: 0, y: 6, scale: 0.985 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 少动 ? 0 : 走 ? 时长.fast : 时长.morph, ease: 走 ? 曲线.ease : 曲线.morph }}
        onAnimationComplete={() => { if (走) router.back(); }}
        /* 点在浮层里面不关——只有点到外面那层灰才算「我要走了」 */
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="setm-x" aria-label="关闭设置" onClick={关}>
          <CloseOutlined />
        </button>
        <div className="setm-scroll">{children}</div>
        <ConsequenceDialog
          open={问 > 0}
          onClose={() => set问(0)}
          题={`还有 ${问} 项没保存`}
          后果={[{ 标: "会丢", 级: "危", 话: "现在关掉，刚改的不会存；想留着就点「取消」回去保存" }]}
          是="放弃改动并关闭"
          做={() => { 清没存(); 退场(); }}
        />
      </motion.div>
    </motion.div>
  );
}
