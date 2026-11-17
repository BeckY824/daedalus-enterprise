/**
 * 守门（11-18 复盘第 5 类「多个入口写同一件事，守门只装了一部分」）：没有统一的建项目函数，几条路默认值各缺一样
 * （客户页新开项目不带项目来源；补潜客培育、线索转化、导入不写分配方式；导入不写合同状态）。
 * 现在凡是 src 里 Project create / createMany / upsert 的 data，都得摊开 lib/project/proj-fields.ts 的 新项目默认值(…)——
 * 它要求每条路说清分配方式、项目来源（给 null 要在调用处写明为什么），合同状态落「起草中」。
 * 不经过它的只有下面白名单里的，写明理由。不连库、不 import 业务代码。也不许用原生 SQL 往 Project 里插。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { 源文件们, 找写处, type 写处 } from "./helpers/source-scan";

const 文件们 = 源文件们();
const 写处们 = 找写处(文件们, /\.project\.(create|createMany|upsert)\(/g);

/** 不经 新项目默认值 的建项目：文件 + 所在顶层函数，逐条说明 */
const 白名单: { 文件: string; 函数: string; 为什么: string }[] = [
  { 文件: "lib/enterprise-import/project-target.ts", 函数: "建回项目", 为什么: "导入撤回后恢复：照删之前的快照原样建回（分配方式、来源、合同状态都是原值），不是新建" },
];

const 经默认值 = (w: 写处) => !!w.data && /\.\.\.\s*新项目默认值\(/.test(w.data);
const 白 = (w: 写处) => 白名单.find((x) => x.文件 === w.文件 && x.函数 === w.函数);

describe("建项目都经 新项目默认值（复盘第 5 类）", () => {
  it("扫得到：写处够多，默认值确实在用（防扫描本身坏了白过）", () => {
    expect(写处们.length).toBeGreaterThanOrEqual(6);
    expect(写处们.filter(经默认值).length).toBeGreaterThanOrEqual(5);
    expect(写处们.filter((w) => w.data === null)).toEqual([]);
  });

  it("每一处建项目都摊开 新项目默认值(…)，或在白名单里写明理由", () => {
    const 坏 = 写处们.filter((w) => !经默认值(w) && !白(w)).map((w) => `${w.位置}（${w.函数}）`);
    expect(坏).toEqual([]);
  });

  it("新项目默认值 放在 data 最后几项里，不被后面同名的格子盖掉", () => {
    const 坏 = 写处们.filter(经默认值).filter((w) => {
      const 后面 = w.data!.slice(w.data!.search(/\.\.\.\s*新项目默认值\(/));
      return /\b(contractStatus|assignMode|channelId)\s*:/.test(后面.replace(/新项目默认值\([^)]*\)/, ""));
    }).map((w) => w.位置);
    expect(坏).toEqual([]);
  });

  it("新项目默认值 要求说清分配方式、项目来源（签名没被改松）", () => {
    const s = fs.readFileSync(文件们.find((f) => f.endsWith("lib/project/proj-fields.ts"))!, "utf8");
    expect(s).toMatch(/export function 新项目默认值\(\s*企业: boolean,\s*来: \{ 分配方式: string \| null; 项目来源: string \| null \}/);
  });

  it("白名单每条都还用得上（代码改了就删掉）", () => {
    for (const x of 白名单) expect([x.文件, x.函数, 写处们.some((w) => w.文件 === x.文件 && w.函数 === x.函数)]).toEqual([x.文件, x.函数, true]);
  });

  it("不用原生 SQL 往 Project 里插", () => {
    const 坏 = 文件们.filter((f) => /INSERT\s+INTO\s+["`]?Project["`]?[\s(]/i.test(fs.readFileSync(f, "utf8")));
    expect(坏).toEqual([]);
  });
});
