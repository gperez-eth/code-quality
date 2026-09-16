import { createHash } from 'node:crypto';

/**
 * Identifies an issue by rule, file and the *content* of the offending line
 * rather than its number, so unrelated edits above it do not resurface the
 * issue as new. Collisions within a file are disambiguated by occurrence.
 */
export function fingerprint(input: {
  ruleKey: string;
  filePath: string;
  lineText: string;
  occurrence: number;
}): string {
  return createHash('sha256')
    .update(input.ruleKey)
    .update('\0')
    .update(input.filePath)
    .update('\0')
    .update(input.lineText.trim())
    .update('\0')
    .update(String(input.occurrence))
    .digest('hex')
    .slice(0, 32);
}
