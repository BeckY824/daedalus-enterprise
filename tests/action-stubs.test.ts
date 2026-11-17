/** tests/helpers/action-stubs.ts：UI 测试的动作桩按源码补全导出（11-17） */
import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import { 导出名, 文件导出名, 补全动作桩 } from "./helpers/action-stubs";

const 导出of = (代码: string) =>
  Object.values(buildSync({ stdin: { contents: 代码, loader: "jsx" }, write: false, metafile: true, format: "esm", logLevel: "silent" }).metafile.outputs).flatMap((o) => o.exports).sort();

describe("导出名", () => {
  it("认 function / const / export {} / default，不认类型和注释里的", () => {
    const 源 = `"use server";
      // export const 注释里的 = 1;
      export type 类型 = string;
      export async function 甲() {}
      export const 乙 = async () => 1;
      const 丙 = 1, 丁 = 2;
      export { 丙, 丁 as 戊, type 类型2 };
      export default async function () {}`;
    expect(导出名(源).sort()).toEqual(["default", "丙", "乙", "戊", "甲"].sort());
  });
});

describe("补全动作桩", () => {
  const 文件 = "src/app/(app)/leads/schedule-actions.ts";

  it("手写的保留原样，源文件其余导出补成默认；补出来的代码 esbuild 能解析、导出齐全", () => {
    const 全部 = 文件导出名(文件);
    expect(全部.length).toBeGreaterThan(1);
    const 手写 = `export const ${全部[0]}=async()=>window.__特别;`;
    const 代码 = 补全动作桩(文件, 手写);
    expect(代码.startsWith(手写)).toBe(true);
    expect(导出of(代码)).toEqual([...全部].sort());
    for (const n of 全部.slice(1)) expect(代码).toContain(`export const ${n}=async()=>({ok:true});`);
  });

  it("逗号串写法也认得（const f=…;export const a=f,b=f），不重复导出；可换默认", () => {
    const 全部 = 文件导出名(文件);
    const 代码 = 补全动作桩(文件, `const f=async()=>1;export const ${全部.join("=f,")}=f;`, "async()=>null");
    expect(导出of(代码)).toEqual([...全部].sort());
    expect(补全动作桩(文件, "", "async()=>null")).toContain("=async()=>null;");
  });

  it("源文件不在了直接报错", () => {
    expect(() => 补全动作桩("src/app/(app)/不存在-actions.ts")).toThrow(/不存在/);
  });
});
