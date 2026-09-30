<script setup lang="ts">
import { TrendingDown, TrendingUp } from "lucide-vue-next";
import { computed, type Component } from "vue";

const props = defineProps<{
  label: string;
  value: string;
  hint?: string;
  icon?: Component;
  /** Relative change vs previous period, in percent points or percent. */
  delta?: number | null;
  deltaSuffix?: string;
  /** When true, a negative delta is good (e.g. failures going down). */
  invert?: boolean;
  /** Direction carries no judgement (e.g. number of sources). */
  neutral?: boolean;
  tone?: "pass" | "forwarded" | "misaligned" | "fail" | "brand";
}>();

const good = computed(() => (props.neutral || (props.delta ?? 0) === 0 ? null : (props.delta ?? 0) > 0 !== !!props.invert));
const toneBg: Record<string, string> = {
  pass: "bg-pass-soft text-pass",
  forwarded: "bg-forwarded-soft text-forwarded",
  misaligned: "bg-misaligned-soft text-misaligned",
  fail: "bg-fail-soft text-fail",
  brand: "bg-brand-soft text-brand",
};
</script>

<template>
  <div class="card p-5">
    <div class="flex items-start justify-between gap-3">
      <p class="text-sm font-medium text-muted">{{ label }}</p>
      <span v-if="icon" class="grid size-8 place-items-center rounded-lg" :class="toneBg[tone ?? 'brand']">
        <component :is="icon" class="size-4" />
      </span>
    </div>
    <p class="mt-2 text-3xl font-semibold tracking-tight tabular-nums">{{ value }}</p>
    <div class="mt-2 flex min-h-5 items-center gap-2 text-xs">
      <span
        v-if="delta !== undefined && delta !== null && Number.isFinite(delta)"
        class="inline-flex items-center gap-0.5 font-medium"
        :class="good === null ? 'text-muted' : good ? 'text-pass' : 'text-fail'"
      >
        <TrendingUp v-if="delta > 0" class="size-3.5" />
        <TrendingDown v-else-if="delta < 0" class="size-3.5" />
        {{ delta > 0 ? "+" : "" }}{{ delta.toLocaleString("es", { maximumFractionDigits: 1 }) }}{{ deltaSuffix ?? "%" }}
      </span>
      <span v-if="hint" class="truncate text-muted">{{ hint }}</span>
    </div>
  </div>
</template>
