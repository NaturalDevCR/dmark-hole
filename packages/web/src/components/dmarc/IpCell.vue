<script setup lang="ts">
import { flag, countryName } from "@/lib/format";
defineProps<{ ip: string; ptr?: string | null; provider?: string | null; country?: string | null; link?: boolean }>();
</script>

<template>
  <div class="min-w-0">
    <div class="flex items-center gap-1.5">
      <span v-if="country" :title="countryName(country)">{{ flag(country) }}</span>
      <RouterLink v-if="link !== false" :to="`/sources/${encodeURIComponent(ip)}`" class="mono truncate font-medium hover:text-brand hover:underline" @click.stop>{{ ip }}</RouterLink>
      <span v-else class="mono truncate font-medium">{{ ip }}</span>
      <span v-if="provider" class="truncate rounded bg-brand-soft px-1.5 text-[11px] font-medium text-brand">{{ provider }}</span>
    </div>
    <p v-if="ptr" class="mt-0.5 truncate text-xs text-muted" :title="ptr">{{ ptr }}</p>
  </div>
</template>
