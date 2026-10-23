<!-- NEW FILE: src/views/ForgotPasswordView.vue -->
<script setup lang="ts">
import { ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { RouterLink } from "vue-router";

const email = ref("");
const authStore = useAuthStore();

// This state will be used to show a success message and hide the form.
const emailSent = ref(false);

async function handleRequest() {
  const success = await authStore.handleForgotPassword({ email: email.value });
  if (success) {
    emailSent.value = true;
  }
}
</script>

<template>
  <div class="auth-container">
    <h2>Forgot Password</h2>

    <div v-if="emailSent">
      <p>
        Please check your inbox for a link to reset your password. If you don't
        see it, check your spam folder.
      </p>
      <p><RouterLink to="/login">Back to Login</RouterLink></p>
    </div>

    <form v-else @submit.prevent="handleRequest" class="auth-form">
      <p>
        Enter your email address and we'll send you a link to reset your
        password.
      </p>
      <div class="form-group">
        <label for="email">Email</label>
        <input type="email" id="email" v-model="email" required />
      </div>
      <button
        type="submit"
        class="btn-primary"
        :disabled="authStore.authStatus === 'loading'"
      >
        {{
          authStore.authStatus === "loading" ? "Sending..." : "Send Reset Link"
        }}
      </button>
    </form>

    <p v-if="!emailSent">
      <RouterLink to="/login">Cancel</RouterLink>
    </p>
  </div>
</template>

<style scoped>
@import "@/assets/authFormStyle";
</style>
