<script setup lang="ts">
/**
 * InvitationLandingView — /invitations/:token, the link in an invitation email (auth layout).
 * The preview is anonymous (the token is the secret; the email is masked).
 *   signed out     → Log in / Create account (both come back here), and the token is remembered
 *                    (`tp-pending-invitation`, 7 days) so it survives creating an account and
 *                    confirming the email; plus an anonymous Decline (§8 Q-F, see ANONYMOUS_DECLINE)
 *   signed in      → Accept / Decline
 *   wrong account  → "Sent to m•••@gmail.com, you're signed in as …" + Log out
 *   not pending    → accepted / declined / withdrawn / expired message
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { CircleCheck, Mail, MailX, TriangleAlert } from "lucide-vue-next";
import AuthLayout from "@/components/auth/AuthLayout.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import { orgService } from "@/services/orgService";
import { sessionBound, useAuthStore } from "@/stores/authStore";
import { useOrgStore } from "@/stores/orgStore";
import { useTaskStore } from "@/stores/taskStore";
import { useUIStore } from "@/stores/uiStore";
import { userEmailFromToken } from "@/composables/useCurrentUser";
import { orgPagePath } from "@/components/shell/navItems";
import { apiErrorMessage, httpStatus, isSessionChangedError } from "@/lib/apiErrors";
import { clearPendingInvitation, invitationPath, savePendingInvitation } from "@/lib/authRedirect";
import { formatRelativeToNow } from "@/lib/datetime";
import type { InvitationPreview } from "@/types/org";

/**
 * §8 Q-F (approved): people may decline from the email link without signing in. To require an
 * account instead, set this to false (the signed-in Decline stays).
 */
const ANONYMOUS_DECLINE = true;

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const orgStore = useOrgStore();
const taskStore = useTaskStore();
const uiStore = useUIStore();
const layout = ref<InstanceType<typeof AuthLayout> | null>(null);

const token = computed(() => {
  const raw = route.params.token;
  return String(Array.isArray(raw) ? raw[0] : (raw ?? ""));
});
const isAuthenticated = computed(() => authStore.isAuthenticated);
const myEmail = computed(() => userEmailFromToken(authStore.accessToken));

type Phase = "loading" | "ready" | "invalid" | "error" | "declined";
const phase = ref<Phase>("loading");
const preview = ref<InvitationPreview | null>(null);
const loadError = ref("");
const actionError = ref("");
const busy = ref<"accept" | "decline" | "logout" | null>(null);
let loadSeq = 0;

const returnHere = computed(() => invitationPath(token.value));
const loginLink = computed(() => ({ path: "/login", query: { redirect: returnHere.value } }));
const registerLink = computed(() => ({ path: "/register", query: { redirect: returnHere.value } }));

const orgName = computed(() => preview.value?.organizationName || "the organization");
const roleText = computed(() => (preview.value?.role === "Admin" ? "an admin" : "a member"));
const inviter = computed(() => preview.value?.invitedByDisplayName || "Someone");
const isPending = computed(() => preview.value?.status === "Pending");
/** Signed in with another account than the invitation's (the server says so). */
const wrongAccount = computed(() => isAuthenticated.value && preview.value?.matchesCurrentUser === false);

const title = computed(() => {
  if (phase.value === "loading") return "Invitation";
  if (phase.value === "invalid") return "This invitation link isn't valid";
  if (phase.value === "error") return "Couldn't open the invitation";
  if (phase.value === "declined") return "Invitation declined";
  switch (preview.value?.status) {
    case "Accepted":
      return "Invitation already accepted";
    case "Declined":
      return "This invitation was declined";
    case "Rescinded":
      return "This invitation was withdrawn";
    case "Expired":
      return "This invitation has expired";
    default:
      return `Join ${orgName.value}`;
  }
});
const tone = computed(() => {
  if (phase.value === "invalid" || phase.value === "error") return "danger";
  if (phase.value === "ready" && isPending.value) return "accent";
  if (phase.value === "ready" && preview.value?.status === "Accepted") return "success";
  return "neutral";
});

