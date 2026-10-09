// Hämtar bilder från Instagram (Graph API) till assets/gallery/ och uppdaterar data/gallery.json.
// Alla nya bilder godkänns automatiskt. Ta bort en bild genom att radera dess rad i data/gallery.json och filen i assets/gallery/.
// Kör: IG_USER_ID=... IG_TOKEN=... node scripts/sync-instagram.mjs
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { IG_USER_ID, IG_TOKEN } = process.env;
if (!IG_USER_ID || !IG_TOKEN) {
  console.error('Sätt IG_USER_ID och IG_TOKEN.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const galleryPath = path.join(root, 'data/gallery.json');
const outDir = path.join(root, 'assets/gallery');
const current = existsSync(galleryPath) ? JSON.parse(await readFile(galleryPath, 'utf8')) : { items: [] };
const known = new Map(current.items.map(i => [i.id, i]));

// Bilder, videor (miniatyr) och karuseller (första bilden).
let url = `https://graph.instagram.com/v21.0/${IG_USER_ID}/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=50&access_token=${encodeURIComponent(IG_TOKEN)}`;
const posts = [];
while (url && posts.length < 200) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Graph API svarade ${res.status}. Kontrollera token och konto.`);
  const page = await res.json();
  posts.push(...page.data);
  url = page.paging?.next || null;
}

// Ger URL till en bild för inlägget, eller null om det inte går.
async function imageUrl(post) {
  if (post.media_type === 'IMAGE') return post.media_url;
  if (post.media_type === 'VIDEO') return post.thumbnail_url || null;
  if (post.media_type === 'CAROUSEL_ALBUM') {
    const res = await fetch(`https://graph.instagram.com/v21.0/${post.id}/children?fields=media_type,media_url,thumbnail_url&access_token=${encodeURIComponent(IG_TOKEN)}`);
    if (!res.ok) return null;
    const { data = [] } = await res.json();
    const first = data.find(c => c.media_type === 'IMAGE') || data[0];
    if (!first) return null;
    return first.media_type === 'VIDEO' ? first.thumbnail_url : first.media_url;
  }
  return null;
}

await mkdir(outDir, { recursive: true });
let added = 0;
for (const post of posts) {
  if (known.has(post.id)) {
    // Fyll i medietyp för bilder som hämtades innan vi sparade den.
    const item = known.get(post.id);
    if (!item.media_type) item.media_type = post.media_type;
    continue;
  }
  const src = await imageUrl(post);
  if (!src) continue;
  const img = await fetch(src);
  if (!img.ok) continue;
  const ext = (img.headers.get('content-type') || '').includes('png') ? 'png' : 'jpg';
  const file = `${post.id}.${ext}`;
  await writeFile(path.join(outDir, file), Buffer.from(await img.arrayBuffer()));
  known.set(post.id, {
    id: post.id,
    src: `assets/gallery/${file}`,
    alt: '',
    permalink: post.permalink,
    timestamp: post.timestamp,
    media_type: post.media_type,
    approved: true,
  });
  added++;
}

const items = [...known.values()].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
await writeFile(galleryPath, JSON.stringify({ items }, null, 2) + '\n');
console.log(`${added} nya bilder. ${items.length} totalt, ${items.filter(i => i.approved).length} godkända.`);
