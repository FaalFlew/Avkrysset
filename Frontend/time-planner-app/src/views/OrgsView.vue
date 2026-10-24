<script setup lang="ts">
/**
 * OrgsView — /orgs: my invitations (accept / decline by id), my organizations, and the Create /
 * Join-with-code dialogs. The org list comes from orgStore (refreshed on mount).
 */
import { computed, nextTick, onMounted, ref } from "vue";
import { RouterLink, useRouter } from "vue-router";
import { storeToRefs } from "pinia";
import { Building2, ChevronRight, KeyRound, Mail, Plus } from "lucide-vue-next";
import UiPageHeader from "@/components/ui/UiPageHeader.vue";
import UiCard from "@/components/ui/UiCard.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiBadge from "@/components/ui/UiBadge.vue";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiInput from "@/components/ui/UiInput.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import UiEmptyState from "@/components/ui/UiEmptyState.vue";
import UiErrorState from "@/components/ui/UiErrorState.vue";
import OrgMonogram from "@/components/org/OrgMonogram.vue";
import { orgPagePath } from "@/components/shell/navItems";
import { useOrgStore } from "@/stores/orgStore";
import { useUIStore } from "@/stores/uiStore";
import { apiErrorMessage, httpStatus, isSessionChangedError } from "@/lib/apiErrors";
import { isCompleteJoinCode, JOIN_CODE_LENGTH, normalizeJoinCode } from "@/lib/joinCode";
import { formatRelativeToNow, formatZoneLabel, getActiveTimeZone } from "@/lib/datetime";
import type { Invitation } from "@/types/org";

const NAME_MAX = 150;

const router = useRouter();
const orgStore = useOrgStore();
const uiStore = useUIStore();
const { orgs, invitations, loaded, isLoading, loadError } = storeToRefs(orgStore);

const showSkeleton = computed(() => !loaded.value && isLoading.value && orgs.value.length === 0);
const showError = computed(() => !!loadError.value && !loaded.value);
const isEmpty = computed(() => loaded.value && orgs.value.length === 0 && invitations.value.length === 0);

onMounted(() => {
  void orgStore.loadMine();
});

function retry(): void {
  void orgStore.loadMine();
}

const roleText = (role: string) => (role === "Admin" ? "an admin" : "a member");

// ------------------------------------------------------------------ invitations
const busyInvite = ref<string | null>(null);
const inviteError = ref<{ id: string; message: string } | null>(null);

async function accept(invitation: Invitation): Promise<void> {
  if (busyInvite.value) return;
  busyInvite.value = invitation.id;
  inviteError.value = null;
  try {
    const membership = await orgStore.acceptInvitation({ id: invitation.id });
    const name = membership.organizationName || invitation.organizationName;
    uiStore.showToast(`You joined ${name}.`, "success", 6000, {
      action: { label: "Open", onClick: () => void router.push(orgPagePath(membership.organizationId)) },
    });
  } catch (error) {
    if (isSessionChangedError(error)) return;
    inviteError.value = { id: invitation.id, message: apiErrorMessage(error, "Couldn't accept the invitation.") };
    // Expired / no longer pending: the inbox is out of date.
    const status = httpStatus(error);
    if (status === 400 || status === 404 || status === 409) void orgStore.loadMine();
  } finally {
    busyInvite.value = null;
  }
}

async function decline(invitation: Invitation): Promise<void> {
  if (busyInvite.value) return;
  const confirmed = await uiStore.confirm(
    "Decline invitation?",
    `You'll need a new invitation to join ${invitation.organizationName} later.`,
    { confirmText: "Decline", tone: "danger" }
  );
  if (!confirmed) return;
  busyInvite.value = invitation.id;
  inviteError.value = null;
  try {
    await orgStore.declineInvitation({ id: invitation.id });
    uiStore.showToast(`Declined the invitation to ${invitation.organizationName}.`, "info");
    await nextTick();
    document.querySelector<HTMLElement>("[data-focus-fallback='orgs']")?.focus();
  } catch (error) {
    if (isSessionChangedError(error)) return;
    inviteError.value = { id: invitation.id, message: apiErrorMessage(error, "Couldn't decline the invitation.") };
    const status = httpStatus(error);
    if (status === 400 || status === 404 || status === 409) void orgStore.loadMine();
  } finally {
    busyInvite.value = null;
  }
}

// ------------------------------------------------------------------ create
const createOpen = ref(false);
const createName = ref("");
const createError = ref("");
const creating = ref(false);
const deviceZone = computed(() => formatZoneLabel(getActiveTimeZone()));

