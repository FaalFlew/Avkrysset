// src/components/ui/types.ts — shared types for the UI primitives.

import type { Component } from "vue";

/** Optional action button on a toast (uiStore.showToast(..., { action })). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

/** Visual tone of a confirmation dialog: 'danger' renders a red confirm button. */
export type ConfirmTone = "default" | "danger";

/** Why an overlay closed: Esc key, pointer outside / scrim click, or a close button. */
export type OverlayCloseReason = "escape" | "outside" | "button";

export type OptionValue = string | number;

/** <UiSelect :options> item. */
export interface SelectOption<V extends OptionValue = OptionValue> {
  value: V;
  label: string;
  disabled?: boolean;
}

/** <UiSegmentedControl :options> item. `icon` is a lucide-vue-next component. */
export interface SegmentOption<V extends OptionValue = OptionValue> {
  value: V;
  label: string;
  icon?: Component;
  /** Accessible name when it should differ from `label` (e.g. icon-only controls). */
  ariaLabel?: string;
}

/** <UiMenu :items> item. */
export interface MenuItem {
  id: string;
  label: string;
  /** lucide-vue-next component, rendered at 16px. */
  icon?: Component;
  /** Destructive item (red text). */
  danger?: boolean;
  /** Shown as <UiKbd> on the right, e.g. ['Mod', 'Enter']. */
  shortcut?: string[];
  disabled?: boolean;
  onSelect: () => void;
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
export type IconButtonVariant = "ghost" | "secondary" | "primary" | "danger-ghost";
export type ControlSize = "sm" | "md" | "lg";
export type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

/** Anything with a client rect, e.g. a DOMRect from getBoundingClientRect(). */
export interface AnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export type FloatingPlacement =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

/** RouterLink target accepted by UiButton/UiIconButton `to` (a path or a named/path location). */
export type LinkTarget =
  | string
  | {
      name?: string;
      path?: string;
      params?: Record<string, string | number>;
      query?: Record<string, string | number | null | undefined>;
      hash?: string;
      replace?: boolean;
    };
