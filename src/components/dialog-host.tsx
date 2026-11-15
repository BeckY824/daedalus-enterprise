"use client";
/**
 * 不用在调用方 JSX 里挂节点的弹框：`await 挂框(画, 默认值)`。
 *
 * 为什么要它：客户页那几个 use*Confirm（删客户、退回公海、转让、一起转走）原来是 antd modal.confirm，
 * 调用方遍布客户列表、客户详情、编辑表单、线索分配、项目页——换成后果框（ConsequenceDialog）要是逼每个调用方
 * 都多挂一个 {框}，就得动一圈别人的文件。这里学 UndoBar：第一次用时在 <body> 底下自己长一个根，套上全站 antd 配置
 * （AntdConfig：中文、主题），同一时刻只有一个框；上一个还开着又来一个，上一个按「默认值」（= 取消）结束。
 *
 * 画进来的东西不在调用方的 React 树里：别在里面用调用方的 context（business、me……），要用的值先取好再传进来。
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import AntdConfig from "@/components/AntdConfig";
import ConsequenceDialog, { type 后果框参数 } from "@/components/ConsequenceDialog";

type 画法 = (开: boolean, 关: (v: unknown) => void) => ReactNode;
type 态 = { id: number; 画: 画法; 开: boolean } | null;

let 当前: 态 = null;
let 序 = 0;
let 等: { id: number; 默认: unknown; resolve: (v: unknown) => void } | null = null;
const 听众 = new Set<() => void>();
let 根: Root | null = null;

function 设(x: 态) {
  当前 = x;
  for (const f of 听众) f();
}

function Host() {
  const s = useSyncExternalStore(
    (f) => {
      听众.add(f);
      return () => 听众.delete(f);
    },
    () => 当前,
    () => null,
  );
  if (!s) return null;
  const id = s.id;
  return <>{s.画(s.开, (v) => 结束(id, v))}</>;
}

function 结束(id: number, v: unknown) {
  if (等?.id === id) {
    const r = 等.resolve;
    等 = null;
    r(v);
  }
  // 先收（open=false 让 antd 放关闭动画），destroyOnHidden 会自己卸里面的东西
  if (当前?.id === id) 设({ ...当前, 开: false });
}

function 挂上() {
  if (根 || typeof document === "undefined") return;
  const el = document.createElement("div");
  el.setAttribute("data-dialog-host", "");
  document.body.appendChild(el);
  根 = createRoot(el);
  根.render(
    <AntdConfig>
      <Host />
    </AntdConfig>,
  );
}

/** 开一个框，等它结束：关(v) 的 v 就是结果；被下一个框顶掉 = 默认 */
export function 挂框<T>(画: (开: boolean, 关: (v: T) => void) => ReactNode, 默认: T): Promise<T> {
  挂上();
  if (等) {
    const r = 等;
    等 = null;
    r.resolve(r.默认);
  }
  const id = ++序;
  return new Promise<T>((resolve) => {
    等 = { id, 默认, resolve: resolve as (v: unknown) => void };
    设({ id, 画: 画 as 画法, 开: true });
  });
}

/** 后果框（ConsequenceDialog）的命令式版：成了 true，取消 false。做 没成时原因写在框里、框不关 */
export function 问后果(p: 后果框参数): Promise<boolean> {
  return 挂框<boolean>((开, 关) => <ConsequenceDialog {...p} open={开} onClose={(成了) => 关(成了)} />, false);
}
