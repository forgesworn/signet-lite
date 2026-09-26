import { useState } from 'react'
import { checkConfirm } from './confirm.js'

export function ConfirmBackup({ words, picks, onConfirmed }: { words: string[]; picks: number[]; onConfirmed: () => void }) {
  const [answers, setAnswers] = useState<string[]>(picks.map(() => ''))
  const [attempted, setAttempted] = useState(false)

  const allFilled = answers.every(a => a.trim().length > 0)
  const correct = checkConfirm(words, picks, answers)
  const showError = attempted && allFilled && !correct

  function handleConfirm() {
    setAttempted(true)
    if (correct) onConfirmed()
  }

  return (
    <main className="page">
      <h2 style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>Confirm your backup</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: 12, lineHeight: 1.5, marginBottom: 20 }}>
        Enter the words at the positions below to confirm you've written them down.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
        {picks.map((pick, i) => (
          <div key={pick}>
            <label htmlFor={`confirm-word-${pick}`} style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
              Word #{pick + 1}
            </label>
            <input
              id={`confirm-word-${pick}`}
              className="input"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={answers[i]}
              onChange={e => {
                const next = [...answers]
                next[i] = e.target.value
                setAnswers(next)
                setAttempted(false)
              }}
            />
          </div>
        ))}
      </div>
      {showError && (
        <p style={{ color: 'var(--danger)', fontSize: 13, marginBottom: 12 }}>
          That doesn't match — check your written copy.
        </p>
      )}
      <button
        className="btn btn-primary"
        disabled={!allFilled}
        onClick={handleConfirm}
      >
        Confirm
      </button>
    </main>
  )
}
