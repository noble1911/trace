# Code style

## Formatting (enforced by Biome — `biome.json`)

- 2-space indent, 100-char line width, LF endings.
- Double quotes in TS/TSX, semicolons, trailing commas (ES5).
- Run `npx @biomejs/biome check --write src` before considering work done.

## Naming

- `camelCase` variables/functions, `PascalCase` React components and types.
- File names: `kebab-case` by default; `PascalCase.tsx` for component files; `useThing.ts` for hooks.
- Booleans read as predicates: `isConnected`, `hasActiveSprint`, `canTransition`.

## TypeScript

- **Strict mode on. No `any`** — use `unknown` and narrow. No non-null `!` unless provably safe with a comment.
- **Named exports only.** No default exports (keeps refactors and grep honest).
- `interface` for object shapes, `type` for unions/intersections. Export types next to their implementation.
- Validate data crossing the IPC boundary; don't trust a cast to make untyped JSON safe.

## React

- Function components only. **No `React.FC`** — type props directly: `function Card({ id }: CardProps)`.
- No `forwardRef` (React 19 forwards refs as normal props).
- Keep components presentational where possible; push data-fetching/lifecycle into hooks and stores.
- One component per file (small helper subcomponents in the same file are fine if the file stays under the cap).

## CSS / design tokens

- All colors, radii, fonts come from `src/styles/tokens.css` (ported from the design's `--c-*` oklch tokens).
  **Never hardcode a hex/oklch value in a component.**
- Use the design's existing class names and structure for pixel fidelity; add new classes in the relevant
  domain's stylesheet, not inline `style={{...}}` (except genuinely dynamic values like a progress width).

## Rust

- `rustfmt` defaults. `Result<T, String>` at the command boundary; richer errors (`thiserror`) inside modules.
- No `unwrap()`/`expect()` on fallible runtime paths — propagate with `?` and map at the edge.
- Doc-comment (`///`) every public fn/struct with the *why*, matching the style already in `claude/pty.rs`.
