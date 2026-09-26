import type { Event as NostrEvent } from 'nostr-tools'
import type { Session } from '../../app/session.js'
import type { ProfileMetadata } from '../../app/db.js'
import { saveProfile as saveProfileRecord, loadProfile } from '../../app/db.js'
import { uploadBlob, type EventTemplate } from '../../app/blossom.js'
import { buildKind0Content } from './profile-metadata.js'

type Uploader = (server: string, blob: Blob, sign: (t: EventTemplate) => NostrEvent) => Promise<{ url: string; sha256: string }>

/** Publish (and locally store) an identity's profile. If a new avatar was picked it's uploaded to
 *  Blossom and its URL becomes the picture; otherwise the existing local avatar is kept. The kind-0
 *  content is built over the previously-fetched raw profile so unmanaged fields survive, signed by
 *  the identity, published to the relays, and a local copy (metadata + avatar) is saved. */
export async function publishProfile(opts: {
  session: Session
  identityName: string
  metadata: ProfileMetadata
  base?: Record<string, unknown>
  newAvatar?: Blob
  blossomServer: string
  upload?: Uploader
  now?: number
}): Promise<void> {
  const upload = opts.upload ?? uploadBlob
  const metadata: ProfileMetadata = { ...opts.metadata }
  const sign = (t: EventTemplate) => opts.session.signer.signEventAs(opts.identityName, t)

  let avatarBlob = opts.newAvatar
  if (opts.newAvatar) {
    const { url } = await upload(opts.blossomServer, opts.newAvatar, sign)
    metadata.picture = url
  } else {
    // No new image — keep whatever local avatar copy we already have.
    avatarBlob = (await loadProfile(opts.identityName))?.avatarBlob
  }

  const content = buildKind0Content(metadata, opts.base ?? {})
  const event = opts.session.signer.signEventAs(opts.identityName, { kind: 0, content })
  opts.session.publish(event)

  await saveProfileRecord({ name: opts.identityName, metadata, avatarBlob, updatedAt: opts.now ?? Math.floor(Date.now() / 1000) })
}
