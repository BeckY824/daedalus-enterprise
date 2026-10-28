import { getSetting, setSetting } from "./settings";
import { BUSINESS_KEY, mergeBusiness, 企业版锁定, 企业版默认业务, type BusinessConfig } from "./business-config";
import { 企业版 } from "./enterprise/switch";

export * from "./business-config";

/** 企业版读出来先换默认职位 / 简介、再锁住模版和项目模式（business-config.ts 企业版锁定） */
export async function getBusiness(): Promise<BusinessConfig> {
  const b = mergeBusiness(await getSetting<Partial<BusinessConfig>>(BUSINESS_KEY));
  return 企业版() ? 企业版锁定(企业版默认业务(b)) : b;
}

export async function saveBusiness(cfg: BusinessConfig): Promise<void> {
  const b = mergeBusiness(cfg);
  await setSetting(BUSINESS_KEY, 企业版() ? 企业版锁定(b) : b);
}
