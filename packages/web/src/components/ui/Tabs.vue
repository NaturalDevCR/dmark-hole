<script setup lang="ts">
import type { Component } from "vue";
const model = defineModel<string>({ required: true });
defineProps<{ tabs: { id: string; label: string; icon?: Component; count?: number | null }[] }>();
</script>

<template>
  <nav class="-mb-px flex gap-1 overflow-x-auto border-b border-line" role="tablist">
    <button
      v-for="t in tabs"
      :key="t.id"
      role="tab"
      :aria-selected="model === t.id"
      class="inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition"
      :class="model === t.id ? 'border-brand text-fg' : 'border-transparent text-muted hover:text-fg'"
      @click="model = t.id"
    >
      <component :is="t.icon" v-if="t.icon" class="size-4" />
      {{ t.label }}
      <span v-if="t.count" class="rounded-full bg-subtle px-1.5 text-xs text-muted">{{ t.count }}</span>
    </button>
  </nav>
</template>
