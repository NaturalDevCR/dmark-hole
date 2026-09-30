<script setup lang="ts">
import { computed } from "vue";
import VChart from "vue-echarts";
import { tooltipBase, useChartTokens } from "@/lib/chart";
import { num } from "@/lib/format";

const props = withDefaults(
  defineProps<{ items: { name: string; value: number; color: string }[]; center?: string; centerLabel?: string; size?: number }>(),
  { size: 180 },
);
const tokens = useChartTokens();

const option = computed(() => {
  const t = tokens.value;
  const total = props.items.reduce((a, x) => a + x.value, 0);
  return {
    animationDuration: 400,
    tooltip: {
      ...tooltipBase(t),
      trigger: "item",
      formatter: (p: { name: string; value: number }) =>
        `<b>${p.name}</b><br/>${num(p.value)} · ${total ? ((p.value / total) * 100).toFixed(1) : 0}%`,
    },
    series: [
      {
        type: "pie",
        radius: ["68%", "92%"],
        padAngle: 1.5,
        itemStyle: { borderRadius: 3, borderColor: t.surface, borderWidth: 2 },
        label: { show: false },
        emphasis: { scale: true, scaleSize: 3 },
        data: props.items.filter((i) => i.value > 0).map((i) => ({ name: i.name, value: i.value, itemStyle: { color: i.color } })),
      },
    ],
  };
});
</script>

<template>
  <div class="relative" :style="{ width: `${size}px`, height: `${size}px` }">
    <VChart :option="option" :style="{ width: `${size}px`, height: `${size}px` }" autoresize />
    <div v-if="center" class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
      <span class="text-2xl font-semibold tabular-nums">{{ center }}</span>
      <span v-if="centerLabel" class="text-xs text-muted">{{ centerLabel }}</span>
    </div>
  </div>
</template>
