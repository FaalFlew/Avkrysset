<!-- src/components/ToastNotification.vue -->
<template>
  <div class="toast-wrapper">
    <Transition name="toast-slide">
      <div v-if="toast.isVisible" :class="toastClasses" class="toast">
        <span class="toast-message">{{ toast.message }}</span>
        <button class="close-button" @click="uiStore.hideToast()">×</button>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useUIStore } from "@/stores/uiStore";
import { storeToRefs } from "pinia";

const uiStore = useUIStore();
const { toast } = storeToRefs(uiStore);

const toastClasses = computed(() => ({
  "toast--success": toast.value.type === "success",
  "toast--error": toast.value.type === "error",
  "toast--info": toast.value.type === "info",
}));
</script>

<style scoped>
* {
  box-sizing: border-box;
}
.toast-wrapper {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  width: 90%;
  max-width: 400px;
  pointer-events: none; /* Allows clicks to pass through the wrapper */
}

.toast {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  color: white;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  pointer-events: auto; /* Re-enable clicks on the toast itself */
}

.toast--info {
  background-color: #2f86eb;
}

.toast--success {
  background-color: #34b77d;
}

.toast--error {
  background-color: #e53e3e; /* var(--danger-color) */
}

.toast-message {
  font-weight: 500;
}

.close-button {
  background: none;
  border: none;
  color: white;
  font-size: 1.5rem;
  line-height: 1;
  padding: 0 0 0 1rem;
  opacity: 0.8;
  cursor: pointer;
}
.close-button:hover {
  opacity: 1;
}

/* Vue Transition classes */
.toast-slide-enter-active,
.toast-slide-leave-active {
  transition: all 0.4s ease;
}

.toast-slide-enter-from,
.toast-slide-leave-to {
  transform: translateY(-100px);
  opacity: 0;
}
</style>