async function load(): Promise<void> {
  const seq = ++loadSeq;
  if (!token.value) {
    phase.value = "invalid";
    return;
  }
  if (phase.value !== "ready") phase.value = "loading";
  loadError.value = "";
  try {
    const result = await sessionBound(() => orgService.getInvitationPreview(token.value));
    if (seq !== loadSeq) return;
    preview.value = result;
    phase.value = "ready";
    if (result.status !== "Pending") clearPendingInvitation();
    else if (!isAuthenticated.value) savePendingInvitation(token.value);
  } catch (error) {
    if (seq !== loadSeq || isSessionChangedError(error)) return;
    if (httpStatus(error) === 404) {
      clearPendingInvitation();
      phase.value = "invalid";
    } else {
      loadError.value = apiErrorMessage(error, "Check your connection and try again.");
      phase.value = "error";
    }
  }
}

async function accept(): Promise<void> {
  if (busy.value) return;
  busy.value = "accept";
  actionError.value = "";
  try {
    const membership = await orgStore.acceptInvitation({ token: token.value });
    clearPendingInvitation();
    uiStore.showToast(`You joined ${membership.organizationName || orgName.value}.`, "success");
    await router.replace(orgPagePath(membership.organizationId));
  } catch (error) {
    if (isSessionChangedError(error)) return;
    const status = httpStatus(error);
    actionError.value =
      status === 404
        ? "This invitation is for a different account."
        : apiErrorMessage(error, "Couldn't accept the invitation.");
    if (status === 400 || status === 409) void load();
  } finally {
    busy.value = null;
  }
}

async function decline(): Promise<void> {
  if (busy.value) return;
  const confirmed = await uiStore.confirm(
    "Decline invitation?",
    `You'll need a new invitation to join ${orgName.value} later.`,
    { confirmText: "Decline", tone: "danger" }
  );
  if (!confirmed) return;
  busy.value = "decline";
  actionError.value = "";
  try {
    await orgStore.declineInvitation({ token: token.value });
    clearPendingInvitation();
    phase.value = "declined";
  } catch (error) {
    if (isSessionChangedError(error)) return;
    actionError.value = apiErrorMessage(error, "Couldn't decline the invitation.");
    const status = httpStatus(error);
    if (status === 400 || status === 409) void load();
  } finally {
    busy.value = null;
  }
}

/** Wrong account: sign out here and stay on the invitation (it then offers Log in). */
async function logOut(): Promise<void> {
  if (busy.value) return;
  busy.value = "logout";
  try {
    await authStore.logout();
    await taskStore.initializeData();
  } finally {
    busy.value = null;
  }
}

onMounted(load);
// Signing in or out changes what the preview says about "you" (matchesCurrentUser).
watch([token, isAuthenticated], () => void load());
// Announce the outcome by moving focus to the (new) heading.
watch(title, async () => {
  if (phase.value === "loading") return;
  await nextTick();
  layout.value?.focusHeading();
});
</script>

