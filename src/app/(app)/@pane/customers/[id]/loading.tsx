import { CustomerRosterSkeleton } from "@/components/CustomerRoster";

/**
 * 客户详情中栏名单的加载态（11-22 切页卡顿）：给这个并行槽位一个 Suspense 边界。
 * 没有它时名单挡着整次切页——点一位客户，要等名单那几句查询都回来，路由才提交、客户详情自己的骨架（customers/[id]/loading.tsx）才出得来
 */
export default function Loading() {
  return <CustomerRosterSkeleton />;
}
