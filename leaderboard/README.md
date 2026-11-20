# Topplistan för Turbogalopp

Topplistan körs som en gratis Cloudflare Worker med en D1-databas. Spelet på haest.se pratar med den;
tills adressen är ifylld i spelet är topplistan helt dold och spelet fungerar som vanligt.

Filer här:

- `worker.js` – koden som körs hos Cloudflare
- `schema.sql` – tabellen i databasen

## Sätta upp den (ca 10 minuter, allt i webbläsaren)

1. **Konto.** Skapa ett gratis konto på [dash.cloudflare.com](https://dash.cloudflare.com/sign-up).
2. **Databasen.** Gå till **Storage & Databases → D1 SQL Database → Create**. Döp den till
   `haest-topplista` och skapa. Öppna den, gå till fliken **Console**, klistra in hela innehållet i
   `schema.sql` och tryck **Execute**.
3. **Workern.** Gå till **Workers & Pages → Create → Create Worker** (Hello World-mallen). Döp den till
   `haest-topplista` och tryck **Deploy**.
4. **Koden.** Tryck **Edit code**, markera allt och ersätt med innehållet i `worker.js`. Tryck **Deploy**.
5. **Koppla databasen.** I Workern: **Settings → Bindings → Add binding → D1 database**.
   Variabelnamn: `DB`. Databas: `haest-topplista`. Spara.
6. **Hemlighet.** **Settings → Variables and Secrets → Add**. Typ: **Secret**. Namn: `SECRET`.
   Värde: en lång slumpad sträng, minst 40 tecken (t.ex. från en lösenordshanterare). Spara och deploya.
7. **Testa.** Öppna Workerns adress med `/top` på slutet, t.ex.
   `https://haest-topplista.DITTNAMN.workers.dev/top`. Du ska se `{"top":[]}`.
8. **Koppla spelet.** Skriv in adressen (utan `/top`) i `turbogalopp/index.html`:
   `const LB_URL = 'https://haest-topplista.DITTNAMN.workers.dev';`

Menyernas namn i Cloudflare kan skilja sig lite, men stegen är desamma.

## Ta bort fusk eller olämpliga namn

Öppna databasen i Cloudflare → **Console** och kör:

```sql
-- De 50 bästa, med id
SELECT id, name, score, play_time, datetime(created_at / 1000, 'unixepoch') AS tid
FROM scores ORDER BY score DESC LIMIT 50;

-- Ta bort en rad
DELETE FROM scores WHERE id = 123;

-- Ta bort alla resultat för ett namn (skriv namnet exakt som det visas)
DELETE FROM scores WHERE name = 'Namnet';

-- Nollställ hela listan
DELETE FROM scores;
```

## Fuskskydd

Spelet körs i webbläsaren, så ingen topplista kan göras helt fuskfri. Den här gör det svårt:

- Varje inskickning kräver en signerad biljett som spelet får när en omgång börjar, och biljetten kan bara användas en gång.
- Poängen måste gå ihop med spelets egen formel och vara möjlig på den tid som faktiskt gått.
- Samma IP kan skicka högst 10 resultat per 10 minuter.
- Namn: 2–16 tecken, inga länkar och ett filter för de vanligaste fula orden.
- Bara haest.se får anropa den från en webbläsare.

Ändrar ni spelets poäng (morötter, toppfart) behöver konstanterna högst upp i `worker.js` följa med.
