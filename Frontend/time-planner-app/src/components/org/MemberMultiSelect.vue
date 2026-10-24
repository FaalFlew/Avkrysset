<script setup lang="ts">
/**
 * MemberMultiSelect — pick one or more organization members (assignees of an org task or a
 * promoted issue; used by 3C's editor and 3D's promote dialog).
 * A fieldset of checkboxes (keyboard: Tab between members, Space toggles), "you" first, then by
 * name; a search field appears for larger orgs. The parent owns validation (≥ 1 assignee) and
 * passes the message as `error`.
 * Props:
 *   modelValue: string[] — selected user ids (v-model)
 *   members: SelectableMember[] — active members (orgStore.selectableMembers)
 *   label?: string (default "Assignees")
 *   meId?: string | null — marks "(you)" and lists me first
 *   error?: string — shown under the list (role="alert"), sets aria-invalid on the group
 *   hint?: string
 *   disabled?: boolean
 *   loading?: boolean — members are still loading (skeleton rows)
 * Emits: update:modelValue(string[])
 */
import { computed, ref, useId } from "vue";
import { CircleAlert, Search } from "lucide-vue-next";
import UiInput from "@/components/ui/UiInput.vue";
import UiSkeleton from "@/components/ui/UiSkeleton.vue";
import type { SelectableMember } from "@/types/org";

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    members: SelectableMember[];
    label?: string;
    meId?: string | null;
    error?: string;
    hint?: string;
    disabled?: boolean;
    loading?: boolean;
  }>(),
  { label: "Assignees", meId: null, error: undefined, hint: undefined, disabled: false, loading: false },
);
const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

/** Above this many members a search field filters the list. */
const SEARCH_THRESHOLD = 7;

const uid = useId();
const hintId = `mms-hint-${uid}`;
const errorId = `mms-error-${uid}`;
const query = ref("");

const sameId = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const isMe = (m: SelectableMember) => sameId(m.userId, props.meId);
const nameOf = (m: SelectableMember) => m.displayName || m.userEmail;

const sorted = computed(() =>
  [...props.members].sort((a, b) => {
    if (isMe(a) !== isMe(b)) return isMe(a) ? -1 : 1;
    return nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: "base" });
  })
);
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return sorted.value;
  return sorted.value.filter((m) => nameOf(m).toLowerCase().includes(q) || m.userEmail.toLowerCase().includes(q));
});
const selected = computed(() => new Set(props.modelValue.map((id) => id.toLowerCase())));
const isSelected = (m: SelectableMember) => selected.value.has(m.userId.toLowerCase());
const summary = computed(() => {
  const count = props.members.filter(isSelected).length;
  return count === 0 ? "None selected" : `${count} selected`;
});
const describedBy = computed(() => [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(" ") || undefined);

function toggle(member: SelectableMember, checked: boolean): void {
  const rest = props.modelValue.filter((id) => !sameId(id, member.userId));
  emit("update:modelValue", checked ? [...rest, member.userId] : rest);
}
</script>

<template>
  <fieldset
    class="mms"
    :class="{ 'has-error': !!error }"
    :disabled="disabled"
    :aria-describedby="describedBy"
    :aria-invalid="error ? 'true' : undefined"
  >
    <legend class="mms__legend">
      <span class="mms__label">{{ label }}</span>
      <span class="mms__summary tabular">{{ summary }}</span>
    </legend>

    <UiInput
      v-if="members.length > SEARCH_THRESHOLD"
      v-model="query"
      type="search"
      label="Find a member"
      hide-label
      placeholder="Find a member"
      autocomplete="off"
      class="mms__search"
    >
      <template #leading><Search :size="16" /></template>
    </UiInput>

    <div v-if="loading" class="mms__list" aria-busy="true">
      <span class="sr-only" role="status">Loading members…</span>
      <div v-for="n in 3" :key="n" class="mms__option">
        <UiSkeleton :width="18" :height="18" radius="var(--radius-xs)" />
        <UiSkeleton width="50%" :height="12" />
      </div>
    </div>
    <ul v-else role="list" class="mms__list">
      <li v-for="member in filtered" :key="member.userId">
        <label class="mms__option" :class="{ 'is-selected': isSelected(member) }">
          <input
            type="checkbox"
            class="mms__checkbox"
            :checked="isSelected(member)"
            :disabled="disabled"
            @change="toggle(member, ($event.target as HTMLInputElement).checked)"
          />
          <span class="mms__text">
            <span class="mms__name">{{ nameOf(member) }}<span v-if="isMe(member)" class="mms__you"> (you)</span></span>
            <span v-if="member.displayName && member.displayName !== member.userEmail" class="mms__email">{{ member.userEmail }}</span>
          </span>
        </label>
      </li>
      <li v-if="filtered.length === 0" class="mms__empty">
        {{ members.length === 0 ? "No members to choose from." : `No members match “${query.trim()}”.` }}
      </li>
    </ul>

    <p v-if="hint" :id="hintId" class="mms__hint">{{ hint }}</p>
    <p v-if="error" :id="errorId" class="mms__error" role="alert">
      <CircleAlert :size="14" aria-hidden="true" />
      <span>{{ error }}</span>
    </p>
  </fieldset>
</template>

<style scoped>
.mms {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.mms__legend {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
  margin-bottom: var(--space-1-5);
  padding: 0;
}
.mms__label {
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
}
.mms__summary {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.mms__list {
  display: flex;
  flex-direction: column;
  max-height: 240px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-1);
  border: 1px solid var(--border-input);
  border-radius: var(--radius-md);
  background-color: var(--bg-input);
}
.has-error .mms__list {
  border-color: var(--danger);
}
.mms__option {
  display: flex;
  align-items: center;
  gap: var(--space-2-5);
  min-height: 40px;
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color var(--dur-fast) var(--ease-standard);
}
.mms__option:hover {
  background-color: var(--bg-subtle);
}
.mms__option:focus-within {
  outline: 2px solid var(--focus-ring);
  outline-offset: -2px;
}
.mms__option.is-selected {
  background-color: var(--accent-subtle);
}
.mms__checkbox {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--accent);
  cursor: inherit;
}
.mms__checkbox:focus-visible {
  outline: none;
}
.mms__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.mms__name {
  overflow: hidden;
  font-size: var(--fs-14);
  line-height: var(--lh-14);
  color: var(--text-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mms__you {
  color: var(--text-tertiary);
}
.mms__email {
  overflow: hidden;
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mms__empty {
  padding: var(--space-3) var(--space-2);
  font-size: var(--fs-13);
  line-height: var(--lh-13);
  color: var(--text-tertiary);
}
.mms__hint {
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--text-tertiary);
}
.mms__error {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--fs-12);
  line-height: var(--lh-12);
  color: var(--danger-text);
}
fieldset:disabled .mms__option {
  cursor: not-allowed;
  opacity: 0.6;
}
@media (pointer: coarse) {
  .mms__option {
    min-height: 44px;
  }
}
</style>
