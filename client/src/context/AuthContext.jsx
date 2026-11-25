import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { TOKEN_KEY } from '../api/client';

const AuthContext = createContext(null);

/** Pure permission check — usable outside React too. */
/** moduleKey may be a list — then any one of the modules is enough. */
export const hasPermission = (user, moduleKey, action = 'view') =>
  !!user && (user.role?.isSuper || [].concat(moduleKey).some((k) => !!user.permissions?.[k]?.includes(action)));

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  const refresh = useCallback(async () => {
    const { data } = await api.get('/auth/me');
    setUser(data.user);
    return data.user;
  }, []);

  // Restore session on page load
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setBooting(false);
      return;
    }
    refresh()
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setBooting(false));
  }, [refresh]);

  // Pick up role/permission changes made by an admin when the tab regains focus
  useEffect(() => {
    const onFocus = () => localStorage.getItem(TOKEN_KEY) && refresh().catch(() => {});
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  // Axios interceptor fires this when the token is rejected
  useEffect(() => {
    const onLogout = () => setUser(null);
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, []);

  const login = useCallback(async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem(TOKEN_KEY, data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      booting,
      login,
      logout,
      refresh,
      can: (moduleKey, action = 'view') => hasPermission(user, moduleKey, action),
    }),
    [user, booting, login, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
