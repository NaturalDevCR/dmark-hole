<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import AppShell from "@/components/AppShell.vue";
import Toasts from "@/components/ui/Toasts.vue";

const route = useRoute();
const bare = computed(() => route.meta.public === true);
</script>

<template>
  <RouterView v-if="bare" />
  <AppShell v-else>
    <RouterView v-slot="{ Component }">
      <component :is="Component" :key="route.path" />
    </RouterView>
  </AppShell>
  <Toasts />
</template>
