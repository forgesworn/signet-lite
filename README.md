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
git clone https://github.com/forgesworn/signet-lite.git && cd signet-lite
npm install
npm run dev        # Vite dev server
```

Signet Lite is an application, not a library: clone the repository rather than running
`npm install signet-lite`. See [Layout](#layout) for what that means for `package.json`.

| Script | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck (`tsc --noEmit`) and build for production |
| `npm test` | Run the unit/component suite (Vitest) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Run the Playwright end-to-end suite |
| `npm run test:compat` | Run the NIP-46 conformance and Signet Login compatibility specs only |

## Supported NIP-46 methods

The list lives in `SUPPORTED_METHODS` in `src/engine/nip46.ts`. Requests from a client that has not
connected are dropped without a reply, apart from a `connect` that carries a live bunker secret.

| Method | Result | Approval |
|---|---|---|
| `connect` | `ack` | none |
| `get_public_key` | the identity's public key (hex) | none |
| `ping` | `pong` | none |
| `switch_relays` | JSON `null` (a no-op, since relays are user-managed) | none |
| `sign_event` | the signed event, as JSON | approval hook |
| `nip44_encrypt` | NIP-44 ciphertext | approval hook |
| `nip44_decrypt` | plaintext | approval hook |
| `nip04_decrypt` | plaintext (legacy kind-4 DMs, decrypt only) | approval hook |

"Approval hook" means the request goes through the app's per-app policy, which either prompts you
or auto-approves under an "always" rule. With no hook configured the signer denies the request.

Anything else, including `nip04_encrypt` and `logout`, is answered with the error
`unsupported method`.

In the `nostrconnect://` flow Lite echoes the client's secret in the `connect` response. In the
`bunker://` flow the response is a plain `ack`.

## Connecting a client

In Signet Lite choose **Connect an app**, then **Create a link for an app**, then **Create link**.
Lite shows a `bunker://<pubkey>?relay=...&secret=...` URI. The secret is single-use and expires
after 5 minutes. Pass the URI to a NIP-46 client such as the `BunkerSigner` in `nostr-tools`
(adapted from `e2e/bunker-full.spec.ts`):

```ts
import { parseBunkerInput, BunkerSigner } from 'nostr-tools/nip46'
import { generateSecretKey } from 'nostr-tools/pure'

const pointer = await parseBunkerInput(bunkerUri) // the bunker:// link from Lite
if (!pointer) throw new Error('not a valid bunker link')

const signer = BunkerSigner.fromBunker(generateSecretKey(), pointer)
await signer.connect() // Lite authorises the secret without a prompt

// Bunker-link connections ask by default, so approve this in Lite.
const event = await signer.signEvent({
  kind: 1,
  created_at: Math.floor(Date.now() / 1000),
  tags: [],
  content: 'hello from a real app',
})
// event.pubkey is the identity's public key

await signer.close()
```

In Node, install a WebSocket implementation first, as the e2e specs do:
`useWebSocketImplementation(WebSocket)` from `nostr-tools/pool`, with `WebSocket` from `ws`.

For the opposite direction, where the client creates a `nostrconnect://` link and you paste it into
Lite, see `e2e/nostrconnect-full.spec.ts`.

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

### Not a library

`package.json` has no library build and no publish workflow. Its `main`, `types` and `exports`
fields point at `src/index.ts`, an unbuilt TypeScript barrel for in-repo use, so installing the
package as a dependency would give you raw source rather than a compiled API. The only build
output is the PWA in `dist/`. `src/index.ts` re-exports these engine pieces:

- `generateMnemonic`, `deriveIdentity`
- `Signer` and the `ApprovalRequest` type
- `SignerRelay`, `createSimplePool` and the `RelayPool` type
- `encryptSecret`, `decryptSecret`, `isEncrypted`, `encryptWithKey`, `decryptWithKey`

It also exports a `version` constant (`'0.1.0'`) that does not track `package.json`.

To reuse the protocol layer, copy from `src/engine/` or vendor the repository.

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
