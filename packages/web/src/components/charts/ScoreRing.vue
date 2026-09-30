<script setup lang="ts">
import { computed } from "vue";
import { healthTone } from "@/lib/format";

const props = withDefaults(defineProps<{ score: number | null; size?: number; stroke?: number; label?: string }>(), { size: 56, stroke: 5 });
const r = computed(() => (props.size - props.stroke) / 2);
const c = computed(() => 2 * Math.PI * r.value);
const color = computed(() => ({ pass: "var(--c-pass)", misaligned: "var(--c-misaligned)", fail: "var(--c-fail)" })[healthTone(props.score) as "pass"] ?? "var(--c-faint)");
</script>

<template>
  <div class="relative inline-grid place-items-center" :style="{ width: `${size}px`, height: `${size}px` }">
    <svg :width="size" :height="size" class="-rotate-90">
      <circle :cx="size / 2" :cy="size / 2" :r="r" fill="none" stroke="var(--c-subtle)" :stroke-width="stroke" />
      <circle
        v-if="score !== null"
        :cx="size / 2"
        :cy="size / 2"
        :r="r"
        fill="none"
        :stroke="color"
        :stroke-width="stroke"
        stroke-linecap="round"
        :stroke-dasharray="c"
        :stroke-dashoffset="c * (1 - Math.max(0, Math.min(100, score)) / 100)"
        class="transition-[stroke-dashoffset] duration-700"
      />
    </svg>
    <div class="absolute inset-0 flex flex-col items-center justify-center leading-none">
      <span class="font-semibold tabular-nums" :style="{ fontSize: `${size * 0.28}px` }">{{ score ?? "—" }}</span>
      <span v-if="label" class="mt-0.5 text-[10px] text-muted">{{ label }}</span>
    </div>
  </div>
</template>
