import { 企业版 } from "./switch";

/**
 * 企业版的产品名（2026-10-27）。私有部署给客户用，界面上显示客户自己定的名字，
 * 不显示我们的产品名。名字只从部署环境变量 CRM_PRODUCT_NAME 来，代码里不写任何客户的名字。
 *
 * 不是企业版、或没设 → null，各处照旧显示自己原来的名字。只在服务端读，客户端组件由服务端当 prop 传。
 */
export function 自定产品名(): string | null {
  if (!企业版()) return null;
  const 名 = process.env.CRM_PRODUCT_NAME?.trim();
  return 名 ? 名.slice(0, 40) : null;
}
