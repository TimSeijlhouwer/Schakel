# Schakel — multiplayer (stap 1: lobby)

Dit is het kale skelet van de online versie: een spel aanmaken met een code,
joinen op een andere telefoon, elkaar live in de lobby zien, en de host kan
starten. De echte speelschermen bouwen we hierop verder.

Stack: Vite + React (client) en Supabase (database, anonieme login, realtime).

## Wat je nodig hebt
- Node.js 18 of nieuwer
- Een gratis Supabase-account

## Eenmalige setup

1. **Maak een Supabase-project** op https://supabase.com (New project).
2. **Anonieme login aanzetten.** In het Supabase-dashboard: Authentication →
   Sign In / Providers → zet **Anonymous sign-ins** aan.
3. **Database aanmaken.** Open de SQL Editor, plak de inhoud van
   `supabase/schema.sql` en klik Run.
4. **Sleutels invullen.** In het dashboard onder Settings → API vind je de
   *Project URL* en de *anon public* key. Kopieer `.env.example` naar `.env`
   en vul ze in:
   ```
   cp .env.example .env
   ```

## Draaien

```
npm install
npm run dev
```

Vite toont een lokale URL en een netwerk-URL (bv. `http://192.168.x.x:5173`).
Die netwerk-URL kun je op je telefoon openen als je op hetzelfde wifi zit.

## Testen in je eentje
Open de app in twee verschillende browservensters (of één gewoon en één
incognito). Elk venster telt als een aparte speler, omdat elk venster zijn
eigen anonieme sessie krijgt. Maak in het ene venster een spel, kopieer de
code, en join ermee in het andere venster — je ziet de speler live in de
lobby verschijnen.

## Structuur
```
src/
  supabaseClient.js   Supabase-verbinding + anonieme login
  lib/
    constants.js      spelerskleuren, codegenerator
    api.js            aanmaken / joinen / starten
  screens/
    Home.jsx          naam invullen, spel maken of joinen
    Lobby.jsx         live spelerslijst, host start
  App.jsx             sessie + schakelen tussen schermen
supabase/
  schema.sql          tabellen + beveiliging + realtime
```

## Volgende stap
Bovenop deze lobby komen: het woordveld op de server delen, per speler
geheime woorden (met strengere beveiliging), de beurten, hints, raden met
gedeelde timer, en de puntenberekening. Daarna statistieken en leaderboards.

---

## Online zetten (spelen op verschillende netwerken)

`npm run dev` draait alleen lokaal, dus dan kan alleen iemand op hetzelfde
wifi meedoen. Zet je de frontend online, dan krijg je een publieke URL die
overal werkt — mobiele data, ander wifi, andere stad. Je Supabase-backend
draait al in de cloud, dus alleen de frontend hoeft er nog bij.

### 1. Code op GitHub zetten

**Zonder terminal (GitHub Desktop):**
1. Installeer GitHub Desktop en log in met je GitHub-account.
2. File → Add Local Repository → kies de map `schakel-app`.
   (Of: File → New Repository als je hier begint.)
3. Klik "Publish repository". Zet 'm op **private** als je wilt; hosten kan
   nog steeds. De `.env` gaat automatisch niet mee — die staat in
   `.gitignore`, dus je zet niets geheims online.

**Met terminal:**
```
cd schakel-app
git init
git add .
git commit -m "Schakel: lobby-skelet"
git branch -M main
git remote add origin https://github.com/<jouw-naam>/schakel-app.git
git push -u origin main
```
(Maak eerst een lege repo aan op github.com en plak de URL hierboven.)

### 2. Koppelen aan een host

Kies er één — voor deze app maakt het weinig uit. Vercel, Netlify en
Cloudflare Pages hebben allemaal een gratis niveau dat ruim voldoet.

Voorbeeld met **Vercel**:
1. Ga naar vercel.com en log in met GitHub.
2. "Add New… → Project" en kies je `schakel-app`-repo.
3. Vercel herkent Vite vanzelf (build: `npm run build`, output: `dist`).
   Meestal hoef je hier niets te wijzigen.
4. **Belangrijk — omgevingsvariabelen.** Voeg vóór het deployen dezelfde twee
   toe die in je `.env` staan:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   Zonder deze weet de online versie niet met welke Supabase hij moet praten.
5. Deploy. Je krijgt een URL zoals `schakel.vercel.app`. Die deel je — klaar.

Netlify en Cloudflare Pages werken bijna identiek: repo kiezen, dezelfde twee
variabelen invullen, deployen.

### 3. Vanzelf bijwerken

Omdat de host aan GitHub hangt, deployt elke `git push` (of "push" in GitHub
Desktop) automatisch een verse versie. Handig als we straks de speelschermen
toevoegen: pushen, en de online versie is meteen bij.

### Is die anon-key niet geheim?

Nee, en dat hoort zo. De `anon`-key is bedoeld om openbaar in de frontend te
staan. De beveiliging zit niet in het verbergen van die sleutel, maar in de
row-level-security-regels in de database (zie `supabase/schema.sql`). Daarom
is het veilig om de app publiek te zetten. Je *service_role*-key deel je nooit
en zetten we nergens in de frontend.
