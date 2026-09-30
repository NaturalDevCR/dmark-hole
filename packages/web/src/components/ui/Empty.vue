<script setup lang="ts">
import { Inbox } from "lucide-vue-next";
import type { Component } from "vue";
defineProps<{ title: string; description?: string; icon?: Component }>();
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-12 text-center">
    <span class="grid size-11 place-items-center rounded-xl bg-subtle text-faint"><component :is="icon ?? Inbox" class="size-5" /></span>
    <p class="mt-3 text-sm font-medium">{{ title }}</p>
    <p v-if="description" class="mt-1 max-w-md text-sm text-muted">{{ description }}</p>
    <div v-if="$slots.default" class="mt-4"><slot /></div>
  </div>
</template>
