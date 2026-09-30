<script setup lang="ts">
import { CheckCircle2, Info, X, XCircle } from "lucide-vue-next";
import { useToasts } from "@/stores/toasts";
const toasts = useToasts();
const icons = { success: CheckCircle2, error: XCircle, info: Info };
const colors = { success: "text-pass", error: "text-fail", info: "text-forwarded" };
</script>

<template>
  <div class="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-full max-w-sm flex-col gap-2">
    <TransitionGroup enter-from-class="translate-y-2 opacity-0" leave-to-class="opacity-0" enter-active-class="transition" leave-active-class="transition">
      <div v-for="t in toasts.items" :key="t.id" class="card pointer-events-auto flex items-start gap-3 p-3.5 shadow-lg">
        <component :is="icons[t.kind]" class="mt-0.5 size-5 shrink-0" :class="colors[t.kind]" />
        <p class="min-w-0 flex-1 text-sm break-words">{{ t.message }}</p>
        <button class="text-faint hover:text-fg" @click="toasts.dismiss(t.id)"><X class="size-4" /></button>
      </div>
    </TransitionGroup>
  </div>
</template>
