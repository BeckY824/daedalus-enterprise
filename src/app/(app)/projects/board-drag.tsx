"use client";

import { useEffect, useRef, useState, type CSSProperties, type RefObject, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Modal } from "antd";
import { showUndo } from "@/components/UndoBar";
import { useConsequence } from "@/components/ConsequenceDialog";
import { 少动 } from "@/lib/reduced-motion";
import type { 看板一列, 看板卡片 } from "@/lib/project/board";
import type { 草稿们 } from "@/lib/project/required-fill";
import { 改项目节点, 看板推进预检, 看板补必填料 } from "./actions";
import { ProjectFillRequired } from "./[id]/ProjectFillRequired";
import { 动作出错话 } from "@/lib/stale-deploy";
/** 推进节点的撤销窗口（原型 6 秒） */
const 撤销毫秒 = 6000;

/**
 * 看板拖动换进程（P-界面-45，原型 pr.drag / cu.board，11-15 新功能）：企业版项目看板（/projects、客户页的项目看板）上，
 * 把卡片拖到另一个进程列 = 改到那个进程。规则一条不在这里判：
 *   ① 先问服务端 看板推进预检（改不了进程的人 → 回原因；当前进程配了必填、没填齐 → 回还差哪几项）；
 *   ② 真推照旧走 改项目节点（权限、推进关、必填、补全期全在那里再判一遍），被挡就弹回原位、说原因。
 * 缺必填：卡片先弹回原处，弹一个小框就地补填（11-15 用户定：和项目详情「完成节点」同一个 ProjectFillRequired，填完直接推过去）；
 * 小框里填不了的（沟通、附件、回款这类）照旧给「去…」进项目。读不到项目料时退回只列还差哪几项的小框——「去补齐」进项目。
 * 缺着必填谁都不能推（客户 11-19 定稿「全员统一必须填齐」：原来总管理、销售管理的「仍要推进 · 缺的留空」去掉了）。
 * 推成了：底部一句「已推到 X」带「撤销」（P-界面-40 推进节点可撤销），撤销 = 改回原来的进程（同样走服务端）；
 * 跨阶段（线索→商机、商机→订单）先确认、推成了不给撤销（企业版退不回上一阶段）。
 * 只有进程列能放（交付结清、流失、丢单要写原因、勾验收，回项目里点）；有结局的、在公海的、只看进度的卡片不给拖。
 * 键盘：卡片上按 Alt + → / ← 推到下一个 / 退回上一个进程，走同一条路；读屏念结果（role=status）。
 * 减弱动态：卡片不跟着指针位移、不弹，只亮目标列，落位直接换列
 */

type 落点 = { 列: string; 名: string; phase: string; node: string };
type 补框 = { id: string; 卡名: string; 到: 落点; 还差: string[]; 锚: DOMRect; 原: 看板卡片; 从名: string; 料?: 补料 };
type 补料 = Extract<Awaited<ReturnType<typeof 看板补必填料>>, { ok: true }>;
type 拖着 = { id: string; 卡: 看板卡片; 从列: string; el: HTMLElement; x0: number; y0: number; 动了: boolean; pointerId: number };

/** 拖多远才算拖（像素）：比这近是点一下，照旧进详情 */
const 起拖距 = 5;
/** 指针到看板左右边这么近就顺手往那边滑 */
const 贴边 = 48;
const 贴边步 = 16;

