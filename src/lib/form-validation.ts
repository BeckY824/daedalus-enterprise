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
