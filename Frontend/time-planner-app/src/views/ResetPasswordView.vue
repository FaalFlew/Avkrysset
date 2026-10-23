<!-- MODIFIED FILE: src/views/ResetPasswordView.vue -->
<script setup lang="ts">
import { ref, onMounted, computed } from "vue"; // ADDED: computed
import { useAuthStore } from "@/stores/authStore";
import { useRouter, useRoute, RouterLink } from "vue-router";
import { useUIStore } from "@/stores/uiStore"; // ADDED: for showing error toasts

const newPassword = ref("");
const confirmPassword = ref(""); // ADDED: State for the confirm password field
const passwordVisible = ref(false); // ADDED: State to toggle password visibility
const authStore = useAuthStore();
const uiStore = useUIStore(); // ADDED
const router = useRouter();
const route = useRoute();

const userId = ref("");
const token = ref("");
const passwordReset = ref(false);

// ADDED: A computed property to determine the input type
const passwordInputType = computed(() =>
  passwordVisible.value ? "text" : "password"
);

onMounted(() => {
  userId.value = route.query.userId as string;
  token.value = route.query.token as string;
  if (!userId.value || !token.value) {
    uiStore.showToast("Invalid or incomplete password reset link.", "error");
    router.push("/login");
  }
});

async function handleReset() {
  // --- ADDED: Validation for matching passwords ---
  if (newPassword.value !== confirmPassword.value) {
    uiStore.showToast("Passwords do not match. Please try again.", "error");
    return; // Stop execution if passwords don't match
  }

  // Also good to check for password length, though the backend will do it.
  if (newPassword.value.length < 8) {
    uiStore.showToast("Password must be at least 8 characters long.", "error");
    return;
  }

  const success = await authStore.handleResetPassword({
    userId: userId.value,
    token: token.value,
    newPassword: newPassword.value,
  });
  if (success) {
    passwordReset.value = true;
  }
}

// ADDED: Function to toggle password visibility
function togglePasswordVisibility() {
  passwordVisible.value = !passwordVisible.value;
}
</script>

<template>
  <div class="auth-container">
    <h2>Reset Your Password</h2>

    <div v-if="passwordReset">
      <p>Your password has been changed successfully.</p>
      <RouterLink to="/login" class="btn-primary">Proceed to Login</RouterLink>
    </div>

    <form v-else @submit.prevent="handleReset" class="auth-form">
      <p>Enter and confirm your new password below.</p>

      <div class="form-group password-input-wrapper">
        <label for="newPassword">New Password</label>
        <input
          :type="passwordInputType"
          id="newPassword"
          v-model="newPassword"
          required
        />
        <!-- MODIFICATION: Replaced <span> with <i> for Font Awesome icon -->
        <i
          @click="togglePasswordVisibility"
          class="password-toggle-icon fa-solid"
          :class="passwordVisible ? 'fa-eye-slash' : 'fa-eye'"
        ></i>
      </div>

      <div class="form-group password-input-wrapper">
        <label for="confirmPassword">Confirm New Password</label>
        <input
          :type="passwordInputType"
          id="confirmPassword"
          v-model="confirmPassword"
          required
        />
      </div>

      <button
        type="submit"
        class="btn-primary"
        :disabled="authStore.authStatus === 'loading'"
      >
        {{
          authStore.authStatus === "loading" ? "Resetting..." : "Reset Password"
        }}
      </button>
    </form>
  </div>
</template>

<style scoped>
@import "@/assets/authFormStyle";

.password-input-wrapper {
  position: relative;
}

.password-toggle-icon {
  position: absolute;
  top: 70%;
  right: 15px;
  transform: translateY(-50%);
  cursor: pointer;
  user-select: none;
  /* MODIFICATION: Style the icon element */
  color: #aaa;
  font-size: 1rem; /* Adjust size as needed */
}
.password-toggle-icon:hover {
  color: #333;
}
</style>
