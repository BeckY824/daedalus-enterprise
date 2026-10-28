import { expect, type Locator } from "@playwright/test";

export const 企业版 = process.env.CRM_ENTERPRISE === "1";

/**
 * 企业版普通销售新建的只能记在自己名下（src/lib/enterprise/import-perm.ts 新建只给自己）：
 * 「销售负责人」锁着、已经是自己，验它锁着就算选好了。
 * 只看得见自己一个人时这一格整个不出（CustomerForm 的 独自一人），也就是记在自己名下。
 */
export async function 负责人锁给自己(表单: Locator) {
  const 负责人 = 表单.getByLabel("销售负责人");
  if ((await 负责人.count()) === 0) return;
  await expect(负责人).toBeDisabled();
  await expect(表单.getByText("新建的只能记在自己名下")).toBeVisible();
}
