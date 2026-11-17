"use client";

/**
 * 录入弹窗的三条规矩（2026-10-19 客户反馈「新建客户 / 新建商机填到一半点框外面，弹窗没了，要重填」）：
 *
 * 1. 点遮罩不关。antd 弹窗默认点外面就关，填了一半的东西一下全没了
 * 2. Esc / 右上角 X / 「取消」关的时候，人填过东西就先问一句「放弃填的内容？」
 * 3. 没保存就关的、刷新 / 发版后重开的，草稿留在这台电脑上（localStorage，存取见 lib/form-draft.ts），下次打开同一个弹窗接着填；保存成功就清掉
 *
 * 「填过」只认人亲手改的（Form 的 onValuesChange 只在人操作时触发，程序 setFieldsValue 不算）——
 * 打开时程序填进去的默认值（负责人、跟进类型……）不算填过，没动就关不用问（同 PlanForm 人改过方式 那条坑）。
 *
 * 草稿只存这台电脑、只按人分（换个账号登录看不到上一个人的草稿），放 3 天，过了当没有。
 * 编辑弹窗（11-17 起也存，键里带记录编号）：只存人改过的那几格（和打开那一刻比），带回时不拿旧值盖掉没动的格子。
 * 带回不再用底部撤销条：框里一行「已带回上次没提交的内容 · 清空」（守.提示，各弹窗摆在表单顶上）。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Space } from "antd";
import type { FormInstance } from "antd";
import { useMe } from "@/lib/me-client";
import { DraftHint } from "@/components/FormDraft";
import { 草稿全名, 读一份, 存草稿, 清草稿, 有内容, 改过的格 } from "@/lib/form-draft";

/** 存取挪到 lib/form-draft.ts（11-17 全站一份）；老地方照样能引 */
export { 草稿全名, 读草稿, 存草稿, 清草稿, 有内容 } from "@/lib/form-draft";

export type 守卫选项 = {
  open: boolean;
  /** 关掉弹窗（原来 onCancel 里做的事） */
  关: () => void;
  /** antd 表单。没有表单的（完成计划小框这种 useState 的）不给，用 填过 自己说 */
  form?: FormInstance;
  /** 给了才存草稿：同一个键就是「同一个弹窗」。新建按来源分（`新建待办:<客户>`），编辑带记录编号（`编辑客户:<id>`）；null = 不存 */
  草稿键?: string | null;
  /** 编辑老记录：草稿只存改过的格子 */
  编辑?: boolean;
  /** 没有 antd 表单的弹窗自己说填没填过 */
  填过?: () => boolean;
  /** 正在保存的时候不让关（原来有的照旧） */
  忙?: boolean;
  /** 弹窗原来的 afterOpenChange（多半是 聚焦首项），照样调 */
  afterOpenChange?: (开了: boolean) => void;
  /** 不进草稿的格子：跟着挑中那位客户走的（客户、联系人、商机），下次打开重新挑 */
  不存?: readonly string[];
  /** 表单外头、也是人打的字（AI 速记框、卡点那一块）：取 / 放 */
  额外?: { 取: () => Record<string, unknown>; 放: (v: Record<string, unknown>) => void };
  /** 挂着几个附件：存不进来，带回时提示要重选 */
  附件数?: () => number;
};

