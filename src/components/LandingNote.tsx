"use client";
/**
 * 落地那页原处说一句（lib/landing-note.ts）：跳过来时带的话写在列表上方一行（role=status），「知道了」收掉，离开这页也清掉。
 * 服务端快照是空的：整页刷新落地时，水合之后再出来，不会对不上。
 */
import { useEffect, useSyncExternalStore } from "react";
import { 看落地话, 清落地话, 订落地话 } from "@/lib/landing-note";

export default function LandingNote({ 路径, className = "cu-said cu-said-row" }: { 路径: string; className?: string }) {
  const 话 = useSyncExternalStore(订落地话, () => 看落地话(路径), () => null);
  // 离开这页就清：回来不再说第二遍
  useEffect(() => () => 清落地话(), []);
  if (!话) return null;
  return (
    <div role="status" className={`${className} landing-note`}>
      {话}
      <button type="button" className="landing-note-x" onClick={清落地话}>
        知道了
      </button>
    </div>
  );
}
