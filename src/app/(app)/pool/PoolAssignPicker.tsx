"use client";
/**
 * 公海「分配给同事」选人框（原型 pool.assign「改后」，P-界面-43）：从按钮处打开，人多也好找。
 *   顶部搜名字；「最近分配给」几个人一点就选（存在这台电脑上，换电脑没有也照常能用）；下面名单按部门分组，↑↓ 移动、回车确定。
 *   持有上限开着时每人右边写「持有 / 上限」，满了的置灰、选不了（P-界面-43；服务端 超上限 照拦，这里只是先让人看见）。
 *   底下一句写后果（P-界面-40「选人框里写后果」）：谁会接手、待办怎么走、几秒内可撤销；号码不全的也在这里提一句（不另弹框）。
 *   单个：点人 = 直接分（一步完成，底部撤销条可撤）。批量：点人只是选中，按「下一步」再进后果框（P-界面-40 批量分配走后果框）。
 * 分的过程中键里转圈、不收第二下；没分成原因写在框里，不弹顶部提示。
 */
import { useMemo, useRef, useState } from "react";
import { Button, Input, Modal } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";

const 最近键 = "pool-assign-recent";
const 最近几位 = 4;

function 读最近(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(最近键) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function 记最近(id: string) {
  try {
    localStorage.setItem(最近键, JSON.stringify([id, ...读最近().filter((x) => x !== id)].slice(0, 最近几位)));
  } catch {
    /* 存不了就算了：只是方便 */
  }
}

export type 选人项 = { value: string; label: string; 组?: string; 组序?: number; 持有?: number | null; 上限?: number | null };
const 满了 = (p: 选人项) => p.上限 != null && p.持有 != null && p.持有 >= p.上限;
const 没分部门 = "没分部门";

export default function PoolAssignPicker({
  open,
  题,
  人们,
  批,
  后果,
  做,
  onClose,
}: {
  open: boolean;
  /** 「把「星河乐园」分配给」/「把 3 个分配给」 */
  题: string;
  人们: 选人项[];
  /** 批量：点人只是选中，「下一步」交给 做（调用方再开后果框） */
  批?: boolean;
  /** 选中某人时底下那句后果 */
  后果: (名: string) => string;
  /** 单个：真分；批量：进下一步。回 ok:false / 抛错 = 原因写在框里 */
  做: (id: string, 名: string) => 做的结果 | Promise<做的结果>;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [当前, set当前] = useState<string | null>(null);
  const [忙, set忙] = useState(false);
  const [错, set错] = useState("");
  const [最近, set最近] = useState<string[]>([]);
  const 列表 = useRef<HTMLDivElement>(null);
  // 每次打开从头来（搜的字、选的人、错误不带过来）。渲染时比上一次的 open，不用 effect
  const [上次开, set上次开] = useState(false);
  if (open !== 上次开) {
    set上次开(open);
    if (open) {
      const 近 = 读最近().filter((id) => 人们.some((p) => p.value === id));
      setQ("");
      set错("");
      set忙(false);
      set最近(近);
      set当前(近.find((id) => !满了(人们.find((p) => p.value === id)!)) ?? 人们.find((p) => !满了(p))?.value ?? null);
    }
  }
  // 按部门分组（按组织架构里的部门顺序，没分部门的放最后）；组内按原顺序。搜的时候只留有人的组
  const 组们 = useMemo(() => {
    const v = q.trim().toLowerCase();
    const m = new Map<string, 选人项[]>();
    const 序 = new Map<string, number>();
    for (const p of 人们) {
      if (v && !p.label.toLowerCase().includes(v)) continue;
      const g = p.组 || 没分部门;
      m.set(g, [...(m.get(g) ?? []), p]);
      if (!序.has(g)) 序.set(g, p.组序 ?? 0);
    }
    // 同组织架构里部门的顺序（sort），一样的按名字；没分部门的放最后
    return [...m.entries()].sort(([a], [b]) => (a === 没分部门 ? 1 : b === 没分部门 ? -1 : 序.get(a)! - 序.get(b)! || a.localeCompare(b, "zh")));
  }, [q, 人们]);
  /** 只有一个组（都没分部门）时不画组头 */
  const 画组头 = 组们.length > 1 || (组们.length === 1 && 组们[0][0] !== 没分部门);
  const 剩 = useMemo(() => 组们.flatMap(([, ps]) => ps), [组们]);
  const 能选 = useMemo(() => 剩.filter((p) => !满了(p)), [剩]);
  const 名 = (id: string | null) => 人们.find((p) => p.value === id)?.label ?? "";
  const 选中 = 当前 && 能选.some((p) => p.value === 当前) ? 当前 : (能选[0]?.value ?? null);

  async function 交(id: string | null) {
    if (!id || 忙) return;
    const p = 人们.find((x) => x.value === id);
    if (!p || 满了(p)) return;
    set当前(id);
    set忙(true);
    set错("");
    const 因 = await 跑出原因(() => 做(id, 名(id)));
    set忙(false);
    if (因) return void set错(因);
    记最近(id);
    onClose();
  }
  const 点人 = (id: string) => (批 ? set当前(id) : void 交(id));

  // ↑↓ 只在选得了的人之间走（满了的跳过）
  function 挪(d: number) {
    if (!能选.length) return;
    const i = Math.max(0, Math.min(能选.length - 1, 能选.findIndex((p) => p.value === 选中) + d));
    set当前(能选[i].value);
    requestAnimationFrame(() => 列表.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(能选[i].value)}"]`)?.scrollIntoView({ block: "nearest" }));
  }

  return (
    <Modal
      open={open}
      title={<span className="pool-pick-t">{题}</span>}
      width={420}
      onCancel={() => !忙 && onClose()}
      maskClosable={!忙}
      destroyOnHidden
      footer={
        <div className="pool-pick-foot">
          <span className="pool-pick-eff" aria-live="polite">{错 ? <span className="pool-err">{错}</span> : 选中 ? 后果(名(选中)) : "没有可分的人"}</span>
          <Button onClick={onClose} disabled={忙}>取消</Button>
          <Button type="primary" disabled={!选中} loading={忙} onClick={() => void 交(选中)}>
            {选中 ? (批 ? `下一步：分给 ${名(选中)}` : `分给 ${名(选中)}`) : "分配"}
          </Button>
        </div>
      }
    >
      <Input
        autoFocus
        allowClear
        aria-label="搜同事名字"
        placeholder="搜名字"
        prefix={<SearchOutlined className="muted" />}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            挪(e.key === "ArrowDown" ? 1 : -1);
          } else if (e.key === "Enter") {
            e.preventDefault();
            void 交(选中);
          }
        }}
      />
      {最近.length > 0 && (
        <div className="pool-pick-recent">
          <span className="muted">最近分配给</span>
          {最近.map((id) => (
            <button key={id} type="button" className="pool-pick-chip" disabled={忙 || 满了(人们.find((p) => p.value === id)!)} onClick={() => 点人(id)}>{名(id)}</button>
          ))}
        </div>
      )}
      <div className="pool-pick-list" role="listbox" aria-label="同事" ref={列表}>
        {组们.map(([g, ps]) => (
          <div key={g} role="group" aria-label={g}>
            {画组头 && <div className="pool-pick-g" aria-hidden>{g}</div>}
            {ps.map((p) => {
              const 满 = 满了(p);
              return (
                <div
                  key={p.value}
                  data-id={p.value}
                  role="option"
                  aria-selected={p.value === 选中}
                  aria-disabled={满 || undefined}
                  className="pool-pick-p"
                  onMouseEnter={() => !忙 && !满 && set当前(p.value)}
                  onClick={() => !忙 && !满 && 点人(p.value)}
                >
                  <span className="pool-pick-av" aria-hidden>{p.label.slice(0, 1)}</span>
                  <span className="pool-pick-n">{p.label}</span>
                  {p.上限 != null && p.持有 != null && (
                    <span className="pool-pick-cap">{满 ? "满了 · " : ""}{p.持有} / {p.上限}</span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {!剩.length && <div className="muted pool-pick-none">没找到「{q.trim()}」</div>}
      </div>
    </Modal>
  );
}
