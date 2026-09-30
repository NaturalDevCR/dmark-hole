<script setup lang="ts">
import { computed } from "vue";

/** Tiny dependency-free SVG sparkline (0–100 scale by default). */
const props = withDefaults(defineProps<{ values: (number | null)[]; width?: number; height?: number; min?: number; max?: number; color?: string }>(), {
  width: 120,
  height: 32,
  color: "var(--c-brand)",
});

const path = computed(() => {
  const pts = props.values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const lo = props.min ?? Math.min(...pts.map((p) => p.v));
  const hi = props.max ?? Math.max(...pts.map((p) => p.v));
  const span = hi - lo || 1;
  const n = props.values.length - 1 || 1;
  const xy = pts.map((p) => [(p.i / n) * (props.width - 4) + 2, props.height - 3 - ((p.v - lo) / span) * (props.height - 6)] as const);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const area = `${line}L${xy[xy.length - 1]![0].toFixed(1)},${props.height}L${xy[0]![0].toFixed(1)},${props.height}Z`;
  return { line, area, last: xy[xy.length - 1]! };
});
</script>

<template>
  <svg :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" class="overflow-visible" aria-hidden="true">
    <template v-if="path">
      <path :d="path.area" :fill="color" opacity="0.1" />
      <path :d="path.line" fill="none" :stroke="color" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" />
      <circle :cx="path.last[0]" :cy="path.last[1]" r="2.5" :fill="color" />
    </template>
    <line v-else x1="2" :y1="height / 2" :x2="width - 2" :y2="height / 2" stroke="var(--c-line-strong)" stroke-dasharray="3 3" />
  </svg>
</template>
