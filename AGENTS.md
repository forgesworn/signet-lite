# AGENTS.md

Guidance for coding agents working in this repository.

My Signet Lite is a web-based Nostr remote signer (NIP-46), shipped as a static React PWA. It is an
application, not a library: there is no library build, and `main`, `types` and `exports` in
`package.json` point at the unbuilt barrel `src/index.ts`. Do not treat the package as something to
import from npm. See `README.md` for features, the supported NIP-46 methods and a client example.

## Layout and layer rules

```
src/engine/   Portable protocol layer: Signer, NIP-46, relay, key derivation, crypto.
src/app/      Browser glue: IndexedDB store, session lifecycle, PIN/WebAuthn auth, auto-lock.
src/ui/       React UI: onboarding, unlock, connect/approve, settings, profile.
e2e/          Playwright specs: a real nostr-tools client against an in-process relay.
```

- `src/engine/` imports nothing from `src/app/` or `src/ui/`, and nothing from `react`, `idb` or the
  DOM and storage globals. Its external dependencies are `nostr-tools`, `nsec-tree` and
  `@scure/bip39`. Keep it that way so the protocol stays testable in isolation.
- `src/app/` may import `src/engine/`. It never imports `src/ui/`. It owns IndexedDB (`idb`),
  WebAuthn and the document and window hooks.
- `src/ui/` is React. It imports from both `src/engine/` and `src/app/`.
- Put protocol behaviour in `src/engine/`, persistence and browser APIs in `src/app/`, and
  presentation in `src/ui/`.

## Invariants

- **No NIP-04 encryption.** `nip04_encrypt` and `logout` are not in `SUPPORTED_METHODS`
  (`src/engine/nip46.ts`) and are answered with the error `unsupported method`. `nip04_decrypt` is
  supported, decrypt only, so legacy kind-4 DMs stay readable. Do not add NIP-04 encryption. Tests:
  `src/engine/signer.test.ts` and `src/engine/signer.signet-login-conformance.test.ts`. The header
  comment of the conformance spec says `nip04_decrypt` is omitted; the code and its assertions say
  it is supported.
- **Key-using methods are approval-gated.** `sign_event`, `nip44_encrypt`, `nip44_decrypt` and
  `nip04_decrypt` go through the approve hook (`METHODS_REQUIRING_APPROVAL` in
  `src/engine/signer.ts`). A new method that touches key material must be added there, to
  `SUPPORTED_METHODS`, and to the method table in `README.md`.
- **Keys never leave memory unprotected.** Decrypted keys live only in an unlocked session. Private
  key bytes are zeroed after use, `Signer.destroy()` clears live key material, and a lock settles
  any open approval prompt first. Never log, persist or display the mnemonic, an `nsec` or a derived
  key.
- **The activity log is metadata only.** `ActivityEvent` carries no content, plaintext or DM
  counterparty, and `errorCode` is a short fixed string.
- **Requests are handled once.** Stale or future-dated events are dropped
  (`isFreshNIP46Event`), and the `claim` hook in `handleRequestEvent` stops a replayed request being
  handled twice.
- **Bunker secrets are single-use.** `enableBunker` mints a secret that expires after 5 minutes,
  is compared in constant time and is deleted on first successful `connect`.
- **No `console.*` in production source.** `src/no-console.test.ts` fails on any call.
- **CSP is tested.** `src/csp.test.ts` checks the policy in `index.html` and `public/_headers`.
- NIP-44 for encryption. NIP-49 (`ncryptsec`) import resolves to the key without displaying it.

## Verify

Run these before committing:

```sh
npm ci
npm test               # Vitest unit and component suite
npm run test:e2e       # Playwright; needs `npx playwright install chromium` once
npm run build          # tsc --noEmit, then vite build
```

`npm run test:compat` runs only the NIP-46 conformance and Signet Login compatibility specs. The
Signet Login SDK spec runs its checks only when `SIGNET_LOGIN_COMPAT=1` is set. CI (Node 24) runs
the steps above in `.github/workflows/deploy.yml` and the compatibility workflows.

## Conventions

- TypeScript with `strict` on. Engine imports use the `.js` suffix (`'./nip46.js'`).
- Tests sit next to the code as `*.test.ts` and `*.test.tsx`. End-to-end specs live in `e2e/`.
- Security reports go to the address in `SECURITY.md`, not to a public issue.
