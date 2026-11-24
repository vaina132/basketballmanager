# Licensing (paid version)

Owner decision, 24 November 2026: build the infrastructure for the paid version now, but keep it **off**. The owner is play-testing, so the game stays fully playable without a licence key. The Gumroad check comes later, when the owner says it is time to sell.

Sales model: the first half of the first season is free. To continue, the player needs a licence (sold through Gumroad).

This page is about the game's own licence keys. Rights to photos, names and logos are a separate topic (HANDOVER.md, "Licensing before selling the game").

## What exists

All code is in `src/licensing/`; tests are in `tests/licensing.test.tsx`.

| Part | File | What it does |
| --- | --- | --- |
| Switch | `config.ts` | `LICENSING_ENABLED`, read from the build setting `VITE_LICENSING_ENABLED`. Off unless it is exactly `true`. `LICENSING_BUY_URL` comes from `VITE_LICENSING_BUY_URL` (https only; empty means no Buy link). |
| Free-play rule | `free-limit.ts` | `freePlayLimit(state)` and `isPastFreeLimit(state)`; see "The free part" below. |
| Licence in the browser | `entitlement.ts` | `Entitlement` is either `unlicensed` or `licensed` with key, product id and verified-at time. Kept in the browser's `localStorage` under `courtside.licence`, wrapped in try/catch. Never stored in a save file. |
| Key checker | `verifier.ts` | The `LicenceVerifier` interface and `notConfiguredVerifier`, a stub that answers "not configured" for every key and makes no network call. |
| Gate | `gate.ts` | `canAdvance(state, entitlement)`: the one check before the career moves on. Always allows while the switch is off. With the switch on, a career past the free part needs a licence. |
| Unlock screen | `src/ui/UnlockGame.tsx` | "Unlock the full game": licence key field, a Buy link (only when a shop URL is set; otherwise "Licences are not on sale yet."), a Save button and the message that the career is kept and continues from the same day after unlocking. |

Wiring in `src/App.tsx`: Continue (the button, the Space key and the season-end choice all go through `continueCareer`) asks `canAdvance` before it starts, and again after every day of a run, so a run stops on the day the free part ends. The unlock screen opens only when `LICENSING_ENABLED` is true and the gate refuses; it is loaded on demand. Saving, loading, the main menu and every page stay usable at all times.

### The free part

Every career starts in season 1. The halfway point is counted in games, not dates, so it works for every calendar:

- A manager with a club: when half of his club's domestic regular-season games (rounded up) have a result. Examples: 17 of 34 in an 18-club European league, 41 of 82 in the NBA.
- A manager without a club: when half of all domestic regular-season games in the world (rounded up) have a result.
- Play-in, playoffs and European games are not counted.
- Once the first season has ended (its end, the offseason and every later season), the free part is over.

In multi-league worlds each manager is measured by his own club's games, so the league's length does not matter. If he moves club or loses his job during season 1, the count follows his new situation from then on.

## How to switch it on

1. Set the environment variable `VITE_LICENSING_ENABLED` to `true` for the build (Vercel: Project, Settings, Environment Variables), and `VITE_LICENSING_BUY_URL` to the Gumroad product page.
2. Redeploy. The setting is read at build time, so a change needs a new build.
3. Do this only after the Gumroad verifier below exists. Until then the stub refuses every key, so players past the free part could not continue.

To switch it off again, remove the variable (or set anything other than `true`) and redeploy. Nothing in saves changes either way.

## What is needed for Gumroad

Owner tasks:

1. Create the product on Gumroad and set its price.
2. Turn on "Generate a unique license key per sale" for the product.
3. Give the developer the product id (shown on the product's page once licence keys are on). It is not a secret.
4. Decide the re-check and refund policy (below) and the wording of the Buy page.

Developer tasks:

1. **Server verification function.** A small Vercel serverless function (for example `api/licence.ts`) that receives the key and calls Gumroad's licence verify API (`POST https://api.gumroad.com/v2/licenses/verify` with `product_id` and `license_key`; pass `increment_uses_count=false` on re-checks). It answers only "licensed / invalid / unavailable", and treats refunded, disputed or chargebacked purchases as invalid. The browser calls our function, never Gumroad directly. The existing Supabase edge functions are an alternative host. No secret is needed for the verify call; keep any future secrets in the host's settings, never in this public repository.
2. **Browser verifier.** A `LicenceVerifier` that calls that function and returns a `licensed` entitlement with key, product id and the time of the check. Swap it in for `notConfiguredVerifier` in `App.tsx`.
3. **Re-check policy.** Suggested: check again in the background when the game opens, at most once every 30 days; a refunded or disputed key then returns to "unlicensed".
4. **Offline grace.** If a re-check cannot reach the server, keep the licence (the game must work offline); only a definite "invalid" answer removes it.
5. **Abuse limits.** Optionally use Gumroad's `uses` count to notice a key shared widely, and rate-limit the server function.
6. Tests for the verifier (mocked network), then a short manual check on a preview deployment before the switch goes on in production.

## Limitations and risks

- **The check lives in the browser.** The game runs entirely in the browser, so a determined player can change the stored licence or the code. This keeps honest players honest; it is not copy protection. The server check makes faking a key harder, not impossible.
- **Per browser.** The licence is stored per browser and device. A new browser, a private window or cleared site data asks for the key again (the key itself stays valid).
- **Blocked storage.** If the browser blocks storage, an accepted licence lasts only for that visit.
- **Saves stay shareable.** The licence is never in a save, so a shared save does not carry an unlock, and editing a save cannot unlock the game. A save from a licensed player loaded by someone else is blocked past the free part, as intended.
- **Mid-season moves.** A manager who loses his job during season 1 is measured on the world's games from then on, which can be a little earlier or later than his club's halfway point.
- **The next game may already be set up.** When the free part ends, the next game can already be open on the match screen. It can be watched, but its result is only recorded by Continue, which stays locked.
- **Gumroad dependency.** Gumroad's fees, API changes or outages affect sales and new unlocks; offline grace protects existing players.
- **Rights.** Selling needs the image, name and logo rights settled first (HANDOVER.md, "Licensing before selling the game").
