/** Exchange the host's printed process URL for its browser cookie; never log the token or cookie. */
export function webLaunchUrl(log, base) {
  const candidates = log.match(/https?:\/\/[^\s]+\/\?token=[A-Za-z0-9_-]+/g) || [];
  const launchUrl = candidates.findLast(value => new URL(value).origin === base);
  if (!launchUrl) throw new Error('Harness has not announced its browser authentication URL.');
  return launchUrl;
}

export async function authenticateWeb(log, base) {
  const launchUrl = webLaunchUrl(log, base);
  const response = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(1500) });
  const header = response.headers.get('set-cookie');
  if (response.status !== 303 || !header) throw new Error(`Harness browser authentication returned HTTP ${response.status}.`);
  return { cookie: header.split(';', 1)[0] };
}

/** Diagnostics retain readiness and errors without retaining browser authentication inputs. */
export function redactWebAuth(log) {
  return log.replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]');
}
