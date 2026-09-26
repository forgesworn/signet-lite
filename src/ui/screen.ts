export type Screen =
  | 'loading' | 'welcome' | 'create-phrase' | 'confirm-backup'
  | 'setup-unlock' | 'import' | 'unlock' | 'restore-warning' | 'home'
  | 'connect' | 'connect-done' | 'bunker' | 'approve'
  | 'settings' | 'backup' | 'move-to-mysignet' | 'connected-apps' | 'relays' | 'delete-signet' | 'profile' | 'activity' | 'upgrade-pin-prf'

/** First screen after boot: unlock an existing identity, or welcome a new user. */
export function decideInitialScreen(hasMaster: boolean): 'welcome' | 'unlock' {
  return hasMaster ? 'unlock' : 'welcome'
}
