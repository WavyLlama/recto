// Recto AI: card generation, explanations, QCM distractors.
// Secrets: GEMINI_API_KEY (required), GEMINI_MODEL (optional, default gemini-2.5-flash).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const clip = (s: unknown, n: number) => String(s ?? '').slice(0, n);

async function gemini(parts: unknown[], key: string) {
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('') || '{}';
  return JSON.parse(text);
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Méthode non autorisée.' }, 405);
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'L’IA n’est pas encore configurée sur ce site (clé manquante).' }, 503);

  // The caller's own session: the quota and the checks below run as that user.
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, apikey, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return json({ error: 'Connecte-toi pour utiliser l’IA.' }, 401);
  const { data: allowed, error: quotaError } = await sb.rpc('ai_take_quota');
  if (quotaError) return json({ error: 'Quota indisponible, réessaie plus tard.' }, 500);
  if (!allowed) return json({ error: 'Limite quotidienne d’utilisation de l’IA atteinte. Réessaie demain.' }, 429);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

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
      }], key);
      return json({ text: clip(out.text, 800) });
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
    return json({ error: 'L’IA n’a pas pu répondre. Réessaie dans un instant.' }, 502);
  }
});