<template>
  <AuthLayout ref="layout" :title="title" :tone="tone" centered>
    <template #icon>
      <CircleCheck v-if="phase === 'ready' && preview?.status === 'Accepted'" :size="20" />
      <TriangleAlert v-else-if="phase === 'invalid' || phase === 'error'" :size="20" />
      <MailX v-else-if="phase === 'declined' || (phase === 'ready' && !isPending)" :size="20" />
      <Mail v-else :size="20" />
    </template>

    <!-- Loading -->
    <div v-if="phase === 'loading'" class="invite-landing__loading" aria-busy="true">
      <span class="sr-only" role="status">Loading the invitation…</span>
      <UiSkeleton width="80%" :height="14" />
      <UiSkeleton width="60%" :height="14" />
      <UiSkeleton :height="44" radius="var(--radius-md)" />
    </div>

    <!-- Unknown token -->
    <template v-else-if="phase === 'invalid'">
      <p class="auth-text">
        It may have been mistyped, or replaced by a newer invitation. Ask the person who invited you to send it again.
      </p>
      <div class="auth-actions">
        <UiButton :to="isAuthenticated ? '/orgs' : '/'" variant="primary" size="lg" block>
          {{ isAuthenticated ? "Go to your organizations" : "Go to Time Planner" }}
        </UiButton>
      </div>
    </template>

    <!-- Network / server -->
    <template v-else-if="phase === 'error'">
      <p class="auth-text">{{ loadError }}</p>
      <div class="auth-actions">
        <UiButton variant="primary" size="lg" block @click="load">Try again</UiButton>
      </div>
    </template>

    <!-- Declined just now -->
    <template v-else-if="phase === 'declined'">
      <p class="auth-text">You won't join {{ orgName }}. An owner or admin can still invite you again later.</p>
      <div class="auth-actions">
        <UiButton :to="isAuthenticated ? '/orgs' : '/'" variant="primary" size="lg" block>
          {{ isAuthenticated ? "Go to your organizations" : "Go to Time Planner" }}
        </UiButton>
      </div>
    </template>

    <!-- Pending -->
    <template v-else-if="preview && isPending">
      <p class="auth-text">
        <strong>{{ inviter }}</strong> invited you to join <strong>{{ orgName }}</strong> as {{ roleText }}.
      </p>
      <p class="auth-text invite-landing__meta">
        Sent to {{ preview.invitedEmailMasked }} · expires {{ formatRelativeToNow(preview.expiryUtc) }}
      </p>

      <p v-if="actionError" class="auth-alert invite-landing__alert" role="alert">
        <TriangleAlert :size="16" />
        <span>{{ actionError }}</span>
      </p>

      <!-- Signed in with another account -->
      <template v-if="wrongAccount">
        <p class="auth-alert auth-alert--info invite-landing__alert">
          <span>
            This invitation was sent to {{ preview.invitedEmailMasked }}, but you're signed in as
            <strong>{{ myEmail ?? "another account" }}</strong>. Log out, then log in with the invited email.
          </span>
        </p>
        <div class="auth-actions">
          <UiButton variant="primary" size="lg" block :loading="busy === 'logout'" @click="logOut">Log out</UiButton>
        </div>
      </template>

      <!-- Signed in -->
      <div v-else-if="isAuthenticated" class="auth-actions">
        <UiButton variant="primary" size="lg" block :loading="busy === 'accept'" :disabled="busy === 'decline'" @click="accept">
          Accept invitation
        </UiButton>
        <UiButton variant="secondary" size="lg" block :loading="busy === 'decline'" :disabled="busy === 'accept'" @click="decline">
          Decline
        </UiButton>
      </div>

      <!-- Signed out -->
      <template v-else>
        <div class="auth-actions">
          <UiButton :to="loginLink" variant="primary" size="lg" block>Log in to accept</UiButton>
          <UiButton :to="registerLink" variant="secondary" size="lg" block>Create an account</UiButton>
        </div>
        <p class="auth-text invite-landing__note">
          Create the account with the invited email. We'll bring you back to this invitation after you log in.
        </p>
        <div v-if="ANONYMOUS_DECLINE" class="auth-section">
          <p class="auth-text">Not interested?</p>
          <UiButton variant="ghost" block :loading="busy === 'decline'" class="invite-landing__decline" @click="decline">
            Decline invitation
          </UiButton>
        </div>
      </template>
    </template>

    <!-- Accepted / declined / withdrawn / expired -->
    <template v-else-if="preview">
      <p v-if="preview.status === 'Accepted'" class="auth-text">
        {{ isAuthenticated && preview.matchesCurrentUser !== false ? `You're a member of ${orgName}.` : `It was accepted for ${preview.invitedEmailMasked}.` }}
      </p>
      <p v-else class="auth-text">Ask an owner or admin of {{ orgName }} to invite you again.</p>
      <div class="auth-actions">
        <UiButton
          v-if="preview.status === 'Accepted' && isAuthenticated && preview.matchesCurrentUser !== false"
          :to="orgPagePath(preview.organizationId)"
          variant="primary"
          size="lg"
          block
        >
          Open {{ orgName }}
        </UiButton>
        <UiButton v-else-if="!isAuthenticated" :to="loginLink" variant="primary" size="lg" block>Log in</UiButton>
        <UiButton v-else to="/orgs" variant="primary" size="lg" block>Go to your organizations</UiButton>
      </div>
    </template>
  </AuthLayout>
</template>

<style scoped>
.invite-landing__loading {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.auth-text.invite-landing__meta,
.auth-text.invite-landing__note {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-tertiary);
}
.auth-text.invite-landing__note {
  margin-top: var(--space-3);
}
.invite-landing__alert {
  margin-top: var(--space-4);
}
.invite-landing__decline {
  margin-top: var(--space-2);
}
</style>