export function useBoardDrag({ 看板, 开, 名of, 去补齐, 刷新, 框 }: {
  看板: 看板一列[];
  /** 看板横向滚动的那个框：拖到左右边时顺手滑 */
  框: RefObject<HTMLElement | null>;
  /** 企业版项目看板才开（进程列）；团队版五列、新线索页、只读视角不开 */
  开: boolean;
  /** 卡片叫什么（提示里用） */
  名of: (r: 看板卡片) => string;
  /** 缺必填时「去补齐」：进这个项目 */
  去补齐: (r: 看板卡片) => void;
  刷新: () => void;
}) {
  // 乐观落位：id → 列键。服务端给了新的一屏就作废（推成了的那一屏里它本来就在新列）
  const [搬原, set搬] = useState<{ 源: 看板一列[]; 表: Record<string, string> }>({ 源: 看板, 表: {} });
  const 搬 = 搬原.源 === 看板 ? 搬原.表 : {};
  const 改搬 = (id: string, 列: string | null) =>
    set搬((m) => {
      const 表 = { ...(m.源 === 看板 ? m.表 : {}) };
      if (列 === null) delete 表[id]; else 表[id] = 列;
      return { 源: 看板, 表 };
    });
  const [悬停列, set悬停列] = useState<string | null>(null);
  const [拖中, set拖中] = useState<string | null>(null);
  const [弹回, set弹回] = useState<string | null>(null);
  const [补, set补] = useState<补框 | null>(null);
  const [问后果, 后果框] = useConsequence();
  const [播报, set播报] = useState("");
  /** 卡片弹回的原因：一张小卡浮在那张卡旁边（同还差小框的样子），不弹顶部提示；点一下或 6 秒后收 */
  const [弹回话, set弹回话] = useState<{ 话: string; 位: CSSProperties; 次: number } | null>(null);
  const 弹回次 = useRef(0);
  const 拖 = useRef<拖着 | null>(null);
  const 刚拖过 = useRef(false);
  const 列们 = useRef(new Map<string, HTMLElement>());

  const 能放 = (c: 看板一列): c is 看板一列 & { 阶段: NonNullable<看板一列["阶段"]> } => !!c.阶段;
  const 能拖 = (r: 看板卡片) => 开 && !r.result && !r.pooled && !r.只看进度;
  const 落点of = (c: 看板一列): 落点 | null => (能放(c) ? { 列: c.列, 名: c.名, phase: c.阶段, node: c.列 } : null);

  const 说 = (话: string) => set播报(话);
  const 弹回去 = (id: string, 话?: string) => {
    改搬(id, null);
    set弹回(id);
    window.setTimeout(() => set弹回((x) => (x === id ? null : x)), 400);
    if (话) {
      const el = document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(id)}"]`);
      const 锚 = el?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0);
      const 次 = ++弹回次.current;
      set弹回话({ 话, 位: 补框位置(锚), 次 });
      window.setTimeout(() => set弹回话((x) => (x?.次 === 次 ? null : x)), 6000);
      说(话);
    }
  };

  async function 真推(r: 看板卡片, 到: 落点) {
    // [待客户定 A] 拖到下一阶段的列（线索→商机、商机→订单）先确认：企业版推过去就回不了上一阶段（同项目页「完成节点」那个框）。
    // 问的时候卡片先回原列，确认了才落到新列；取消 = 弹回、不说话
    if (到.phase !== r.phase) {
      改搬(r.id, null);
      const 好 = await 问后果({
        题: "推过去就回不了上一阶段，确定？",
        后果: [
          { 标: "会发生", 话: `「${名of(r)}」进到 ${到.phase}·${到.名}`, 级: "警" },
          { 标: "回不来", 话: `进了${到.phase}就不能再退回${r.phase}`, 级: "危" },
        ],
        是: `进${到.phase}`,
        危: false,
        做: () => undefined,
      });
      if (!好) return 弹回去(r.id);
    }
    改搬(r.id, 到.列);
    const 原 = { phase: r.phase, node: r.node, result: null };
    try {
      const x = await 改项目节点(r.id, { phase: 到.phase, node: 到.node, result: null }, null, null, "看板拖动");
      if (!x.ok) return 弹回去(r.id, x.error ?? "没推成，请稍后再试");
      const 名 = 名of(r);
      const 推到 = "自动推到" in x && x.自动推到?.length ? `，必填齐了又自动推到 ${x.自动推到.join(" → ")}` : "";
      说(`「${名}」已推到「${到.名}」${推到}`);
      // 底部撤销条（PR5a）：撤销 = 改回原来的进程，同样走服务端；被挡就在条上写原因。
      // 跨阶段（线索→商机、商机→订单）企业版退不回去（nodes.ts 改节点问题），撤销必然被拦：不给撤销条，卡片落在新列、播报照说
      if (到.phase !== r.phase) return 刷新();
      showUndo({
        话: `「${名}」→ ${到.名}${推到}`,
        毫秒: 撤销毫秒,
        撤销: async () => {
          改搬(r.id, null);
          const y = await 改项目节点(r.id, 原);
          if (y.ok) 说(`「${名}」已退回「${r.node}」`);
          刷新();
          return y;
        },
      });
      刷新();
    } catch (出错) {
      弹回去(r.id, 动作出错话(出错, "没推成，请稍后再试"));
    }
  }

  async function 推(r: 看板卡片, 从列: string, c: 看板一列, el: HTMLElement | null) {
    if (c.列 === 从列) return;
    const 到 = 落点of(c);
    if (!到) return 弹回去(r.id, `「${c.名}」要写原因或勾验收，请进项目里点`);
    改搬(r.id, 到.列);
    try {
      const 预 = await 看板推进预检(r.id, { phase: 到.phase, node: 到.node });
      if (!预.ok) return 弹回去(r.id, 预.error);
      if (预.还差.length) {
        弹回去(r.id);
        const 锚 = (el ?? document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(r.id)}"]`))?.getBoundingClientRect() ?? new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0);
        说(`推到「${到.名}」前还差 ${预.还差.length} 项：${预.还差.join("、")}`);
        // 读得到项目料、且项目页那套也认还差 → 就地补填；不然退回只列还差的小框
        const 料 = await 看板补必填料(r.id).catch(() => null);
        const 用料 = 料?.ok && 料.p.必填?.还差?.length ? 料 : undefined;
        return set补({ id: r.id, 卡名: 名of(r), 到, 还差: 预.还差, 锚, 原: r, 从名: 看板.find((x) => x.列 === 从列)?.名 ?? "", 料: 用料 });
      }
    } catch (出错) {
      return 弹回去(r.id, 动作出错话(出错, "没推成，请稍后再试"));
    }
    await 真推(r, 到);
  }

  // 拖着的时候指针跟着走（挂在 window 上：指针出了卡片也不丢）
  useEffect(() => {
    const 量列 = (x: number, y: number) => {
      for (const [k, el] of 列们.current) {
        const b = el.getBoundingClientRect();
        if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) return k;
      }
      return null;
    };
    const 移 = (e: PointerEvent) => {
      const d = 拖.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      if (!d.动了) {
        if (Math.hypot(dx, dy) < 起拖距) return;
        d.动了 = true;
        set拖中(d.id);
      }
      if (!少动()) d.el.style.transform = `translate(${dx}px, ${dy}px)`;
      set悬停列(量列(e.clientX, e.clientY));
      const 板 = 框.current;
      if (板) {
        const b = 板.getBoundingClientRect();
        if (e.clientX > b.right - 贴边) 板.scrollLeft += 贴边步;
        else if (e.clientX < b.left + 贴边) 板.scrollLeft -= 贴边步;
      }
    };
    const 收 = (e: PointerEvent, 作数: boolean) => {
      const d = 拖.current;
      if (!d || e.pointerId !== d.pointerId) return;
      拖.current = null;
      d.el.style.transform = "";
      set拖中(null);
      set悬停列(null);
      if (!d.动了) return;
      // 拖完松手浏览器还会补一下 click：这一下不算点卡片
      刚拖过.current = true;
      window.setTimeout(() => { 刚拖过.current = false; }, 0);
      if (!作数) return;
      const 到列 = 量列(e.clientX, e.clientY);
      const c = 到列 && 看板.find((x) => x.列 === 到列);
      if (c && c.列 !== d.从列) void 推(d.卡, d.从列, c, d.el);
      else if (到列 === null) 弹回去(d.id);
    };
    const 松 = (e: PointerEvent) => 收(e, true);
    const 取消 = (e: PointerEvent) => 收(e, false);
    const 键 = (e: KeyboardEvent) => {
      const d = 拖.current;
      if (e.key !== "Escape" || !d) return;
      拖.current = null;
      d.el.style.transform = "";
      set拖中(null);
      set悬停列(null);
      if (d.动了) { 刚拖过.current = true; window.setTimeout(() => { 刚拖过.current = false; }, 0); }
    };
    window.addEventListener("pointermove", 移);
    window.addEventListener("pointerup", 松);
    window.addEventListener("pointercancel", 取消);
    window.addEventListener("keydown", 键);
    return () => {
      window.removeEventListener("pointermove", 移);
      window.removeEventListener("pointerup", 松);
      window.removeEventListener("pointercancel", 取消);
      window.removeEventListener("keydown", 键);
    };
  });

  /** 这一列现在摆哪些卡（乐观落位算进去）、几张 */
  function 列里(c: 看板一列, 原卡们: 看板卡片[], 全部: Map<string, { 卡: 看板卡片; 列: string }>) {
    const 留 = 原卡们.filter((r) => !搬[r.id] || 搬[r.id] === c.列);
    const 来 = Object.entries(搬).filter(([id, 列]) => 列 === c.列 && 全部.get(id) && 全部.get(id)!.列 !== c.列).map(([id]) => 全部.get(id)!.卡);
    const 数 = c.数 - (原卡们.length - 留.length) + 来.length;
    return { 卡们: [...来, ...留], 数 };
  }

  /** 一张卡片要的：挂到 div 上的属性（dom）、键盘（键，认了返回 true）、刚拖完那下 click 不算（刚拖过）、加的类 */
  function 卡片属性(r: 看板卡片, 从列: string) {
    if (!能拖(r)) return null;
    const 可去 = 看板.filter(能放);
    const 现在 = 搬[r.id] ?? 从列;
    const 我在 = 可去.findIndex((c) => c.列 === 现在);
    return {
      dom: {
        "data-card-id": r.id,
        "aria-roledescription": "可拖动的卡片",
        "aria-keyshortcuts": "Alt+ArrowLeft Alt+ArrowRight",
        "aria-describedby": "board-drag-hint",
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
          if (e.button !== 0 || e.pointerType === "touch") return;
          拖.current = { id: r.id, 卡: r, 从列: 现在, el: e.currentTarget, x0: e.clientX, y0: e.clientY, 动了: false, pointerId: e.pointerId };
        },
      },
      刚拖过: () => 刚拖过.current,
      键: (e: ReactKeyboardEvent<HTMLElement>) => {
        if (!e.altKey || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return false;
        e.preventDefault();
        const c = 可去[我在 + (e.key === "ArrowRight" ? 1 : -1)];
        if (!c) { 说(e.key === "ArrowRight" ? "已经是最后一个进程，交付结清、流失、丢单请进项目里点" : "已经是第一个进程"); return true; }
        void 推(r, 现在, c, e.currentTarget);
        return true;
      },
      类: `${拖中 === r.id ? " is-dragging" : ""}${弹回 === r.id ? " is-bounced" : ""}${补?.id === r.id ? " is-gated" : ""}`,
    };
  }

  const 列属性 = (c: 看板一列) => ({
    ref: (el: HTMLElement | null) => { if (el) 列们.current.set(c.列, el); else 列们.current.delete(c.列); },
    className: 拖中 && 悬停列 === c.列 ? (能放(c) ? " is-drop" : " is-drop-no") : "",
  });

  const 关补 = () => set补(null);
  /** 小框里填了一半关掉，再拖同一张卡回来草稿还在 */
  const 草稿 = useRef(new Map<string, 草稿们>());
  const 补新料 = async (id: string) => {
    const x = await 看板补必填料(id).catch(() => null);
    if (x?.ok) set补((b) => (b && b.id === id ? { ...b, 料: x } : b));
    刷新();
  };
  const 附件 = (
    <>
      <span id="board-drag-hint" hidden>拖到别的进程列改进程；也可以按 Alt 加右方向键推到下一个进程，Alt 加左方向键退回上一个</span>
      <span role="status" aria-live="polite" className="sr-only">{播报}</span>
      {后果框}
      {弹回话 && (
        <div className="board-gate" role="alert" style={弹回话.位}>
          <button type="button" className="board-gate-x" aria-label="收起" onClick={() => set弹回话(null)}>×</button>
          <div className="board-gate-t">没推过去</div>
          <div>{弹回话.话}</div>
        </div>
      )}
      {补?.料 && (
        <Modal open title={`推到「${补.到.名}」前还差 ${补.还差.length} 项`} footer={null} width={560} destroyOnHidden
          onCancel={关补} className="board-fill">
          <div className="board-gate-name" title={补.卡名}>{补.卡名}</div>
          <ProjectFillRequired
            p={补.料.p}
            联系人们={补.料.联系人们}
            能就地改={补.料.能就地改}
            改不了话={补.料.改不了话}
            现在在={补.从名}
            能推进
            完成到字={`推到「${补.到.名}」`}
            忙={false}
            on完成={() => { const x = 补; 关补(); void 真推(x.原, x.到); }}
            on关={关补}
            on去={() => { const x = 补; 关补(); 去补齐(x.原); }}
            读草稿={() => 草稿.current.get(补.id)}
            留草稿={(d) => { 草稿.current.set(补.id, d); }}
            刷新={() => 补新料(补.id)}
          />
        </Modal>
      )}
      {补 && !补.料 && typeof document !== "undefined" && createPortal(
        <BoardGate 框={补} style={补框位置(补.锚)} 关={关补}
          去补齐={() => { 关补(); 去补齐(补.原); }} />,
        document.body,
      )}
    </>
  );

  return { 列里, 卡片属性, 列属性, 附件 };
}

