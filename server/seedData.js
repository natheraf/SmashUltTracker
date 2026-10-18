import { hashPassword } from './auth.js';
import { nowIso } from './db.js';
import { characters } from '../seed/characters.js';

export const ALL_PERMISSIONS = [
  'review_submissions',
  'approve_streamers',
  'manage_users',
  'manage_characters',
  'revoke_completions',
  'use_tracker',
];

const ROLE_DEFINITIONS = [
  {
    name: 'admin',
    description: 'Full access, including reviewing submissions and managing users.',
    permissions: ALL_PERMISSIONS,
  },
  {
    name: 'streamer',
    description: 'Can run the tracker page for their own channel.',
    permissions: ['use_tracker'],
  },
];

/** Idempotent: inserts roles/permissions that don't exist yet. */
export function seedRoles(db) {
  const insertRole = db.prepare(
    'INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)',
  );
  const insertPermission = db.prepare(
    'INSERT OR IGNORE INTO permissions (name, description) VALUES (?, ?)',
  );
  const link = db.prepare(
    `INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
     SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = ? AND p.name = ?`,
  );
  for (const perm of ALL_PERMISSIONS) insertPermission.run(perm, '');
  for (const role of ROLE_DEFINITIONS) {
    insertRole.run(role.name, role.description);
    for (const perm of role.permissions) link.run(role.name, perm);
  }
}

/** Upserts the roster from seed/characters.js; never deletes characters. */
export function seedCharacters(db) {
  const upsert = db.prepare(
    `INSERT INTO characters (slug, name, series, select_order, is_dlc, is_echo)
     VALUES (@slug, @name, @series, @select_order, @is_dlc, @is_echo)
     ON CONFLICT(slug) DO UPDATE SET
       name = excluded.name,
       series = excluded.series,
       select_order = excluded.select_order,
       is_dlc = excluded.is_dlc,
       is_echo = excluded.is_echo`,
  );
  const tx = db.transaction((entries) => {
    entries.forEach((c, i) => {
      upsert.run({
        slug: c.slug,
        name: c.name,
        series: c.series || '',
        select_order: i + 1,
        is_dlc: c.is_dlc ? 1 : 0,
        is_echo: c.is_echo ? 1 : 0,
      });
    });
  });
  tx(characters);
}

export function grantRole(db, username, roleName, grantedBy = null) {
  db.prepare(
    `INSERT OR IGNORE INTO user_roles (user_id, role_id, granted_by)
     SELECT u.id, r.id, ? FROM users u, roles r
     WHERE u.username = ? AND r.name = ?`,
  ).run(grantedBy, username, roleName);
}

/**
 * First-admin bootstrap: if no account holds the admin role, create one from
 * ADMIN_USERNAME / ADMIN_PASSWORD (approved). In production the password must
 * be set explicitly.
 */
export function bootstrapAdmin(db, config) {
  const existing = db
    .prepare(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE r.name = 'admin' LIMIT 1`,
    )
    .get();
  if (existing) return null;

  if (config.isProduction && config.adminPassword === 'changeme123') {
    throw new Error(
      'ADMIN_PASSWORD must be set to a unique value in production (no admin account exists yet).',
    );
  }
  const info = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, status, created_at, updated_at)
       VALUES (?, ?, ?, 'approved', ?, ?)`,
    )
    .run(
      config.adminUsername,
      hashPassword(config.adminPassword),
      config.adminUsername,
      nowIso(),
      nowIso(),
    );
  const userId = Number(info.lastInsertRowid);
  db.prepare(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT ?, id FROM roles WHERE name = 'admin'`,
  ).run(userId);
  console.log(`[boot] created admin account "${config.adminUsername}"`);
  return userId;
}
