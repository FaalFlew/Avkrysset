// NEW FILE: src/router/index.ts

import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/authStore";

// We will create these view components in the next actions.
import PlannerView from "@/views/PlannerView.vue";
import LoginView from "@/views/LoginView.vue";
import RegisterView from "@/views/RegisterView.vue";
import AuthCallbackView from "@/views/AuthCallbackView.vue"; // ADDED: Import the new view
import TodayView from "@/views/TodayView.vue"; // ADDED
import ForgotPasswordView from "@/views/ForgotPasswordView.vue"; // ADDED
import ResetPasswordView from "@/views/ResetPasswordView.vue"; // ADDED
import CheckEmailView from "@/views/CheckEmailView.vue"; // ADDED

const routes = [
  {
    path: "/",
    name: "Planner",
    component: PlannerView,
  },

  { path: "/today", name: "Today", component: TodayView },

  {
    path: "/login",
    name: "Login",
    component: LoginView,
    meta: { guestOnly: true }, // This route is only for guests
  },
  {
    path: "/register",
    name: "Register",
    component: RegisterView,
    meta: { guestOnly: true }, // This route is also only for guests
  },

  {
    path: "/confirm-email",
    name: "ConfirmEmail",
    component: AuthCallbackView,
    meta: { guestOnly: true }, // This page should only be accessible to non-logged-in users
  },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: ForgotPasswordView,
    meta: { guestOnly: true },
  },
  {
    path: "/reset-password",
    name: "ResetPassword",
    component: ResetPasswordView,
    meta: { guestOnly: true },
  },
  {
    path: "/check-email",
    name: "CheckEmail",
    component: CheckEmailView,
    meta: { guestOnly: true },
  },

  // We will add routes for Analytics, etc., later.
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// --- Navigation Guard ---
// This function runs before every route change.
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore();
  const isAuthenticated = authStore.isAuthenticated;

  if (to.meta.requiresAuth && !isAuthenticated) {
    // If the route requires auth and the user is not logged in, redirect to login.
    next("/login");
  } else if (to.meta.guestOnly && isAuthenticated) {
    // If the route is for guests only and the user is logged in, redirect to the planner.
    next("/");
  } else {
    // Otherwise, allow the navigation.
    next();
  }
});

export default router;
