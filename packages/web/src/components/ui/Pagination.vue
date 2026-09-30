<script setup lang="ts">
import { ChevronLeft, ChevronRight } from "lucide-vue-next";
import { computed } from "vue";
import { num } from "@/lib/format";

const page = defineModel<number>({ required: true });
const props = defineProps<{ total: number; pageSize: number }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
</script>

<template>
  <div class="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-muted">
    <span>{{ num(total) }} resultados</span>
    <div class="flex items-center gap-2">
      <button class="btn-secondary btn-sm" :disabled="page <= 1" @click="page--"><ChevronLeft class="size-4" /></button>
      <span class="tabular-nums">{{ page }} / {{ pages }}</span>
      <button class="btn-secondary btn-sm" :disabled="page >= pages" @click="page++"><ChevronRight class="size-4" /></button>
    </div>
  </div>
</template>
