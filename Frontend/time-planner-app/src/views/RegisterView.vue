<!-- NEW FILE: src/views/RegisterView.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useTaskStore } from "@/stores/taskStore";
import { useRouter, RouterLink } from "vue-router";
import { useUIStore } from "@/stores/uiStore";
const email = ref("");
const password = ref("");
const authStore = useAuthStore();
const taskStore = useTaskStore();
const router = useRouter();

async function handleRegister() {
  const uiStore = useUIStore();

  const migrationData = taskStore.getLocalDataForMigration();
  const hasMigrationData =
    migrationData.categories.length > 0 ||
    migrationData.tasks.length > 0 ||
    migrationData.templates.length > 0;

  // This variable will hold our decision: true (migrate), false (don't migrate), or undefined (no data).
  let shouldMigrate: boolean | undefined = undefined;

  if (hasMigrationData) {
    const userChoice = await uiStore.confirm(
      "Migrate Guest Data?",
      "We found data from your guest session. Do you want to move it to your new account?",
      // Provide clean, clear button text
      { confirmText: "Yes", cancelText: "No" }
    );

    if (userChoice === null) {
      // --- Case 1: ABORT ---
      // User clicked 'X' or backdrop. Stop the entire process.
      uiStore.showToast("Registration cancelled.", "info");
      return;
    }

    // --- Case 2: PROCEED ---
    // User clicked either "Yes" (true) or "No" (false).
    shouldMigrate = userChoice;
  }

  // This block will only be reached if the user did not abort the modal.
  const success = await authStore.register({
    email: email.value,
    password: password.value,
    // Only include migrationData if the user explicitly chose "Yes".
    migrationData: shouldMigrate === true ? migrationData : undefined,
  });

  if (success) {
    // Only clear local data if it was successfully migrated.
    if (shouldMigrate === true) {
      taskStore.clearLocalData();
    }
    router.push("/check-email");
  }
}
</script>

<template>
  <div class="auth-container">
    <h2>Register</h2>
    <form @submit.prevent="handleRegister" class="auth-form">
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" v-model="email" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" v-model="password" required />
      </div>
      <button
        type="submit"
        class="btn-primary"
        :disabled="authStore.authStatus === 'loading'"
      >
        {{ authStore.authStatus === "loading" ? "Registering..." : "Register" }}
      </button>
    </form>
    <p>
      Already have an account? <RouterLink to="/login">Login here</RouterLink>
    </p>
  </div>
</template>

<style scoped>
/* Import and reuse the styles from LoginView */
@import "@/assets/authFormStyle";
</style>
