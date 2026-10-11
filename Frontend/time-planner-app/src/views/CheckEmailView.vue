<!-- NEW FILE: src/views/CheckEmailView.vue -->
<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useRouter, RouterLink } from "vue-router";

const authStore = useAuthStore();
const router = useRouter();

// Get the email from the store that was set during registration.
const email = computed(() => authStore.registeredEmail);

// If for some reason the user lands on this page without an email
// (e.g., direct navigation), redirect them away.
if (!email.value) {
  router.push("/register");
}

async function resendEmail() {
  await authStore.handleResendConfirmation();
}
</script>

<template>
  <div class="auth-container check-email-container">
    <h2>Please Confirm Your Email</h2>
    <p class="icon">📧</p>
    <p v-if="email">
      We've sent a confirmation link to <strong>{{ email }}</strong
      >.
    </p>
    <p>Please click the link in the email to complete your registration.</p>

    <div class="resend-section">
      <p>Didn't receive the email?</p>
      <button
        @click="resendEmail"
        class="btn-secondary"
        :disabled="authStore.authStatus === 'loading'"
      >
        {{
          authStore.authStatus === "loading"
            ? "Sending..."
            : "Resend Confirmation Link"
        }}
      </button>
    </div>

    <p class="back-link">
      <RouterLink to="/login">Back to Login</RouterLink>
    </p>
  </div>
</template>

<style scoped>
@import "@/assets/authFormStyle";

.check-email-container .icon {
  font-size: 4rem;
  margin: 1rem 0 2rem 0;
}
.resend-section {
  margin-top: 2rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e0e0e0;
}
.resend-section p {
  margin-bottom: 0.5rem;
  font-size: 0.9rem;
}
.back-link {
  margin-top: 2rem;
  font-size: 0.9rem;
}
</style>
