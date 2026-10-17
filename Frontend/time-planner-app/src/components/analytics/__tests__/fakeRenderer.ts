/**
 * Test-only: a tiny in-memory renderer for Vue components (the test environment is node, with no
 * DOM library). Elements keep their props (incl. event handlers), so a test can find a button
 * and "click" it by calling its handler, then read the re-rendered tree.
 */
import { createRenderer, nextTick, type Component } from "vue";

export interface FakeNode {
  type: "element" | "text" | "comment";
  tag: string;
  text: string;
  props: Record<string, unknown>;
  children: FakeNode[];
  parent: FakeNode | null;
}

function node(type: FakeNode["type"], tag = "", text = ""): FakeNode {
  return { type, tag, text, props: {}, children: [], parent: null };
}

function detach(child: FakeNode): void {
  const parent = child.parent;
  if (!parent) return;
  const index = parent.children.indexOf(child);
  if (index !== -1) parent.children.splice(index, 1);
  child.parent = null;
}

const { createApp } = createRenderer<FakeNode, FakeNode>({
  createElement: (tag) => node("element", tag),
  createText: (text) => node("text", "", text),
  createComment: (text) => node("comment", "", text),
  setText: (n, text) => {
    n.text = text;
  },
  setElementText: (el, text) => {
    for (const child of [...el.children]) detach(child);
    if (text) {
      const t = node("text", "", text);
      t.parent = el;
      el.children.push(t);
    }
  },
  insert: (child, parent, anchor) => {
    detach(child);
    child.parent = parent;
    const index = anchor ? parent.children.indexOf(anchor) : -1;
    if (index === -1) parent.children.push(child);
    else parent.children.splice(index, 0, child);
  },
  remove: detach,
  parentNode: (n) => n.parent,
  nextSibling: (n) => {
    const siblings = n.parent?.children ?? [];
    return siblings[siblings.indexOf(n) + 1] ?? null;
  },
  patchProp: (el, key, _prev, next) => {
    el.props[key] = next;
  },
});

/** Mount `component` with `props`; returns the root container. */
export function mountFake(component: Component, props: Record<string, unknown> = {}, plugins: unknown[] = []) {
  const container = node("element", "root");
  const app = createApp(component, props);
  for (const plugin of plugins) app.use(plugin as never);
  app.mount(container);
  return { container, app, unmount: () => app.unmount() };
}

/** Text of a subtree; element boundaries count as spaces, whitespace is collapsed. */
export function textOf(n: FakeNode): string {
  if (n.type === "text") return n.text;
  if (n.type === "comment") return "";
  return n.children.map(textOf).join(" ").replace(/\s+/g, " ").trim();
}

function classes(n: FakeNode): string[] {
  const value = n.props.class;
  if (typeof value === "string") return value.split(/\s+/).filter(Boolean);
  return [];
}

export function hasClass(n: FakeNode, name: string): boolean {
  return classes(n).includes(name);
}

/** Every element below `root` matching `predicate`, in document order. */
export function findAll(root: FakeNode, predicate: (n: FakeNode) => boolean): FakeNode[] {
  const out: FakeNode[] = [];
  const walk = (n: FakeNode) => {
    for (const child of n.children) {
      if (child.type === "element" && predicate(child)) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

export const byClass = (name: string) => (n: FakeNode) => hasClass(n, name);
export const byTag = (tag: string) => (n: FakeNode) => n.tag === tag;

/**
 * Dispatch a bubbling event: the handlers (`onClick`, `onInput`, …) of `n` and its ancestors run
 * with a minimal event (`target` = `n`) until one stops propagation; then renders are flushed.
 */
export async function fire(n: FakeNode, event: string, init: Record<string, unknown> = {}): Promise<void> {
  const key = `on${event.charAt(0).toUpperCase()}${event.slice(1)}`;
  let stopped = false;
  let handled = false;
  const evt = {
    type: event,
    target: n,
    currentTarget: n as FakeNode | null,
    defaultPrevented: false,
    preventDefault() {
      evt.defaultPrevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
    ...init,
  };
  for (let cur: FakeNode | null = n; cur && !stopped; cur = cur.parent) {
    const handler = cur.props[key];
    if (typeof handler !== "function") continue;
    handled = true;
    evt.currentTarget = cur;
    handler(evt);
  }
  if (!handled) throw new Error(`no ${event} handler on <${n.tag}> or its ancestors`);
  await nextTick();
  await nextTick();
}

/** The closest ancestor (or self) matching `predicate`. */
export function closest(n: FakeNode | null, predicate: (n: FakeNode) => boolean): FakeNode | null {
  for (let cur = n; cur; cur = cur.parent) if (cur.type === "element" && predicate(cur)) return cur;
  return null;
}
