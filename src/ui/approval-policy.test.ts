import { describe, it, expect } from 'vitest'
import { resolveApproval, appRecordFromRequest, categoryOf, categoryForRequest } from './approval-policy.js'
import type { StoredApp } from '../app/db.js'

const app = (over: Partial<StoredApp>): StoredApp => ({ clientPubkey: 'c', identityName: 'd', appName: 'A', connectedAt: 0, ...over })

describe('approval-policy', () => {
  it('maps methods to their policy category', () => {
    expect(categoryOf('sign_event')).toBe('sign')
    expect(categoryOf('nip44_encrypt')).toBe('dm')
    expect(categoryOf('nip44_decrypt')).toBe('dm')
    expect(categoryOf('get_public_key')).toBeNull()
  })

  it('asks unless the relevant category is set to always', () => {
    // No app record → always ask.
    expect(resolveApproval(undefined, 'sign_event')).toBe('ask')
    // sign=always, dm=ask → signing auto-allows, DMs still prompt.
    const signOnly = app({ policies: { sign: 'always', dm: 'ask' } })
    expect(resolveApproval(signOnly, 'sign_event')).toBe('allow')
    expect(resolveApproval(signOnly, 'nip44_decrypt')).toBe('ask')
    // dm=always, sign=ask → the reverse.
    const dmOnly = app({ policies: { sign: 'ask', dm: 'always' } })
    expect(resolveApproval(dmOnly, 'nip44_encrypt')).toBe('allow')
    expect(resolveApproval(dmOnly, 'sign_event')).toBe('ask')
  })

  it('reads a legacy always-allow record as always for both categories', () => {
    const legacy = app({ policy: 'always-allow' })
    expect(resolveApproval(legacy, 'sign_event')).toBe('allow')
    expect(resolveApproval(legacy, 'nip44_encrypt')).toBe('allow')
  })

  it('builds an app record from an approval request with the given policies', () => {
    const rec = appRecordFromRequest(
      { identityName: 'magazine', clientPubkey: 'abcd1234ef', method: 'sign_event' },
      { sign: 'always', dm: 'ask' },
    )
    expect(rec).toMatchObject({ clientPubkey: 'abcd1234ef', identityName: 'magazine', policies: { sign: 'always', dm: 'ask' } })
    expect(rec.appName).toContain('abcd1234')
  })

  it('categoryForRequest maps a kind-0 sign_event to profile', () => {
    expect(categoryForRequest('sign_event', 0)).toBe('profile')
    expect(categoryForRequest('sign_event', 1)).toBe('sign')
    expect(categoryForRequest('nip44_encrypt')).toBe('dm')
    expect(categoryForRequest('get_public_key')).toBeNull()
  })

  it('declines profile (kind 0) writes by default, and respects ask/always', () => {
    // No profile set → default decline, even when signing is trusted.
    const trusted = app({ policies: { sign: 'always', dm: 'always' } })
    expect(resolveApproval(trusted, 'sign_event', 0)).toBe('decline')
    // A non-zero kind still uses the sign policy.
    expect(resolveApproval(trusted, 'sign_event', 1)).toBe('allow')
    // profile: ask → prompt.
    const askProfile = app({ policies: { sign: 'always', dm: 'always', profile: 'ask' } })
    expect(resolveApproval(askProfile, 'sign_event', 0)).toBe('ask')
    // profile: always → allow.
    const allowProfile = app({ policies: { sign: 'always', dm: 'always', profile: 'always' } })
    expect(resolveApproval(allowProfile, 'sign_event', 0)).toBe('allow')
    // Unknown app → kind-0 write declined.
    expect(resolveApproval(undefined, 'sign_event', 0)).toBe('decline')
  })

  it('a per-kind override wins over the blanket sign policy', () => {
    // sign: ask by default, but kind 1 is granted → that kind auto-allows, others still prompt.
    const grantOne = app({ policies: { sign: 'ask', dm: 'ask' }, kindPolicies: { '1': 'always' } })
    expect(resolveApproval(grantOne, 'sign_event', 1)).toBe('allow')
    expect(resolveApproval(grantOne, 'sign_event', 30023)).toBe('ask')

    // sign: always, but kind 5 (deletion) is withheld → that kind still prompts.
    const trustExceptDelete = app({ policies: { sign: 'always', dm: 'always' }, kindPolicies: { '5': 'ask' } })
    expect(resolveApproval(trustExceptDelete, 'sign_event', 1)).toBe('allow')
    expect(resolveApproval(trustExceptDelete, 'sign_event', 5)).toBe('ask')
  })

  it('a zap request (kind 9734) prompts under a blanket sign:always — money needs a human', () => {
    // Trusted-for-signing app: ordinary notes auto-sign, but zaps still prompt.
    const trusted = app({ policies: { sign: 'always', dm: 'always' } })
    expect(resolveApproval(trusted, 'sign_event', 1)).toBe('allow')
    expect(resolveApproval(trusted, 'sign_event', 9734)).toBe('ask')
    // A legacy always-allow record likewise doesn't silently auto-sign zaps.
    expect(resolveApproval(app({ policy: 'always-allow' }), 'sign_event', 9734)).toBe('ask')
    // ...unless the user explicitly granted zaps (the per-kind "always allow zaps" choice).
    const zapGranted = app({ policies: { sign: 'ask', dm: 'ask' }, kindPolicies: { '9734': 'always' } })
    expect(resolveApproval(zapGranted, 'sign_event', 9734)).toBe('allow')
    // A withheld per-kind override still prompts.
    const zapWithheld = app({ policies: { sign: 'always', dm: 'always' }, kindPolicies: { '9734': 'ask' } })
    expect(resolveApproval(zapWithheld, 'sign_event', 9734)).toBe('ask')
  })

  it('a per-kind override never affects DMs or kind-0 profile writes', () => {
    const a = app({ policies: { sign: 'ask', dm: 'always', profile: 'always' }, kindPolicies: { '1': 'always' } })
    expect(resolveApproval(a, 'nip44_encrypt')).toBe('allow')      // dm category, untouched
    expect(resolveApproval(a, 'sign_event', 0)).toBe('allow')       // profile category, untouched
  })
})
