# Replit import notes

Source: Replit app **BUHAY.OS** — https://replit.com/@porscharyder/BUHAYOS
Imported: 2026-10-25, text files only, via the Replit file-reading connector.

The connector can only read text files up to ~100 KB, so the files below were
**not** imported and must be copied over manually (e.g. Replit → ⋮ → Download as zip).

## Missing — needed to build/run

| File | Used by |
| --- | --- |
| `attached_assets/buhay-os-lockup-cropped.png` | `artifacts/life-planner/src/App.tsx` (`@assets/...`) |
| `artifacts/buhay-os-mobile/assets/images/icon.png` | `app.json` |
| `artifacts/buhay-os-mobile/assets/images/wordmark.png` | `components/ui.tsx`, `app/(auth)/sign-in.tsx` |
| `artifacts/buhay-os-mobile/assets/images/orb.png` | mobile app assets |
| `artifacts/buhay-os-daybook-film/public/images/buhay-lockup.png` | daybook film |
| `artifacts/buhay-os-daybook-film/public/images/buhay-orb.png` | daybook film |
| `artifacts/buhay-os-daybook-film/public/images/buhay-wordmark.png` | daybook film |
| `artifacts/buhay-os-daybook-film/public/audio/bg_music.mp3` | daybook film |

## Missing — reference material

- `attached_assets/6A9C4676-6CE2-48C8-B674-1CE1C3D49DEA_1791788451738.png`
- `attached_assets/713AD78C-15BD-4E22-B2C2-47B40C528A1F_1791788451738.png`
- `attached_assets/DB1D86D8-6784-4F6A-B04A-F253DE54F0F6_1791788451738.png`
- `attached_assets/Untitled_design_-_4_1791790561660.png`
- `attached_assets/Untitled_design_-_5_1791790561660.png`
- `attached_assets/Untitled_design_-_6_1791790561659.png`
- `attached_assets/buhayos_release1_1791810358953.docx`

## Local changes after import

- `pnpm-lock.yaml` was too large to import, so it was regenerated locally with
  `pnpm install` (pnpm 11). Resolved versions may differ from the Replit lockfile.
- `pnpm-workspace.yaml`: the win32-x64 native packages (esbuild, rollup,
  lightningcss, tailwind oxide, ngrok) are no longer stripped by `overrides`,
  and an `allowBuilds` block was added because pnpm 11 ignores
  `onlyBuiltDependencies`.
- `artifacts/buhay-os-daybook-film/tsconfig.json`: added the DOM `lib`, as in
  `life-planner`. Without it, `pnpm run typecheck` failed (on Replit too).

## Intentionally skipped

Build output and gitignored files: `*.tsbuildinfo`, `.expo/`, `node_modules/`,
`artifacts/life-planner/test-results/`, `artifacts/buhay-os-mobile/expo-env.d.ts`,
and the empty `artifacts/buhay-os-mobile/static-build/` directories.

## Fidelity caveat

The connector returns plain text, so trailing whitespace and final newlines may
differ slightly from the originals. Generated code can be rebuilt with
`pnpm --filter @workspace/api-spec run codegen`.
