// Skriver in spelningar och strukturerad data (JSON-LD) direkt i index.html,
// så att sökmotorer och AI-tjänster ser dem även utan att köra JavaScript.
// Körs automatiskt av .github/workflows/build-seo.yml när data/gigs.json ändras.
// Manuellt: node scripts/build-seo.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SITE = 'https://haest.se/';
const SPOTIFY_ARTIST = 'https://open.spotify.com/artist/46Y0N0k3EoQDd82sxmXX8w';
// Fyll i när länken finns, så hamnar den i den strukturerade datan och llms.txt.
const APPLE_MUSIC_ARTIST = '';
const MONTHS_SV = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];

const { gigs } = JSON.parse(readFileSync('data/gigs.json', 'utf8'));
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeLink = url => (typeof url === 'string' && /^https:\/\//.test(url) ? url : null);
const fmt = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_SV[m - 1]} ${y}`; };

const upcoming = gigs.filter(g => g.date && g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
const tba = gigs.filter(g => !g.date);
const played = gigs.filter(g => g.date && g.date < today).sort((a, b) => b.date.localeCompare(a.date));

// Samma markup som script.js bygger, så sidan ser likadan ut före och efter laddning.
const row = g => {
  const past = Boolean(g.date) && g.date < today;
  const date = g.date ? `<time class="gig-date" datetime="${g.date}">${fmt(g.date)}</time>` : '<span class="gig-date">Datum TBA</span>';
  const link = safeLink(g.link) && !past ? `<a href="${esc(g.link)}" target="_blank" rel="noopener"> biljetter →<span class="sr-only"> (öppnas i ny flik)</span></a>` : '';
  return `<li${past ? ' class="gig-past"' : ''}>${date}<span><span class="gig-venue">${esc(g.venue)}</span><span class="gig-city">, ${esc(g.city)}</span>${link}</span></li>`;
};
const listHtml = [...upcoming, ...tba, ...played].map(row).join('') || '<li class="gig-empty">Inga spelningar inbokade just nu.</li>';

const band = {
  '@type': 'MusicGroup',
  '@id': `${SITE}#band`,
  name: 'häst',
  alternateName: ['Häst', 'Haest'],
  url: SITE,
  image: `${SITE}assets/og-image.jpg`,
  description: 'häst är ett grungeband från Uppsala som spelar vrålande balader på svenska, punk-slarvig grunge.',
  genre: ['Grunge', 'Alternativ rock', 'Punk'],
  foundingDate: '2025',
  foundingLocation: { '@type': 'Place', name: 'Uppsala, Sverige', address: { '@type': 'PostalAddress', addressLocality: 'Uppsala', addressCountry: 'SE' } },
  email: 'bandet@haest.se',
  sameAs: ['https://www.facebook.com/haest.se/', 'https://www.instagram.com/haest.se/', SPOTIFY_ARTIST, APPLE_MUSIC_ARTIST].filter(Boolean),
  track: [
    { '@type': 'MusicRecording', name: 'Akta', url: 'https://open.spotify.com/track/1VEEz3Ve9GJQIqUpxDwzvs' },
    { '@type': 'MusicRecording', name: 'Skjut mig nu', url: 'https://open.spotify.com/track/6rJhMOM1PLizFBGZvp1qNj' }
  ]
};

const events = gigs.filter(g => g.date).map(g => ({
  '@type': 'MusicEvent',
  name: `häst på ${g.venue}`,
  startDate: g.date,
  eventStatus: 'https://schema.org/EventScheduled',
  eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
  location: { '@type': 'Place', name: g.venue, address: { '@type': 'PostalAddress', addressLocality: g.city, addressCountry: 'SE' } },
  description: `häst spelar grunge på ${g.venue} i ${g.city}.`,
  performer: { '@id': `${SITE}#band` },
  image: `${SITE}assets/og-image.jpg`,
  ...(safeLink(g.link) ? { url: g.link, offers: { '@type': 'Offer', url: g.link } } : { url: `${SITE}#work` })
}));

const website = { '@type': 'WebSite', '@id': `${SITE}#site`, url: SITE, name: 'häst', inLanguage: 'sv-SE', publisher: { '@id': `${SITE}#band` } };
const jsonLd = JSON.stringify({ '@context': 'https://schema.org', '@graph': [band, website, ...events] }, null, 1).replace(/</g, '\\u003c');

const replaceBetween = (html, name, content) => {
  const re = new RegExp(`(<!-- ${name}:start -->)[\\s\\S]*?(<!-- ${name}:end -->)`);
  if (!re.test(html)) throw new Error(`Markör saknas i index.html: ${name}`);
  return html.replace(re, `$1${content}$2`);
};

let html = readFileSync('index.html', 'utf8');
html = replaceBetween(html, 'gigs', listHtml);
html = replaceBetween(html, 'jsonld', `\n<script type="application/ld+json">\n${jsonLd}\n</script>\n`);
// Cache-bust: ?v= blir en hash av filens innehåll, så besökare alltid får senaste versionen.
for (const file of ['styles.css', 'script.js']) {
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);
  html = html.replace(new RegExp(`${file.replace('.', '\\.')}\\?v=[\\w]+`, 'g'), `${file}?v=${hash}`);
}
writeFileSync('index.html', html);

// llms.txt: faktasammanfattning för AI-tjänster, med aktuella spelningar.
const gigLine = g => `- ${fmt(g.date)}: ${g.venue}, ${g.city}${safeLink(g.link) ? ` (biljetter: ${g.link})` : ''}`;
const llms = `# häst

> häst är ett grungeband från Uppsala, Sverige, bildat 2025. Bandet spelar vrålande balader på svenska: punk-slarvig grunge.

## Om bandet
- Hemstad: Uppsala, Sverige
- Bildat: 2025
- Genre: grunge, alternativ rock, punk
- Språk: svenska
- Sättning: bas, trummor, gitarr och sång
- Senaste singel: "Akta" (https://open.spotify.com/track/1VEEz3Ve9GJQIqUpxDwzvs)
- Annan låt: "Skjut mig nu" (https://open.spotify.com/track/6rJhMOM1PLizFBGZvp1qNj)
- Bandet beskriver sig själva som om Nirvana kom från Eskilstuna. Lyssnare har jämfört dem med Dungen och Pixies.

## Kommande spelningar
${upcoming.length ? upcoming.map(gigLine).join('\n') : '- Inga inbokade just nu.'}

Alla spelningar: ${SITE}#work

## Spel
Bandet har gjort webbspelet Turbogalopp, gratis att spela i webbläsaren på mobil och dator: ${SITE}turbogalopp/

## Lyssna och följ
- Spotify: ${SPOTIFY_ARTIST}
${APPLE_MUSIC_ARTIST ? `- Apple Music: ${APPLE_MUSIC_ARTIST}\n` : ''}- Instagram: https://www.instagram.com/haest.se/
- Facebook: https://www.facebook.com/haest.se/

## Kontakt och bokning
- E-post: bandet@haest.se
- Webbplats: ${SITE}
`;
writeFileSync('llms.txt', llms);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>
  <url><loc>${SITE}turbogalopp/</loc></url>
</urlset>
`;
writeFileSync('sitemap.xml', sitemap);
console.log(`Klart: ${upcoming.length} kommande, ${played.length} spelade spelningar.`);
