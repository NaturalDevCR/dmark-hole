import { createPinia } from "pinia";
import { createApp } from "vue";
import App from "./App.vue";
import { setUnauthorizedHandler } from "./lib/api";
import { router } from "./router";
import { useAuth } from "./stores/auth";
import "./style.css";

const app = createApp(App);
app.use(createPinia());
app.use(router);

setUnauthorizedHandler(() => {
  const auth = useAuth();
  auth.user = null;
  if (router.currentRoute.value.path !== "/login") router.push({ path: "/login", query: { next: router.currentRoute.value.fullPath } });
});

app.mount("#app");
