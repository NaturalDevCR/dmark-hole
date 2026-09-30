<script setup lang="ts">
import { Check, Copy } from "lucide-vue-next";
import { ref } from "vue";
const props = defineProps<{ text: string }>();
const done = ref(false);
async function copy() {
  try {
    await navigator.clipboard.writeText(props.text);
    done.value = true;
    setTimeout(() => (done.value = false), 1500);
  } catch {
    /* clipboard blocked on http origins */
  }
}
</script>

<template>
  <button type="button" class="btn-ghost btn-sm p-1.5" title="Copiar" @click.stop="copy">
    <Check v-if="done" class="size-3.5 text-pass" />
    <Copy v-else class="size-3.5" />
  </button>
</template>
