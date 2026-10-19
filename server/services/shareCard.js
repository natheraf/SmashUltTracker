import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';
import { projectRoot } from '../db.js';

/**
 * Share card: renders the "live" hero as 1200x630 SVG using satori, then
 * rasterizes to PNG with resvg. It is intentionally simple and reads
 * straight off the home snapshot; only what's needed to show the challenge
 * at a glance.
 */

const FONT_PATH = path.join(projectRoot, 'server/fonts/Inter-Regular.woff2');
const FONT_BUFFER = fs.readFileSync(FONT_PATH);

const THEME = {
  bg: '#0b0d12',
  card: '#161a24',
  border: '#262c3a',
  text: '#e8ebf2',
  muted: '#9aa3b5',
  accent: '#4f8cff',
  success: '#3ecf8e',
};

const WIDTH = 1200;
const HEIGHT = 630;
const PADDING = 40;

const CSS = `
  * { box-sizing: border-box; }
  .root {
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: ${PADDING}px;
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: radial-gradient(1200px 720px at 80% 0%, rgba(79,140,255,0.15) 0%, ${THEME.bg} 70%);
    color: ${THEME.text};
    font-family: Inter, system-ui, -apple-system, sans-serif;
  }
  .header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 40px;
  }
  .title-box {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .title {
    font-size: 68px;
    font-weight: 700;
    line-height: 0.95;
    letter-spacing: -1px;
  }
  .subtitle {
    font-size: 26px;
    color: ${THEME.muted};
    max-width: 760px;
    line-height: 1.3;
  }
  .live-pill {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 18px;
    border-radius: 999px;
    background: rgba(62,207,142,0.14);
    border: 2px solid rgba(62,207,142,0.55);
    color: ${THEME.success};
    font-size: 20px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    box-shadow: 0 12px 80px -30px rgba(62,207,142,0.9);
    flex-shrink: 0;
  }
  .dot {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: ${THEME.success};
  }
  .cards {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    align-items: flex-end;
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 22px 24px;
    background: ${THEME.card};
    border: 1px solid ${THEME.border};
    border-radius: 18px;
    min-width: 320px;
    max-width: 560px;
    box-shadow: 0 40px 120px -40px rgba(0,0,0,0.6);
  }
  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
  }
  .name {
    font-size: 36px;
    font-weight: 700;
  }
  .meta {
    font-size: 20px;
    color: ${THEME.muted};
  }
  .progress {
    display: flex;
    align-items: flex-end;
    gap: 16px;
  }
  .big {
    font-size: 60px;
    font-weight: 800;
    line-height: 0.9;
  }
  .target {
    font-size: 30px;
    color: ${THEME.muted};
    padding-bottom: 6px;
  }
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .brand {
    font-size: 22px;
    color: ${THEME.muted};
  }
  .accent {
    color: ${THEME.accent};
  }
`;

function card({ title, name, wins, target, meta }) {
  return {
    type: 'div',
    props: {
      className: 'card',
      children: [
        {
          type: 'div',
          props: {
            className: 'card-top',
            children: [
              { type: 'div', props: { className: 'name', children: name } },
              meta ? { type: 'div', props: { className: 'meta', children: meta } } : null,
            ].filter(Boolean),
          },
        },
        title ? { type: 'div', props: { className: 'meta', children: title } } : null,
        {
          type: 'div',
          props: {
            className: 'progress',
            children: [
              { type: 'div', props: { className: 'big', children: String(wins) } },
              { type: 'div', props: { className: 'target', children: `/ ${target}` } },
            ],
          },
        },
      ],
    },
  };
}

function livePill() {
  return {
    type: 'div',
    props: {
      className: 'live-pill',
      children: [
        { type: 'div', props: { className: 'dot' } },
        { type: 'span', props: { children: 'LIVE NOW' } },
      ],
    },
  };
}

export async function renderLiveCardPng({ home, progress }) {
  const cards = [];

  for (const s of home.streaks.slice(0, 3)) {
    cards.push(
      card({
        name: s.display_name,
        wins: s.wins,
        target: s.target,
        title: s.character.name,
      }),
    );
  }
  for (const ir of home.ironman.slice(0, 2)) {
    cards.push(
      card({
        name: ir.display_name,
        wins: ir.won,
        target: ir.total,
        title: 'Ironman',
        meta: ir.drawn ? `Next: ${ir.drawn.name}` : 'Ready to draw',
      }),
    );
  }
  if (cards.length === 0 && home.streamers.length > 0) {
    const primary = home.primary_streamer_id;
    cards.push(
      card({
        name: home.streamers.find((x) => x.id === primary)?.display_name || 'The challenge',
        wins: progress?.completions?.length ?? 0,
        target: 86,
        title: '50 wins with every fighter',
      }),
    );
  }

  const subtitle =
    home.streaks.length || home.ironman.length
      ? 'Watch the run live — new wins and milestones as they happen.'
      : 'Tracking 50 wins with every fighter. Join the community and submit your VODs.';

  const svg = await satori(
    {
      type: 'div',
      props: {
        className: 'root',
        children: [
          {
            type: 'div',
            props: {
              className: 'header',
              children: [
                {
                  type: 'div',
                  props: {
                    className: 'title-box',
                    children: [
                      { type: 'div', props: { className: 'title', children: 'SmashUltTracker' } },
                      { type: 'div', props: { className: 'subtitle', children: subtitle } },
                    ],
                  },
                },
                livePill(),
              ],
            },
          },
          { type: 'div', props: { className: 'cards', children: cards } },
          {
            type: 'div',
            props: {
              className: 'footer',
              children: [
                { type: 'div', props: { className: 'brand', children: 'smashulttracker' } },
                {
                  type: 'div',
                  props: {
                    className: 'brand',
                    children: [
                      'Community tracker — ',
                      { type: 'span', props: { className: 'accent', children: 'smashulttracker.app' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [{ name: 'Inter', data: FONT_BUFFER, weight: 400, style: 'normal' }],
    },
  );

  const png = new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
  return png;
}