function openCreate(): void {
  createName.value = "";
  createError.value = "";
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  if (creating.value) return;
  const name = createName.value.trim();
  if (!name) {
    createError.value = "Give your organization a name.";
    return;
  }
  if (name.length > NAME_MAX) {
    createError.value = `Use at most ${NAME_MAX} characters.`;
    return;
  }
  creating.value = true;
  createError.value = "";
  try {
    const org = await orgStore.create({ name });
    createOpen.value = false;
    uiStore.showToast(`Created ${org.name}.`, "success");
    await router.push(orgPagePath(org.id));
  } catch (error) {
    if (isSessionChangedError(error)) return;
    createError.value = apiErrorMessage(error, "Couldn't create the organization.");
  } finally {
    creating.value = false;
  }
}

// ------------------------------------------------------------------ join
const joinOpen = ref(false);
const joinCode = ref("");
const joinError = ref("");
const joining = ref(false);

function openJoin(): void {
  joinCode.value = "";
  joinError.value = "";
  joinOpen.value = true;
}

function joinErrorMessage(error: unknown): string {
  if (httpStatus(error) === 404) return "That code isn't valid. Check it with the person who shared it.";
  return apiErrorMessage(error, "Couldn't join with that code.");
}

async function submitJoin(): Promise<void> {
  if (joining.value) return;
  if (!isCompleteJoinCode(joinCode.value)) {
    joinError.value = `Enter the ${JOIN_CODE_LENGTH}-character code (letters and numbers).`;
    return;
  }
  joining.value = true;
  joinError.value = "";
  try {
    const membership = await orgStore.joinWithCode(normalizeJoinCode(joinCode.value));
    joinOpen.value = false;
    uiStore.showToast(`You joined ${membership.organizationName}.`, "success");
    await router.push(orgPagePath(membership.organizationId));
  } catch (error) {
    if (isSessionChangedError(error)) return;
    joinError.value = joinErrorMessage(error);
  } finally {
    joining.value = false;
  }
}
</script>

<template>
  <div class="orgs-page">
    <UiPageHeader title="Organizations" subtitle="Plan together: a shared schedule, a board and analytics for your team.">
      <template #actions>
        <UiButton variant="secondary" data-focus-fallback="orgs" @click="openJoin">
          <template #leading><KeyRound :size="16" /></template>
          Join with code
        </UiButton>
        <UiButton variant="primary" @click="openCreate">
          <template #leading><Plus :size="16" /></template>
          New organization
        </UiButton>
      </template>
    </UiPageHeader>

    <!-- Invitations inbox -->
    <UiCard v-if="invitations.length > 0" title="Invitations" padding="none" class="orgs-page__card">
      <template #actions>
        <UiBadge tone="accent">{{ invitations.length }}</UiBadge>
      </template>
      <ul role="list" class="invite-list">
        <li v-for="invitation in invitations" :key="invitation.id" class="invite">
          <span class="invite__icon" aria-hidden="true"><Mail :size="16" /></span>
          <div class="invite__body">
            <p class="invite__title">
              <strong>{{ invitation.organizationName }}</strong>
            </p>
            <p class="invite__text">
              {{ invitation.invitedByDisplayName ?? "Someone" }} invited you to join as {{ roleText(invitation.role) }} ·
              expires {{ formatRelativeToNow(invitation.expiryUtc) }}
            </p>
            <p v-if="inviteError?.id === invitation.id" class="invite__error" role="alert">{{ inviteError.message }}</p>
          </div>
          <div class="invite__actions">
            <UiButton
              size="sm"
              variant="ghost"
              :disabled="busyInvite !== null && busyInvite !== invitation.id"
              :aria-label="`Decline the invitation to ${invitation.organizationName}`"
              @click="decline(invitation)"
            >
              Decline
            </UiButton>
            <UiButton
              size="sm"
              variant="primary"
              :loading="busyInvite === invitation.id"
              :disabled="busyInvite !== null && busyInvite !== invitation.id"
              :aria-label="`Accept the invitation to ${invitation.organizationName}`"
              @click="accept(invitation)"
            >
              Accept
            </UiButton>
          </div>
        </li>
      </ul>
    </UiCard>

    <UiErrorState
      v-if="showError"
      title="Couldn't load your organizations"
      :description="loadError ?? undefined"
      :retrying="isLoading"
      @retry="retry"
    />

    <div v-else-if="showSkeleton" class="org-grid" aria-busy="true">
      <span class="sr-only" role="status">Loading organizations…</span>
      <div v-for="n in 3" :key="n" class="org-card org-card--skeleton">
        <UiSkeleton :width="32" :height="32" />
        <div class="org-card__text">
          <UiSkeleton width="60%" :height="14" />
          <UiSkeleton width="40%" :height="12" />
        </div>
      </div>
    </div>

    <UiEmptyState
      v-else-if="isEmpty"
      :icon="Building2"
      title="No organizations yet"
      description="Create one for your team, or join with a code from an organization's owner or admin."
    >
      <template #actions>
        <UiButton variant="secondary" @click="openJoin">Join with code</UiButton>
        <UiButton variant="primary" @click="openCreate">New organization</UiButton>
      </template>
    </UiEmptyState>

    <section v-else-if="orgs.length > 0" aria-labelledby="orgs-list-title">
      <h2 id="orgs-list-title" class="orgs-page__section-title">Your organizations</h2>
      <ul role="list" class="org-grid">
        <li v-for="org in orgs" :key="org.id">
          <RouterLink :to="orgPagePath(org.id)" class="org-card">
            <OrgMonogram :name="org.name" :color="org.color" size="lg" />
            <span class="org-card__text">
              <span class="org-card__name">{{ org.name }}</span>
              <span class="org-card__meta">{{ formatZoneLabel(org.timeZoneId) }}</span>
            </span>
            <UiBadge v-if="org.myRole" :tone="org.myRole === 'Member' ? 'neutral' : 'accent'">{{ org.myRole }}</UiBadge>
            <ChevronRight :size="16" class="org-card__chevron" aria-hidden="true" />
          </RouterLink>
        </li>
      </ul>
    </section>

    <!-- Create -->
    <UiDialog v-model:open="createOpen" title="New organization" size="sm">
      <form id="create-org-form" class="orgs-dialog" @submit.prevent="submitCreate">
        <UiInput
          v-model="createName"
          label="Name"
          name="organizationName"
          autocomplete="organization"
          :maxlength="NAME_MAX"
          required
          data-autofocus
          :error="createError || undefined"
          :hint="`Uses your time zone, ${deviceZone}. You can change it later in the organization's settings.`"
          @input="createError = ''"
        />
      </form>
      <template #footer="{ close }">
        <UiButton variant="ghost" @click="close('button')">Cancel</UiButton>
        <UiButton type="submit" form="create-org-form" variant="primary" :loading="creating">Create</UiButton>
      </template>
    </UiDialog>

    <!-- Join -->
    <UiDialog v-model:open="joinOpen" title="Join with a code" description="Ask an owner or admin of the organization for its code." size="sm">
      <form id="join-org-form" class="orgs-dialog" @submit.prevent="submitJoin">
        <UiInput
          v-model="joinCode"
          label="Join code"
          name="joinCode"
          autocomplete="off"
          autocapitalize="characters"
          spellcheck="false"
          :maxlength="JOIN_CODE_LENGTH + 4"
          placeholder="ABCD2345"
          class="orgs-dialog__code"
          required
          data-autofocus
          :error="joinError || undefined"
          :hint="`${JOIN_CODE_LENGTH} letters and numbers. Spaces and dashes are fine.`"
          @input="joinError = ''"
        />
      </form>
      <template #footer="{ close }">
        <UiButton variant="ghost" @click="close('button')">Cancel</UiButton>
        <UiButton type="submit" form="join-org-form" variant="primary" :loading="joining">Join</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.orgs-page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  width: 100%;
  max-width: var(--content-medium);
  margin: 0 auto;
  padding: var(--space-8) var(--space-6) var(--space-12);
}
@media (max-width: 767.98px) {
  .orgs-page {
    padding: var(--space-5) var(--space-4) var(--space-10);
  }
}

