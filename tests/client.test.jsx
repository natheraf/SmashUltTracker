import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import CharacterGrid from '../src/components/CharacterGrid.jsx';
import SubmissionsQueue from '../src/components/admin/SubmissionsQueue.jsx';
import { IronmanCard, StreakCard } from '../src/components/home/LiveCards.jsx';
import CommunityVote from '../src/components/home/CommunityVote.jsx';
import Timeline from '../src/components/home/Timeline.jsx';
import SubmitVodDialog from '../src/components/SubmitVodDialog.jsx';
import IronmanPanel from '../src/components/tracker/IronmanPanel.jsx';
import { AuthProvider } from '../src/context/AuthContext.jsx';
import Admin from '../src/pages/Admin.jsx';
import Overlay from '../src/pages/Overlay.jsx';

/**
 * The UI has no browser in CI, so panels are rendered through react-dom/server.
 * That still catches broken render paths — bad props, missing guards, typos in
 * state field names — without needing jsdom.
 */

const deckEntry = (slug, name, status, drawOrder = null) => ({
  entry_id: drawOrder ?? 1,
  character_id: drawOrder ?? 1,
  slug,
  name,
  status,
  draw_order: drawOrder,
});

const ironmanRun = {
  id: 7,
  status: 'active',
  started_at: '2024-01-01T10:00:00.000Z',
  ended_at: null,
  elapsed_seconds: 754,
  running: true,
  paused: false,
  total: 86,
  won_count: 2,
  lost_count: 0,
  zero_since: null,
  current_draw: { entry_id: 9, character_id: 9, slug: 'mario', name: 'Mario' },
  entries: [
    deckEntry('donkey-kong', 'Donkey Kong', 'won', 1),
    deckEntry('link', 'Link', 'won', 2),
    deckEntry('mario', 'Mario', 'drawn', 3),
    deckEntry('samus', 'Samus', 'pending'),
  ],
};

const history = [
  {
    id: 3,
    status: 'failed',
    started_at: '2023-12-01T10:00:00.000Z',
    ended_at: '2024-01-01T09:00:00.000Z',
    duration_seconds: 3600,
    won_count: 1,
    total: 86,
  },
  {
    id: 4,
    status: 'completed',
    started_at: '2024-01-02T10:00:00.000Z',
    ended_at: '2024-01-03T10:00:00.000Z',
    won_count: 86,
    total: 86,
  },
];

function render(element) {
  return renderToString(element);
}

/** Strips React's `<!-- -->` text separators so phrases stay searchable. */
function plain(html) {
  return html.replace(/<!--.*?-->/g, '');
}

function renderRoute(path, element) {
  return renderToString(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/overlay/:token" element={element} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('IronmanPanel', () => {
  it('renders the empty state with rules and past runs', () => {
    const html = render(
      <IronmanPanel state={{ ironman: null, ironman_history: history }} act={async () => ({})} busy={false} />,
    );
    expect(html).toContain('Start a run');
    expect(html).toContain('Back to 50-win streak');
    expect(html).toContain('Past runs');
    expect(html).toContain('failed');
    expect(html).toContain('completed');
  });

  it('renders an active run with the draw, win count and resolved deck', () => {
    const html = render(
      <IronmanPanel
        state={{ ironman: ironmanRun, ironman_history: [] }}
        act={async () => ({})}
        busy={false}
      />,
    );
    expect(plain(html)).toContain('Win with Mario');
    expect(html).toContain('Loss — end the run…');
    expect(html).toContain('12:34'); // 754s elapsed
    expect(plain(html)).toContain('/ 86 won');
    // Pending fighters stay off the deck; the drawn one folds in.
    expect(html).toContain('ironman-tile is-drawn');
    expect(html).not.toContain('Samus');
  });

  it('renders the ready-to-draw state when nothing is drawn', () => {
    const html = render(
      <IronmanPanel
        state={{ ironman: { ...ironmanRun, current_draw: null }, ironman_history: [] }}
        act={async () => ({})}
        busy={false}
      />,
    );
    expect(html).toContain('Ready to draw');
    expect(html).toContain('Draw a random fighter');
    expect(html).not.toContain('Win with');
  });
});

describe('Overlay', () => {
  it('mounts on the token route before its first fetch resolves', () => {
    const html = renderRoute('/overlay/tok123', <Overlay />);
    expect(html).toContain('overlay-root');
  });
});

describe('home page pieces', () => {
  const streakCard = {
    streamer_id: 1,
    display_name: 'Nai',
    youtube_url: 'https://www.youtube.com/@nai',
    twitch_url: 'https://twitch.tv/nai',
    character: { id: 4, slug: 'samus', name: 'Samus' },
    wins: 3,
    target: 50,
    elapsed_seconds: 754,
    running: false,
    paused: false,
  };

  it('renders a live streak card with its timer and channel links', () => {
    const html = plain(render(<StreakCard card={streakCard} />));
    expect(html).toContain('Nai');
    expect(html).toContain('Samus');
    expect(html).toContain('3');
    expect(html).toContain('/ 50 wins');
    expect(html).toContain('12:34');
    expect(html).toContain('twitch.tv/nai');
    expect(html).toContain('aria-label="Nai on YouTube"');
  });

  it('renders an Ironman card with the drawn fighter and progress', () => {
    const html = plain(
      render(
        <IronmanCard
          card={{
            streamer_id: 2,
            display_name: 'Nai',
            youtube_url: null,
            twitch_url: 'https://twitch.tv/nai',
            run_id: 9,
            drawn: { id: 1, slug: 'mario', name: 'Mario' },
            won: 2,
            total: 86,
            elapsed_seconds: 60,
            running: true,
            paused: false,
          }}
        />,
      ),
    );
    expect(html).toContain('Ironman');
    expect(html).toContain('Mario');
    expect(html).toContain('/ 86');
    expect(html).toContain('fighters won');
  });

  it('shows the timeline loading state before its first fetch resolves', () => {
    expect(render(<Timeline />)).toContain('Loading');
  });

  it('marks completed, partial and selected fighters without a toolbar', () => {
    const characters = [
      { id: 1, slug: 'mario', name: 'Mario', series: 'Super Mario', select_order: 1 },
      { id: 2, slug: 'samus', name: 'Samus', series: 'Metroid', select_order: 4 },
    ];
    const html = render(
      <CharacterGrid
        characters={characters}
        streaks={[{ character_id: 2, wins: 12 }]}
        completed={new Set([1])}
        selectedId={2}
        onSelect={() => {}}
        toolbar={false}
        showTarget
      />,
    );
    expect(html).toContain('12/50');
    expect(html).toContain('char-cell is-completed');
    expect(html).toContain('is-selected');
    expect(html).not.toContain('char-picker-toolbar');
  });
});

