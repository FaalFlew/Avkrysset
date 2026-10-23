<!-- src/components/ConfirmDialog.vue -->
<template>
  <div
    v-if="uiStore.confirmationDialog.isOpen"
    class="modal-overlay"
    @click.self="abort"
  >
    <div class="modal-content">
      <button @click="abort" class="close-button">&times;</button>
      <!-- Call 'abort' -->

      <h3>{{ uiStore.confirmationDialog.title }}</h3>
      <p>{{ uiStore.confirmationDialog.message }}</p>
      <div class="form-actions">
        <!-- The "No" button resolves the promise with `false` -->
        <button type="button" class="btn-secondary" @click="answer(false)">
          {{ (uiStore.confirmationDialog as any).cancelText }}
        </button>
        <!-- The "Confirm" button resolves the promise with `true` -->
        <button type="button" class="btn-primary" @click="answer(true)">
          {{ (uiStore.confirmationDialog as any).confirmText }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useUIStore } from "@/stores/uiStore";

const uiStore = useUIStore();

// This function resolves the promise with a boolean value (true or false).
const answer = (confirmation: boolean) => {
  uiStore.answerConfirmation(confirmation);
};

// This function resolves the promise with `null` to signal an abort.
const abort = () => {
  uiStore.answerConfirmation(null);
};
</script>

<style scoped>
/* MODIFIED: Using more standard button classes */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 2000;
}
.modal-content {
  position: relative;
  background: white;
  padding: 2rem;
  border-radius: 8px;
  width: 90%;
  max-width: 400px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
  text-align: center;
}
.close-button {
  position: absolute;
  top: 10px;
  right: 15px;
  background: none;
  border: none;
  font-size: 1.8rem;
  line-height: 1;
  color: #aaa;
  cursor: pointer;
}
.close-button:hover {
  color: #333;
}
h3 {
  margin-top: 0;
  color: #333;
}
p {
  color: #555;
  margin-bottom: 1.5rem;
}
.form-actions {
  display: flex;
  justify-content: center; /* Centering the buttons */
  gap: 1rem;
}
</style>
