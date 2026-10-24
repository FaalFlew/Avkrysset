<script setup lang="ts">
/**
 * ContextSwitcher — switch between the Personal workspace and the user's organizations.
 * Entries: Personal / each org (monogram in its colour, name, my role) / "Invitations (n)" /
 * "Create or join…" (→ /orgs; guests are sent to log in by the route guard).
 * Props:
 *   variant: 'expanded' — full-width button at the top of the sidebar (and the tablet drawer)
 *            'rail'     — monogram icon button with the same menu
 *            'sheet'    — a plain list for the phone More sheet ("Workspace" section)
 *   global?: boolean — this instance answers the "O" hotkey (useShell().switcherOpen); only the
 *            sidebar/rail of the app shell sets it (not the drawer copy)
 * Emits: navigate — an entry was chosen (the More sheet / drawer close themselves on it)
 */
import { computed, defineComponent, h, markRaw, ref, type Component } from "vue";
import { useRouter } from "vue-router";
import { Check, ChevronsUpDown, Mail, Plus } from "lucide-vue-next";
import UiMenu from "@/components/ui/UiMenu.vue";
import UiIconButton from "@/components/ui/UiIconButton.vue";
import type { MenuItem } from "@/components/ui/types";
import OrgMonogram from "@/components/org/OrgMonogram.vue";
import { useOrgStore } from "@/stores/orgStore";
import { useAuthStore } from "@/stores/authStore";
import { useBreakpoint } from "@/composables/useMediaQuery";
import { useShell } from "./useShell";
import { useWorkspace } from "./useWorkspace";
import { orgPagePath } from "./navItems";
import type { Organization } from "@/types/org";

const props = withDefaults(defineProps<{ variant: "expanded" | "rail" | "sheet"; global?: boolean }>(), {
  global: false,
});
const emit = defineEmits<{ navigate: [] }>();

const router = useRouter();
const orgStore = useOrgStore();
const authStore = useAuthStore();
const { isCoarse } = useBreakpoint();
const { switcherOpen } = useShell();
const { context, org } = useWorkspace();

const localOpen = ref(false);
const open = computed({
  get: () => (props.global ? switcherOpen.value : localOpen.value),
  set: (value: boolean) => {
    if (props.global) switcherOpen.value = value;
    else localOpen.value = value;
  },
});

const isAuthenticated = computed(() => authStore.isAuthenticated);
const orgs = computed(() => orgStore.orgs);
const invitationCount = computed(() => orgStore.pendingInvitationCount);
const currentOrgId = computed(() => (context.value.kind === "org" ? context.value.orgId.toLowerCase() : null));
const isCurrent = (o: Organization) => currentOrgId.value === o.id.toLowerCase();

/** Name shown on the trigger: the org's (once loaded) or "Personal". */
const currentName = computed(() => (context.value.kind === "org" ? (org.value?.name ?? "Organization") : "Personal"));
const currentRole = computed(() => (context.value.kind === "org" ? (org.value?.myRole ?? null) : null));
/** Second line of the trigger: my role in the org, "Workspace" for Personal. */
const secondaryText = computed(() => currentRole.value ?? (context.value.kind === "personal" ? "Workspace" : ""));
/** Starts with the visible text (label-in-name), then what the button does. */
const triggerLabel = computed(() => {
  const n = invitationCount.value;
  const invites = n ? `, ${n} pending invitation${n === 1 ? "" : "s"}` : "";
  return `${[currentName.value, secondaryText.value].filter(Boolean).join(" ")}, switch workspace${invites}`;
});
const shortcut = computed(() => (props.global && !isCoarse.value ? ["O"] : undefined));
const orgsLabel = computed(() => (isAuthenticated.value ? "Create or join…" : "Organizations…"));

async function go(path: string): Promise<void> {
  emit("navigate");
  await router.push(path).catch(() => undefined);
}

// Menu icons: the monogram as a 16px "icon" (UiMenu renders `item.icon` with :size and a class,
// which this wrapper consumes so the monogram keeps its own size and colours).
const monogramIcons = new Map<string, Component>();
function monogramIcon(name: string | null, color: string | null): Component {
  const key = `${name ?? ""}|${color ?? ""}`;
  let icon = monogramIcons.get(key);
  if (!icon) {
    icon = markRaw(
      defineComponent({
        name: "WorkspaceMenuIcon",
        inheritAttrs: false,
        props: { size: { type: Number, default: 16 } },
        setup: () => () => h(OrgMonogram, { name, color, size: "sm" }),
      })
    );
    monogramIcons.set(key, icon);
  }
  return icon;
}

const menuItems = computed<MenuItem[]>(() => {
  const items: MenuItem[] = [
    {
      id: "personal",
      label: "Personal",
      icon: monogramIcon(null, null),
      checked: context.value.kind === "personal",
      group: "Workspaces",
      onSelect: () => {
        if (context.value.kind !== "personal") void go("/");
      },
    },
    ...orgs.value.map<MenuItem>((o) => ({
      id: `org-${o.id}`,
      label: o.name,
      description: o.myRole ?? undefined,
      icon: monogramIcon(o.name, o.color),
      checked: isCurrent(o),
      group: "Workspaces",
      onSelect: () => {
        if (!isCurrent(o)) void go(orgPagePath(o.id));
      },
    })),
  ];
  if (invitationCount.value > 0) {
    items.push({ id: "invitations", label: `Invitations (${invitationCount.value})`, icon: Mail, onSelect: () => void go("/orgs") });
  }
  items.push({ id: "orgs", label: orgsLabel.value, icon: Plus, onSelect: () => void go("/orgs") });
  return items;
});
</script>

