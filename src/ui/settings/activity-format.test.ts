import { describe, it, expect } from 'vitest'
import { describeActivity, outcomeLabel, errorDetail, activityAppName, formatRelativeTime } from './activity-format.js'

describe('describeActivity', () => {
  it('maps common kinds to friendly verbs', () => {
    expect(describeActivity('sign_event', 1)).toBe('Signed a note')
    expect(describeActivity('sign_event', 0)).toBe('Updated your profile')
    expect(describeActivity('sign_event', 7)).toBe('Signed a reaction')
  })

  it('shows the kind number for uncommon sign_event kinds', () => {
    expect(describeActivity('sign_event', 30023)).toBe('Signed an event (kind 30023)')
    expect(describeActivity('sign_event')).toBe('Signed an event')
  })

  it('describes the encryption and read methods', () => {
    expect(describeActivity('nip44_encrypt')).toBe('Encrypted a message')
    expect(describeActivity('nip44_decrypt')).toBe('Read a message')
    expect(describeActivity('get_public_key')).toBe('Read your public key')
  })

  it('falls back to the raw method name when unknown', () => {
    expect(describeActivity('something_new')).toBe('something_new')
  })
})

describe('outcomeLabel', () => {
  it('words each outcome in the past tense', () => {
    expect(outcomeLabel('signed')).toBe('Signed')
    expect(outcomeLabel('denied')).toBe('Declined')
    expect(outcomeLabel('error')).toBe('Failed')
  })

  it('reads an auto-declined request as "Blocked" — a rule said no, not the user', () => {
    expect(outcomeLabel('denied', true)).toBe('Blocked')
    expect(outcomeLabel('denied', false)).toBe('Declined')
    // auto only changes the denied wording; signed/error are unaffected.
    expect(outcomeLabel('signed', true)).toBe('Signed')
    expect(outcomeLabel('error', true)).toBe('Failed')
  })

  it('reads an unanswered (timed-out) request as "Timed out", outranking auto/blocked', () => {
    expect(outcomeLabel('denied', false, true)).toBe('Timed out')
    // A timeout reads the same whether or not the auto flag is also set — it was no one's decision.
    expect(outcomeLabel('denied', true, true)).toBe('Timed out')
    // timedOut only affects a denial; a signed/error outcome is unchanged.
    expect(outcomeLabel('signed', false, true)).toBe('Signed')
    expect(outcomeLabel('error', false, true)).toBe('Failed')
  })
})

describe('errorDetail', () => {
  it('maps fixed engine codes to friendly reasons', () => {
    expect(errorDetail('invalid event template')).toBe('Invalid request from the app')
    expect(errorDetail('missing params')).toBe('The app left out required details')
    expect(errorDetail('unsupported method')).toBe('The app asked for something unsupported')
    expect(errorDetail('request failed')).toBe('Something went wrong')
  })

  it('passes an unknown code through, and yields nothing for no code', () => {
    expect(errorDetail('some new code')).toBe('some new code')
    expect(errorDetail(undefined)).toBeUndefined()
  })
})

describe('activityAppName', () => {
  it('shows the app\'s current name, so renaming a connected app flows through to history', () => {
    // Live name present and different from the snapshot taken at log time → the rename wins.
    expect(activityAppName('Renamed', 'Old snapshot', 'abcd1234ef')).toBe('Renamed')
  })

  it('falls back to the at-log-time snapshot when the app has been forgotten (no live name)', () => {
    expect(activityAppName(undefined, 'noStrudel', 'abcd1234ef')).toBe('noStrudel')
  })

  it('falls back to a pubkey stub when there is neither a live name nor a snapshot', () => {
    expect(activityAppName(undefined, undefined, 'abcd1234ef')).toBe('App abcd1234')
  })
})

describe('formatRelativeTime', () => {
  it('rounds to a compact relative string', () => {
    expect(formatRelativeTime(1000, 1010)).toBe('just now')
    expect(formatRelativeTime(1000, 1000 + 5 * 60)).toBe('5m ago')
    expect(formatRelativeTime(1000, 1000 + 3 * 3600)).toBe('3h ago')
    expect(formatRelativeTime(1000, 1000 + 2 * 86400)).toBe('2d ago')
  })

  it('never shows a negative delta', () => {
    expect(formatRelativeTime(2000, 1000)).toBe('just now')
  })
})