/** 还差小框、弹回原因小卡贴在卡片旁边：右边放得下放右边，不然放左边；上下不出视口 */
function 补框位置(锚: DOMRect): CSSProperties {
  const 宽 = 280;
  const 右边放得下 = 锚.right + 8 + 宽 <= innerWidth - 8;
  const left = 右边放得下 ? 锚.right + 8 : Math.max(8, 锚.left - 8 - 宽);
  return { left, top: Math.max(8, Math.min(锚.top, innerHeight - 220)), width: 宽 };
}

function BoardGate({ 框: x, style, 关, 去补齐 }: { 框: 补框; style: CSSProperties; 关: () => void; 去补齐: () => void }) {
  const 首钮 = useRef<HTMLButtonElement>(null);
  useEffect(() => { 首钮.current?.focus(); }, []);
  return (
    <div className="board-gate" role="dialog" data-swap-busy="" aria-label={`推到「${x.到.名}」前还差 ${x.还差.length} 项`} style={style}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); 关(); } }}>
      <div className="board-gate-t">推到「{x.到.名}」前还差 {x.还差.length} 项</div>
      <div className="board-gate-name" title={x.卡名}>{x.卡名}</div>
      <ul className="board-gate-list">{x.还差.map((k) => <li key={k}>{k}</li>)}</ul>
      <div className="board-gate-foot">
        <Button size="small" onClick={关}>先不推</Button>
        <Button ref={首钮} size="small" type="primary" onClick={去补齐}>去补齐</Button>
      </div>
    </div>
  );
}
