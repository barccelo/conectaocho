/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

type SessionState = {
  entries: Array<{ word: string; definition?: string }>;
  cards: Array<{ attempts: number; revealedPositions: number[]; solved: boolean; isSeed?: boolean }>;
  activeIndex: number;
  finished: boolean;
  remaining: number;
  paused: boolean;
  allowPlayerInput: boolean;
  usedLetters: Record<string, "correct" | "wrong">;
  usedLettersForIndex?: number;
  notice?: { id: number | string; message: string; type: string } | null;
  revision: number;
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

const publicState = (state: SessionState) => ({
  cards: state.cards.map((card, index) => ({
    attempts: card.attempts,
    revealedPositions: card.revealedPositions,
    solved: card.solved,
    isSeed: card.isSeed,
    length: Array.from(state.entries[index].word).filter((c) => /[\p{L}\p{N}]/u.test(c)).length,
    visibleLetters: Array.from(state.entries[index].word).filter((c) => /[\p{L}\p{N}]/u.test(c)).map((c, position) =>
      card.solved || card.revealedPositions.includes(position) ? c.toUpperCase() : null),
    availableLetters: [...new Set(Array.from(state.entries[index].word)
      .filter((c) => /[\p{L}\p{N}]/u.test(c))
      .map((c, position) => ({ letter: c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(), position }))
      .filter(({ position }) => !card.revealedPositions.includes(position))
      .map(({ letter }) => letter))],
  })),
  activeIndex: state.activeIndex,
  finished: state.finished,
  remaining: state.remaining,
  paused: state.paused,
  allowPlayerInput: state.allowPlayerInput,
  usedLetters: state.usedLetters || {},
  usedLettersForIndex: state.usedLettersForIndex ?? state.activeIndex,
  notice: state.notice || null,
  revision: state.revision || 0,
});

async function ensureSessions(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS game_sessions (id TEXT PRIMARY KEY, host_key TEXT NOT NULL, state TEXT NOT NULL, updated_at INTEGER NOT NULL)").run();
}

async function handleSessionApi(request: Request, env: Env, url: URL): Promise<Response> {
  await ensureSessions(env.DB);
  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const body = await request.json() as { state?: SessionState };
    if (!body.state?.entries?.length) return json({ error: "Partida inválida" }, 400);
    const id = crypto.randomUUID().replaceAll("-", "").slice(0, 10);
    const hostKey = crypto.randomUUID();
    body.state.revision = 1;
    await env.DB.prepare("INSERT INTO game_sessions (id, host_key, state, updated_at) VALUES (?, ?, ?, ?)")
      .bind(id, hostKey, JSON.stringify(body.state), Date.now()).run();
    return json({ id, hostKey, state: publicState(body.state) }, 201);
  }

  const match = url.pathname.match(/^\/api\/sessions\/([a-zA-Z0-9]+)(?:\/(letter))?$/);
  if (!match) return json({ error: "No encontrado" }, 404);
  const row = await env.DB.prepare("SELECT host_key, state FROM game_sessions WHERE id = ?").bind(match[1]).first<{ host_key: string; state: string }>();
  if (!row) return json({ error: "Partida no encontrada" }, 404);
  let state = JSON.parse(row.state) as SessionState;

  if (request.method === "GET") return json(publicState(state));
  if (request.method === "PUT") {
    if (request.headers.get("x-host-key") !== row.host_key) return json({ error: "No autorizado" }, 403);
    const body = await request.json() as { state?: SessionState };
    if (!body.state?.entries?.length) return json({ error: "Estado inválido" }, 400);
    const incomingRevision = Number(body.state.revision || 0);
    const storedRevision = Number(state.revision || 0);
    if (incomingRevision !== storedRevision) return json({ error: "Estado desactualizado", state: publicState(state) }, 409);
    state = body.state;
    if (state.usedLettersForIndex !== state.activeIndex) {
      state.usedLetters = {};
      state.usedLettersForIndex = state.activeIndex;
    }
    state.revision = (state.revision || 0) + 1;
    const update = await env.DB.prepare("UPDATE game_sessions SET state = ?, updated_at = ? WHERE id = ? AND CAST(json_extract(state, '$.revision') AS INTEGER) = ?")
      .bind(JSON.stringify(state), Date.now(), match[1], storedRevision).run();
    if (!update.meta.changes) {
      const latest = await env.DB.prepare("SELECT state FROM game_sessions WHERE id = ?").bind(match[1]).first<{ state: string }>();
      return json({ error: "Estado desactualizado", state: latest ? publicState(JSON.parse(latest.state) as SessionState) : null }, 409);
    }
    return json(publicState(state));
  }
  if (request.method === "POST" && match[2] === "letter") {
    if (state.paused || state.finished || !state.allowPlayerInput) return json({ error: "Teclado bloqueado" }, 409);
    const body = await request.json() as { letter?: string };
    const letter = (body.letter || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
    if (!/^[A-ZÑ]$/.test(letter) || state.usedLetters?.[letter]) return json(publicState(state));
    const storedRevision = Number(state.revision || 0);
    const card = state.cards[state.activeIndex];
    const letters = Array.from(state.entries[state.activeIndex].word).filter((c) => /[\p{L}\p{N}]/u.test(c));
    const positions = letters.map((c, i) => ({ c: c.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase(), i })).filter((x) => x.c === letter).map((x) => x.i);
    if (positions.length && positions.every((position) => card.revealedPositions.includes(position))) return json(publicState(state));
    state.usedLetters ||= {};
    if (state.usedLettersForIndex !== state.activeIndex) state.usedLetters = {};
    state.usedLettersForIndex = state.activeIndex;
    if (positions.length) {
      positions.forEach((position) => { if (!card.revealedPositions.includes(position)) card.revealedPositions.push(position); });
      card.revealedPositions.sort((a, b) => a - b);
      state.usedLetters[letter] = "correct";
      if (card.revealedPositions.length >= letters.length) {
        card.solved = true;
        state.remaining += 10;
        state.activeIndex += 1;
        state.finished = state.activeIndex >= state.cards.length;
        state.usedLetters = {};
        state.usedLettersForIndex = state.activeIndex;
        state.notice = { id: `${Date.now()}-${crypto.randomUUID()}`, message: "Palabra descubierta · +10 s", type: "success" };
      } else state.notice = { id: `${Date.now()}-${crypto.randomUUID()}`, message: `Letra ${letter} correcta`, type: "success" };
    } else {
      state.usedLetters[letter] = "wrong";
      card.attempts += 1;
      if (card.attempts >= 3) {
        card.attempts = 0;
        state.remaining = Math.max(0, state.remaining - 5);
        state.notice = { id: `${Date.now()}-${crypto.randomUUID()}`, message: "−5 s", type: "penalty" };
      } else state.notice = { id: `${Date.now()}-${crypto.randomUUID()}`, message: "Letra incorrecta", type: "error" };
    }
    state.revision = (state.revision || 0) + 1;
    const update = await env.DB.prepare("UPDATE game_sessions SET state = ?, updated_at = ? WHERE id = ? AND CAST(json_extract(state, '$.revision') AS INTEGER) = ?")
      .bind(JSON.stringify(state), Date.now(), match[1], storedRevision).run();
    if (!update.meta.changes) {
      const latest = await env.DB.prepare("SELECT state FROM game_sessions WHERE id = ?").bind(match[1]).first<{ state: string }>();
      return json(latest ? publicState(JSON.parse(latest.state) as SessionState) : { error: "Partida no encontrada" }, latest ? 200 : 404);
    }
    return json(publicState(state));
  }
  return json({ error: "Método no permitido" }, 405);
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/sessions")) return handleSessionApi(request, env, url);

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
