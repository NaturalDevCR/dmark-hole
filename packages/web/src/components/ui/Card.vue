<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string; flush?: boolean }>();
</script>

<template>
  <section class="card">
    <header v-if="title || $slots.actions || $slots.header" class="card-header">
      <slot name="header">
        <div class="min-w-0">
          <h3 class="card-title">{{ title }}</h3>
          <p v-if="subtitle" class="mt-0.5 text-xs text-muted">{{ subtitle }}</p>
        </div>
      </slot>
      <div v-if="$slots.actions" class="flex shrink-0 items-center gap-2"><slot name="actions" /></div>
    </header>
    <div :class="flush ? '' : 'card-body'"><slot /></div>
  </section>
</template>
