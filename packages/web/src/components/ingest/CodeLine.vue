<script setup lang="ts">
import { computed } from "vue";
import CopyButton from "@/components/ui/CopyButton.vue";

const props = defineProps<{
  /** Text that is copied to the clipboard. */
  text: string;
  /** Optional text shown instead (e.g. a masked token). */
  display?: string;
  label?: string;
}>();
const shown = computed(() => props.display ?? props.text);
</script>

<template>
  <div>
    <p v-if="label" class="mb-1 text-xs font-medium text-muted">{{ label }}</p>
    <div class="flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2">
      <pre class="mono min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap break-all text-fg">{{ shown }}</pre>
      <CopyButton :text="text" />
    </div>
  </div>
</template>
