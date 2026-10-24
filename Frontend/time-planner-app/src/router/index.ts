// src/router/index.ts

import { nextTick } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/authStore";

import PlannerView from "@/views/PlannerView.vue";
import TodayView from "@/views/TodayView.vue";
import LoginView from "@/views/LoginView.vue";
import RegisterView from "@/views/RegisterView.vue";
import AuthCallbackView from "@/views/AuthCallbackView.vue";
import ForgotPasswordView from "@/views/ForgotPasswordView.vue";
import ResetPasswordView from "@/views/ResetPasswordView.vue";
import CheckEmailView from "@/views/CheckEmailView.vue";

declare module "vue-router" {
  interface RouteMeta {
    /** Page name for document.title ("Planner · Time Planner"). */
    title?: string;
    /** 'auth' renders the route without the app shell (the view brings its own AuthLayout). */
    layout?: "app" | "auth";
    requiresAuth?: boolean;
    /** Only for signed-out users (signed-in users are sent to the planner). */
    guestOnly?: boolean;
  }
}

const routes: RouteRecordRaw[] = [
  { path: "/", name: "Planner", component: PlannerView, meta: { title: "Planner" } },
  { path: "/today", name: "Today", component: TodayView, meta: { title: "Today" } },
  {
    path: "/analytics",
    name: "Analytics",
    // Lazy: keeps Chart.js out of the main bundle.
    component: () => import("@/components/TaskAnalytics.vue"),
    meta: { title: "Analytics" },
  },
  {
    path: "/templates",
    name: "Templates",
    component: () => import("@/components/TaskTemplateManager.vue"),
    meta: { title: "Templates" },
  },

  {
    path: "/login",
    name: "Login",
    component: LoginView,
    meta: { guestOnly: true, layout: "auth", title: "Log in" },
  },
  {
    path: "/register",
    name: "Register",
    component: RegisterView,
    meta: { guestOnly: true, layout: "auth", title: "Create account" },
  },
  {
    path: "/confirm-email",
    name: "ConfirmEmail",
    component: AuthCallbackView,
    meta: { guestOnly: true, layout: "auth", title: "Confirm email" },
  },
  {
    path: "/forgot-password",
    name: "ForgotPassword",
    component: ForgotPasswordView,
    meta: { guestOnly: true, layout: "auth", title: "Reset password" },
  },
  {
    path: "/reset-password",
    name: "ResetPassword",
    component: ResetPasswordView,
    meta: { guestOnly: true, layout: "auth", title: "Choose a new password" },
  },
  {
    path: "/check-email",
    name: "CheckEmail",
    component: CheckEmailView,
    meta: { guestOnly: true, layout: "auth", title: "Check your email" },
  },

  { path: "/:pathMatch(.*)*", redirect: "/" },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// --- Navigation guard ---
router.beforeEach((to) => {
  const authStore = useAuthStore();
  if (to.meta.requiresAuth && !authStore.isAuthenticated) return "/login";
  if (to.meta.guestOnly && authStore.isAuthenticated) return "/";
  return true;
});

// --- Title + focus management ---
let isFirstNavigation = true;
router.afterEach((to, _from, failure) => {
  if (failure) return;
  document.title = to.meta.title ? `${to.meta.title} · Time Planner` : "Time Planner";

  if (isFirstNavigation) {
    isFirstNavigation = false;
    return;
  }
  // Move focus to the new page's heading so screen-reader and keyboard users start there.
  void nextTick(() => {
    window.requestAnimationFrame(() => {
      const heading = document.querySelector<HTMLElement>("[data-page-heading]");
      heading?.focus({ preventScroll: true });
    });
  });
});

export default router;
