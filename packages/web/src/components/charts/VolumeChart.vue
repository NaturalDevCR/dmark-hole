<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import { t as i18nT } from "@/i18n";
import { tooltipBase, useChartTokens } from "@/lib/chart";
import { CATEGORY, day, num } from "@/lib/format";
import type { Category, Timeseries } from "@/lib/types";

const props = withDefaults(defineProps<{ data: Timeseries; height?: number }>(), { height: 280 });
const tokens = useChartTokens();
const order: Category[] = ["pass", "forwarded", "misaligned", "fail"];

const option = computed(() => {
  const t = tokens.value;
  const n = props.data.days.length;
  return {
    animationDuration: 400,
    grid: { left: 8, right: 8, top: 36, bottom: 4, containLabel: true },
    legend: {
      top: 0,
      left: 0,
      icon: "roundRect",
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 16,
      textStyle: { color: t.muted, fontSize: 12 },
    },
    tooltip: {
      ...tooltipBase(t),
      trigger: "axis",
      axisPointer: { type: "shadow", shadowStyle: { color: t.line, opacity: 0.35 } },
      formatter: (items: { seriesName: string; value: number; color: string; dataIndex: number }[]) => {
        const i = items[0]?.dataIndex ?? 0;
        const total = items.reduce((a, x) => a + (x.value || 0), 0);
        const rows = items
          .slice()
          .reverse()
          .map(
            (x) =>
              `<div style="display:flex;gap:16px;justify-content:space-between"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${x.color};margin-right:6px"></span>${x.seriesName}</span><b>${num(x.value)}</b></div>`,
          )
          .join("");
        const c = props.data.series.compliance[i];
        return `<div style="min-width:180px"><div style="margin-bottom:6px;font-weight:600">${day(props.data.days[i]!)}</div>${rows}<div style="border-top:1px solid ${t.line};margin-top:6px;padding-top:6px;display:flex;justify-content:space-between"><span>${i18nT("common.chart.total")}</span><b>${num(total)}</b></div><div style="display:flex;justify-content:space-between;color:${t.muted}"><span>${i18nT("common.chart.compliance")}</span><span>${c === null || c === undefined ? "—" : c + "%"}</span></div></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: props.data.days.map(day),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: t.line } },
      axisLabel: { color: t.faint, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { color: t.line, type: [3, 3] } },
      axisLabel: { color: t.faint, fontSize: 11, formatter: (v: number) => (v >= 1000 ? `${v / 1000}k` : v) },
    },
    series: order.map((c, idx) => ({
      name: CATEGORY[c].label,
      type: "bar",
      stack: "total",
      barMaxWidth: n > 120 ? 6 : 22,
      data: props.data.series[c],
      itemStyle: {
        color: t.series[c],
        borderColor: t.surface,
        borderWidth: n > 90 ? 0 : 1,
        // Only the top segment gets rounded corners (drawn per stack in echarts ≥5.5 via borderRadius on last series).
        borderRadius: idx === order.length - 1 ? [3, 3, 0, 0] : 0,
      },
      emphasis: { focus: "series" },
    })),
  };
});
</script>

<template>
  <VChart :option="option" :style="{ height: `${height}px` }" autoresize />
</template>
