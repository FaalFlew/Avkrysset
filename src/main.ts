import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initializeTaskStore } from "./stores/taskStore";
import "./assets/main.css";

const app = createApp(App);

app.use(createPinia());

initializeTaskStore();

app.mount("#app");
