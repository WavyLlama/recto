# Recto

Mes cartes de révision : cartes à retourner, apprentissage guidé, test noté, jeu d'association et révision espacée. Comptes et synchronisation entre appareils via Supabase, espace admin.

Site statique, sans étape de build : `index.html`, `app.js`, `logic.js`, `icons.js`, `style.css`.

- **Lancer en local :** `python3 -m http.server 5173`, puis ouvrir http://localhost:5173
- **Tests :** `node --test tests/logic.test.mjs`
- **Base de données :** exécuter `supabase.sql` dans l'éditeur SQL de Supabase, puis renseigner `config.js`. Le premier compte créé devient administrateur.
- **Mise en ligne :** GitHub Pages, branche `main`, dossier racine.
