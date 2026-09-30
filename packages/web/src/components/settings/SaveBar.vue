<script setup lang="ts">
import Spinner from "@/components/ui/Spinner.vue";
defineProps<{ dirty: boolean; saving: boolean }>();
defineEmits<{ reset: [] }>();
</script>

<template>
  <div class="flex flex-wrap items-center justify-end gap-3 border-t border-line px-5 py-3.5">
    <span v-if="dirty" class="mr-auto text-xs text-misaligned">{{ $t("settings.saveBar.unsaved") }}</span>
    <slot />
    <button type="button" class="btn-ghost" :disabled="!dirty || saving" @click="$emit('reset')">{{ $t("settings.saveBar.discard") }}</button>
    <button type="submit" class="btn-primary" :disabled="!dirty || saving"><Spinner v-if="saving" />{{ $t("settings.saveBar.save") }}</button>
  </div>
</template>
