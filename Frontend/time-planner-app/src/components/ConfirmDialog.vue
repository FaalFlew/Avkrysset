<!-- src/components/ConfirmDialog.vue -->
<script setup lang="ts">
/**
 * ConfirmDialog — renders uiStore.confirmationDialog (uiStore.confirm(...) resolves with the answer).
 * Mount once (App.vue).
 *
 * Answers (unchanged semantics): Confirm → true, Cancel → false,
 * Esc / outside click / X → null (= abort; RegisterView relies on this).
 *
 * Optional hooks read through a narrow typed view (uiStore may add them later):
 *   confirmText / cancelText — button labels (default "Confirm" / "Cancel")
 *   tone: ConfirmTone — 'danger' renders a red confirm button and focuses Cancel first;
 *     otherwise the confirm button is primary and focused first.
 */
import { computed } from "vue";
import { useUIStore } from "@/stores/uiStore";
import UiDialog from "@/components/ui/UiDialog.vue";
import UiButton from "@/components/ui/UiButton.vue";
import type { ConfirmTone, OverlayCloseReason } from "@/components/ui/types";

interface ConfirmView {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

const uiStore = useUIStore();
const dialog = computed(() => uiStore.confirmationDialog as typeof uiStore.confirmationDialog & ConfirmView);

const isDanger = computed(() => dialog.value.tone === "danger");
const confirmText = computed(() => dialog.value.confirmText || "Confirm");
const cancelText = computed(() => dialog.value.cancelText || "Cancel");
const initialFocus = computed(() => (isDanger.value ? "[data-confirm-cancel]" : "[data-confirm-accept]"));

function answer(value: boolean): void {
  uiStore.answerConfirmation(value);
}

function onDismiss(_reason: OverlayCloseReason): void {
  uiStore.answerConfirmation(null);
}
</script>

<template>
  <UiDialog
    :open="dialog.isOpen"
    :title="dialog.title"
    :description="dialog.message"
    size="sm"
    role="alertdialog"
    :initial-focus="initialFocus"
    @close="onDismiss"
  >
    <template #footer>
      <UiButton class="confirm-dialog__button" variant="secondary" data-confirm-cancel @click="answer(false)">
        {{ cancelText }}
      </UiButton>
      <UiButton
        class="confirm-dialog__button"
        :variant="isDanger ? 'danger' : 'primary'"
        data-confirm-accept
        @click="answer(true)"
      >
        {{ confirmText }}
      </UiButton>
    </template>
  </UiDialog>
</template>

<style scoped>
@media (max-width: 767.98px) {
  .confirm-dialog__button {
    flex: 1 1 0;
  }
}
</style>
