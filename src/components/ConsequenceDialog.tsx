"use client";
/**
 * 后果框：写清后果的二次确认（原型 g.confirm2「改后」），替代 antd modal.confirm 的那种「确定 / 取消」。
 *
 * 哪些事用它，看机制总表 P-界面-40 的「后果确认框」那一类（退回公海、标无效、删客户、删回款、转让、批量分配……）。
 * 一行后果说得完的用就地确认（InlineConfirm），能一次做完的不问（P-界面-40 末句）。
 *
 * 长相：
 *   标题写「动作 + 那条东西」：「把「华东展具」退回公海」，不写「确定吗？」
 *   后果**分条**，每条一个小标签打头（领不回 / 一起退 / 之后），红 = 回不来，橙 = 连带，灰 = 之后会怎样
 *   要原因的（P-界面-42）：字典常用项是可点的小块，点「其他」原地变输入框、必填；没选好确认键点不了
 *   要勾「我知道…」的（比如删客户连签约一起删）：勾上之前确认键点不了
 *   确认键写那件事本身（「退回公海」），危险的事是红的实心键；取消在左
 * 确认之后：键里转圈、不收第二下；没成就把原因写在框里（不弹顶部提示、不关框），可以再点；成了才关。
 * 要给撤销的（退回公海 6 秒内可撤）由调用方在 做 成功之后 showUndo——撤销条会跟着跳到下一页。
 *
 * 两种用法：
 *   <ConsequenceDialog open={…} onClose={…} 题=… 后果={[…]} 是="退回公海" 做={…} />
 *   const [问后果, 后果框] = useConsequence();  …  {后果框}  …  const 成了 = await 问后果({ 题, 后果, 是, 做 })
 * 第二种和 antd 的 modal.confirm 一样顺手，但框是我们自己画的。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, Modal } from "antd";
import { 其他项, 其他补充上限, 合其他 } from "@/lib/enterprise/dict-kinds";
import { 跑出原因, type 做的结果 } from "@/lib/confirm-result";

export type 后果条 = {
  /** 打头的小标签，两三个字：领不回 / 一起退 / 之后 / 全部删掉 / 不动 */
  标: string;
  /** 那一条后果，一句话 */
  话: React.ReactNode;
  /** 危 = 回不来（红），警 = 连带的（橙），常 = 之后会怎样 / 不受影响（灰）。默认 常 */
  级?: "危" | "警" | "常";
};

export type 后果框参数 = {
  /** 标题：动作 + 那条东西，「把「华东展具」退回公海」 */
  题: React.ReactNode;
  /** 分条的后果 */
  后果: 后果条[];
  /** 后果下面再补一段（比如金额明细）；能拆成条的先拆成条 */
  补充?: React.ReactNode;
  /** 确认键上的字：那件事本身，「退回公海」「删除」「转让」 */
  是: string;
  /** 危险的事（默认）：确认键是红的实心键；false = 主色 */
  危?: boolean;
  /** 要原因：字典常用项（设置里的字典）。选「其他」要再写，提交给 做 的是「其他：xxx」（同 DictSelect） */
  原因?: { 选项: readonly string[]; 叫?: string };
  /** 要先勾上才让确认：「我知道签约也会删掉」 */
  须知?: string;
  /** 确认之后做的事。回 { ok:false, error } 或抛错 = 没成：原因写在框里，框不关 */
  做: (原因?: string) => 做的结果 | Promise<做的结果>;
  /** 框宽，默认 440 */
  宽?: number;
};

