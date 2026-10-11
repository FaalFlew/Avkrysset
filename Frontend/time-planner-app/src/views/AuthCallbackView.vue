<!-- NEW FILE: src/views/AuthCallbackView.vue -->
<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, RouterLink } from "vue-router";
import { authService } from "@/services/authService";

// Define the state for our view
type ConfirmationStatus = "confirming" | "success" | "error";
const status = ref<ConfirmationStatus>("confirming");
const errorMessage = ref(
  "An unknown error occurred. Please try the link again or contact support."
);

const route = useRoute();

onMounted(async () => {
  // 1. Get the userId and token from the URL query parameters
  const userId = route.query.userId as string;
  const token = route.query.token as string;

  // 2. Basic validation
  if (!userId || !token) {
    errorMessage.value =
      "The confirmation link is invalid or incomplete. Please check the link in your email.";
    status.value = "error";
    return;
  }

  // 3. Call the backend to confirm the email
  try {
    await authService.confirmEmail(userId, token);
    status.value = "success";
  } catch (error: any) {
    // If the backend returns an error (e.g., token expired, already used), display it.
    errorMessage.value =
      error.response?.data?.message ||
      "Email confirmation failed. The link may have expired.";
    status.value = "error";
    console.error("Email confirmation error:", error);
  }
});
</script>

<template>
  <div class="auth-container">
    <!-- Show a loading spinner while confirming -->
    <div v-if="status === 'confirming'">
      <h2>Confirming Your Email...</h2>
      <p>Please wait a moment.</p>
      <!-- You can add a spinner component here -->
    </div>

    <!-- Show a success message -->
    <div v-else-if="status === 'success'">
      <h2>Email Confirmed</h2>
      <p>Your account has been successfully verified.</p>
      <RouterLink to="/login" class="btn-primary">Proceed to Login</RouterLink>
    </div>

    <!-- Show an error message -->
    <div v-else-if="status === 'error'">
      <h2>Confirmation Failed</h2>
      <p>{{ errorMessage }}</p>
      <p>
        You can try to <RouterLink to="/login">log in</RouterLink> to resend the
        confirmation email if needed.
      </p>
    </div>
  </div>
</template>

<style scoped>
/* We can reuse the same styles as our Login/Register pages */
.auth-container {
  max-width: 450px;
  margin: 50px auto;
  padding: 2rem;
  background: #fff;
  border-radius: 8px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  text-align: center;
}

h2 {
  margin-bottom: 1rem;
}

p {
  color: #555;
  line-height: 1.6;
  margin-bottom: 1.5rem;
}

.btn-primary {
  display: inline-block;
  text-decoration: none;
  padding: 0.8rem 1.5rem;
  margin-top: 1rem;
}
</style>
