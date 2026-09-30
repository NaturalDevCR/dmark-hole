<template>
  <div class="min-h-screen bg-background">
    <AppSidebar v-if="authStore.isAuthenticated" />
    <div :class="['transition-all duration-300', authStore.isAuthenticated ? 'ml-64' : '']">
      <AppHeader v-if="authStore.isAuthenticated" />
      <main :class="authStore.isAuthenticated ? 'p-6' : ''">
        <router-view />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import AppSidebar from "@/components/layout/AppSidebar.vue";
import AppHeader from "@/components/layout/AppHeader.vue";
import { useAuthStore } from "@/stores/auth";

const authStore = useAuthStore();

onMounted(() => {
  const token = localStorage.getItem("token");
  if (token) {
    authStore.setToken(token);
    authStore.fetchUser();
  }
});
</script>
