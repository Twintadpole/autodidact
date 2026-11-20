<template>
  <div ref="el" class="echart" role="img" :aria-label="label" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, SVGRenderer]);

/** One ECharts chart that redraws when its options change and fits its box as the card resizes. */
const props = defineProps<{ option: EChartsCoreOption; label: string }>();
const el = ref<HTMLDivElement | null>(null);
let chart: echarts.ECharts | undefined;
let ro: ResizeObserver | undefined;

onMounted(() => {
  chart = echarts.init(el.value!, undefined, { renderer: 'svg' });
  chart.setOption(props.option);
  ro = new ResizeObserver(() => chart?.resize());
  ro.observe(el.value!);
});
watch(
  () => props.option,
  (o) => chart?.setOption(o, { notMerge: true }),
);
onBeforeUnmount(() => {
  ro?.disconnect();
  chart?.dispose();
});
</script>

<style scoped>
.echart {
  width: 100%;
  height: 100%;
  min-height: 120px;
}
</style>
