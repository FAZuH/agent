/**
 * The host resolves these for plugins, so nothing is vendored and nothing is
 * installed: a plugin that renders a slot claim imports them and gets the
 * host's own copies.
 */
declare module "@opentui/core" {
  export class BoxRenderable {
    constructor(renderer: unknown, options?: Record<string, unknown>)
    add(child: unknown): void
    destroyRecursively(): void
    [key: string]: any
  }
  export class ScrollBoxRenderable extends BoxRenderable {}
  export class TextRenderable extends BoxRenderable {}
  export function isEditBufferRenderable(node: unknown): boolean
}

declare module "solid-js" {
  export function createSignal<T>(value: T): [() => T, (value: T) => void]
  export function createEffect(fn: () => void): void
  export function onMount(fn: () => void): void
  export function onCleanup(fn: () => void): void
}
