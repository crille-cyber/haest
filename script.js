'use strict';
(() => {
  const rail = document.querySelector('.project-rail');
  const collage = document.querySelector('.collage');
  const car = document.querySelector('.elevator-car');
  const person = document.querySelector('.elevator-person');
  const links = [...rail.querySelectorAll('a')];
  const targets = ['.fass-diagram', '.hemkop', '.rekord', '.bilia'].map(s => document.querySelector(s));
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
    if (centers[3] > lastCenter) {
      centers[3] = lastCenter;
      for (let i = 2; i >= 0; i--) centers[i] = Math.min(centers[i], centers[i + 1] - gap);
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
          const exitSide = mobile.matches || i !== 3 ? -1 : 1;
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
      if (!matched) { y = floorY[3]; current = 3; state = 'finished'; }
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
