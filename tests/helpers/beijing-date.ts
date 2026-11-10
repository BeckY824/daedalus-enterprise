/**
 * 测试里造「今天 / 明天 / N 天前」用这个，不要 new Date() 转 ISO 串再截前 10 位：
 * 那样取到的是 UTC 的日子，北京 0:00–8:00（= GMT 16–24 点）时比业务的「今天」早一天，断言「今天 / 未来」的用例就红。
 * 这里和业务代码走同一个业务钟（lib/business-clock），业务按哪天算、测试就按哪天造。
 * tests/utc-date-cap.test.ts 守着：tests/ 里 UTC 取日的写法只减不增。
 */
import { businessDayjs } from "@/lib/business-clock";

/** 业务今天往后数 n 天（负数往前），YYYY-MM-DD */
export function 北京日期(偏移天数 = 0): string {
  return businessDayjs().add(偏移天数, "day").format("YYYY-MM-DD");
}

/** 某个时刻落在业务日历的哪一天，YYYY-MM-DD */
export function 北京日(时刻: Date): string {
  return businessDayjs(时刻).format("YYYY-MM-DD");
}
