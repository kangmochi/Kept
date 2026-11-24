/**
 * Whole-word fixes for speech-to-text mistakes we have actually heard.
 * "invoice" (an Indonesian loanword) comes back from Mistral as "info C".
 */
const RULES: { pattern: RegExp; replacement: string }[] = [
  { pattern: /\binfo\s+c\b/gi, replacement: 'invoice' },
  { pattern: /\binfo\s+see\b/gi, replacement: 'invoice' },
  { pattern: /\binvois\b/gi, replacement: 'invoice' },
]

export function correctTranscript(text: string): string {
  let out = text
  for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement)
  return out.replace(/\s+/g, ' ').trim()
}
