<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useRouter, useRoute, RouterLink } from "vue-router";
import { useUIStore } from "@/stores/uiStore";
import { CircleCheck } from "lucide-vue-next";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import PasswordField from "@/components/auth/PasswordField.vue";
import PasswordRequirements from "@/components/auth/PasswordRequirements.vue";
import { meetsPasswordRules } from "@/components/auth/passwordRules";
import UiButton from "@/components/ui/UiButton.vue";

const REQUIREMENTS_ID = "reset-password-requirements";

const newPassword = ref("");
const confirmPassword = ref("");
const passwordVisible = ref(false); // one toggle shows/hides both fields
const authStore = useAuthStore();
const uiStore = useUIStore();
const router = useRouter();
const route = useRoute();

const userId = ref("");
const token = ref("");
const passwordReset = ref(false);

// Inline validation (replaces the old error toasts)
const newPasswordError = ref("");
const confirmError = ref("");
const newPasswordField = ref<InstanceType<typeof PasswordField> | null>(null);
const confirmField = ref<InstanceType<typeof PasswordField> | null>(null);
const layout = ref<InstanceType<typeof AuthLayout> | null>(null);

watch(newPassword, (value) => {
  if (newPasswordError.value && meetsPasswordRules(value)) newPasswordError.value = "";
});
watch([newPassword, confirmPassword], ([pw, confirm]) => {
  if (confirmError.value && pw === confirm) confirmError.value = "";
});

onMounted(() => {
  userId.value = route.query.userId as string;
  token.value = route.query.token as string;
  if (!userId.value || !token.value) {
    uiStore.showToast("Invalid or incomplete password reset link.", "error");
    router.push("/login");
  }
});

async function handleReset() {
  newPasswordError.value = "";
  confirmError.value = "";

  if (!meetsPasswordRules(newPassword.value)) {
    newPasswordError.value = "Your password doesn't meet the requirements yet.";
    newPasswordField.value?.focus();
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    confirmError.value = "Passwords don't match.";
    confirmField.value?.focus();
    return;
  }

  const success = await authStore.handleResetPassword({
    userId: userId.value,
    token: token.value,
    newPassword: newPassword.value,
  });
  if (success) {
    passwordReset.value = true;
    await nextTick();
    layout.value?.focusHeading();
  }
}
</script>

<template>
  <AuthLayout v-if="passwordReset" ref="layout" title="Password updated" tone="success" centered>
    <template #icon><CircleCheck :size="20" /></template>
    <p class="auth-text">You can now log in with your new password.</p>
    <div class="auth-actions">
      <UiButton to="/login" variant="primary" size="lg" block>Log in</UiButton>
    </div>
  </AuthLayout>

  <AuthLayout v-else ref="layout" title="Choose a new password" subtitle="Pick something you haven't used here before.">
    <form class="auth-form" @submit.prevent="handleReset">
      <div class="auth-field-group">
        <PasswordField
          ref="newPasswordField"
          v-model="newPassword"
          v-model:visible="passwordVisible"
          label="New password"
          name="new-password"
          autocomplete="new-password"
          :error="newPasswordError"
          :aria-describedby="REQUIREMENTS_ID"
          required
        />
        <PasswordRequirements :id="REQUIREMENTS_ID" :password="newPassword" />
      </div>

      <PasswordField
        ref="confirmField"
        v-model="confirmPassword"
        v-model:visible="passwordVisible"
        label="Confirm password"
        name="confirm-password"
        autocomplete="new-password"
        :show-toggle="false"
        :error="confirmError"
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
        {{ authStore.authStatus === "loading" ? "Updating…" : "Update password" }}
      </UiButton>
    </form>

    <template #footer>
      <p><RouterLink to="/login">Back to log in</RouterLink></p>
    </template>
  </AuthLayout>
</template>
