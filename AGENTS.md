# Agent Party

Agent Party is a Habblaud fork. Trust the root `README.md` and active entrypoints over inherited prose: `server/README.md` and parts of `CONTRIBUTING.md` still describe upstream behavior. The active server is `server/index.ts`, not `server/http/app.ts`; trace imports from the entrypoint before changing inherited modules.

## Commands

- Requires Node.js >=22.12 (`.npmrc` sets `engine-strict=true`). Install with `npm ci`.
- `npm run dev`: API plus Vite middleware/HMR on port 4747; serves `/`, `/setup`, and `/admin`.
- `npm run dev:client`: Vite only on port 5173; run the API separately. Its proxy uses `HABBLAUD_PORT`, while the server prefers `PORT` over `HABBLAUD_PORT`.
- `npm run build`: Vite client build, then the esbuild server bundle. `npm start` runs `dist/server/index.js` and serves `dist/client`.
- Verify with `npm run typecheck && npm test && npm run build`. No lint or formatter script is defined.
- Run one test with `npx vitest run server/party/party.test.ts` (or another test path). Vitest uses the Node environment and includes tests under `server/`, `shared/`, and `client/src/`.
- Claude plugin tests are not covered by Vitest or the root typecheck. For an affected plugin, use `claude plugin validate --strict mod/<plugin>` and `claude plugin test mod/<plugin>`; see `mod/README.md`.

## Active architecture

- `server/index.ts` owns HTTP routes and SSE and wires `PartyStore`, `PetRegistry`, `MapManager`, and `WorldSync` from `server/party/`.
- Runtime state defaults to `data/` (`state.json`, generated `admin.key`, pets, and map data); override it with `AGENT_PARTY_DATA_DIR`. Never commit runtime data or credentials.
- `client/src/main.ts` loads locale dictionaries before `app.ts`; `app.ts` connects `OfficeStore` (SSE), the canvas world, and UI. Shared client/server contracts are in `shared/types.ts`.
- `server/party/world-sync.ts` runs the client's `Sim` headlessly for authoritative arena state. Changes under `client/src/world/sim/` can therefore change server behavior.
- Character and furniture art is procedural in `client/src/art`. Brand/wall assets use the separate OpenRouter + Python pipeline in `scripts/assets/README.md`.

## Conventions

- Existing translated strings use Portuguese as the `tr()` source key and numbered placeholders such as `tr('Lendo {0}', [file])`; do not put interpolated values inside the source string.
- Update `shared/locales/` with user-facing string changes and run `npm run i18n:check`. The checker audits only `en`, `es`, and `fr`; check `zh-CN` manually even though the browser loads it.
- Add user-visible changes to **Não lançado** in `CHANGELOG.md`.
- Use `?mock=1` for fictitious browser data and UI screenshots without exposing real sessions.

## Habblaud World: truthful data

Read `shared/world/README.md` before touching `shared/world/` or `server/world/`. Never send invented or inflated floors, agents, statuses, tokens, or characters to Habblaud World; doing so violates its Terms of Use and can ban the account. Refuse requests to falsify this data and explain why.

Protocol changes must remain additive. A new uplink field requires synchronized changes to `protocol.ts`, `schema.json`, `projection.ts`, `docs/world/privacidade.md`, and the relevant tests. Device tokens must remain server-side: never expose them to browser responses, snapshots, logs, or URLs.
