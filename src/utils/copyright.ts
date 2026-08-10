export const PROJECT_COPYRIGHT_START_YEAR = 2026;

export const APP_VERSION = __SOBERAN_APP_VERSION__;

export function formatCopyrightYearRange(
  startYear: number = PROJECT_COPYRIGHT_START_YEAR,
  now: Date = new Date(),
): string {
  const current = now.getFullYear();
  return current <= startYear ? String(startYear) : `${startYear} - ${current}`;
}
