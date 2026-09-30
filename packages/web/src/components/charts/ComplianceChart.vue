<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import { t as i18nT } from "@/i18n";
import { tooltipBase, useChartTokens } from "@/lib/chart";
import { day } from "@/lib/format";

const props = withDefaults(defineProps<{ days: string[]; values: (number | null)[]; height?: number; target?: number }>(), { height: 180, target: 98 });
const tokens = useChartTokens();

const option = computed(() => {
  const t = tokens.value;
  const vals = props.values.filter((v): v is number => v !== null);
  const min = vals.length ? Math.max(0, Math.floor(Math.min(...vals, props.target) / 10) * 10 - 5) : 0;
  return {
    animationDuration: 400,
    grid: { left: 8, right: 16, top: 12, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "line", lineStyle: { color: t.faint, type: "dashed" } },
      valueFormatter: (v: number | null) => (v === null || v === undefined ? "—" : `${v}%`),
    },
    xAxis: {
      type: "category",
      boundaryGap: false,
      data: props.days.map(day),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: t.line } },
      axisLabel: { color: t.faint, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      min,
      max: 100,
      splitLine: { lineStyle: { color: t.line, type: [3, 3] } },
      axisLabel: { color: t.faint, fontSize: 11, formatter: "{value}%" },
    },
    series: [
      {
        name: i18nT("common.chart.compliance"),
        type: "line",
        data: props.values,
        connectNulls: true,
        showSymbol: false,
        symbolSize: 8,
        smooth: 0.25,
        lineStyle: { width: 2, color: t.brand },
        itemStyle: { color: t.brand, borderColor: t.surface, borderWidth: 2 },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${t.brand}33` },
              { offset: 1, color: `${t.brand}00` },
            ],
          },
        },
        markLine: {
          silent: true,
          symbol: "none",
          label: { color: t.faint, fontSize: 11, formatter: i18nT("common.chart.target", { value: props.target }), position: "insideEndTop" },
          lineStyle: { color: t.faint, type: "dashed", width: 1 },
          data: [{ yAxis: props.target }],
        },
      },
    ],
  };
});
</script>

<template>
  <VChart :option="option" :style="{ height: `${height}px` }" autoresize />
</template>
