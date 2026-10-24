<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useAuthStore } from "@/stores/authStore";
import { useTaskStore } from "@/stores/taskStore";
import { useRoute, useRouter, RouterLink } from "vue-router";
import { safeRedirect } from "@/lib/authRedirect";
import { useUIStore } from "@/stores/uiStore";
import { CircleAlert } from "lucide-vue-next";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import PasswordField from "@/components/auth/PasswordField.vue";
import PasswordRequirements from "@/components/auth/PasswordRequirements.vue";
import { meetsPasswordRules } from "@/components/auth/passwordRules";
import { registerErrorMessage } from "@/components/auth/authErrors";
import UiButton from "@/components/ui/UiButton.vue";
import UiInput from "@/components/ui/UiInput.vue";
import { joinList, pluralize } from "@/lib/format";

const REQUIREMENTS_ID = "register-password-requirements";

const email = ref("");
const password = ref("");
const authStore = useAuthStore();
const taskStore = useTaskStore();
const router = useRouter();
const route = useRoute();

/** "Log in" keeps where the user was going (e.g. an invitation link). */
const loginLink = computed(() => {
  const query: Record<string, string> = {};
  const redirect = safeRedirect(route.query.redirect);
  if (redirect) query.redirect = redirect;
  if (route.query.reason === "orgs") query.reason = "orgs";
  return { path: "/login", query };
});

// Inline feedback
const passwordError = ref("");
const formError = ref("");
const submitting = ref(false);
const passwordField = ref<InstanceType<typeof PasswordField> | null>(null);

const passwordOk = computed(() => meetsPasswordRules(password.value));
const isBusy = computed(() => submitting.value || authStore.authStatus === "loading");

watch(password, () => {
  if (passwordError.value && passwordOk.value) passwordError.value = "";
});

async function handleRegister() {
  if (isBusy.value) return;
  const uiStore = useUIStore();
  formError.value = "";

  // Block submit until the password satisfies the backend rules.
  if (!passwordOk.value) {
    passwordError.value = "Your password doesn't meet the requirements yet.";
    passwordField.value?.focus();
    return;
  }
  passwordError.value = "";

  const migrationData = taskStore.getLocalDataForMigration();
  const hasMigrationData =
    migrationData.categories.length > 0 ||
    migrationData.tasks.length > 0 ||
    migrationData.templates.length > 0;

  // This variable will hold our decision: true (migrate), false (don't migrate), or undefined (no data).
  let shouldMigrate: boolean | undefined = undefined;

  if (hasMigrationData) {
    // The server merges "Other" and case/space variants of the same name (Register.cs),
    // so only count the categories that will actually be created.
    const newCategories = new Set(
      migrationData.categories
        .map((c) => c.name.trim().toLowerCase())
        .filter((name) => name !== "other")
    ).size;
    const found = [
      migrationData.tasks.length ? pluralize(migrationData.tasks.length, "task") : "",
      migrationData.templates.length ? pluralize(migrationData.templates.length, "template") : "",
      newCategories ? pluralize(newCategories, "category", "categories") : "",
    ].filter(Boolean);

    const userChoice = await uiStore.confirm(
      "Bring your guest data?",
      `We found ${joinList(found)} saved in this browser. Move them to your new account?`,
      { confirmText: "Move my data", cancelText: "Start fresh" }
    );

    if (userChoice === null) {
      // ABORT: the user closed the dialog (Esc, X or backdrop). Stop the entire process.
      uiStore.showToast("Registration cancelled.", "info");
      return;
    }

    // PROCEED: "Move my data" (true) or "Start fresh" (false).
    shouldMigrate = userChoice;
  }

  submitting.value = true;
  try {
    const success = await authStore.register({
      email: email.value,
      password: password.value,
      // Only include migrationData if the user explicitly chose to move it.
      migrationData: shouldMigrate === true ? migrationData : undefined,
    });

    if (success) {
      // Only clear local data if it was successfully migrated.
      if (shouldMigrate === true) {
        taskStore.clearLocalData();
      }
      router.push("/check-email");
    } else {
      formError.value = registerErrorMessage(authStore);
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <AuthLayout title="Create your account" subtitle="It's free. Your guest plans can come with you.">
    <form class="auth-form" @submit.prevent="handleRegister">
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

      <div class="auth-field-group">
        <PasswordField
          ref="passwordField"
          v-model="password"
          name="new-password"
          autocomplete="new-password"
          :error="passwordError"
          :aria-describedby="REQUIREMENTS_ID"
          required
        />
        <PasswordRequirements :id="REQUIREMENTS_ID" :password="password" />
      </div>

      <UiButton type="submit" variant="primary" size="lg" block class="auth-submit" :loading="isBusy">
        {{ isBusy ? "Creating account…" : "Create account" }}
      </UiButton>
    </form>

    <template #footer>
      <p>Already have an account? <RouterLink :to="loginLink">Log in</RouterLink></p>
    </template>
  </AuthLayout>
</template>
