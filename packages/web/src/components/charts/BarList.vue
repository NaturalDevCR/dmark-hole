<script setup lang="ts">
import { computed } from "vue";
import { num } from "@/lib/format";

/** Horizontal bars in plain HTML: ranked lists read better than a chart here. */
const props = defineProps<{
  items: { key: string; label: string; value: number; sub?: string; color?: string; to?: string }[];
  valueLabel?: (v: number) => string;
}>();
const max = computed(() => Math.max(1, ...props.items.map((i) => i.value)));
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="i in items" :key="i.key">
      <component :is="i.to ? 'RouterLink' : 'div'" :to="i.to" class="group relative flex items-center justify-between gap-3 rounded-md px-2.5 py-1.5" :class="i.to && 'hover:bg-subtle'">
        <span class="absolute inset-y-0 left-0 rounded-md opacity-15 transition-[width]" :style="{ width: `${(i.value / max) * 100}%`, background: i.color ?? 'var(--c-brand)' }" />
        <span class="relative min-w-0 truncate text-sm">
          {{ i.label }}
          <span v-if="i.sub" class="ml-1 text-xs text-muted">{{ i.sub }}</span>
        </span>
        <span class="relative shrink-0 text-sm font-medium tabular-nums">{{ valueLabel ? valueLabel(i.value) : num(i.value) }}</span>
      </component>
    </li>
  </ul>
</template>
