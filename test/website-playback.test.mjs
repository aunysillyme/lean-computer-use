import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupTrailer } from '../website/assets/trailer.js';

function fixture(reduced = false, reject = false) {
  const events = {}, attrs = {};
  let click, change, plays = 0, loads = 0;
  const preference = { matches: reduced, addEventListener: (_, fn) => { change = fn; } };
  const button = { setAttribute: (key, value) => { attrs[key] = value; }, addEventListener: (_, fn) => { click = fn; } };
  const video = {
    paused: true, currentTime: 0, autoplay: true,
    addEventListener: (name, fn) => { events[name] = fn; },
    play() { plays++; if (reject) return Promise.reject(Error('Denied')); this.paused = false; events.play(); return Promise.resolve(); },
    pause() { this.paused = true; events.pause(); },
    removeAttribute(name) { if (name === 'autoplay') this.autoplay = false; },
    load() { loads++; },
  };
  setupTrailer(video, { matchMedia: () => preference }, { querySelector: () => button });
  return { video, button, attrs, preference, click: () => click(), change: () => change(), plays: () => plays, loads: () => loads };
}

test('trailer starts muted and the keyboard button tracks play and pause', () => {
  const f = fixture();
  assert.equal(f.plays(), 1);
  assert.equal(f.video.muted, true);
  assert.equal(f.attrs['aria-pressed'], 'true');
  assert.equal(f.button.textContent, 'Pause trailer');
  f.click();
  assert.equal(f.video.paused, true);
  assert.equal(f.attrs['aria-label'], 'Play trailer');
  f.click();
  assert.equal(f.video.paused, false);
});

test('reduced motion restores the poster and waits for explicit play', () => {
  const f = fixture(true);
  assert.equal(f.plays(), 0);
  assert.equal(f.video.autoplay, false);
  assert.equal(f.video.paused, true);
  assert.equal(f.loads(), 1);
  f.click();
  assert.equal(f.plays(), 1);
  assert.equal(f.attrs['aria-pressed'], 'true');
  f.video.currentTime = 8;
  f.change();
  assert.equal(f.video.currentTime, 0);
  assert.equal(f.video.paused, true);
  f.preference.matches = false;
  f.change();
  assert.equal(f.video.paused, false);
});

test('blocked autoplay leaves a usable play button', async () => {
  const f = fixture(false, true);
  await Promise.resolve();
  assert.equal(f.video.paused, true);
  assert.equal(f.attrs['aria-pressed'], 'false');
  assert.equal(f.button.textContent, 'Play trailer');
});
