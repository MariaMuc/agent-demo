# Agent conversationnel – démo pour apprenants

Application web 100 % statique (HTML/CSS/JS) : chaque utilisateur saisit **son fournisseur LLM** et **sa propre clé API**, puis discute avec le modèle. Aucun serveur, aucune clé stockée côté hébergeur.

## Fournisseurs inclus
Groq, OpenAI, OpenRouter, Mistral, Google Gemini, Together AI, DeepSeek, et « Autre » (toute API compatible OpenAI : renseigner l'URL de base).

## Tester en local
```bash
cd public
python3 -m http.server 8000   # puis ouvrir http://localhost:8000
```

## Déployer sur Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
# remplacer VOTRE-ID-PROJET-FIREBASE dans .firebaserc, puis :
firebase deploy --only hosting
```

## Structure
```
public/index.html   interface
public/style.css    styles (clair/sombre automatique)
public/app.js       logique (appels API, streaming, rendu)
firebase.json       configuration Firebase Hosting
.firebaserc         ID du projet Firebase
```

## Sécurité
- La clé est envoyée uniquement au fournisseur choisi, depuis le navigateur de l'utilisateur.
- Elle est gardée en `sessionStorage` (effacée à la fermeture de l'onglet), ou en `localStorage` si l'utilisateur coche « Se souvenir ».
- Ne jamais mettre de clé API dans le code ou sur GitHub.
