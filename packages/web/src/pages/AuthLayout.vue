<script setup lang="ts">
import LanguageSwitcher from "@/components/LanguageSwitcher.vue";
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
    <div class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60rem_30rem_at_50%_-10%,color-mix(in_srgb,var(--c-brand)_18%,transparent),transparent)]" />
    <div class="w-full max-w-sm">
      <div class="mb-8 flex flex-col items-center text-center">
        <img src="/favicon.svg" alt="" class="size-12" />
        <h1 class="mt-4 text-xl font-semibold tracking-tight">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 text-sm text-muted">{{ subtitle }}</p>
      </div>
      <div class="card p-6"><slot /></div>
      <div class="mt-4 flex justify-center"><LanguageSwitcher /></div>
    </div>
  </div>
</template>
