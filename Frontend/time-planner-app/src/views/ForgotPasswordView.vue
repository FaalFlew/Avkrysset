<script setup lang="ts">
import { nextTick, ref } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { RouterLink } from "vue-router";
import { Mail } from "lucide-vue-next";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiInput from "@/components/ui/UiInput.vue";

const email = ref("");
const authStore = useAuthStore();
const layout = ref<InstanceType<typeof AuthLayout> | null>(null);

// This state will be used to show a success message and hide the form.
const emailSent = ref(false);

async function handleRequest() {
  const success = await authStore.handleForgotPassword({ email: email.value });
  if (success) {
    emailSent.value = true;
    // Move focus to the new heading so screen readers hear the result.
    await nextTick();
    layout.value?.focusHeading();
  }
}
</script>

<template>
  <AuthLayout
    v-if="emailSent"
    ref="layout"
    title="Check your inbox"
    tone="accent"
    centered
  >
    <template #icon><Mail :size="20" /></template>
    <p class="auth-text">
      If an account exists for <strong>{{ email }}</strong>, a reset link is on its way. It can take a minute — check
      spam too.
    </p>
    <div class="auth-actions">
      <UiButton to="/login" variant="primary" size="lg" block>Back to log in</UiButton>
    </div>
  </AuthLayout>

  <AuthLayout
    v-else
    ref="layout"
    title="Reset your password"
    subtitle="Enter your email and we'll send you a reset link."
  >
    <form class="auth-form" @submit.prevent="handleRequest">
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
      <UiButton
        type="submit"
        variant="primary"
        size="lg"
        block
        class="auth-submit"
        :loading="authStore.authStatus === 'loading'"
      >
        {{ authStore.authStatus === "loading" ? "Sending…" : "Send reset link" }}
      </UiButton>
    </form>

    <template #footer>
      <p>Remembered it? <RouterLink to="/login">Log in</RouterLink></p>
    </template>
  </AuthLayout>
</template>
