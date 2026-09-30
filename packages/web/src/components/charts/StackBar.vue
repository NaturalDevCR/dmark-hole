<script setup lang="ts">
import { computed } from "vue";
import { CATEGORY, num } from "@/lib/format";
import type { Category } from "@/lib/types";

/** Single 100% stacked bar of the four DMARC categories with an accessible title. */
const props = withDefaults(defineProps<{ pass: number; forwarded: number; misaligned: number; fail: number; height?: number }>(), { height: 8 });
const order: Category[] = ["pass", "forwarded", "misaligned", "fail"];
const total = computed(() => props.pass + props.forwarded + props.misaligned + props.fail);
const title = computed(() => order.map((c) => `${CATEGORY[c].label}: ${num(props[c])}`).join(" · "));
</script>

<template>
  <div class="flex w-full gap-[2px] overflow-hidden rounded-full bg-subtle" :style="{ height: `${height}px` }" :title="title" role="img" :aria-label="title">
    <template v-if="total > 0">
      <span v-for="c in order" v-show="props[c] > 0" :key="c" :style="{ width: `${(props[c] / total) * 100}%`, background: `var(--c-series-${c})` }" />
    </template>
  </div>
</template>
