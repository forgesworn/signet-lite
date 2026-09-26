# My Signet Lite

A web-based **Nostr remote signer** (NIP-46). My Signet Lite holds your key and signs on behalf of
other Nostr apps over a relay, so your `nsec` never touches the apps you use. It's a
cross-platform PWA — install it to the home screen on iOS, Android, or desktop — and a lighter
sibling of [My Signet](https://mysignet.app).

## What it does

- **NIP-46 remote signer.** Apps connect via a `bunker://` link you create, or by pasting a
  `nostrconnect://` link they generate. Signet Lite signs their requests over a relay.
- **Multiple identities** from one seed. Identities are derived from a single BIP-39 mnemonic by
  name (via `nsec-tree`), so adding one needs no new backup.
- **Granular per-app permissions.** Each app has `sign` / `dm` / `profile` policies, plus
  **per-kind overrides** — "always allow" a kind-1 note without trusting every future kind.
- **Activity log.** An on-device record of what each app has signed (metadata only — never the
  content, plaintext, or who you message), with auto-approval and rate-limit badges.
- **Rate limiting.** A trusted app that exceeds its auto-sign budget is bumped to a prompt
  (never hard-blocked) so a runaway or compromised app gets noticed.
- **Encrypted at rest.** A random master key wraps the seed. On supported devices, quick unlock
  wraps that master key with both the 6-digit PIN and a WebAuthn-PRF device secret, so an offline
  browser database copy cannot be tested against the PIN alone. Legacy/basic PIN-only unlock still
  works for compatibility, with online attempts throttled. The session auto-locks on idle/hide and
  drops live signer state on lock.
- **Modern crypto only.** NIP-44 for encryption; NIP-04 is **decrypt-only** (read legacy kind-4 DMs), and Lite never
  *creates* NIP-04 ciphertext (`nip04_encrypt` is excluded). NIP-49
  (`ncryptsec`) import resolves to the key without ever displaying it.

## Quick start

```sh
npm install
npm run dev        # Vite dev server
```

| Script | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck (`tsc --noEmit`) and build for production |
| `npm test` | Run the unit/component suite (Vitest) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Run the Playwright end-to-end suite |

## Deployment

Production is **[lite.mysignet.app](https://lite.mysignet.app)**, a static deploy next to its
sibling `mysignet.app`. There is no backend. The build emits a fully static PWA bundle to
`dist/`.

On every push to `main`, the [deploy workflow](.github/workflows/deploy.yml) runs the unit,
component and end-to-end suites, builds, and syncs `dist/` to the static host. The
[compatibility workflows](.github/workflows/compatibility.yml) run NIP-46 compatibility checks
against the lockfile dependencies and the latest client packages.

To verify locally before pushing:

```sh
npm ci
npm test
npm run test:e2e
npm run build
```

## Layout

```
src/engine/   Portable protocol layer — Signer, NIP-46, relay, key derivation, crypto. No UI/DB.
src/app/      Browser glue — IndexedDB store, session lifecycle, auth (PIN/biometric), auto-lock.
src/ui/       React UI — onboarding, unlock, connect/approve, settings, profile.
e2e/          Playwright specs driving a real nostr-tools client against an in-process relay.
```

The `engine` layer is deliberately framework- and storage-free, so the protocol is testable in
isolation and the app/UI layers wire it to IndexedDB and React.

## Security model

- Your key never leaves the device unencrypted. The decrypted key lives only in memory during an
  unlocked session; locking stops relay traffic and drops the live signer state immediately.
- Remote apps only ever receive signatures/encryptions, never the key.
- The signer is idempotent per request, so a relay re-delivering a request can't cause a double
  sign.
- Existing PIN-only installs keep working and can upgrade in Settings to PIN + WebAuthn PRF without
  creating a new identity or changing their recovery phrase.

## Contributing & security

Issues and pull requests are welcome. Please report security vulnerabilities privately. See
[SECURITY.md](SECURITY.md).

## Licence

[MIT](LICENSE) © ForgeSworn