.orgs-page__section-title {
  margin-bottom: var(--space-3);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-tertiary);
}

/* ---------- invitations ---------- */
.invite-list {
  display: flex;
  flex-direction: column;
}
.invite {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-4);
  border-top: 1px solid var(--border-subtle);
}
.invite__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--radius-full);
  background-color: var(--accent-subtle);
  color: var(--accent-text);
}
.invite__body {
  flex: 1 1 auto;
  min-width: 0;
}
.invite__title {
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-primary);
  overflow-wrap: anywhere;
}
.invite__title strong {
  font-weight: var(--fw-semibold);
}
.invite__text {
  margin-top: var(--space-0-5);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.invite__error {
  margin-top: var(--space-1-5);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--danger-text);
}
.invite__actions {
  display: flex;
  gap: var(--space-2);
  flex-shrink: 0;
}
@media (max-width: 559.98px) {
  .invite {
    flex-wrap: wrap;
  }
  .invite__actions {
    width: 100%;
    justify-content: flex-end;
  }
}
@media (pointer: coarse) {
  .invite__actions :deep(.ui-button) {
    min-height: 40px;
  }
}

/* ---------- org cards ---------- */
.org-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-3);
}
.org-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 64px;
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  background-color: var(--bg-surface);
  color: var(--text-primary);
  text-decoration: none;
  transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
a.org-card:hover {
  border-color: var(--border-strong);
  background-color: var(--bg-subtle);
}
.org-card__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.org-card__name {
  overflow: hidden;
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-card__meta {
  overflow: hidden;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.org-card__chevron {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

/* ---------- dialogs ---------- */
.orgs-dialog {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.orgs-dialog__code :deep(input) {
  font-family: var(--font-mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
</style>
