// src/components/ui/index.ts — barrel for the design-system primitives.
// Usage: import { UiButton, UiDialog, type MenuItem } from "@/components/ui";

export { default as AppLogo } from "./AppLogo.vue";
export { default as UiBadge } from "./UiBadge.vue";
export { default as UiButton } from "./UiButton.vue";
export { default as UiCard } from "./UiCard.vue";
export { default as UiDialog } from "./UiDialog.vue";
export { default as UiEmptyState } from "./UiEmptyState.vue";
export { default as UiErrorState } from "./UiErrorState.vue";
export { default as UiIconButton } from "./UiIconButton.vue";
export { default as UiInput } from "./UiInput.vue";
export { default as UiKbd } from "./UiKbd.vue";
export { default as UiLoadingBar } from "./UiLoadingBar.vue";
export { default as UiMenu } from "./UiMenu.vue";
export { default as UiPageHeader } from "./UiPageHeader.vue";
export { default as UiPopover } from "./UiPopover.vue";
export { default as UiSegmentedControl } from "./UiSegmentedControl.vue";
export { default as UiSelect } from "./UiSelect.vue";
export { default as UiSkeleton } from "./UiSkeleton.vue";
export { default as UiSpinner } from "./UiSpinner.vue";
export { default as UiThemeToggle } from "./UiThemeToggle.vue";
export { default as UiTooltip } from "./UiTooltip.vue";

export {
  register as registerOverlay,
  unregister as unregisterOverlay,
  isTopmost,
  isInsideOverlayAbove,
  hasOpenOverlay,
  hasOpenModal,
  createOverlayId,
  type OverlayOptions,
} from "./dialogStack";

export { computeFloatingPosition, useFloating, type FloatingPosition } from "./floating";

export type {
  AnchorRect,
  ButtonVariant,
  ConfirmTone,
  ControlSize,
  FloatingPlacement,
  IconButtonVariant,
  LinkTarget,
  MenuItem,
  OptionValue,
  OverlayCloseReason,
  SegmentOption,
  SelectOption,
  ToastAction,
  Tone,
} from "./types";
