/**
 * The version shown in Settings > About: package.json's version plus the short git
 * SHA of the build, e.g. '1.2.0 (3f9c2ab)'. Either part may be missing (a build
 * without git has no SHA), so this falls back to whatever is known.
 */
export function formatAppVersion(version: string, commit: string): string {
  const semver = version.trim();
  const sha = commit.trim();
  if (semver && sha) return `${semver} (${sha})`;
  return semver || sha || 'Unknown';
}

/** Build-time constants from vite.config.ts; `typeof` keeps this safe if they're missing. */
export const APP_VERSION = formatAppVersion(
  typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
  typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '',
);
