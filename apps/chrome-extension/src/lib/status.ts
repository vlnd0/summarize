export function splitStatusPercent(input: string): { text: string; percent: string | null } {
  const trimmed = input.trim()
  if (!trimmed) return { text: '', percent: null }

  // Match "... 34%" or "... (34%)" at the end, and split it out for a stronger visual treatment.
  const m = trimmed.match(/^(?<text>.*?)(?:\s*[([]?(?<sign>-)?(?<pct>\d{1,3})%[)\]]?)\s*$/)
  if (!m?.groups) return { text: trimmed, percent: null }
  if (m.groups.sign === '-') return { text: trimmed, percent: null }
  const pctNum = Number(m.groups.pct)
  if (!Number.isFinite(pctNum) || pctNum < 0 || pctNum > 100)
    return { text: trimmed, percent: null }
  const text = (m.groups.text ?? '').trim()
  if (!text) return { text: trimmed, percent: null }
  return { text, percent: `${pctNum}%` }
}
