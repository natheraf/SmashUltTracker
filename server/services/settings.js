/**
 * App settings live in the `settings` key/value table so admins can change
 * them without a migration. Values are always stored as strings.
 */

export const PRIMARY_STREAMER_KEY = 'primary_streamer_id';

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, String(value));
}

export function deleteSetting(db, key) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

/**
 * The primary streamer (nairomk) shown on the home page by default. Falls back
 * to nothing when unset or when the stored user is gone/unapproved.
 */
export function getPrimaryStreamerId(db) {
  const id = Number(getSetting(db, PRIMARY_STREAMER_KEY));
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = db
    .prepare("SELECT 1 AS ok FROM users WHERE id = ? AND status = 'approved'")
    .get(id);
  return row ? id : null;
}

export function setPrimaryStreamerId(db, userId) {
  setSetting(db, PRIMARY_STREAMER_KEY, userId);
}
