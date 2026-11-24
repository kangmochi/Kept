/** Remembers the last successful extraction for one identical utterance. */
export class LastGoodCache<T> {
  private slot: { key: string; value: T } | null = null

  get(key: string): T | null {
    if (!this.slot || this.slot.key !== key) return null
    return this.slot.value
  }

  set(key: string, value: T) {
    this.slot = { key, value }
  }
}
