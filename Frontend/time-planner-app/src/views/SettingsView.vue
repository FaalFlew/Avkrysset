<script setup lang="ts">
/**
 * SettingsView — /settings (signed in): display name (shown in organizations; empty = the email),
 * email (read-only), theme, the device time zone (read-only) and sign out.
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Check, LogOut } from "lucide-vue-next";
import UiPageHeader from "@/components/ui/UiPageHeader.vue";
import UiCard from "@/components/ui/UiCard.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiInput from "@/components/ui/UiInput.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import UiErrorState from "@/components/ui/UiErrorState.vue";
import UiThemeToggle from "@/components/ui/UiThemeToggle.vue";
import { apiDataService, type UserProfile } from "@/services/apiDataService";
import { sessionBound } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { logoutAndRedirect } from "@/components/shell/useShell";
import { apiErrorMessage, isSessionChangedError } from "@/lib/apiErrors";
import { formatZoneLabel, getActiveTimeZone } from "@/lib/datetime";

const DISPLAY_NAME_MAX = 100;

const router = useRouter();
const uiStore = useUIStore();

const profile = ref<UserProfile | null>(null);
const loading = ref(true);
const loadError = ref("");
const displayName = ref("");
const saving = ref(false);
const saveError = ref("");
/** "Saved" next to the button until the next edit. */
const justSaved = ref(false);

const zoneLabel = computed(() => formatZoneLabel(getActiveTimeZone()));
const trimmed = computed(() => displayName.value.trim());
const dirty = computed(() => !!profile.value && trimmed.value !== (profile.value.displayName ?? ""));
const nameHint = computed(() =>
  trimmed.value
    ? "Shown to people in your organizations."
    : `Shown to people in your organizations. Leave it empty and we'll show your email${profile.value ? ` (${profile.value.email})` : ""}.`
);

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = "";
  try {
    const result = await sessionBound(() => apiDataService.getMyProfile());
    profile.value = { ...result, displayName: result.displayName?.trim() || null };
    displayName.value = profile.value.displayName ?? "";
  } catch (error) {
    if (isSessionChangedError(error)) return;
    loadError.value = apiErrorMessage(error, "Couldn't load your profile.");
  } finally {
    loading.value = false;
  }
}

async function save(): Promise<void> {
  if (saving.value || !dirty.value) return;
  saveError.value = "";
  if (trimmed.value.length > DISPLAY_NAME_MAX) {
    saveError.value = `Use at most ${DISPLAY_NAME_MAX} characters.`;
    return;
  }
  saving.value = true;
  try {
    const updated = await sessionBound(() => apiDataService.updateMyProfile({ displayName: trimmed.value || null }));
    profile.value = updated;
    displayName.value = updated.displayName ?? "";
    justSaved.value = true;
    uiStore.announce("Display name saved.");
  } catch (error) {
    if (isSessionChangedError(error)) return;
    saveError.value = apiErrorMessage(error, "Couldn't save your display name.");
  } finally {
    saving.value = false;
  }
}

function onInput(): void {
  saveError.value = "";
  justSaved.value = false;
}

async function signOut(): Promise<void> {
  await logoutAndRedirect(router);
}

onMounted(load);
</script>

<template>
  <div class="settings-page">
    <UiPageHeader title="Settings" subtitle="Your profile and preferences." />

    <UiCard title="Profile" padding="lg">
      <UiErrorState
        v-if="loadError"
        size="sm"
        :heading-level="3"
        title="Couldn't load your profile"
        :description="loadError"
        :retrying="loading"
        @retry="load"
      />
      <div v-else-if="loading && !profile" class="settings-page__loading" aria-busy="true">
        <span class="sr-only" role="status">Loading your profile…</span>
        <UiSkeleton width="30%" :height="14" />
        <UiSkeleton :height="36" radius="var(--radius-md)" />
        <UiSkeleton width="30%" :height="14" />
        <UiSkeleton :height="36" radius="var(--radius-md)" />
      </div>
      <form v-else class="settings-page__form" @submit.prevent="save">
        <UiInput
          v-model="displayName"
          label="Display name"
          name="displayName"
          autocomplete="nickname"
          :maxlength="DISPLAY_NAME_MAX"
          :placeholder="profile?.email"
          :hint="nameHint"
          :error="saveError || undefined"
          @input="onInput"
        />
        <UiInput :model-value="profile?.email ?? ''" label="Email" type="email" readonly hint="Your email can't be changed here." />
        <div class="settings-page__actions">
          <UiButton type="submit" variant="primary" :loading="saving" :disabled="!dirty">Save</UiButton>
          <p v-if="justSaved && !dirty" class="settings-page__saved">
            <Check :size="16" aria-hidden="true" />Saved
          </p>
        </div>
      </form>
    </UiCard>

    <UiCard title="Appearance" caption="Light, dark, or follow your device." padding="lg">
      <UiThemeToggle variant="segmented" size="md" show-labels />
    </UiCard>

    <UiCard title="Time zone" padding="lg">
      <p class="settings-page__value">{{ zoneLabel }}</p>
      <p class="settings-page__text">
        Your planner shows times in this device's time zone. Organizations keep their own time zone for analytics and reports.
      </p>
    </UiCard>

    <UiCard title="Account" padding="lg">
      <div class="settings-page__account">
        <p class="settings-page__text">Signed in as <strong>{{ profile?.email ?? "…" }}</strong></p>
        <UiButton variant="secondary" @click="signOut">
          <template #leading><LogOut :size="16" /></template>
          Sign out
        </UiButton>
      </div>
    </UiCard>
  </div>
</template>

<style scoped>
.settings-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  width: 100%;
  max-width: var(--content-narrow);
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-12);
}
.settings-page > :first-child {
  margin-bottom: var(--space-2);
}
@media (max-width: 767.98px) {
  .settings-page {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
}
.settings-page__loading,
.settings-page__form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.settings-page__actions {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.settings-page__saved {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--success-text);
}
.settings-page__value {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
}
.settings-page__text {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}
.settings-page__text strong {
  color: var(--text-primary);
  font-weight: var(--fw-medium);
}
.settings-page__account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.settings-page__account .settings-page__text {
  margin-top: 0;
}
</style>
