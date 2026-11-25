import { Tag } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { 售后回访名, 交付结清要售后回访话 } from "@/lib/project/follow-needs-project-text";

/**
 * 售后回访（11-25，E-283）：交付结清的项目上记沟通时那颗锁着的「售后回访」标——不用另勾、也去不掉（标记跟着项目定，第十节第 11 条）。
 * 客户页记沟通框、项目详情「记售后回访」、完成计划小框、首页 AI 记沟通卡共用
 */
export default function AfterSaleLockTag() {
  return (
    <Tag icon={<LockOutlined />} color="cyan" bordered={false} title={交付结清要售后回访话} data-testid="after-sale-lock" className="as-tag">
      {售后回访名}
    </Tag>
  );
}
