/**
 * 企业版产品名（CRM_PRODUCT_NAME，lib/enterprise/brand.ts，2026-10-27）。
 * 只有企业版部署认这个变量；别的版本设了也不换名（开关关闭照旧）。
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { 自定产品名 } from "@/lib/enterprise/brand";

afterEach(() => vi.unstubAllEnvs());

describe("自定产品名", () => {
  it("开关关闭：设了 CRM_PRODUCT_NAME 也不换名", () => {
    vi.stubEnv("CRM_ENTERPRISE", "");
    vi.stubEnv("CRM_PRODUCT_NAME", "某某 CRM");
    expect(自定产品名()).toBeNull();
  });

  it("企业版设了就用，去掉首尾空格", () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("CRM_PRODUCT_NAME", "  某某 CRM ");
    expect(自定产品名()).toBe("某某 CRM");
  });

  it("企业版没设或只有空格 → 用默认名", () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("CRM_PRODUCT_NAME", "");
    expect(自定产品名()).toBeNull();
    vi.stubEnv("CRM_PRODUCT_NAME", "   ");
    expect(自定产品名()).toBeNull();
  });

  it("太长截到 40 字，别把标签页和登录页撑坏", () => {
    vi.stubEnv("CRM_ENTERPRISE", "1");
    vi.stubEnv("CRM_PRODUCT_NAME", "名".repeat(60));
    expect(自定产品名()).toBe("名".repeat(40));
  });

  it("部署包把 CRM_PRODUCT_NAME 从 .env 传进容器，样例里留空", () => {
    const 包 = path.join(process.cwd(), "deploy/enterprise");
    expect(readFileSync(path.join(包, "docker-compose.yml"), "utf8")).toMatch(/CRM_PRODUCT_NAME: "\$\{CRM_PRODUCT_NAME:-\}"/);
    expect(readFileSync(path.join(包, ".env.example"), "utf8")).toMatch(/^CRM_PRODUCT_NAME=$/m);
  });
});
