// GET /api/mega-status
// Checks Mega.nz connectivity and returns account storage info
// Admin-only. Credentials from env vars only.

import {
  CORS_HEADERS, handleOptions, corsResponse,
  verifyUser, checkAdmin, parseAuthToken,
} from './_shared.js';

export async function onRequest(context) {
  const { request, env } = context;

  const opt = handleOptions(request);
  if (opt) return opt;

  const token = parseAuthToken(request);
  if (!token) return corsResponse({ error: 'Unauthorized' }, 401);

  const user = await verifyUser(token, env);
  if (!user) return corsResponse({ error: 'Invalid token' }, 401);

  const isAdmin = await checkAdmin(user, env);
  if (!isAdmin) return corsResponse({ error: 'Forbidden: admin only' }, 403);

  const result = {
    configured: false,
    accounts: [],
    totalUsed: 0,
    totalTotal: 0,
  };

  let accounts = [];

  // Check single account env vars
  if (env.MEGA_EMAIL && env.MEGA_PASSWORD) {
    accounts.push({
      email: maskEmail(env.MEGA_EMAIL),
      label: 'Default Account',
      email_full: env.MEGA_EMAIL,
      password: env.MEGA_PASSWORD,
    });
  }

  // Check multi-account env var
  if (env.MEGA_ACCOUNTS) {
    try {
      const parsed = JSON.parse(env.MEGA_ACCOUNTS);
      parsed.forEach((a, i) => {
        accounts.push({
          email: maskEmail(a.email),
          label: a.label || `Account ${i + 1}`,
          email_full: a.email,
          password: a.password,
        });
      });
    } catch {
      result.configError = 'MEGA_ACCOUNTS is not valid JSON';
    }
  }

  if (accounts.length === 0) {
    result.configError = 'No Mega credentials configured. Set MEGA_EMAIL/MEGA_PASSWORD env vars.';
    return corsResponse(result);
  }

  result.configured = true;

  // Try to get storage info from each account
  for (const acc of accounts) {
    try {
      let Mega;
      try {
        Mega = await import('megajs');
      } catch {
        result.configError = 'megajs library not available';
        continue;
      }

      const storage = await new Promise((resolve, reject) => {
        const s = new Mega.default({ email: acc.email_full, password: acc.password });
        s.on('ready', () => resolve(s));
        s.on('error', reject);
      });

      // Get account info
      let spaceUsed = 0, spaceTotal = 0;
      try {
        if (storage.account) {
          spaceUsed = storage.account.spaceUsed || 0;
          spaceTotal = storage.account.spaceTotal || 0;
        }
        // Fallback: try API
        if (!spaceTotal && storage.api) {
          const uq = await storage.api.request([{ a: 'uq' }]);
          if (uq && uq[0]) {
            spaceUsed = parseInt(uq[0].rru) || spaceUsed;
            spaceTotal = parseInt(uq[0].rtt) || spaceTotal;
          }
        }
      } catch {
        // storage info not available
      }

      result.accounts.push({
        email: acc.email,
        label: acc.label,
        spaceUsed,
        spaceTotal,
      });
      result.totalUsed += spaceUsed;
      result.totalTotal += spaceTotal;
    } catch (e) {
      result.accounts.push({
        email: acc.email,
        label: acc.label,
        error: e.message,
      });
    }
  }

  return corsResponse(result);
}

function maskEmail(email) {
  if (!email) return '';
  const at = email.indexOf('@');
  if (at <= 1) return email;
  return email[0] + '***' + email.substring(at - 1);
}