const voteStandings = {
  utc_day: '2026-02-04',
  days: 30,
  candidates: [
    { character: { id: 1, slug: 'mario', name: 'Mario' }, today_votes: 4, month_votes: 9 },
    { character: { id: 2, slug: 'samus', name: 'Samus' }, today_votes: 1, month_votes: 3 },
  ],
  today: {
    top: [{ character: { id: 1, slug: 'mario', name: 'Mario' }, today_votes: 4, month_votes: 9 }],
    total: 5,
  },
  month: {
    top: [
      { character: { id: 1, slug: 'mario', name: 'Mario' }, today_votes: 4, month_votes: 9 },
      { character: { id: 2, slug: 'samus', name: 'Samus' }, today_votes: 1, month_votes: 3 },
    ],
    total: 12,
  },
  my_vote: null,
  winner: {
    utc_day: '2026-02-03',
    votes: 7,
    character: { id: 2, slug: 'samus', name: 'Samus' },
  },
};

describe('CommunityVote', () => {
  it('renders the ballot, todays leaders and the last winner', () => {
    const html = plain(render(<CommunityVote standings={voteStandings} onVote={() => {}} />));
    expect(html).toContain('next?');
    expect(html).toContain('Yesterday');
    expect(html).toContain('Samus');
    expect(html).toContain('7 votes on 2026-02-03');
    expect(html).toContain('Last 30 days');
    expect((html.match(/aria-pressed/g) || []).length).toBe(2);
    expect(html).toContain('Pick the fighter you want to see next');
  });

  it('locks the ballot once the visitor has voted', () => {
    const html = plain(
      render(
        <CommunityVote
          standings={{ ...voteStandings, my_vote: 1 }}
          busy={false}
          onVote={() => {}}
        />,
      ),
    );
    expect(html).toContain('You voted for');
    expect(html).toContain('vote-chip is-voted');
    expect(html).toContain('Come back tomorrow');
  });

  it('explains an empty ballot and shows the vote error', () => {
    const html = plain(
      render(
        <CommunityVote
          standings={{
            ...voteStandings,
            candidates: [],
            today: { top: [], total: 0 },
            month: { top: [], total: 0 },
            winner: null,
          }}
          error="You already voted today"
          onVote={() => {}}
        />,
      ),
    );
    expect(html).toContain('nothing left to vote for');
    expect(html).toContain('You already voted today');
    expect(html).not.toContain('Yesterday');
  });

  it('shows a loading line without standings', () => {
    expect(render(<CommunityVote standings={null} onVote={() => {}} />)).toContain('Loading the poll');
  });
});

describe('SubmitVodDialog', () => {
  const characters = [
    { id: 1, slug: 'mario', name: 'Mario', series: 'Super Mario' },
    { id: 2, slug: 'samus', name: 'Samus', series: 'Metroid' },
  ];

  it('renders the form for a single streamer', () => {
    const html = plain(
      render(
        <SubmitVodDialog
          streamers={[{ id: 1, display_name: 'Nai' }]}
          characters={characters}
          defaultStreamerId={1}
          onClose={() => {}}
        />,
      ),
    );
    expect(html).toContain('Submit a VOD');
    expect(html).toContain('Mario — Super Mario');
    expect(html).toContain('Starts at');
    expect(html).toContain('Send for review');
    // One streamer needs no streamer picker.
    expect(html).not.toContain('id="vod-streamer"');
  });

  it('lets a multi-streamer site pick who the VOD belongs to', () => {
    const html = plain(
      render(
        <SubmitVodDialog
          streamers={[
            { id: 1, display_name: 'Nai' },
            { id: 2, display_name: 'Other' },
          ]}
          characters={characters}
          onClose={() => {}}
        />,
      ),
    );
    expect(html).toContain('id="vod-streamer"');
    expect(html).toContain('Other');
  });
});

describe('admin panels', () => {
  it('renders the empty review queue with its shortcuts', () => {
    const html = plain(render(<SubmissionsQueue />));
    expect(html).toContain('VOD submissions');
    expect(html).toContain('Nothing in this queue.');
    expect(html).toContain('shortcuts:');
    expect(html).toContain('Approve selected');
  });

  it('keeps the admin page from crashing without permissions', () => {
    const html = render(
      <AuthProvider>
        <Admin />
      </AuthProvider>,
    );
    expect(html).toContain('Admin');
    expect(html).toContain('no admin permissions');
  });
});
