<script setup lang="ts">
import { storeToRefs } from "pinia";
import { RANGES, useFilters } from "@/stores/filters";
const { days } = storeToRefs(useFilters());
</script>

<template>
  <div class="inline-flex rounded-lg border border-line-strong bg-surface p-0.5" role="group" :aria-label="$t('common.range.label')">
    <button
      v-for="r in RANGES"
      :key="r.days"
      class="rounded-md px-2.5 py-1 text-xs font-medium transition"
      :class="days === r.days ? 'bg-brand text-brand-fg shadow-sm' : 'text-muted hover:text-fg'"
      @click="days = r.days"
    >
      {{ $t(r.labelKey) }}
    </button>
  </div>
</template>
