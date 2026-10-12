<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { CircleCheck, TriangleAlert } from "lucide-vue-next";
import { authService } from "@/services/authService";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiSpinner from "@/components/ui/UiSpinner.vue";

// Define the state for our view
type ConfirmationStatus = "confirming" | "success" | "error";
const status = ref<ConfirmationStatus>("confirming");
const errorMessage = ref("An unknown error occurred. Please try the link again or contact support.");

const route = useRoute();
const layout = ref<InstanceType<typeof AuthLayout> | null>(null);

const title = computed(() => {
  switch (status.value) {
    case "success":
      return "Email confirmed";
    case "error":
      return "We couldn't confirm your email";
    default:
      return "Confirming your email…";
  }
});

// Announce the outcome by moving focus to the (new) heading.
watch(status, async (value) => {
  if (value === "confirming") return;
  await nextTick();
  layout.value?.focusHeading();
});

onMounted(async () => {
  // 1. Get the userId and token from the URL query parameters
  const userId = route.query.userId as string;
  const token = route.query.token as string;

  // 2. Basic validation
  if (!userId || !token) {
    errorMessage.value = "The confirmation link is invalid or incomplete. Please check the link in your email.";
    status.value = "error";
    return;
  }

  // 3. Call the backend to confirm the email
  try {
    await authService.confirmEmail(userId, token);
    status.value = "success";
  } catch (error: unknown) {
    // If the backend returns an error (e.g., token expired, already used), display it.
    const response = (error as { response?: { data?: { message?: string } } }).response;
    errorMessage.value = response?.data?.message || "Email confirmation failed. The link may have expired.";
    status.value = "error";
    console.error("Email confirmation error:", error);
  }
});
</script>

<template>
  <AuthLayout
    ref="layout"
    :title="title"
    :tone="status === 'success' ? 'success' : status === 'error' ? 'danger' : 'neutral'"
    centered
  >
    <template #icon>
      <UiSpinner v-if="status === 'confirming'" :size="20" />
      <CircleCheck v-else-if="status === 'success'" :size="20" />
      <TriangleAlert v-else :size="20" />
    </template>

    <template v-if="status === 'confirming'">
      <p class="auth-text" role="status">This only takes a moment.</p>
    </template>

    <template v-else-if="status === 'success'">
      <p class="auth-text">Your account is ready.</p>
      <div class="auth-actions">
        <UiButton to="/login" variant="primary" size="lg" block>Log in</UiButton>
      </div>
    </template>

    <template v-else>
      <p class="auth-text">{{ errorMessage }}</p>
      <div class="auth-actions">
        <UiButton to="/login" variant="primary" size="lg" block>Back to log in</UiButton>
      </div>
      <p class="auth-text auth-callback__hint">Log in to request a new link.</p>
    </template>
  </AuthLayout>
</template>

<style scoped>
.auth-text.auth-callback__hint {
  margin-top: var(--space-3);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-tertiary);
}
</style>