export function useFormGuard({ open, 关, form, 草稿键 = null, 编辑 = false, 填过, 忙 = false, afterOpenChange, 不存, 额外, 附件数 }: 守卫选项) {
  const { modal } = App.useApp();
  const 我 = useMe();
  const 全名 = 草稿键 ? 草稿全名(我?.id, 草稿键) : null;
  const 改过 = useRef(false);
  const 问着 = useRef(false);
  const 不存键 = (不存 ?? []).join("|");
  /** 打开（动画走完、各弹窗填好初值）那一刻的值：编辑时草稿只存和它不一样的格子；「清空」放回它 */
  const 起始 = useRef<Record<string, unknown> | null>(null);
  const 起始额外 = useRef<Record<string, unknown> | null>(null);
  const [带回了, set带回了] = useState<{ 附件: number } | null>(null);
  const 外 = useRef({ 额外, 附件数 });
  useLayoutEffect(() => {
    外.current = { 额外, 附件数 };
  });
  const 取值 = useCallback(() => {
    const v = { ...(form?.getFieldsValue(true) as Record<string, unknown> | undefined) };
    for (const k of 不存键 ? 不存键.split("|") : []) delete v[k];
    if (编辑) return 起始.current ? 改过的格(起始.current, v) : {};
    return v;
  }, [form, 不存键, 编辑]);
  const 存 = useCallback(() => {
    if (!全名) return;
    const v = 取值();
    const 外头 = 外.current.额外?.取();
    const 外头改了 = 外头 && 起始额外.current ? 改过的格(起始额外.current, 外头) : 外头;
    if (有内容(v) || 有内容(外头改了)) 存草稿(全名, v, { 附件: 外.current.附件数?.() ?? 0, 额外: 外头 });
  }, [全名, 取值]);

  // 草稿在打开那一刻就读好：等动画走完再读的话，人手快、动画没走完就开始填，读到的是自己刚填的这几个字
  const 待恢复 = useRef<ReturnType<typeof 读一份>>(null);
  // 每次打开从头算：上一次改过没保存的，这一次没动就不该问
  useEffect(() => {
    if (!open) return;
    改过.current = false;
    起始.current = null;
    起始额外.current = null;
    待恢复.current = 全名 ? 读一份(全名) : null;
  }, [open, 全名]);

  const 改了 = useCallback(() => {
    改过.current = true;
    // 等这一下的 setState 画完再存：表单外头那几样（额外.取）读的是渲染后的值，同步存会慢一个字。存好了 之后不再存
    window.setTimeout(() => {
      if (改过.current) 存();
    }, 0);
  }, [存]);

  /** 保存成功以后调：草稿清掉，关的时候不再问 */
  const 存好了 = useCallback(() => {
    改过.current = false;
    if (全名) 清草稿(全名);
    set带回了(null);
  }, [全名]);

  /** 「清空」：带回的那几格放回打开时的样子、草稿扔掉 */
  const 清空 = useCallback(() => {
    if (form && 起始.current) form.setFieldsValue(起始.current);
    if (起始额外.current) 外.current.额外?.放(起始额外.current);
    改过.current = false;
    if (全名) 清草稿(全名);
    set带回了(null);
  }, [form, 全名]);

  const 开好了 = useCallback(
    (开了: boolean) => {
      // 动画走完、各弹窗自己的 useEffect 都填过初值了，这时再把草稿盖上去，才不会被它们冲掉
      const 稿 = 待恢复.current;
      待恢复.current = null;
      // 关上了：那一行收起，下次打开从头算
      if (!开了) set带回了(null);
      if (开了) {
        if (form) {
          const v = { ...(form.getFieldsValue(true) as Record<string, unknown>) };
          for (const k of 不存键 ? 不存键.split("|") : []) delete v[k];
          起始.current = v;
        }
        起始额外.current = 外.current.额外?.取() ?? null;
      }
      // 动画没走完人已经动手填了：以人填的为准，不拿草稿盖
      if (开了 && 全名 && 稿 && !改过.current && (有内容(稿.v) || 有内容(稿.额外))) {
        if (form && 有内容(稿.v)) form.setFieldsValue(稿.v);
        if (稿.额外 && typeof 稿.额外 === "object") 外.current.额外?.放(稿.额外 as Record<string, unknown>);
        改过.current = true;
        // 不弹顶部提示、不用撤销条：框里一行「已带回上次没提交的内容 · 清空」（守.提示）
        set带回了({ 附件: 稿.附件 });
      }
      afterOpenChange?.(开了);
    },
    [全名, form, afterOpenChange, 不存键],
  );

  const 要关 = useCallback(() => {
    if (忙 || 问着.current) return;
    const 填了 = 改过.current || Boolean(填过?.());
    if (!填了) {
      if (全名) 清草稿(全名);
      关();
      return;
    }
    问着.current = true;
    const 框 = modal.confirm({
      title: "放弃填的内容？",
      content: 全名 ? "还没保存。留着草稿的话，下次在这台电脑上打开同一个弹窗能接着填。" : "改的还没保存。",
      // 焦点落在「继续填」（就是 OK 那颗）：顺手按回车不会把填的扔掉
      okText: "继续填",
      focusable: { autoFocusButton: "ok" },
      // 盖在所有录入弹窗上面（就地建渠道那个小框是 1100）
      zIndex: 1200,
      afterClose: () => {
        问着.current = false;
      },
      footer: (_, { OkBtn }) => (
        <Space style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <Button
            danger
            onClick={() => {
              if (全名) 清草稿(全名);
              改过.current = false;
              框.destroy();
              关();
            }}
          >
            放弃
          </Button>
          {全名 && (
            <Button
              onClick={() => {
                存();
                框.destroy();
                关();
              }}
            >
              留着草稿，先关掉
            </Button>
          )}
          <OkBtn />
        </Space>
      ),
    });
  }, [忙, 填过, 全名, 关, modal, 存]);

  const 提示: ReactNode = 带回了 ? <DraftHint 附件={带回了.附件} on清空={清空} /> : null;

  return {
    /** 摊到 <Modal> 上：点遮罩不关；Esc / X / 取消 都走 要关 */
    弹窗: { mask: { closable: false }, onCancel: 要关, afterOpenChange: 开好了 },
    /** 接到 <Form onValuesChange> 上（已有的 onValuesChange 里也调一下）；表单外头的字（额外）变了也调 */
    改了,
    存好了,
    要关,
    /** 带回了草稿时框里那一行（摆在表单顶上）；没带回是 null */
    提示,
    清空,
  };
}
