<script setup lang="ts">
import { computed } from "vue";
import { t } from "@/i18n";

/** Compact "SPF pass ✓aligned" style pill used in record tables. */
const props = defineProps<{ kind: "SPF" | "DKIM"; result: string; aligned?: boolean; domain?: string | null; selector?: string | null }>();
const tone = computed(() => {
  if (props.result === "pass") return props.aligned ? "bg-pass-soft text-pass ring-pass/25" : "bg-misaligned-soft text-misaligned ring-misaligned/25";
  if (["fail", "softfail", "permerror"].includes(props.result)) return "bg-fail-soft text-fail ring-fail/20";
  return "bg-subtle text-muted ring-line-strong/60";
});
const title = computed(
  () =>
    `${props.kind} ${props.result}${props.domain ? ` · ${props.domain}` : ""}${props.selector ? ` (s=${props.selector})` : ""}${
      props.result === "pass" ? ` · ${props.aligned ? t("common.auth.aligned") : t("common.auth.notAligned")}` : ""
    }`,
);
</script>

<template>
  <span class="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-xs ring-1 ring-inset" :class="tone" :title="title">
    <span class="font-semibold">{{ kind }}</span>
    <span>{{ result }}</span>
    <span v-if="domain" class="truncate opacity-80">· {{ domain }}</span>
  </span>
</template>
