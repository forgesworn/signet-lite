# Security Policy

## Reporting a vulnerability

My Signet Lite holds Nostr signing keys, so we take reports seriously. Please report
vulnerabilities privately, and do not open a public issue.

**Email:** security@forgesworn.dev

Please include:

- a description of the vulnerability and its impact
- steps to reproduce
- the affected version (see `package.json`) or deployed build
- a suggested fix, if you have one

We will acknowledge receipt within 48 hours and aim to ship a fix within 7 days of confirmation.

## Scope

Security-relevant issues include:

- key material (mnemonic, nsec, derived keys, master key) leaving the device, reaching logs, or
  persisting in memory after lock
- bypassing the PIN / WebAuthn unlock, or the PIN attempt throttle
- a NIP-46 client obtaining a signature, encryption or decryption the user did not approve, or
  one outside its granted per-app / per-kind policy
- cross-site scripting, CSP bypass, or service-worker cache poisoning
- anything that lets one connected app act as, or read data belonging to, another

## Supported versions

Only the latest deployed build at [lite.mysignet.app](https://lite.mysignet.app) is supported.

## Disclosure

We follow coordinated disclosure and will credit reporters who want it.
