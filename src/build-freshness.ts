import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { STORE_SCHEMA_VERSION } from './constants.js';

const SOURCE_SCHEMA_OVERRIDE_ENV = 'OPENCODE_LCM_SOURCE_CONSTANTS_PATH';

function resolveSourceConstantsPath(moduleUrl: string): string {
  const overridden = process.env[SOURCE_SCHEMA_OVERRIDE_ENV]?.trim();
  if (overridden) return overridden;
  return fileURLToPath(new URL('../src/constants.ts', moduleUrl));
}

export function readSourceSchemaVersionSync(
  moduleUrl: string = import.meta.url,
): number | undefined {
  const sourceConstantsPath = resolveSourceConstantsPath(moduleUrl);
  if (!existsSync(sourceConstantsPath)) return undefined;

  const source = readFileSync(sourceConstantsPath, 'utf8');
  const match = source.match(/STORE_SCHEMA_VERSION\s*=\s*(\d+)/);
  if (!match) return undefined;

  return Number.parseInt(match[1], 10);
}

export function assertLocalBuildFreshnessSync(moduleUrl: string = import.meta.url): void {
  const sourceSchemaVersion = readSourceSchemaVersionSync(moduleUrl);
  if (sourceSchemaVersion === undefined || sourceSchemaVersion <= STORE_SCHEMA_VERSION) return;

  const sourceConstantsPath = resolveSourceConstantsPath(moduleUrl);
  throw new Error(
    `Stale local opencode-lcm build detected: source schema version ${sourceSchemaVersion} is newer than built runtime schema version ${STORE_SCHEMA_VERSION}. Run \`npm run build\` before loading the plugin. Source: ${sourceConstantsPath}`,
  );
}
