// Hämtar bilder från Instagram (Graph API) till assets/gallery/ och uppdaterar data/gallery.json.
// Alla nya bilder godkänns automatiskt och sparas som 400x400 WebP (de visas i 170 px).
// Dölj en bild: sätt "approved": false på dess rad i data/gallery.json. Radera INTE raden,
// då hämtas bilden igen vid nästa synk. Bildfilen får du gärna ta bort.
// Kör: IG_USER_ID=... IG_TOKEN=... node scripts/sync-instagram.mjs (kräver ImageMagick).
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
// Sidan visar bara de senaste bilderna, så äldre inlägg än så här hämtas inte.
const NEWEST = 24;
const SIZE = 400;

// Bilder, videor (miniatyr) och karuseller (första bilden).
let url = `https://graph.instagram.com/v21.0/${IG_USER_ID}/media?fields=id,media_type,media_url,thumbnail_url,permalink,timestamp&limit=50&access_token=${encodeURIComponent(IG_TOKEN)}`;
const posts = [];
while (url && posts.length < NEWEST) {
  const res = await fetch(url);
  if (!res.ok) {
    // Visa Metas felmeddelande (utan token) så vi ser varför det går fel.
    const body = (await res.text()).replace(/access_token=[^&"\s]+/g, 'access_token=***').slice(0, 400);
    throw new Error(`Graph API svarade ${res.status}: ${body}`);
  }
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
for (const [index, post] of posts.entries()) {
  if (known.has(post.id)) {
    // Fyll i medietyp för bilder som hämtades innan vi sparade den.
    const item = known.get(post.id);
    if (!item.media_type) item.media_type = post.media_type;
    continue;
  }
  if (index >= NEWEST) continue;
  const src = await imageUrl(post);
  if (!src) continue;
  const img = await fetch(src);
  if (!img.ok) continue;
  const tmp = path.join(outDir, `${post.id}.download`);
  const file = `${post.id}.webp`;
  await writeFile(tmp, Buffer.from(await img.arrayBuffer()));
  try {
    // Beskär till kvadrat från mitten och krymp, samma som kortet visar.
    execFileSync('convert', [tmp, '-auto-orient', '-resize', `${SIZE}x${SIZE}^`, '-gravity', 'center', '-extent', `${SIZE}x${SIZE}`, '-strip', '-quality', '78', path.join(outDir, file)]);
  } finally {
    await unlink(tmp);
  }
  known.set(post.id, {
    id: post.id,
    src: `assets/gallery/${file}`,
    width: SIZE,
    height: SIZE,
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
