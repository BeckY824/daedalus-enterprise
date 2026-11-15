"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Input, Modal, Spin } from "antd";
import type { 演示组 } from "@/lib/enterprise/demo-switch";

/** 最近看过的几个人（只记在这台浏览器里，读不到就当没有） */
const 最近键 = "crm.viewas.recent";
const 读最近 = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(最近键) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 3) : [];
  } catch {
    return [];
  }
};
const 记最近 = (id: string) => {
  try {
    localStorage.setItem(最近键, JSON.stringify([id, ...读最近().filter((x) => x !== id)].slice(0, 3)));
  } catch {
    /* 存不了就不记 */
  }
};

/**
 * 「以某人的视角查看」挑人（切换视图，lib/enterprise/view-as.ts；原型 st.viewas）：一个搜索框 + 按业务角色分组的名单，
 * 顶上「最近」几个；↑↓ 挑、回车选、Esc 关。选了以后框不关、那一行原地转圈「正在切换…」，直到新页面接手——不先白一下屏。
 * 名单服务端给（view-as-menu.ts 读视图名单：在职、不含自己和系统管理员），谁能切、切了能看什么都不在这里管
 */
export default function ViewAsPicker({ open, 名单, 关, 选 }: { open: boolean; 名单: 演示组[]; 关: () => void; 选: (id: string) => void | Promise<void> }) {
  const [词, set词] = useState("");
  const [亮, set亮] = useState(0);
  const [切着, set切着] = useState<string | null>(null);
  const [最近, set最近] = useState<string[]>([]);
  const 表 = useRef<HTMLDivElement>(null);
  // 每次打开从头来（渲染时比上一次的 open，不用 effect；同 ConsequenceDialog）
  const [上次开, set上次开] = useState(false);
  if (open !== 上次开) {
    set上次开(open);
    if (open) {
      set词("");
      set亮(0);
      set切着(null);
      set最近(读最近());
    }
  }

  const 全部 = useMemo(() => 名单.flatMap((g) => g.人.map((p) => ({ ...p, 组: g.名, 字: `${p.name} ${p.说明 ?? ""} ${g.名}`.toLowerCase() }))), [名单]);
  const 组们 = useMemo(() => {
    const q = 词.trim().toLowerCase();
    const 中 = q ? 全部.filter((p) => p.字.includes(q)) : 全部;
    const 近 = q ? [] : 最近.map((id) => 全部.find((p) => p.id === id)).filter((p): p is (typeof 全部)[number] => !!p);
    const 按组 = 名单.map((g) => ({ 名: g.名, 人: 中.filter((p) => p.组 === g.名) })).filter((g) => g.人.length);
    return [...(近.length ? [{ 名: "最近", 人: 近 }] : []), ...按组];
  }, [词, 全部, 名单, 最近]);
  const 平 = 组们.flatMap((g) => g.人.map((p) => ({ ...p, key: `${g.名}:${p.id}` })));

  const 挑 = async (id: string) => {
    if (切着) return;
    set切着(id);
    记最近(id);
    try {
      await 选(id);
    } finally {
      // 没切成（报错留在本页）就恢复可选；切成了页面会整页换掉，这里无所谓
      set切着(null);
    }
  };
  useEffect(() => {
    表.current?.querySelector<HTMLElement>(`[data-i="${亮}"]`)?.scrollIntoView({ block: "nearest" });
  }, [亮]);

  let i = -1;
  return (
    <Modal open={open} title="以某人的视角查看（只读）" onCancel={() => !切着 && 关()} footer={null} destroyOnHidden width={440}>
      <Input
        autoFocus
        aria-label="搜名字或部门"
        placeholder="搜名字或部门"
        value={词}
        disabled={!!切着}
        onChange={(e) => { set词(e.target.value); set亮(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); set亮((n) => Math.min(n + 1, 平.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); set亮((n) => Math.max(n - 1, 0)); }
          else if (e.key === "Enter" && 平[亮]) { e.preventDefault(); void 挑(平[亮].id); }
        }}
      />
      <div className="view-as-list" ref={表} role="listbox" aria-label="成员">
        {!平.length && <div className="view-as-empty">没有匹配的人</div>}
        {组们.map((g) => (
          <div key={g.名} role="group" aria-label={g.名}>
            <div className="view-as-g">{g.名}</div>
            {g.人.map((p) => {
              i += 1;
              const 我 = i;
              return (
                <div
                  key={`${g.名}:${p.id}`}
                  data-i={我}
                  role="option"
                  aria-selected={亮 === 我}
                  className={`view-as-i${亮 === 我 ? " on" : ""}`}
                  tabIndex={-1}
                  onMouseEnter={() => set亮(我)}
                  onClick={() => void 挑(p.id)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void 挑(p.id); } }}
                >
                  <span className="view-as-n">{p.name}</span>
                  {p.说明 && <span className="view-as-d">{p.说明}</span>}
                  {切着 === p.id && <span className="view-as-busy"><Spin size="small" /> 正在切换…</span>}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </Modal>
  );
}
