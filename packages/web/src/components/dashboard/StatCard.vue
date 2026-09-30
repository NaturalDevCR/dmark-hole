<template>
  <div class="rounded-lg border bg-card p-4">
    <div class="flex items-center justify-between">
      <p class="text-xs font-medium text-muted-foreground uppercase tracking-wider">{{ title }}</p>
      <component
        :is="trendIcon"
        class="h-4 w-4"
        :class="{
          'text-green-500': trend === 'up',
          'text-red-500': trend === 'down',
          'text-muted-foreground': trend === 'stable',
        }"
      />
    </div>
    <p class="mt-2 text-2xl font-bold tracking-tight" :class="`text-${color}`">
      {{ formattedValue }}<span class="text-base font-normal">{{ suffix }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { TrendingUp, TrendingDown, Minus } from "lucide-vue-next";

const props = defineProps<{
  title: string;
  value: number;
  suffix: string;
  trend: "up" | "down" | "stable";
  color: string;
}>();

const formattedValue = computed(() => {
  if (props.suffix === "%") return Math.round(props.value);
  return props.value.toLocaleString();
});

const trendIcon = computed(() => {
  if (props.trend === "up") return TrendingUp;
  if (props.trend === "down") return TrendingDown;
  return Minus;
});
</script>
