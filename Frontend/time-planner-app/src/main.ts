// src/main.ts

import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./assets/main.css";
import { setupTaskStoreSubscribers } from "./stores/taskStore";
import router from "./router"; // ADDED: Import the router

const app = createApp(App);

app.use(createPinia());
app.use(router); // ADDED: Tell the Vue app to use the router

// MODIFICATION: Call the new function to set up localStorage persistence for guests
setupTaskStoreSubscribers();

app.mount("#app");
