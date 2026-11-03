/**
 * 客户分布世界地图用的 echarts 件（CustomerWorldMap 动态 import 进来，不进复盘页首屏）：
 * 地图、分档色阶、提示框、canvas 渲染。echarts/core 和别的图表共用一份，这里只多注册地图要的几样。
 */
import * as echarts from "echarts/core";
import { MapChart } from "echarts/charts";
import { TooltipComponent, VisualMapPiecewiseComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([MapChart, TooltipComponent, VisualMapPiecewiseComponent, CanvasRenderer]);

export { echarts };
