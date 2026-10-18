import { useMemo, useState } from 'react';
import CharacterImage from './CharacterImage.jsx';

/**
 * The character picker, laid out like Ultimate's select screen: 13 columns per
 * row (the last row has 8), following the seed's fighter-number order with Mii
 * Fighters at the end. `onSelect` makes the cells clickable; `toolbar` (on by
 * default when `onSelect` is set) adds the search box and completed filter.
 */
export default function CharacterGrid({
  characters,
  streaks = [],
  completed = new Set(),
  selectedId = null,
  onSelect = null,
  // Read-only pages (home) still want clickable cells, just no picker toolbar.
  toolbar = Boolean(onSelect),
  // The tracker grid stays compact; the home grid spells out "12/50".
  showTarget = false,
  dense = false,
}) {
  const [query, setQuery] = useState('');
  const [hideCompleted, setHideCompleted] = useState(false);

  const streakByChar = useMemo(
    () => new Map(streaks.map((streak) => [streak.character_id, streak])),
    [streaks],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return characters.filter((character) => {
      if (hideCompleted && completed.has(character.id)) return false;
      if (!q) return true;
      return character.name.toLowerCase().includes(q) || character.slug.includes(q);
    });
  }, [characters, query, hideCompleted, completed]);

  return (
    <div className="char-picker">
      {toolbar ? (
        <div className="char-picker-toolbar">
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search fighters…"
            aria-label="Search characters"
          />
          <label className="check">
            <input
              type="checkbox"
              checked={hideCompleted}
              onChange={(event) => setHideCompleted(event.target.checked)}
            />
            Hide completed
          </label>
          <span className="muted">
            {completed.size} / {characters.length} done
          </span>
        </div>
      ) : null}

      <div className="char-grid">
        {visible.map((character) => {
          const streak = streakByChar.get(character.id);
          const wins = streak?.wins || 0;
          const isCompleted = completed.has(character.id);
          const isSelected = selectedId === character.id;
          const classes = [
            'char-cell',
            isCompleted ? 'is-completed' : '',
            isSelected ? 'is-selected' : '',
            streak ? 'has-streak' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const label = `${character.name} — ${isCompleted ? 'completed' : `${wins}/50`}`;
          const inner = (
            <>
              <span className="char-cell-img">
                <CharacterImage slug={character.slug} name={character.name} size={56} />
              </span>
              <span className="char-cell-name">{character.name}</span>
              <span className="char-cell-bar" aria-hidden="true">
                <i style={{ width: `${(wins / 50) * 100}%` }} />
              </span>
              {wins > 0 && !isCompleted ? (
                <span className="char-cell-wins">{showTarget ? `${wins}/50` : wins}</span>
              ) : null}
              {isCompleted ? (
                <span className="char-check" aria-hidden="true">
                  ✓
                </span>
              ) : null}
            </>
          );
          return onSelect ? (
            <button
              key={character.id}
              type="button"
              className={classes}
              onClick={() => onSelect(character.id)}
              title={label}
              aria-pressed={isSelected}
            >
              {inner}
            </button>
          ) : (
            <div key={character.id} className={classes} title={label}>
              {inner}
            </div>
          );
        })}
      </div>
      {toolbar && visible.length === 0 ? <p className="muted">No fighters match.</p> : null}
    </div>
  );
}
