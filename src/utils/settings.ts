import { parseJsonValue } from "./format";

export function getJsonSetting<T>(settings: Record<string, string>, key: string, fallback: T): T {
  return parseJsonValue(settings[key] ?? null, fallback);
}
