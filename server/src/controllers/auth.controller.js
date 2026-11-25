import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { loadAccess } from '../services/access.js';

export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ message: 'Email and password are required' });

  const { rows } = await query('SELECT id, password_hash, is_active FROM users WHERE email = LOWER($1)', [
    String(email).trim(),
  ]);
  const row = rows[0];
  const ok = row && (await bcrypt.compare(String(password), row.password_hash));
  if (!ok) return res.status(401).json({ message: 'Invalid email or password' });
  if (!row.is_active) return res.status(403).json({ message: 'Your account is disabled. Contact admin.' });

  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [row.id]);

  const token = jwt.sign({ id: row.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '1d' });
  res.json({ token, user: await loadAccess(row.id) });
};

export const me = (req, res) => res.json({ user: req.user });
