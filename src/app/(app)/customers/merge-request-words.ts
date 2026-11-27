/**
 * 合并申请（第二批 2b-3）界面共用的叫法：合并客户框、合并申请页都用。纯常量，客户端能引
 * （lib/enterprise/merge-request.ts 连着库，客户端不能引；等待工作日 两边各一份，tests/ent-merge-request.test.ts「申请预览」钉住一致）
 */
import type { 凭 } from "@/lib/enterprise/merge-request";

/** 合并申请页（等我同意的、我发起的） */
export const 合并申请页 = "/customers/merge-requests";

/** 等多久（同 merge-request.ts 等待工作日：5 个工作日，E-331 一.1） */
export const 等待工作日 = 5;

/** 凭什么要他同意 → 给人看的说法 */
export const 凭叫法: Record<凭, string> = {
  留下客户负责人: "留下那家的客户负责人",
  被并客户负责人: "并进来那家的客户负责人",
  项目负责人: "项目负责人",
  系统管理员: "系统管理员（第 3 次申请，由你判）",
};

/** 合并后发起人能整单撤回的天数（同 customer-merge.ts 撤回期限天数 = 回收站保留天数；tests/ent-merge-request-notice.test.ts 钉住一致） */
export const 撤回天数 = 30;

/** 拒绝原因最多几个字（必填一句，E-428 ②；P-界面-67；服务端 处理客户合并申请 同样拦） */
export const 拒绝原因上限 = 100;

/** 只读身份下同意 / 拒绝 / 撤回按钮置灰，悬停写的原因（P-界面-67；服务端 merge-request.ts 只读身份 本来就拦） */
export const 只读管理员话 = "只读管理员不能替人同意或拒绝";
export const 教练只读话 = "销售教练只能看，不能替人同意或拒绝";
export const 看别人视角话 = "正在看别人的视角，只能看";