<template>
  <!-- ===== Phone More sheet: a plain list ===== -->
  <ul v-if="variant === 'sheet'" role="list" class="ws-list">
    <li>
      <button
        type="button"
        class="ws-item"
        :aria-current="context.kind === 'personal' ? 'true' : undefined"
        @click="context.kind === 'personal' ? emit('navigate') : go('/')"
      >
        <OrgMonogram />
        <span class="ws-item__text"><span class="ws-item__name">Personal</span></span>
        <Check v-if="context.kind === 'personal'" :size="16" class="ws-item__check" aria-hidden="true" />
      </button>
    </li>
    <li v-for="o in orgs" :key="o.id">
      <button
        type="button"
        class="ws-item"
        :aria-current="isCurrent(o) ? 'true' : undefined"
        @click="isCurrent(o) ? emit('navigate') : go(orgPagePath(o.id))"
      >
        <OrgMonogram :name="o.name" :color="o.color" />
        <span class="ws-item__text">
          <span class="ws-item__name">{{ o.name }}</span>
          <span v-if="o.myRole" class="ws-item__role">{{ o.myRole }}</span>
        </span>
        <Check v-if="isCurrent(o)" :size="16" class="ws-item__check" aria-hidden="true" />
      </button>
    </li>
    <li v-if="invitationCount > 0">
      <button type="button" class="ws-item" @click="go('/orgs')">
        <span class="ws-item__icon" aria-hidden="true"><Mail :size="16" /></span>
        <span class="ws-item__text"><span class="ws-item__name">Invitations ({{ invitationCount }})</span></span>
      </button>
    </li>
    <li>
      <button type="button" class="ws-item" @click="go('/orgs')">
        <span class="ws-item__icon" aria-hidden="true"><Plus :size="16" /></span>
        <span class="ws-item__text"><span class="ws-item__name">{{ orgsLabel }}</span></span>
      </button>
    </li>
  </ul>

  <!-- ===== Sidebar / rail: a menu ===== -->
  <UiMenu v-else v-model:open="open" :items="menuItems" placement="bottom-start">
    <template #trigger="{ toggle, triggerProps }">
      <button
        v-if="variant === 'expanded'"
        type="button"
        class="switcher"
        v-bind="triggerProps"
        :aria-label="triggerLabel"
        :aria-keyshortcuts="shortcut ? 'O' : undefined"
        @click="toggle"
      >
        <OrgMonogram :name="context.kind === 'org' ? currentName : null" :color="org?.color ?? null" />
        <span class="switcher__text">
          <span class="switcher__name">{{ currentName }}</span>
          <span class="switcher__role">{{ secondaryText }}</span>
        </span>
        <span v-if="invitationCount > 0" class="switcher__count tabular" aria-hidden="true">{{ invitationCount }}</span>
        <ChevronsUpDown :size="16" class="switcher__chevrons" aria-hidden="true" />
      </button>
      <UiIconButton
        v-else
        v-bind="triggerProps"
        :label="triggerLabel"
        :shortcut="shortcut"
        size="lg"
        tooltip-placement="right"
        @click="toggle"
      >
        <span class="rail-switcher">
          <OrgMonogram :name="context.kind === 'org' ? currentName : null" :color="org?.color ?? null" />
          <span v-if="invitationCount > 0" class="rail-switcher__dot" aria-hidden="true" />
        </span>
      </UiIconButton>
    </template>
  </UiMenu>
</template>

<style scoped>
/* ---------- expanded trigger ---------- */
.switcher {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: var(--space-2-5);
  width: 100%;
  min-height: 44px;
  padding: var(--space-1-5) var(--space-2);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  background-color: var(--bg-surface);
  color: var(--text-primary);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-standard), border-color var(--dur-fast) var(--ease-standard);
}
.switcher:hover {
  background-color: var(--bg-subtle);
  border-color: var(--border-strong);
}
.switcher[aria-expanded="true"] {
  border-color: var(--border-strong);
  background-color: var(--bg-subtle);
}
.switcher__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.switcher__name {
  overflow: hidden;
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-semibold);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.switcher__role {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.switcher__role:empty {
  display: none;
}
.switcher__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 var(--space-1-5);
  border-radius: var(--radius-full);
  background-color: var(--accent);
  color: var(--text-on-accent);
  font-size: var(--fs-11);
  line-height: var(--lh-11);
  font-weight: var(--fw-semibold);
}
.switcher__chevrons {
  flex-shrink: 0;
  color: var(--text-tertiary);
}

/* ---------- rail trigger ---------- */
.rail-switcher {
  position: relative;
  display: inline-flex;
}
.rail-switcher__dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--bg-sidebar);
  border-radius: var(--radius-full);
  background-color: var(--accent);
}

/* ---------- More sheet list ---------- */
.ws-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ws-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 48px;
  padding: var(--space-1-5) var(--space-2);
  border-radius: var(--radius-md);
  color: var(--text-primary);
  text-align: left;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.ws-item:hover,
.ws-item:active {
  background-color: var(--bg-subtle);
}
.ws-item[aria-current="true"] {
  background-color: var(--bg-muted);
}
.ws-item__icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  color: var(--text-tertiary);
}
.ws-item__text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
}
.ws-item__name {
  overflow: hidden;
  font-size: var(--fs-15);
  line-height: var(--lh-15);
  font-weight: var(--fw-medium);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ws-item__role {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.ws-item__check {
  flex-shrink: 0;
  color: var(--accent-text);
}
</style>
