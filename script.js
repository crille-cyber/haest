'use strict';
(() => {
  const rail = document.querySelector('.project-rail');
  if (!rail) return;
  const collage = document.querySelector('.collage');
  const car = document.querySelector('.elevator-car');
  const person = document.querySelector('.elevator-person');
  const links = [...rail.querySelectorAll('a')];
  const targets = ['.fass', '.hemkop', '.rekord', '#citat', '#skjut-mig', '#contact'].map(s => document.querySelector(s));
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = window.matchMedia('(max-width: 700px)');
  const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
  const ease = n => n * n * (3 - 2 * n);
  let layout, queued = false;

  function measure() {
    const pageY = window.scrollY;
    const collageTop = collage.getBoundingClientRect().top + pageY;
    const intro = document.querySelector('.intro');
    const railTop = mobile.matches ? intro.getBoundingClientRect().bottom + pageY - collageTop + 12 : 0;
    rail.style.top = `${railTop}px`;
    // Rälsen följer sidan ned till footern, så hissen kan åka hela vägen.
    const footerTop = document.querySelector('footer').getBoundingClientRect().top + pageY;
    const collageBottom = collage.getBoundingClientRect().bottom + pageY;
    rail.style.bottom = `${-(footerTop - collageBottom)}px`;
    const railRect = rail.getBoundingClientRect();
    const width = railRect.width;
    const carWidth = width * .78;
    const carHeight = clamp(width * 1.65, 66, 112);
    const startY = mobile.matches ? 18 : Math.max(108, width * 2);
    const floorY = targets.map((target, i) => {
      const box = target.getBoundingClientRect();
      const fraction = i === 0 ? .58 : i === 1 ? .48 : i === 2 ? .3 : .48;
      return clamp(box.top + pageY + box.height * fraction - railRect.top - pageY - carHeight / 2, startY + carHeight, railRect.height - carHeight - 15);
    });
    // Each floor gets a complete arrival / walk out / return / departure sequence.
    // The stops are separated even when two project blocks sit next to each other.
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const entrySpan = Math.min(100, maxScroll * .085);
    const firstCenter = entrySpan + 70;
    const lastCenter = Math.max(firstCenter + 210, maxScroll - 80);
    const gap = Math.min(160, (lastCenter - firstCenter) / 3);
    const centers = floorY.map(y => clamp(railRect.top + pageY + y + carHeight / 2 - innerHeight * .5, firstCenter, lastCenter));
    for (let i = 1; i < centers.length; i++) centers[i] = Math.max(centers[i], centers[i - 1] + gap);
    if (centers[centers.length - 1] > lastCenter) {
      centers[centers.length - 1] = lastCenter;
      for (let i = centers.length - 2; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - gap);
    }
    const halfStop = Math.min(65, gap * .34);
    layout = { width, carWidth, carHeight, startY, floorY, centers, halfStop, entrySpan, railDocTop: railRect.top + pageY };
    rail.style.setProperty('--car-width', `${carWidth}px`);
    rail.style.setProperty('--car-height', `${carHeight}px`);
    floorY.forEach((y, i) => { links[i].style.top = `${Math.max(0, y - 54)}px`; links[i].dataset.scrollStop = centers[i].toFixed(1); });
    draw();
  }

  function draw() {
    queued = false;
    if (!layout) return;
    const { width, carWidth, startY, floorY, centers, halfStop, entrySpan } = layout;
    const scroll = Math.max(0, window.scrollY);
    let y = startY, x = 0, doors = 0, walking = false, walkPhase = 0, direction = -1, current = -1, state = 'travelling';
    const entrySide = mobile.matches ? -1 : 1;
    if (scroll <= entrySpan) {
      const progress = clamp(scroll / entrySpan);
      x = entrySide * width * 1.6 * (1 - ease(clamp(progress / .8)));
      doors = progress < .8 ? 1 : 1 - (progress - .8) / .2;
      walking = progress > 0 && progress < .8;
      walkPhase = progress * 16;
      direction = -entrySide;
      state = 'entering';
    } else {
      let previousY = startY, previousEnd = entrySpan, matched = false;
      for (let i = 0; i < floorY.length; i++) {
        const arrive = centers[i] - halfStop;
        const depart = centers[i] + halfStop;
        if (scroll < arrive) {
          y = previousY + (floorY[i] - previousY) * ease(clamp((scroll - previousEnd) / Math.max(1, arrive - previousEnd)));
          current = i;
          matched = true;
          break;
        }
        if (scroll <= depart) {
          const p = clamp((scroll - arrive) / (depart - arrive));
          // Vänster mot innehållet på gig/musik/om. Höger på de nedre våningarna där ytan till höger är tom.
          const exitSide = mobile.matches || i < 3 ? -1 : 1;
          const distance = carWidth * (exitSide > 0 ? .94 : 1.25);
          y = floorY[i];
          current = i;
          state = 'at-floor';
          if (p < .14) { doors = ease(p / .14); }
          else if (p < .44) {
            const step = (p - .14) / .3;
            doors = 1; x = exitSide * distance * ease(step);
            walking = true; walkPhase = step * 12; direction = exitSide;
            state = 'walking-out';
          } else if (p < .59) {
            doors = 1; x = exitSide * distance; direction = exitSide;
            state = 'visiting';
          } else if (p < .87) {
            const step = (p - .59) / .28;
            doors = 1; x = exitSide * distance * (1 - ease(step));
            walking = true; walkPhase = step * 12; direction = -exitSide;
            state = 'walking-in';
          } else { doors = 1 - ease((p - .87) / .13); }
          matched = true;
          break;
        }
        previousY = floorY[i]; previousEnd = depart;
      }
      if (!matched) { y = floorY[floorY.length - 1]; current = floorY.length - 1; state = 'finished'; }
    }
    if (reducedMotion.matches) {
      current = centers.findIndex(c => scroll < c + halfStop);
      if (current < 0) current = 3;
      y = floorY[current]; x = 0; doors = 1; walking = false;
      state = 'reduced-motion';
    }
    car.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    car.style.setProperty('--doors-open', clamp(doors).toFixed(4));
    person.style.transform = `translate3d(${x.toFixed(2)}px,0,0) scaleX(${direction})`;
    person.style.setProperty('--frame', walking ? 1 + Math.floor(walkPhase) % 4 : 0);
    rail.dataset.state = state;
    rail.dataset.floor = current < 0 ? 'entrance' : String(current + 1);
    links.forEach((link, i) => {
      const active = current === i;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
  }

  function schedule() {
    if (!queued) { queued = true; requestAnimationFrame(draw); }
  }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', measure);
  window.addEventListener('load', measure);
  reducedMotion.addEventListener('change', measure);
  mobile.addEventListener('change', measure);
  links.forEach((link, i) => link.addEventListener('click', event => {
    event.preventDefault();
    rail.dataset.lastClick = String(i);
    rail.dataset.requestedScroll = layout.centers[i].toFixed(1);
    history.replaceState(null, '', link.getAttribute('href'));
    window.scrollTo({ top: layout.centers[i], behavior: 'instant' });
  }));
  // Image loading and typography can change mobile floor positions after first paint.
  new ResizeObserver(measure).observe(collage);
  measure();
})();

// häst: spelningar från data/gigs.json. Spelade konserter visas genomstrukna.
(() => {
  const MONTHS_SV = ['jan', 'feb', 'mars', 'apr', 'maj', 'juni', 'juli', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const list = document.getElementById('gig-list');
  if (!list) return;
  const today = (() => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; })();
  const fmt = iso => { const [y, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS_SV[m - 1]} ${y}`; };
  const row = gig => {
    const li = document.createElement('li');
    const past = Boolean(gig.date) && gig.date < today;
    if (past) li.classList.add('gig-past');
    const date = document.createElement('span');
    date.className = 'gig-date';
    date.textContent = gig.date ? fmt(gig.date) : 'Datum TBA';
    const info = document.createElement('span');
    const venue = document.createElement('span');
    venue.className = 'gig-venue';
    venue.textContent = gig.venue;
    const city = document.createElement('span');
    city.className = 'gig-city';
    city.textContent = `, ${gig.city}`;
    info.append(venue, city);
    if (gig.link && !past) {
      const a = document.createElement('a');
      a.href = gig.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' biljetter →';
      info.append(a);
    }
    li.append(date, info);
    return li;
  };
  fetch('data/gigs.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(({ gigs }) => {
      const upcoming = gigs.filter(g => g.date && g.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const tba = gigs.filter(g => !g.date);
      const played = gigs.filter(g => g.date && g.date < today).sort((a, b) => b.date.localeCompare(a.date));
      list.replaceChildren(...[...upcoming, ...tba, ...played].map(row));
    })
    .catch(err => {
      list.innerHTML = '<li class="gig-empty">Kunde inte ladda spelningarna just nu.</li>';
      console.error('gigs:', err);
    });
})();

// häst: Spotify-spelare i slots. Sätt data-track="<Spotify-track-ID>" i index.html.
(() => {
  document.querySelectorAll('.spotify-slot[data-track]').forEach(slot => {
  const id = slot.dataset.track.trim();
  if (!/^[A-Za-z0-9]{22}$/.test(id)) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://open.spotify.com/embed/track/${id}?utm_source=generator`;
  iframe.width = '100%';
  iframe.height = slot.dataset.height || '80';
  iframe.loading = 'lazy';
  iframe.frameBorder = '0';
  iframe.allow = 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture';
  iframe.title = slot.getAttribute('aria-label') || 'Spotify';
  slot.replaceChildren(iframe);
  slot.classList.add('spotify-live');
});
})();

// häst: ett polaroidkort per plats (data-slot). Platserna i sidordning får de senaste godkända bilderna.
(() => {
  const slots = [...document.querySelectorAll('.polaroids[data-slot]')];
  if (!slots.length) return;
  const TILT = [-4, 3, -2, 5, -3, 2, -5, 4];
  const MONTHS = ['januari', 'februari', 'mars', 'april', 'maj', 'juni', 'juli', 'augusti', 'september', 'oktober', 'november', 'december'];
  // Handskriven text nedtill på kortet: medietyp och datum.
  function captionFor(item) {
    const [y, m, d] = (item.timestamp || '').slice(0, 10).split('-').map(Number);
    const date = y ? `${d} ${MONTHS[m - 1]} ${y}` : '';
    const kind = item.media_type === 'VIDEO' ? 'Video' : item.media_type ? 'Foto' : '';
    return [kind, date].filter(Boolean).join(' · ');
  }
  fetch('data/gallery.json', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(({ items }) => {
      const shown = items.filter(i => i.approved && i.src && i.permalink).slice(0, slots.length);
      shown.forEach((item, n) => {
        const wrap = slots[n];
        const a = document.createElement('a');
        a.className = 'polaroid';
        a.href = item.permalink;
        a.target = '_blank';
        a.rel = 'noopener';
        a.setAttribute('aria-label', `${item.alt || 'Bild från häst'}, öppnas på Instagram`);
        a.style.setProperty('--tilt', `${TILT[n % TILT.length]}deg`);
        const img = document.createElement('img');
        img.src = item.src;
        img.alt = item.alt || 'Bild från häst';
        img.loading = 'lazy';
        img.decoding = 'async';
        const caption = document.createElement('span');
        caption.className = 'polaroid-caption';
        caption.textContent = captionFor(item);
        a.append(img, caption);
        wrap.replaceChildren(a);
        wrap.hidden = false;
      });
    })
    .catch(err => console.error('galleri:', err));
})();
