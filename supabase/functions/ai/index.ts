// Recto AI: card generation, explanations, QCM distractors.
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional, tried first).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

// Google retires model names and its free models are often saturated (503).
// Quick tasks (checking an answer, explaining a mistake) start with the fastest model and skip
// the model's "thinking"; card generation keeps the stronger model first.
const ORDER = {
  quick: ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-3.8-flash'],
  full: ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-3.8-flash'],
};

async function gemini(parts: unknown[], key: string, quick = false) {
  const models = [Deno.env.get('GEMINI_MODEL'), ...ORDER[quick ? 'quick' : 'full']].filter(Boolean) as string[];
  const config = (think: boolean) => ({
    responseMimeType: 'application/json',
    temperature: quick ? 0.2 : 0.4,
    ...(quick ? { maxOutputTokens: 400 } : {}),
    ...(quick && !think ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  });
  const call = (model: string, think: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: config(think) }),
    signal: AbortSignal.timeout(quick ? 10_000 : 40_000),
  });
  let r: Response | null = null;
  for (const model of models) {
    try {
      r = await call(model, false);
      // A model that refuses the "no thinking" setting answers 400: ask it again without it.
      if (quick && r.status === 400) r = await call(model, true);
    } catch {
      console.error(`Gemini model ${model} timed out, trying the next one`);
      r = null;
      continue;
    }
    if (![404, 429, 500, 503].includes(r.status)) break;
    console.error(`Gemini model ${model} answered ${r.status}, trying the next one`);
  }
  if (!r || r.status === 429 || r.status === 503) throw new Error('busy');
  if (!r || !r.ok) throw new Error(`Gemini ${r?.status}: ${(await r?.text())?.slice(0, 300)}`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .filter((p: { thought?: boolean }) => !p.thought)
    .map((p: { text?: string }) => p.text ?? '').join('') || '{}';
  // Some models wrap JSON in a ```json fence despite the JSON response type.
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'L’IA n’est pas encore configurée sur ce site (clé manquante).' }, 503);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  // Sent when a study screen opens, so the function is already started when the first answer arrives.
  if (body.mode === 'ping') return json({ ok: true });

  // The caller's own session: the quota runs as that user. The quota function returns false
  // for a visitor without an account, so both checks can run at the same time.
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, apikey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const [{ data: { user } }, { data: allowed, error: quotaError }] = await Promise.all([sb.auth.getUser(), sb.rpc('ai_take_quota')]);
  if (!user) return json({ error: 'Connecte-toi pour utiliser l’IA.' }, 401);
  if (quotaError) return json({ error: 'Quota indisponible, réessaie plus tard.' }, 500);
  if (!allowed) return json({ error: 'Limite quotidienne d’utilisation de l’IA atteinte. Réessaie demain.' }, 429);

  try {
    if (body.mode === 'generate') {
      const count = Math.min(40, Math.max(5, Number(body.count) || 20));
      const text = clip(body.text, 20000).trim();
      const image = typeof body.image === 'string' && body.image.length < 4_000_000 ? body.image : '';
      if (!text && !image) return json({ error: 'Envoie un texte ou une photo.' }, 400);
      const parts: unknown[] = [{
        text: `Tu es un professeur qui prépare des fiches de révision (flashcards).
À partir du contenu fourni, crée au plus ${count} cartes sur les notions les plus importantes à mémoriser.
Règles :
- "term" : la notion, le mot, la date ou la question, court (au plus 12 mots).
- "def" : la définition ou la réponse, précise et autonome, en une ou deux phrases (au plus 40 mots).
- Écris dans la langue du contenu. Pour du vocabulaire étranger, mets le mot étranger dans "term" et la traduction dans "def".
- Pas de doublons ni de cartes triviales. N'invente rien qui ne soit pas dans le contenu.
- Les formules mathématiques s'écrivent en LaTeX entre $...$.
- "title" : un titre court pour le set (au plus 6 mots).
Réponds uniquement en JSON : {"title": "...", "cards": [{"term": "...", "def": "..."}]}`,
      }];
      if (text) parts.push({ text: `Contenu :\n${text}` });
      if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
      const out = await gemini(parts, key);
      const cards = (Array.isArray(out.cards) ? out.cards : []).slice(0, count)
        .map((c: { term?: unknown; def?: unknown }) => ({ term: clip(c?.term, 300).trim(), def: clip(c?.def, 1000).trim() }))
        .filter((c: { term: string; def: string }) => c.term && c.def);
      return json({ title: clip(out.title, 80), cards });
    }

    if (body.mode === 'explain') {
      const out = await gemini([{
        text: `Un élève révise une fiche. Explique en français, en 2 à 4 phrases simples (au plus 80 mots), pourquoi la bonne réponse est correcte et, si sa réponse est fausse, en quoi elle diffère. Propose si possible un moyen mnémotechnique.
Terme : ${clip(body.term, 300)}
Définition : ${clip(body.def, 1000)}
On lui demandait : ${body.side === 'def' ? 'la définition' : 'le terme'}
Sa réponse : ${clip(body.given, 300) || '(aucune)'}
Réponds uniquement en JSON : {"text": "..."}`,
      }], key, true);
      return json({ text: clip(out.text, 800) });
    }

    if (body.mode === 'grade') {
      const items = (Array.isArray(body.items) ? body.items : []).slice(0, 20)
        .map((it: { term?: unknown; def?: unknown; side?: unknown; given?: unknown }) => {
          const wantsDef = it?.side === 'def';
          return { question: clip(wantsDef ? it?.term : it?.def, 1000), attendu: clip(wantsDef ? it?.def : it?.term, 1000), reponse: clip(it?.given, 1000) };
        });
      if (!items.length) return json({ results: [] });
      const out = await gemini([{
        text: `Tu corriges les réponses écrites d'un élève qui révise des fiches. Pour chaque réponse, dis si elle est juste sur le fond par rapport à la réponse attendue.
Accepte : synonymes, reformulations, ordre différent, abréviations courantes, fautes d'orthographe, réponse plus courte qui contient l'essentiel.
Refuse : erreur sur le fond, notion confondue avec une autre, réponse trop vague ou à laquelle il manque l'élément principal.
Pour chaque réponse, donne un retour d'une phrase en français (au plus 25 mots) : pourquoi c'est accepté, ou ce qui manque ou est faux.
Réponses (JSON) : ${JSON.stringify(items)}
Réponds uniquement en JSON, dans le même ordre : {"results": [{"correct": true, "feedback": "..."}]}`,
      }], key, true);
      const list = Array.isArray(out.results) ? out.results : [];
      return json({ results: items.map((_: unknown, i: number) => ({ correct: list[i]?.correct === true, feedback: clip(list[i]?.feedback, 300) })) });
    }

    if (body.mode === 'distractors') {
      const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 40)
        .map((c: { id?: unknown; term?: unknown; def?: unknown }) => ({ id: clip(c?.id, 60), term: clip(c?.term, 300), def: clip(c?.def, 600) }));
      if (!cards.length) return json({ items: [] });
      const out = await gemini([{
        text: `Pour chaque fiche, écris 3 fausses définitions plausibles pour un QCM : même langue, même longueur et même style que la vraie. Elles doivent être clairement fausses pour qui connaît la notion, sans être absurdes, et ne pas reprendre la vraie définition.
Fiches (JSON) : ${JSON.stringify(cards)}
Réponds uniquement en JSON : {"items": [{"id": "...", "alts": ["...", "...", "..."]}]}`,
      }], key);
      const ids = new Set(cards.map(c => c.id));
      const items = (Array.isArray(out.items) ? out.items : [])
        .filter((it: { id?: unknown }) => ids.has(String(it?.id)))
        .map((it: { id: unknown; alts?: unknown }) => ({ id: String(it.id), alts: (Array.isArray(it.alts) ? it.alts : []).slice(0, 3).map((a: unknown) => clip(a, 500)) }));
      return json({ items });
    }

    return json({ error: 'Mode inconnu.' }, 400);
  } catch (e) {
    console.error(e);
    if (e instanceof Error && e.message === 'busy') return json({ error: 'L’IA gratuite de Google est saturée pour le moment. Réessaie dans une minute.' }, 429);
    return json({ error: 'L’IA n’a pas pu répondre. Réessaie dans un instant.' }, 502);
  }
});
