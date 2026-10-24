// src/main.ts

// Styles first so they precede every component stylesheet in the cascade.
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/print.css";
import "./assets/main.css"; // Legacy compat layer — removed once every screen is migrated.

import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import router from "./router";
import { setupTaskStoreSubscribers } from "./stores/taskStore";
import { syncSessionAcrossTabs } from "./stores/authStore";
import { initTheme } from "./composables/useTheme";

// Sync the theme singleton with what the pre-paint script in index.html already applied.
initTheme();

const app = createApp(App);

app.use(createPinia());
app.use(router);

// Persist guest data to localStorage.
setupTaskStoreSubscribers();

// Follow logouts / token refreshes of other tabs (they share the tokens in localStorage).
syncSessionAcrossTabs();

app.mount("#app");
