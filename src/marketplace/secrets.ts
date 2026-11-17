const assignment = /(?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*(\S+)/gi;

export function findSecrets(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(assignment)) {
    const value = (match[1] ?? "").replace(/^['"]|['",]+$/g, "");
    if (value.length < 8) continue;
    if (/^YOUR_[A-Z0-9_]+$/.test(value) || value.startsWith("$")) continue;
    hits.push(match[0]);
  }
  if (/sk_live_[0-9A-Za-z]{8,}/.test(source) || /AKIA[0-9A-Z]{16}/.test(source) || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source)) {
    hits.push("live credential");
  }
  return hits;
}

export function exampleIsPublishable(source: string): boolean {
  return source.trim().length > 0 && findSecrets(source).length === 0;
}
