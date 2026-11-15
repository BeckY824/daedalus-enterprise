"use client";
/**
 * 公海「分配给同事」选人框（原型 pool.assign「改后」，P-界面-43）：从按钮处打开，人多也好找。
 *   顶部搜名字；「最近分配给」几个人一点就选（存在这台电脑上，换电脑没有也照常能用）；下面整张名单，↑↓ 移动、回车确定。
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

export type 选人项 = { value: string; label: string };

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
      set当前(近[0] ?? 人们[0]?.value ?? null);
    }
  }
  const 剩 = useMemo(() => {
    const v = q.trim().toLowerCase();
    return v ? 人们.filter((p) => p.label.toLowerCase().includes(v)) : 人们;
  }, [q, 人们]);
  const 名 = (id: string | null) => 人们.find((p) => p.value === id)?.label ?? "";
  const 选中 = 当前 && 剩.some((p) => p.value === 当前) ? 当前 : (剩[0]?.value ?? null);

  async function 交(id: string | null) {
    if (!id || 忙) return;
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

  function 挪(d: number) {
    if (!剩.length) return;
    const i = Math.max(0, Math.min(剩.length - 1, 剩.findIndex((p) => p.value === 选中) + d));
    set当前(剩[i].value);
    requestAnimationFrame(() => 列表.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(剩[i].value)}"]`)?.scrollIntoView({ block: "nearest" }));
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
            <button key={id} type="button" className="pool-pick-chip" disabled={忙} onClick={() => 点人(id)}>{名(id)}</button>
          ))}
        </div>
      )}
      <div className="pool-pick-list" role="listbox" aria-label="同事" ref={列表}>
        {剩.map((p) => (
          <div
            key={p.value}
            data-id={p.value}
            role="option"
            aria-selected={p.value === 选中}
            className="pool-pick-p"
            onMouseEnter={() => !忙 && set当前(p.value)}
            onClick={() => !忙 && 点人(p.value)}
          >
            <span className="pool-pick-av" aria-hidden>{p.label.slice(0, 1)}</span>
            <span className="pool-pick-n">{p.label}</span>
          </div>
        ))}
        {!剩.length && <div className="muted pool-pick-none">没找到「{q.trim()}」</div>}
      </div>
    </Modal>
  );
}
