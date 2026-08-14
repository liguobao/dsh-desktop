/** URL policy shared by the main window's navigation handlers. */

/**
 * Return true only for a URL served by this exact Harness instance.
 * @param {string} target
 * @param {string | undefined} harnessOrigin
 */
export function isHarnessUrl(target, harnessOrigin) {
  if (harnessOrigin === undefined) return false
  try {
    const url = new URL(target)
    return url.protocol === 'http:' && url.origin === harnessOrigin
  } catch {
    return false
  }
}

/** Return true for a URL that is safe to hand to the operating system. */
export function isExternalHttpUrl(target) {
  try {
    const protocol = new URL(target).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
