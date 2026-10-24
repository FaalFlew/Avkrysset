// src/router/index.ts

import { nextTick } from "vue";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { useAuthStore } from "@/stores/authStore";
import { loginLocation, type LoginReason } from "@/lib/authRedirect";

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
    /** Why a guest is sent to log in (`/login?reason=…`): "orgs" = "Organizations need a free account". */
    authReason?: LoginReason;
    /** Only for signed-out users (signed-in users are sent to the planner). */
    guestOnly?: boolean;
  }
}

/** Organization ids are GUIDs; anything else under /orgs/ goes back to the list. */
const GUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ORG_META = { requiresAuth: true, authReason: "orgs" } as const;

// Org pages are lazy (one chunk each). Each placeholder is filled by a later sub-phase:
// schedule 3C, board 3D, members/analytics/activity/settings 3E.
const orgRoutes: RouteRecordRaw[] = [
  {
    path: `/orgs/:orgId(${GUID})`,
    component: () => import("@/views/org/OrgLayout.vue"),
    meta: ORG_META,
    children: [
      { path: "", name: "Org", redirect: (to) => ({ name: "OrgSchedule", params: to.params }) },
      { path: "schedule", name: "OrgSchedule", component: () => import("@/views/org/OrgScheduleView.vue"), meta: { title: "Schedule" } },
      { path: "board", name: "OrgBoard", component: () => import("@/views/org/OrgBoardView.vue"), meta: { title: "Board" } },
      { path: "members", name: "OrgMembers", component: () => import("@/views/org/OrgMembersView.vue"), meta: { title: "Members" } },
      { path: "analytics", name: "OrgAnalytics", component: () => import("@/views/org/OrgAnalyticsView.vue"), meta: { title: "Analytics" } },
      { path: "activity", name: "OrgActivity", component: () => import("@/views/org/OrgActivityView.vue"), meta: { title: "Activity" } },
      { path: "settings", name: "OrgSettings", component: () => import("@/views/org/OrgSettingsView.vue"), meta: { title: "Settings" } },
    ],
  },
  { path: "/orgs/:rest(.*)", redirect: "/orgs" },
];

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
    path: "/settings",
    name: "Settings",
    component: () => import("@/views/SettingsView.vue"),
    meta: { title: "Settings", requiresAuth: true },
  },
  {
    path: "/orgs",
    name: "Orgs",
    component: () => import("@/views/OrgsView.vue"),
    meta: { title: "Organizations", ...ORG_META },
  },
  ...orgRoutes,
  {
    // The email link (signed in or not). Anonymous preview + decline by token (§8 Q-F).
    path: "/invitations/:token",
    name: "InvitationLanding",
    component: () => import("@/views/InvitationLandingView.vue"),
    meta: { title: "Invitation", layout: "auth" },
  },
  {
    // Invitation emails sent before Phase 3 link to /accept-invite?token=…
    path: "/accept-invite",
    redirect: (to) => {
      const raw = Array.isArray(to.query.token) ? to.query.token[0] : to.query.token;
      return raw ? { name: "InvitationLanding", params: { token: raw }, query: {} } : { path: "/orgs", query: {} };
    },
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
  // Synchronous on purpose: membership is checked by OrgLayout, so a cold server never freezes
  // navigation. Guests come back here after logging in (LoginView → postLoginPath).
  if (to.meta.requiresAuth && !authStore.isAuthenticated) return loginLocation(to.fullPath, to.meta.authReason);
  if (to.meta.guestOnly && authStore.isAuthenticated) return "/";
  return true;
});

// --- Title + focus management ---
let isFirstNavigation = true;
router.afterEach((to, _from, failure) => {
  if (failure) return;
  // Org pages: OrgLayout sets "{page} · {org} · Time Planner" once it knows the org.
  if (!to.params.orgId) document.title = to.meta.title ? `${to.meta.title} · Time Planner` : "Time Planner";

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
