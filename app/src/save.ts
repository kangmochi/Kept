/** A second press while the save request is still running does nothing. */
export function claimSave(inFlight: boolean): boolean {
  return !inFlight
}

/**
 * 409 consumed means this confirm token already created a row.
 * 409 expired means the glasses must listen again. Anything else is a real failure.
 */
export function interpretSaveFailure(status: number, code: string | undefined): 'saved' | 'expired' | 'failed' {
  if (status === 409 && code === 'consumed') return 'saved'
  if (status === 409 && code === 'expired') return 'expired'
  return 'failed'
}

export function shouldResetSession(status: number): boolean {
  return status === 401
}