export default function ConsequenceDialog({
  open,
  onClose,
  题,
  后果,
  补充,
  是,
  危 = true,
  原因,
  须知,
  做,
  宽 = 440,
}: 后果框参数 & {
  open: boolean;
  /** 取消、点遮罩、Esc、做成了之后都调它；做成了时 成了 = true */
  onClose: (成了: boolean) => void;
}) {
  const [选, set选] = useState<string | null>(null);
  const [写, set写] = useState("");
  const [勾, set勾] = useState(false);
  const [忙, set忙] = useState(false);
  const [错, set错] = useState("");
  const 写框 = useRef<HTMLInputElement>(null);

  // 每次打开都从头来：上一次选的原因、勾、错误不带过来。渲染时比上一次的 open，不用 effect
  const [上次开, set上次开] = useState(open);
  if (open !== 上次开) {
    set上次开(open);
    if (open) {
      set选(null);
      set写("");
      set勾(false);
      set错("");
      set忙(false);
    }
  }

  const 原因值 = 原因 ? 合其他(选, 写) : undefined;
  const 原因齐 = !原因 || (!!选 && (选 !== 其他项 || !!写.trim()));
  const 能确认 = 原因齐 && (!须知 || 勾) && !忙;

  async function 确认() {
    if (!能确认) return;
    set忙(true);
    set错("");
    const 因 = await 跑出原因(() => 做(原因值 ?? undefined));
    set忙(false);
    if (因) set错(因);
    else onClose(true);
  }

  const 取消 = () => {
    if (!忙) onClose(false);
  };

  return (
    <Modal
      open={open}
      onCancel={取消}
      title={题}
      width={宽}
      maskClosable={!忙}
      keyboard={!忙}
      closable={false}
      destroyOnHidden
      className="csq"
      footer={
        <div className="csq-foot">
          <Button onClick={取消} disabled={忙}>
            取消
          </Button>
          <Button
            type="primary"
            danger={危}
            loading={忙}
            disabled={!能确认 && !忙}
            onClick={() => void 确认()}
          >
            {是}
          </Button>
        </div>
      }
    >
      <ul className="csq-list">
        {后果.map((x, i) => (
          <li key={i} className="csq-row">
            <span className="csq-tag" data-level={x.级 ?? "常"}>
              {x.标}
            </span>
            <span className="csq-t">{x.话}</span>
          </li>
        ))}
      </ul>
      {补充 && <div className="csq-more">{补充}</div>}
      {原因 && (
        <div className="csq-why" role="radiogroup" aria-label={原因.叫 ?? "原因"} aria-required>
          <div className="csq-why-h">{原因.叫 ?? "原因"}</div>
          <div className="csq-chips">
            {原因.选项.map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={选 === o}
                className="csq-chip"
                disabled={忙}
                onClick={() => {
                  set选(o);
                  set错("");
                  if (o === 其他项) requestAnimationFrame(() => 写框.current?.focus());
                }}
              >
                {o}
              </button>
            ))}
          </div>
          {选 === 其他项 && (
            <Input
              ref={(r) => {
                写框.current = r?.input ?? null;
              }}
              className="csq-other"
              maxLength={其他补充上限}
              showCount
              disabled={忙}
              placeholder="具体是什么（必填）"
              aria-label={`${原因.叫 ?? "原因"}：其他的具体内容`}
              value={写}
              onChange={(e) => set写(e.target.value)}
              onPressEnter={() => void 确认()}
            />
          )}
        </div>
      )}
      {须知 && (
        <Checkbox className="csq-ack" checked={勾} disabled={忙} onChange={(e) => set勾(e.target.checked)}>
          {须知}
        </Checkbox>
      )}
      {错 && (
        <div className="csq-err" role="alert">
          {错}
        </div>
      )}
    </Modal>
  );
}

/**
 * 命令式用法：const [问后果, 后果框] = useConsequence();
 * 把 后果框 放进组件的 JSX 里（哪都行），然后 await 问后果({...})：成了 true，取消 false。
 * 同一时刻只有一个框；上一个还开着又问了一次，上一个按取消结束。
 */
export function useConsequence(): [(p: 后果框参数) => Promise<boolean>, React.ReactNode] {
  const [参, set参] = useState<后果框参数 | null>(null);
  const [开, set开] = useState(false);
  const 等 = useRef<((v: boolean) => void) | null>(null);

  const 问 = useCallback((p: 后果框参数) => {
    等.current?.(false);
    return new Promise<boolean>((resolve) => {
      等.current = resolve;
      set参(p);
      set开(true);
    });
  }, []);

  // 组件卸了还没答：按取消结束，免得 await 一直挂着
  useEffect(() => () => void 等.current?.(false), []);

  const 节点 = 参 ? (
    <ConsequenceDialog
      {...参}
      open={开}
      onClose={(成了) => {
        set开(false);
        const r = 等.current;
        等.current = null;
        r?.(成了);
      }}
    />
  ) : null;
  return [问, 节点];
}
