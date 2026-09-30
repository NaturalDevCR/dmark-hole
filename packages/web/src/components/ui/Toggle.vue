<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label?: string; description?: string; disabled?: boolean }>();
</script>

<template>
  <label class="flex cursor-pointer items-start justify-between gap-4" :class="disabled && 'cursor-not-allowed opacity-60'">
    <span v-if="label || description" class="min-w-0">
      <span class="block text-sm font-medium text-fg">{{ label }}</span>
      <span v-if="description" class="mt-0.5 block text-xs text-muted">{{ description }}</span>
    </span>
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :disabled="disabled"
      class="relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition focus-visible:ring-3 focus-visible:ring-brand/30"
      :class="model ? 'bg-brand' : 'bg-line-strong'"
      @click="model = !model"
    >
      <span class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition" :class="model && 'translate-x-4'" />
    </button>
  </label>
</template>
