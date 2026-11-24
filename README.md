# Recto

Mes cartes de révision : cartes à retourner, apprentissage guidé, test noté, jeu d'association et révision espacée. Comptes et synchronisation entre appareils via Supabase, espace admin.

Site statique, sans étape de build : `index.html`, `main.js` (point d'entrée), `core.js`, `sync.js`, un module par écran, `logic.js` (logique testée) et `style.css`.

- **Lancer en local :** `python3 -m http.server 5173`, puis ouvrir http://localhost:5173
- **Tests :** `node --test tests/logic.test.mjs`
- **Base de données :** exécuter `supabase.sql`, puis `supabase-v2.sql`, `supabase-v3.sql`, `supabase-v4.sql` et `supabase-v5.sql` dans l'éditeur SQL de Supabase, puis renseigner `config.js`. Le premier compte créé devient administrateur.
- **IA :** fonction `supabase/functions/ai`, à déployer sur Supabase avec le secret `GEMINI_API_KEY` (clé gratuite sur aistudio.google.com).
- **Mise en ligne :** GitHub Pages, branche `main`, dossier racine.
- **Anti-pause :** `.github/workflows/keepalive.yml` interroge la base chaque jour pour que le projet Supabase gratuit ne se mette pas en pause.
- **Connexion Google :** à activer dans Supabase (Authentication → Sign In / Providers → Google) ; le bouton apparaît tout seul ensuite.
