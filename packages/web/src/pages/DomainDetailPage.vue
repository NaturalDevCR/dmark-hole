<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <div>
        <router-link to="/domains" class="text-sm text-muted-foreground hover:text-foreground">&larr; Back to Domains</router-link>
        <h1 class="text-2xl font-bold tracking-tight mt-1">{{ domain?.domain }}</h1>
      </div>
    </div>

    <div class="grid gap-4 md:grid-cols-3">
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground">DMARC Policy</p>
        <p class="text-xl font-bold">{{ domain?.dmarcPolicy || "Not set" }}</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground">Health Score</p>
        <p class="text-xl font-bold">{{ domain?.healthScore || 0 }}%</p>
      </div>
      <div class="rounded-lg border bg-card p-4">
        <p class="text-xs text-muted-foreground">Verification</p>
        <p :class="['text-xl font-bold', domain?.verified ? 'text-green-500' : 'text-yellow-500']">{{ domain?.verified ? "Verified" : "Pending" }}</p>
      </div>
    </div>

    <div class="rounded-lg border bg-card p-6">
      <h3 class="text-lg font-semibold">Domain Details</h3>
      <pre class="mt-4 text-xs text-muted-foreground">{{ JSON.stringify(domain, null, 2) }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import { useApi } from "@/composables/useApi";

const route = useRoute();
const api = useApi();
const domain = ref<Record<string, unknown> | null>(null);

onMounted(async () => {
  const res = await api.get<{ data: Record<string, unknown> }>(`/domains/${route.params.id}`);
  if (res) domain.value = res.data;
});
</script>
