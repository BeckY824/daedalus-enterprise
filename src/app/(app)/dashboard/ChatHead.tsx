"use client";

import { useEffect, useLayoutEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Dropdown, Tooltip } from "antd";
import { EditOutlined, DeleteOutlined, EllipsisOutlined, FormOutlined } from "@ant-design/icons";
import PaneToggle from "@/components/PaneToggle";
import { useMiddlePane } from "@/lib/middle-pane";
import { 新起一屏, 首页屏 } from "@/lib/home-thread";
import { 重命名对话 } from "./threads";
import { useDeleteChat } from "./use-delete-chat";

/**
 * 首页对话框的头（设计语言 HC-1，用户 11-22 选 C1-A / C3-A / C13-A；只现状主题、只首页驾驶舱问过之后）。
 *
 *   左：对话列表收起（或窗口太窄、手机）时一颗「显示对话列表」——和中栏页头那颗同一个（PaneToggle），手机上开左抽屉
 *   标题：这段对话叫什么，点了就地改名（回车存、Esc 不改、点外面存，走现有 重命名对话）；还没落库（没 id）时不能改
 *   右：「待办 N」（顶部待办提示行问过之后收到这里，点开看）· 列表不在时的「新建对话」· ⋯（重命名 / 删除这段对话）
 *
 * 切换视图（P-全局-01）时不给改名、删除：屏上这段是自己的，但列表那边是空的，改了删了人找不到对应。
 */
export default function ChatHead({ 标题, 对话id, 能改, 待办 }: {
  标题: string;
  /** 落库后的对话 id；还没落库 = null */
  对话id: string | null;
  /** false = 切换视图中：不出改名、删除 */
  能改: boolean;
  /** 顶部待办那几行（AwaitAssignTodo 等），原样递进来；它们各自没数据时画空，这里数真画出来几行 */
  待办?: ReactNode;
}) {
  const router = useRouter();
  const 中栏 = useMiddlePane("chat");
  const [删, 后果框] = useDeleteChat();
  const [, startTransition] = useTransition();
  /** 改过的名字先在这儿记着：router.refresh 回来之前（或这段对话地址上还没 ?c=）标题不跳回去 */
  const [改后, set改后] = useState<{ id: string; 名: string } | null>(null);
  const [改着, set改着] = useState(false);
  const [错, set错] = useState<string | null>(null);
  const 名 = 改后 && 改后.id === 对话id ? 改后.名 : 标题;
  const 可改 = 能改 && !!对话id;

  async function 存(v: string) {
    set改着(false);
    const t = v.trim();
    if (!对话id || !t || t === 名) return;
    set改后({ id: 对话id, 名: t });
    const r = await 重命名对话(对话id, t);
    if (!r.ok) {
      set改后(null);
      set错("改不了这条对话");
      return;
    }
    set错(null);
    startTransition(() => router.refresh());
  }

  // 「改不了这条对话」不一直挂着：3 秒后自己收，鼠标移开也收（3704 实操 #410）
  useEffect(() => {
    if (!错) return;
    const t = setTimeout(() => set错(null), 3000);
    return () => clearTimeout(t);
  }, [错]);

  function 新建() {
    新起一屏(首页屏);
    router.push("/dashboard");
  }

  return (
    <div className="cli-head">
      <PaneToggle 栏="chat" 位置="主区" className="cli-head-ib" />
      {改着 ? (
        <RenameBox 初={名} on存={存} on不改={() => set改着(false)} />
      ) : (
        <Tooltip title={错 ?? (可改 ? "点一下改名" : undefined)} open={错 ? true : undefined} onOpenChange={(开) => { if (!开 && 错) set错(null); }} placement="bottomLeft" mouseEnterDelay={0.6}>
          <button
            type="button"
            className={`cli-head-t${可改 ? "" : " is-static"}`}
            onClick={() => 可改 && set改着(true)}
            aria-label={可改 ? `对话「${名}」，点一下改名` : undefined}
            aria-disabled={可改 ? undefined : true}
          >
            {名}
          </button>
        </Tooltip>
      )}
      <span className="cli-head-sp" />
      <TodoChip>{待办}</TodoChip>
      {!中栏.露着 && (
        <Tooltip title="新建对话" placement="bottom">
          <button type="button" className="cli-head-ib" aria-label="新建对话" onClick={新建}>
            <FormOutlined />
          </button>
        </Tooltip>
      )}
      {可改 && (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          menu={{
            items: [
              { key: "rename", icon: <EditOutlined />, label: "重命名" },
              { type: "divider" },
              { key: "delete", icon: <DeleteOutlined />, label: "删除这段对话", danger: true },
            ],
            onClick: ({ key }) => (key === "rename" ? set改着(true) : 删({ id: 对话id!, title: 名 })),
          }}
        >
          <button type="button" className="cli-head-ib" aria-label="这段对话的操作">
            <EllipsisOutlined />
          </button>
        </Dropdown>
      )}
      {后果框}
    </div>
  );
}

function RenameBox({ 初, on存, on不改 }: { 初: string; on存: (v: string) => void; on不改: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  /** 回车存了以后输入框卸掉还会再触发一次 blur：只认第一次 */
  const 完 = useRef(false);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const 收 = (存: boolean) => {
    if (完.current) return;
    完.current = true;
    if (存) on存(ref.current?.value ?? "");
    else on不改();
  };
  return (
    <input
      ref={ref}
      className="cli-head-in"
      defaultValue={初}
      maxLength={60}
      aria-label="对话名字"
      placeholder="给这段对话起个名字"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          收(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          收(false);
        }
      }}
      onBlur={() => 收(true)}
    />
  );
}

/**
 * 「待办 N」：顶部待办提示行问过之后收到标题行右边（用户 11-22 选 C3-A）。
 * 那几行一直挂在这里（关着时 hidden），各自没数据时画空——N 数的是真画出来的行；0 行不出钮。
 * 点开一层浮层，每行原样（带「去回复 ›」这些动作）；点外面、Esc 收起。
 */
function TodoChip({ children }: { children?: ReactNode }) {
  const 层 = useRef<HTMLDivElement>(null);
  const 根 = useRef<HTMLDivElement>(null);
  const [数, set数] = useState(0);
  const [开, set开] = useState(false);
  useEffect(() => {
    const el = 层.current;
    if (!el) return;
    const 量 = () => set数(el.childElementCount);
    量();
    const mo = new MutationObserver(量);
    mo.observe(el, { childList: true });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    if (!开) return;
    const 外 = (e: PointerEvent) => {
      if (!根.current?.contains(e.target as Node)) set开(false);
    };
    const 键 = (e: KeyboardEvent) => {
      if (e.key === "Escape") set开(false);
    };
    document.addEventListener("pointerdown", 外);
    document.addEventListener("keydown", 键);
    return () => {
      document.removeEventListener("pointerdown", 外);
      document.removeEventListener("keydown", 键);
    };
  }, [开]);
  return (
    <div className="cli-head-todo" ref={根} hidden={数 === 0 ? true : undefined}>
      <button type="button" className="cli-head-chip" aria-expanded={开} aria-haspopup="dialog" onClick={() => set开((v) => !v)}>
        待办 <b>{数}</b>
      </button>
      <div className="cli-head-pop" role="dialog" aria-label="待办" hidden={!开}>
        <div className="cli-head-pop-l" ref={层}>
          {children}
        </div>
      </div>
    </div>
  );
}
