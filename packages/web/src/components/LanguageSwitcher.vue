<script setup lang="ts">
import { Languages } from "lucide-vue-next";
import { LOCALES, setLocale, type Locale } from "@/i18n";

defineProps<{ compact?: boolean }>();
</script>

<template>
  <label class="relative inline-flex items-center" :title="$t('common.language')">
    <Languages class="pointer-events-none absolute left-2 size-3.5 text-faint" />
    <select
      class="cursor-pointer appearance-none rounded-md border border-transparent bg-transparent py-1 pr-2 pl-7 text-xs text-muted hover:border-line hover:text-fg focus:border-brand focus:outline-none"
      :aria-label="$t('common.language')"
      :value="$i18n.locale"
      @change="setLocale(($event.target as HTMLSelectElement).value as Locale)"
    >
      <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ compact ? l.code.toUpperCase() : l.label }}</option>
    </select>
  </label>
</template>
