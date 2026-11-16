import { strToU8, strFromU8, zipSync } from "fflate";
import { 写xlsx } from "@/lib/xlsx-write";
import { 客户导出表, 跟进导出表, 系统ID列 } from "./export-table";
import type { 导出指令 } from "./export-protocol";
import { configureBrowserBusinessTimeZone } from "@/lib/business-clock";

// 每次导出独占一个Worker，失败/取消会销毁，不会把半份结果下载给用户。
const files: Record<string, Uint8Array> = {};
const parts: { 文件: string; 类别: string; 条数: number; 首条ID: string; 尾条ID: string }[] = [];
self.onmessage = (event: MessageEvent<导出指令>) => {
  try {
    const task = event.data;
    if (task.动作 === "分批") {
      configureBrowserBusinessTimeZone(task.timeZone);
      const { 批次, b } = task;
      const table = 批次.类别 === "客户" ? 客户导出表(批次.rows, b, task.隐藏负责人, task.渠道两层) : 跟进导出表(批次.rows, b);
      // 系统 ID（库里的 id）是核对关系的稳定键，同名/同电话不会混在一起；放最后保持导入识别习惯。
      // 11-17 客户抬头 PR-1：原来这一列叫「客户编号」，和新加的客户编号（NO.00012，客户表「备注」后面那列）撞名，改叫「系统 ID」
      const ids = 批次.rows.map((r) => "customerId" in r ? [r.customerId, r.id] : [r.id]);
      const name = `${批次.类别}-${String(parts.filter((p) => p.类别 === 批次.类别).length + 1).padStart(3, "0")}.xlsx`;
      files[name] = 写xlsx([{ 名: 批次.类别 === "客户" ? b.customer : "跟进记录", 表头: [...table.head, ...(批次.类别 === "跟进" ? [`客户${系统ID列}`, `跟进${系统ID列}`] : [系统ID列])], 行: table.body.map((r, i) => [...r, ...ids[i]]) }]);
      parts.push({ 文件: name, 类别: 批次.类别, 条数: 批次.rows.length, 首条ID: 批次.rows[0]?.id ?? "", 尾条ID: 批次.rows.at(-1)?.id ?? "" });
      self.postMessage({ ok: true });
    } else {
      files["导出清单.json"] = strToU8(JSON.stringify({ ...task.清单, 分批: parts }, null, 2));
      files["阅读说明.txt"] = strToU8("客户与跟进分别分批保存；按系统 ID 关联，按清单逐份核对条数。客户表可再导入：客户编号、系统 ID 两列是系统生成的，再导入时不收；跟进表供查阅。文件仅包含当前账号可见且符合筛选条件的数据。导出逐批读取并在下载前复核，不含开始导出后新增的记录。正在编辑时请暂停修改再导出。产品图片不在导出里，客户表「图片张数」一列写明这位客户的商机、订单上各挂了几张。\n");
      // 内层xlsx已压缩；外层只打包，避免再次重复压缩。
      if (task.清单.隐藏负责人) files["阅读说明.txt"] = strToU8(strFromU8(files["阅读说明.txt"]) + "本次客户表只有一位可选负责人，且全部客户归属均为此人；省略销售负责人和渠道负责人列。跟进记录保留记录人，系统 ID 保持完整。\n");
      const zip = zipSync(files, { level: 0 });
      self.postMessage({ ok: true, bytes: zip }, { transfer: [zip.buffer] });
    }
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : "生成导出文件失败" });
  }
};
