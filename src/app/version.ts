/**
 * The release this build belongs to: package.json's one version
 * (COMMON-PROJECT-SPEC C13 in `second-brain`, CHANGELOG.md at the root). A
 * named import, so the bundle carries the string and nothing else of that file.
 * Not the agent bridge's number, which counts the bridge alone
 * (`shared/commands/bridge-version.ts`).
 */
import { version } from '../../package.json';

export const APP_VERSION: string = version;
