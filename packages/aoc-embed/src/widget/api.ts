// packages/aoc-embed/src/widget/api.ts
export interface ApiContext {
  base: string;
  embedToken: string;
  jwt: string | null;
  sessionToken: string | null;
  parentOrigin: string;
  ownerJwt?: string | null;  // owner's dashboard JWT, only set in playground mode
  playground?: boolean;       // true when launched from designer playground iframe
}

const VISITOR_UUID_KEY = (embedId: string) => `aoc_visitor_${embedId}`;

export function getOrCreateVisitorUuid(embedId: string): string {
  try {
    let v = localStorage.getItem(VISITOR_UUID_KEY(embedId));
    if (!v) {
      v = crypto.randomUUID();
      localStorage.setItem(VISITOR_UUID_KEY(embedId), v);
    }
    return v;
  } catch {
    return crypto.randomUUID();  // ephemeral fallback
  }
}

export function clearVisitorUuid(embedId: string) {
  try { localStorage.removeItem(VISITOR_UUID_KEY(embedId)); } catch {}
}

function _baseHeaders(ctx: ApiContext): Record<string, string> {
  return {
    'X-Embed-Token': ctx.embedToken,
    'X-Embed-Parent-Origin': ctx.parentOrigin,
  };
}

export async function createSession(ctx: ApiContext, embedId: string) {
  const visitor_uuid = getOrCreateVisitorUuid(embedId);
  const headers: Record<string, string> = {
    ..._baseHeaders(ctx),
    'Content-Type': 'application/json',
  };
  // Playground mode: Authorization carries the owner dashboard JWT.
  // Private mode: Authorization carries the visitor JWT.
  // These are mutually exclusive — playground sessions bypass private-mode visitor auth.
  if (ctx.playground && ctx.ownerJwt) {
    headers['Authorization'] = `Bearer ${ctx.ownerJwt}`;
  } else if (ctx.jwt) {
    headers['Authorization'] = `Bearer ${ctx.jwt}`;
  }
  const body: Record<string, unknown> = { visitor_uuid };
  if (ctx.playground) body.playground = true;
  const res = await fetch(`${ctx.base}/api/embed/session`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json().catch(() => ({ error: 'unknown' }));
  return res.json();
}

export async function sendMessage(ctx: ApiContext, content: string) {
  const res = await fetch(`${ctx.base}/api/embed/message`, {
    method: 'POST',
    headers: {
      ..._baseHeaders(ctx),
      'Authorization': `Bearer ${ctx.sessionToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

export async function fetchHistory(ctx: ApiContext, cursor: string | null) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const res = await fetch(`${ctx.base}/api/embed/history?${params}`, {
    headers: {
      ..._baseHeaders(ctx),
      'Authorization': `Bearer ${ctx.sessionToken}`,
    },
  });
  if (!res.ok) return { messages: [], has_more: false };
  return res.json();
}

export async function clearSession(ctx: ApiContext, embedId: string) {
  await fetch(`${ctx.base}/api/embed/session`, {
    method: 'DELETE',
    headers: {
      ..._baseHeaders(ctx),
      'Authorization': `Bearer ${ctx.sessionToken}`,
    },
  });
  clearVisitorUuid(embedId);
}
