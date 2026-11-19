"use client";

import { Tag } from "antd";
import { CloseOutlined } from "@ant-design/icons";
import { 读批次, 批次说法 } from "@/lib/project/import-batch";

/**
 * 列表页头「导入批次：只看 / 排掉 某批 ×」（11-19，数据页按导入批次点进来带 batch=）：项目列表、新线索、公海页共用。
 * 批次名长，一行省略、悬停看全（企业版一行 + 省略号 + 悬停），窄屏不撑出页宽。认不出的 batch 不摆
 */
export default function BatchFilterTag({ batch, 清掉 }: { batch: string | undefined; 清掉: () => void }) {
  const 批 = 读批次(batch);
  if (!批) return null;
  const 话 = `导入批次：${批次说法(批)}`;
  return (
    <Tag className="batch-filter-tag" closable onClose={(e) => { e.preventDefault(); 清掉(); }} closeIcon={<CloseOutlined aria-label="清掉导入批次筛选" />}>
      <span className="batch-filter-t" title={`${话}（批次号 ${批.批}）`}>{话}</span>
    </Tag>
  );
}
