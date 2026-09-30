<script setup lang="ts">
import type { Tone } from "@/lib/format";

withDefaults(defineProps<{ tone?: Tone; dot?: boolean; size?: "sm" | "md" }>(), { tone: "neutral", dot: false, size: "sm" });

const tones: Record<Tone, string> = {
  pass: "bg-pass-soft text-pass ring-pass/20",
  forwarded: "bg-forwarded-soft text-forwarded ring-forwarded/20",
  misaligned: "bg-misaligned-soft text-misaligned ring-misaligned/25",
  fail: "bg-fail-soft text-fail ring-fail/20",
  neutral: "bg-subtle text-muted ring-line-strong/60",
  brand: "bg-brand-soft text-brand ring-brand/20",
};
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1 ring-inset"
    :class="[tones[tone], size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm']"
  >
    <span v-if="dot" class="size-1.5 rounded-full bg-current" />
    <slot />
  </span>
</template>
