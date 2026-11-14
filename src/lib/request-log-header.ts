/** 慢请求日志的用户 id 请求头（proxy.ts 放、lib/request-log.ts 读）。单独一个文件：proxy 不用把 node:fs 那份拉进来 */
export const 用户头 = "x-crm-uid";
