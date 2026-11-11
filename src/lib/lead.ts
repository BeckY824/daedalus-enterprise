/**
 * 我们自己收信的邮箱（中转站余额告警发到这里，lib/upstream-alert.ts）。
 *
 * 原来这里是官网「预约演示」表单的后端（/api/lead）：校验、限流、发信。那条接口企业版够不着，
 * 12c 随托管版路由一起删了，只剩收件箱这一处还被余额告警用着，跟网关那批一起再收。
 */

/** 收件箱。LEAD_TO > LEGAL_CONTACT > 默认，和条款页的联系邮箱同源 */
export function 收件人(env: NodeJS.ProcessEnv = process.env): string {
  return env.LEAD_TO?.trim() || env.LEGAL_CONTACT?.trim() || "qy1g18@gmail.com";
}
