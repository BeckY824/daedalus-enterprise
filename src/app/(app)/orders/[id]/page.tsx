import { 订单 } from "@/lib/features";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { 订单详情 } from "@/lib/order-db";
import OrderLite from "./OrderLite";

export const dynamic = "force-dynamic";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  // 订单 / 供应商这一版不上（lib/features.ts）：直接输网址也打不开
  if (!订单) notFound();
  await requireUser();
  const { id } = await params;
  const o = await 订单详情(id);
  if (!o) notFound();
  // 只有轻量的订单页——信息 + 挂在它上面的跟进。节点那一套页面（OrderView / OrderForm）企业版仓库 10-28 删了，见 lib/features.ts 订单节点
  return <OrderLite o={o} />;
}
