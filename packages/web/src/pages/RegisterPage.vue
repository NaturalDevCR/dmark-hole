<template>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-md space-y-6">
      <div class="text-center">
        <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
          <Mail class="h-6 w-6 text-primary-foreground" />
        </div>
        <h1 class="text-2xl font-bold">Create Account</h1>
        <p class="text-sm text-muted-foreground">Set up your DMARK-Hole organization</p>
      </div>

      <div class="rounded-lg border bg-card p-6">
        <form @submit.prevent="handleRegister" class="space-y-4">
          <div>
            <label class="mb-1 block text-sm font-medium">Your Name</label>
            <input v-model="name" required class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Email</label>
            <input v-model="email" type="email" required class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Organization Name</label>
            <input v-model="orgName" required class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Organization Slug</label>
            <input v-model="orgSlug" required class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" placeholder="my-company" />
          </div>
          <div>
            <label class="mb-1 block text-sm font-medium">Password</label>
            <input v-model="password" type="password" required minlength="8" class="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>

          <p v-if="error" class="text-sm text-destructive">{{ error }}</p>

          <button type="submit" :disabled="loading" class="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
            {{ loading ? "Creating..." : "Create Account" }}
          </button>
        </form>

        <p class="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?
          <router-link to="/login" class="font-medium text-primary hover:underline">Sign in</router-link>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { Mail } from "lucide-vue-next";

const router = useRouter();
const auth = useAuthStore();

const name = ref("");
const email = ref("");
const orgName = ref("");
const orgSlug = ref("");
const password = ref("");
const loading = ref(false);
const error = ref("");

async function handleRegister() {
  loading.value = true;
  error.value = "";

  const success = await auth.register({
    email: email.value,
    password: password.value,
    name: name.value,
    organizationName: orgName.value,
    organizationSlug: orgSlug.value,
  });

  if (success) {
    router.push("/");
  } else {
    error.value = "Registration failed. Please try again.";
  }

  loading.value = false;
}
</script>
