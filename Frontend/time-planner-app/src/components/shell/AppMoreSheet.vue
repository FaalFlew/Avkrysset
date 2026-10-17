<script setup lang="ts">
/**
 * AppMoreSheet — the mobile "More" bottom sheet: account status, theme, log in / log out.
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import { LogIn, LogOut, UserPlus } from "lucide-vue-next";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiButton from "@/components/ui/UiButton.vue";
import UiThemeToggle from "@/components/ui/UiThemeToggle.vue";
import { useAuthStore } from "@/stores/authStore";
import { logoutAndRedirect } from "./useShell";

const open = defineModel<boolean>("open", { default: false });

const router = useRouter();
const authStore = useAuthStore();
const isAuthenticated = computed(() => authStore.isAuthenticated);

async function go(path: string): Promise<void> {
  open.value = false;
  await router.push(path);
}

async function logout(): Promise<void> {
  open.value = false;
  await logoutAndRedirect(router);
}
</script>

<template>
  <UiDialog v-model:open="open" title="More" presentation="sheet">
    <div class="more">
      <section class="more__section" aria-labelledby="more-account">
        <h3 id="more-account" class="more__label">Account</h3>
        <div v-if="!isAuthenticated" class="more__guest">
          <p class="more__title">Guest mode</p>
          <p class="more__text">Your plans are saved in this browser only. Create a free account to sync across devices.</p>
          <div class="more__actions">
            <UiButton variant="primary" block @click="go('/register')">
              <template #leading><UserPlus :size="16" /></template>
              Create account
            </UiButton>
            <UiButton variant="secondary" block @click="go('/login')">
              <template #leading><LogIn :size="16" /></template>
              Log in
            </UiButton>
          </div>
        </div>
        <div v-else class="more__guest">
          <p class="more__title">Signed in</p>
          <p class="more__text">Your plans sync across your devices.</p>
          <div class="more__actions">
            <UiButton variant="secondary" block @click="logout">
              <template #leading><LogOut :size="16" /></template>
              Log out
            </UiButton>
          </div>
        </div>
      </section>

      <section class="more__section" aria-labelledby="more-theme">
        <h3 id="more-theme" class="more__label">Appearance</h3>
        <UiThemeToggle variant="segmented" size="md" show-labels block />
      </section>
    </div>
  </UiDialog>
</template>

<style scoped>
.more {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-top: var(--space-2);
}
.more__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.more__label {
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-medium);
  letter-spacing: var(--tracking-caps);
  text-transform: uppercase;
  color: var(--text-tertiary);
}
.more__title {
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-semibold);
}
.more__text {
  margin-top: var(--space-1);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-secondary);
}
.more__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  margin-top: var(--space-3);
}
</style>
