// src/composables/useOrgPermissions.ts — can() bound to my role in an organization and my user id.
//
//   const perms = useOrgPermissions();            // the org of the current route
//   perms.can("member.remove", { target })        // → { allowed } | { allowed: false, hidden, reason }
//   perms.visible("board.manage")                 // render the control at all?
//   perms.taskCapabilities(task)                  // server capabilities, else TaskCapabilities.For
//
// The role comes from orgStore (kept current by membership re-checks and, later, role events), so
// everything recomputes when it changes.

import { computed, toValue, type MaybeRefOrGetter } from "vue";
import { useRoute } from "vue-router";
import type { TaskCapabilities } from "@/types";
import { useOrgStore } from "@/stores/orgStore";
import { useCurrentUserId } from "@/composables/useCurrentUser";
import { contextFromParams } from "@/components/shell/navItems";
import {
  can as canFor,
  taskCapabilitiesFor,
  type OrgAction,
  type Permission,
  type PermissionContext,
  type TaskForCapabilities,
} from "@/lib/orgPermissions";

/** `orgId` defaults to the org in the current route (call from a component's setup). */
export function useOrgPermissions(orgId?: MaybeRefOrGetter<string | null | undefined>) {
  const orgStore = useOrgStore();
  const meId = useCurrentUserId();
  const route = orgId === undefined ? useRoute() : null;

  const id = computed<string | null>(() => {
    if (orgId !== undefined) return toValue(orgId) ?? null;
    const context = contextFromParams(route?.params ?? {});
    return context.kind === "org" ? context.orgId : null;
  });
  const role = computed(() => orgStore.roleIn(id.value));

  function can(action: OrgAction, ctx: PermissionContext = {}): Permission {
    return canFor(role.value, action, { meId: meId.value, ...ctx });
  }

  return {
    orgId: id,
    role,
    meId,
    can,
    /** `can(...).allowed` */
    allowed: (action: OrgAction, ctx?: PermissionContext) => can(action, ctx).allowed,
    /** Render the control (allowed, or disabled with a reason)? */
    visible: (action: OrgAction, ctx?: PermissionContext) => {
      const result = can(action, ctx);
      return result.allowed || !result.hidden;
    },
    /** Why the action is not allowed (tooltip / menu description), or undefined. */
    reason: (action: OrgAction, ctx?: PermissionContext) => {
      const result = can(action, ctx);
      return result.allowed ? undefined : result.reason;
    },
    /** What I may do with an org task: the server's capabilities, else the same rule computed here. */
    taskCapabilities: (task: TaskForCapabilities & { capabilities?: TaskCapabilities }): TaskCapabilities =>
      task.capabilities ?? taskCapabilitiesFor(role.value, task, meId.value),
  };
}
