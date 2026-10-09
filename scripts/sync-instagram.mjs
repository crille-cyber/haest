// Hämtar bilder från Instagram (Graph API) till assets/gallery/ och uppdaterar data/gallery.json.
// Nya bilder kommer in med approved:false. Sätt approved:true på de som ska visas i galleriet.
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

// Bara bilder (IMAGE). Karuseller och videor hoppas över tills vi behöver dem.
let url = `https://graph.facebook.com/v21.0/${IG_USER_ID}/media?fields=id,media_type,media_url,permalink,timestamp&limit=50&access_token=${encodeURIComponent(IG_TOKEN)}`;
const posts = [];
while (url && posts.length < 200) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Graph API svarade ${res.status}. Kontrollera token och konto.`);
  const page = await res.json();
  posts.push(...page.data.filter(m => m.media_type === 'IMAGE' && m.media_url));
  url = page.paging?.next || null;
}

await mkdir(outDir, { recursive: true });
let added = 0;
for (const post of posts) {
  if (known.has(post.id)) continue;
  const img = await fetch(post.media_url);
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
    approved: false,
  });
  added++;
}

const items = [...known.values()].sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
await writeFile(galleryPath, JSON.stringify({ items }, null, 2) + '\n');
console.log(`${added} nya bilder. ${items.length} totalt, ${items.filter(i => i.approved).length} godkända.`);
