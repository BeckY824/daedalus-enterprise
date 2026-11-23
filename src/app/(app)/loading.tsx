import SlotSkeleton from "@/components/SlotSkeleton";

/**
 * 等的时候画什么：Next 把这一个 loading 同时套在正文、中栏、浮层三个槽位上，按槽位分开画见 components/SlotSkeleton.tsx。
 * 换客户、列表进详情不出它（同一段 customers 没换，旧内容留到新内容就绪）；整页打开、左栏换页、本地还没有内容时才出
 */
export default function Loading() {
  return <SlotSkeleton />;
}
