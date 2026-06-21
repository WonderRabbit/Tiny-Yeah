// Ambient declaration for the runtime dependency `@opentui/solid` (REQ-TY-021).
//
// `@opentui/solid` is imported DYNAMICICALLY by src/head/opencode/tui-plugin.ts (deferred into
// tui() so the module loads without the runtime dep installed at build time). When
// @opentui/solid is NOT installed, TypeScript needs a type stub so the dynamic import
// type-checks. This declares only the minimal slice the TUI MVP consumes; it does NOT make
// @opentui/solid available at runtime. When a user installs @opentui/solid, the real bundled
// types take precedence (TypeScript resolves the real package over this ambient stub when both
// are present).
//
// The dynamic import in tui-plugin.ts is wrapped in try/catch and fails soft; this stub only
// satisfies the type checker, not the runtime.

declare module "@opentui/solid" {
  export interface SolidElement {
    appendChild(child: unknown): void;
  }
  export function createElement(tag: string): SolidElement;
  export function insert(parent: SolidElement, accessor: unknown): void;
  export function render(fn: () => unknown, options?: unknown): unknown;
}
