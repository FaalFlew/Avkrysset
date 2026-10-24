<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useTaskStore } from "@/stores/taskStore";
import { useRouter, useRoute, RouterLink } from "vue-router";
import { useUIStore } from "@/stores/uiStore";
import { ArrowRight, CircleAlert } from "lucide-vue-next";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import PasswordField from "@/components/auth/PasswordField.vue";
import { loginErrorMessage } from "@/components/auth/authErrors";
import UiButton from "@/components/ui/UiButton.vue";
import UiInput from "@/components/ui/UiInput.vue";

const SLOW_HINT_DELAY_MS = 3000;

const uiStore = useUIStore();

const email = ref("");
const password = ref("");
const authStore = useAuthStore();
const taskStore = useTaskStore();
const router = useRouter();
const route = useRoute(); // To read query params

// Inline feedback (the form never relies on toasts alone).
const formError = ref("");
const showSlowHint = ref(false);
const submitting = ref(false);
let slowHintTimer: number | undefined;

const isBusy = computed(() => submitting.value || authStore.authStatus === "loading");

function startSlowHintTimer(): void {
  stopSlowHintTimer();
  slowHintTimer = window.setTimeout(() => {
    showSlowHint.value = true;
  }, SLOW_HINT_DELAY_MS);
}

function stopSlowHintTimer(): void {
  if (slowHintTimer !== undefined) window.clearTimeout(slowHintTimer);
  slowHintTimer = undefined;
  showSlowHint.value = false;
}

// Check for query params on component mount
onMounted(() => {
  if (route.query.confirmed === "true") {
    uiStore.showToast("Email confirmed successfully! You can now log in.", "success");
  }
  if (route.query.sessionExpired === "true") {
    uiStore.showToast("Your session has expired. Please log in again.", "info");
  }
});

onBeforeUnmount(stopSlowHintTimer);

async function handleLogin() {
  if (isBusy.value) return;
  formError.value = "";
  submitting.value = true;
  startSlowHintTimer();
  try {
    const success = await authStore.login({
      email: email.value,
      password: password.value,
    });

    if (success) {
      // After successful login, initialize the task data from the API
      await taskStore.initializeData();
      // Then navigate to the main planner view
      router.push("/");
    } else {
      formError.value = loginErrorMessage(authStore);
    }
  } finally {
    submitting.value = false;
    stopSlowHintTimer();
  }
}
</script>

<template>
  <AuthLayout title="Welcome back" subtitle="Log in to sync your plans across devices.">
    <form class="auth-form" @submit.prevent="handleLogin">
      <p v-if="formError" class="auth-alert" role="alert">
        <CircleAlert :size="16" />
        <span>{{ formError }}</span>
      </p>

      <UiInput
        v-model="email"
        label="Email"
        type="email"
        size="lg"
        name="email"
        autocomplete="email"
        inputmode="email"
        autocapitalize="off"
        spellcheck="false"
        required
      />

      <PasswordField v-model="password" name="password" autocomplete="current-password" required>
        <template #label-end>
          <RouterLink to="/forgot-password" class="auth-link-sm">Forgot password?</RouterLink>
        </template>
      </PasswordField>

      <UiButton type="submit" variant="primary" size="lg" block class="auth-submit" :loading="isBusy">
        {{ isBusy ? "Logging in…" : "Log in" }}
      </UiButton>
    </form>
    <p class="auth-hint" aria-live="polite">
      <template v-if="showSlowHint">The server may be waking up — this can take up to 20 seconds.</template>
    </p>

    <template #footer>
      <p>New here? <RouterLink to="/register">Create an account</RouterLink></p>
      <div class="auth-divider" aria-hidden="true">or</div>
      <UiButton to="/" variant="ghost">
        Continue as guest
        <template #trailing><ArrowRight :size="16" /></template>
      </UiButton>
    </template>
  </AuthLayout>
</template>
