import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { configure } from '@testing-library/react'

// CI runners are far slower than dev machines, and several component tests gate a UI
// transition behind a real PBKDF2 600k key-wrap (PIN setup, unlock). The default 1000ms
// findBy/waitFor timeout can expire mid-wrap on a shared CI core — the create-with-PIN flow
// stuck on the SetupUnlock screen is exactly that. Give async queries realistic headroom;
// findBy still resolves the instant the element appears, so passing tests gain no delay —
// only a higher ceiling before they fail.
configure({ asyncUtilTimeout: 5000 })
