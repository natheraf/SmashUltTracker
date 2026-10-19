import { useCallback, useEffect, useState } from 'react';
import { api, patch } from '../../api.js';
import AdminSection, { AdminTable } from './AdminSection.jsx';

const EDITABLE = ['name', 'series', 'select_order', 'is_echo', 'is_dlc'];

/**
 * Roster metadata: display name, series, roster position and echo/DLC flags.
 * These drive the select-screen grid everywhere on the site, so changes show up
 * immediately — no reseed needed.
 */
export default function CharactersPanel() {
  const [characters, setCharacters] = useState([]);
  const [edits, setEdits] = useState({});
  const [query, setQuery] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api('/api/admin/characters')
      .then((data) => {
        setCharacters(data.characters);
        setEdits({});
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const editOf = (character) => ({ ...character, ...(edits[character.id] || {}) });

  const setEdit = (character, key, value) =>
    setEdits((prev) => ({
      ...prev,
      [character.id]: { ...editOf(character), [key]: value },
    }));

  async function save(character) {
    const next = editOf(character);
    const body = {};
    for (const key of EDITABLE) {
      const value = key === 'is_echo' || key === 'is_dlc' ? Boolean(next[key]) : next[key];
      if (value !== character[key]) body[key] = value;
    }
    if (Object.keys(body).length === 0) return;
    setBusy(true);
    try {
      await patch(`/api/admin/characters/${character.id}`, body);
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = characters.filter((character) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      character.name.toLowerCase().includes(q) ||
      character.slug.includes(q) ||
      character.series.toLowerCase().includes(q)
    );
  });

  return (
    <AdminSection
      title="Fighters"
      hint="Names, series and roster position. Select order is unique — swapping two fighters means saving one on the other's order in two steps."
      error={error}
      actions={
        <>
          <label className="field field-inline">
            <span>Filter</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="name or series"
            />
          </label>
          <button type="button" className="btn btn-sm" onClick={load}>
            Reset
          </button>
        </>
      }
    >
      <AdminTable head={['#', 'Fighter', 'Series', 'Echo', 'DLC', '']}>
        {visible.map((character) => {
          const next = editOf(character);
          const dirty = EDITABLE.some((key) => String(next[key]) !== String(character[key]));
          return (
            <tr key={character.id}>
              <td>
                <input
                  className="order-input"
                  type="number"
                  min={1}
                  value={next.select_order}
                  onChange={(event) => setEdit(character, 'select_order', Number(event.target.value))}
                  aria-label={`Roster position for ${character.name}`}
                />
              </td>
              <td>
                <input
                  value={next.name}
                  onChange={(event) => setEdit(character, 'name', event.target.value)}
                  aria-label={`Name for ${character.name}`}
                />
              </td>
              <td>
                <input
                  value={next.series}
                  onChange={(event) => setEdit(character, 'series', event.target.value)}
                  aria-label={`Series for ${character.name}`}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={Boolean(next.is_echo)}
                  onChange={(event) => setEdit(character, 'is_echo', event.target.checked)}
                  aria-label={`${character.name} is an echo fighter`}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  checked={Boolean(next.is_dlc)}
                  onChange={(event) => setEdit(character, 'is_dlc', event.target.checked)}
                  aria-label={`${character.name} is DLC`}
                />
              </td>
              <td>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!dirty || busy}
                  onClick={() => save(character)}
                >
                  Save
                </button>
              </td>
            </tr>
          );
        })}
      </AdminTable>
      {visible.length === 0 ? <p className="muted">No fighters match.</p> : null}
    </AdminSection>
  );
}
