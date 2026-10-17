<script setup lang="ts">
import { computed } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useRouter, RouterLink } from "vue-router";
import { Mail } from "lucide-vue-next";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import UiButton from "@/components/ui/UiButton.vue";

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
  <AuthLayout title="Confirm your email" tone="accent" centered>
    <template #icon><Mail :size="20" /></template>
    <p v-if="email" class="auth-text">
      We sent a confirmation link to <strong>{{ email }}</strong>. Click it to activate your account.
    </p>
    <p v-else class="auth-text">We sent you a confirmation link. Click it to activate your account.</p>

    <div class="auth-section">
      <p class="auth-text">Didn't get it?</p>
      <div class="auth-actions auth-actions--tight">
        <UiButton
          variant="secondary"
          size="lg"
          block
          :loading="authStore.authStatus === 'loading'"
          @click="resendEmail"
        >
          {{ authStore.authStatus === "loading" ? "Sending…" : "Resend email" }}
        </UiButton>
      </div>
    </div>

    <template #footer>
      <p><RouterLink to="/login">Back to log in</RouterLink></p>
    </template>
  </AuthLayout>
</template>

<style scoped>
.auth-actions.auth-actions--tight {
  margin-top: var(--space-3);
}
</style>
