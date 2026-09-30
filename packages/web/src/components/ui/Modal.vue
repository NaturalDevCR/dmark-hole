<script setup lang="ts">
import { X } from "lucide-vue-next";
import { onBeforeUnmount, onMounted } from "vue";

const props = withDefaults(defineProps<{ title: string; width?: "sm" | "md" | "lg" | "xl" }>(), { width: "md" });
const emit = defineEmits<{ close: [] }>();
const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" };

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close");
}
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
void props;
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-[2px] sm:items-center" @mousedown.self="emit('close')">
      <div class="card my-8 w-full shadow-xl" :class="widths[width]" role="dialog" aria-modal="true">
        <header class="card-header">
          <h2 class="text-base font-semibold">{{ title }}</h2>
          <button class="btn-ghost -mr-2 p-1.5" aria-label="Cerrar" @click="emit('close')"><X class="size-4" /></button>
        </header>
        <div class="card-body"><slot /></div>
        <footer v-if="$slots.footer" class="flex justify-end gap-2 border-t border-line px-5 py-3.5"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>
