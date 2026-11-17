import { expect } from "@playwright/test";
import { strFromU8, unzipSync } from "fflate";
import { 读xlsx } from "../src/lib/import/xlsx";

/** 验真实下载包；逐份读内层工作簿，核对清单、条数、编号和客户/跟进关联。 */
export function 读取完整导出(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  expect(files["阅读说明.txt"]).toBeTruthy();
  const 清单 = JSON.parse(strFromU8(files["导出清单.json"]));
  expect(Number.isFinite(Date.parse(清单.截止))).toBe(true);
  expect(Number.isFinite(Date.parse(清单.完成))).toBe(true);
  const tables: Record<string, string[][]> = { 客户: [], 跟进: [] };
  const xml: Record<string, string[]> = { 客户: [], 跟进: [] };
  const ids: Record<string, Set<string>> = { 客户: new Set(), 跟进: new Set() };
  const seen = new Set<string>();
  const 编号 = new Set<string>();
  const 工作簿XML: string[] = [];
  const 工作表XML: { 名: string; 内容: string }[] = [];
  for (const part of 清单.分批 as { 文件: string; 类别: string; 条数: number; 首条ID: string; 尾条ID: string }[]) {
    expect(part.文件).toMatch(/^(客户|跟进)-\d{3,}\.xlsx$/);
    expect(part.文件.startsWith(part.类别 + "-")).toBe(true);
    expect(seen.has(part.文件)).toBe(false); seen.add(part.文件);
    const rows = 读xlsx(files[part.文件]);
    expect(rows.length).toBe(part.条数 + 1);
    const head = rows[0];
    if (tables[part.类别].length) expect(head).toEqual(tables[part.类别][0]);
    else tables[part.类别].push(head);
    tables[part.类别].push(...rows.slice(1));
    /*
      核对关系用的稳定键是末尾的系统 ID（库里的 id）：客户表一列「系统 ID」，跟进表两列「客户系统 ID」「跟进系统 ID」。
      11-17 客户抬头 PR-1 前这几列叫「客户编号」「跟进编号」；现在「客户编号」是系统发的号（NO.00012），在客户表「备注」后面，
      没编号的客户（种子直接插库、存量回填前）那格留空——不是关联键，不拿它对条数
    */
    const idIndex = head.indexOf(part.类别 === "客户" ? "系统 ID" : "跟进系统 ID");
    expect(idIndex).toBeGreaterThanOrEqual(0);
    for (const row of rows.slice(1)) { expect(row[idIndex]).toBeTruthy(); expect(ids[part.类别].has(row[idIndex])).toBe(false); ids[part.类别].add(row[idIndex]); }
    expect(rows[1]?.[idIndex] ?? "").toBe(part.首条ID);
    expect(rows.at(-1)?.[idIndex] && rows.length > 1 ? rows.at(-1)![idIndex] : "").toBe(part.尾条ID);
    if (part.类别 === "客户") {
      // 客户编号一列：「备注」后、「系统 ID」前，表头跟叫法走（客户编号 / 学员编号）；有号的写 NO. + 5 位以上、互不重复，
      // 没号的留空（界面上的短号不进导出：不唯一，导回来还会被当成别家的号并进备注）
      const noIndex = idIndex - 1;
      expect(head.slice(noIndex - 1, idIndex + 1)).toEqual(["备注", expect.stringMatching(/编号$/), "系统 ID"]);
      for (const row of rows.slice(1)) {
        const no = row[noIndex] ?? "";
        if (!no) continue;
        expect(no).toMatch(/^NO\.\d{5,}$/);
        expect(编号.has(no), `客户编号 ${no} 重复`).toBe(false); 编号.add(no);
      }
    }
    const inner = unzipSync(files[part.文件]);
    工作簿XML.push(strFromU8(inner["xl/workbook.xml"]));
    for (const [name, value] of Object.entries(inner)) if (name.startsWith("xl/worksheets/")) {
      const 内容 = strFromU8(value); xml[part.类别].push(内容); 工作表XML.push({ 名: `${part.文件}/${name}`, 内容 });
    }
  }
  expect(Object.keys(files).sort()).toEqual([...seen, "导出清单.json", "阅读说明.txt"].sort());
  expect(ids.客户.size).toBe(清单.客户数); expect(ids.跟进.size).toBe(清单.跟进数);
  // 某类零条时产品不生成空工作簿；清单总数仍必须为零。
  if (tables.跟进.length) {
    const customerIndex = tables.跟进[0].indexOf("客户系统 ID");
    expect(customerIndex).toBeGreaterThanOrEqual(0);
    for (const row of tables.跟进.slice(1)) expect(ids.客户.has(row[customerIndex])).toBe(true);
    /*
      跟进表的客户编号一列（11-17 客户抬头 PR-1b）：和客户表同一个位置规矩——「记录人」后、「客户系统 ID」前，表头跟叫法走；
      每条的号和客户表里同一位客户（按系统 ID 对）那格一模一样，客户没编号这里也留空
    */
    const fNo = customerIndex - 1;
    expect(tables.跟进[0].slice(fNo - 1, customerIndex + 1)).toEqual(["记录人", expect.stringMatching(/编号$/), "客户系统 ID"]);
    const 客头 = tables.客户[0] ?? [];
    const 客号 = new Map(tables.客户.slice(1).map((r) => [r[客头.indexOf("系统 ID")], r[客头.indexOf("系统 ID") - 1] ?? ""]));
    for (const row of tables.跟进.slice(1)) expect(row[fNo] ?? "", `跟进 ${row.at(-1)} 的客户编号`).toBe(客号.get(row[customerIndex]) ?? "");
  }
  return { 清单, 客户: tables.客户, 跟进: tables.跟进, 客户XML: xml.客户.join("\n"), 跟进XML: xml.跟进.join("\n"), 工作簿XML, 工作表XML };
}
