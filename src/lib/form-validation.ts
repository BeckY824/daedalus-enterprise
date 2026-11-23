import { 录入电话 } from "./phone";

/** Only validate visibility; preserve the original text, including emoji joiners. */
export function hasVisibleText(value: unknown): value is string {
  return typeof value === "string" && value.replace(/[\s\p{Cf}\p{Cc}\p{M}\u2800\u3164\u115f\u1160\uffa0]/gu, "").length > 0;
}

export function requiredText(message: string) {
  return {
    required: true,
    validator: (_: unknown, value: unknown) => hasVisibleText(value) ? Promise.resolve() : Promise.reject(new Error(message)),
  };
}

export function isFormValidationError(error: unknown): boolean {
  return !!error && typeof error === "object" && "errorFields" in error && Array.isArray(error.errorFields);
}

/**
 * 线索、渠道表单「联系电话」格的就地校验（11-17 复盘第 4 类）：和服务端同一个 录入电话——号码以外的字整格拦下、格子下面说为什么。
 * 和打开时一样（没改的老号、共享区打码的号）不验，服务端同样放过
 */
export function 电话格验(v: string | null | undefined, 原?: string | null): Promise<void> {
  const s = (v ?? "").trim();
  if (s === (原 ?? "").trim()) return Promise.resolve();
  const r = 录入电话(s, { 必填: false });
  return r.ok ? Promise.resolve() : Promise.reject(new Error(r.error));
}

/**
 * 设计语言 E1（D03，同 D4 新建沟通 / 待办 / 卡点）：antd 表单校验没过——红字在各格下面，再把焦点挪到第一处没填好的格
 * （等红字画出来再挪）。用法：`form.validateFields().catch(跳到第一处(form))`，没过回 null
 */
export function 跳到第一处(form: { focusField: (name: (string | number)[]) => void }) {
  return (e: unknown): null => {
    const 名 = isFormValidationError(e) ? (e as { errorFields: { name: (string | number)[] }[] }).errorFields[0]?.name : undefined;
    if (名) window.setTimeout(() => form.focusField(名), 0);
    return null;
  };
}

/** 格子里能接焦点的控件。antd 6 的下拉、日期框里面也是一个 input（.ant-select-selector 已经没了），自定义的按 tabindex=0 认 */
export const 可聚焦控件 = ':is(textarea, input:not([type=hidden]):not(:disabled), [tabindex="0"])';

/**
 * 设计语言 E1（D03）：一格里该接焦点的那个控件——先找标红的（类型 + 号码拼在一格里、只有号码红时落到号码上），没有标红的取第一个。
 * 不是 antd Form 的表单（自己算缺项、按格子容器标红的）用它：`格里该聚焦的(格子)?.focus()`
 */
export function 格里该聚焦的(格子: Element | null): HTMLElement | null {
  if (!格子) return null;
  const 红 = 格子.querySelector('[class*="-status-error"]');
  const 红里的 = 红 && (红.matches(可聚焦控件) ? 红 : 红.querySelector(可聚焦控件));
  return (红里的 ?? 格子.querySelector(可聚焦控件)) as HTMLElement | null;
}
