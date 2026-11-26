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
};
