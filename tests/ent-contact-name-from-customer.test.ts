/**
 * 客户名拆人名（E-260，lib/enterprise/contact-name-from-customer.ts）：号码落到主联系人、客户又没有联系人时新建的那位按它起名；
 * 认得出人名才填，认不出（单位名、空的）留空串。代码入口和数据脚本共用。
 */
import { describe, expect, it } from "vitest";
import { 客户名拆人名 } from "@/lib/enterprise/contact-name-from-customer";

describe("客户名拆人名", () => {
  it("名称本身就是人名、称呼：原样拿", () => {
    expect(客户名拆人名("张三")).toBe("张三");
    expect(客户名拆人名("李总")).toBe("李总");
    expect(客户名拆人名("王女士")).toBe("王女士");
    expect(客户名拆人名("欧阳娜娜")).toBe("欧阳娜娜");
    expect(客户名拆人名("John Smith")).toBe("John Smith");
  });

  it("竖线、斜杠、括号、逗号分开的几段：取像人名的那段", () => {
    expect(客户名拆人名("张三｜美国")).toBe("张三");
    expect(客户名拆人名("美国|John Smith")).toBe("John Smith");
    expect(客户名拆人名("深圳（陈经理）")).toBe("陈经理");
    expect(客户名拆人名("广州，刘先生，要报价")).toBe("刘先生");
  });

  it("夹着号码、空格的：号码挖掉再认", () => {
    expect(客户名拆人名("李总 13800001111")).toBe("李总");
    expect(客户名拆人名("张三13800001111")).toBe("张三");
    expect(客户名拆人名("+86 138-0000-1111 赵六")).toBe("赵六");
    expect(客户名拆人名("深圳 黄先生 外贸")).toBe("黄先生");
  });

  it("单位名、认不出的、空的：留空串，不猜", () => {
    expect(客户名拆人名("深圳星辰科技有限公司")).toBe("");
    expect(客户名拆人名("ACME Trading Ltd")).toBe("");
    expect(客户名拆人名("13800001111")).toBe("");
    expect(客户名拆人名("要报价")).toBe("");
    expect(客户名拆人名("")).toBe("");
    expect(客户名拆人名(null)).toBe("");
    expect(客户名拆人名(undefined)).toBe("");
    expect(客户名拆人名("　​ ")).toBe("");
  });
});
