<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useTaskStore } from "@/stores/taskStore";
import { useRouter, useRoute, RouterLink } from "vue-router";
import { useUIStore } from "@/stores/uiStore";

const uiStore = useUIStore(); // Get a reference to uiStore

const email = ref("");
const password = ref("");
const authStore = useAuthStore();
const taskStore = useTaskStore();
const router = useRouter();
const route = useRoute(); // To read query params

// Check for query params on component mount
onMounted(() => {
  if (route.query.confirmed === "true") {
    uiStore.showToast(
      "Email confirmed successfully! You can now log in.",
      "success"
    );
  }
  // ADDED: Check for the new query parameter
  if (route.query.sessionExpired === "true") {
    uiStore.showToast("Your session has expired. Please log in again.", "info");
  }
});

async function handleLogin() {
  const success = await authStore.login({
    email: email.value,
    password: password.value,
  });

  if (success) {
    // After successful login, initialize the task data from the API
    await taskStore.initializeData();
    // Then navigate to the main planner view
    router.push("/");
  }
}
</script>

<template>
  <div class="auth-container">
    <h2>Login</h2>
    <form @submit.prevent="handleLogin" class="auth-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" v-model="email" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" v-model="password" required />
      </div>
      <div class="form-extra-links">
        <RouterLink to="/forgot-password">Forgot Password?</RouterLink>
      </div>
      <button
        type="submit"
        class="btn-primary"
        :disabled="authStore.authStatus === 'loading'"
      >
        {{ authStore.authStatus === "loading" ? "Logging in..." : "Login" }}
      </button>
    </form>
    <p>
      Don't have an account?
      <RouterLink to="/register">Register here</RouterLink>
    </p>
  </div>
</template>

<style scoped>
/* Simple styles for the auth forms */
.auth-container {
  max-width: 400px;
  margin: 50px auto;
  padding: 2rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  text-align: center;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.auth-form button {
  margin-top: 1rem;
}

p {
  margin-top: 1.5rem;
}

.form-extra-links {
  text-align: right;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}
</style>
