import { timingSafeEqual } from 'node:crypto';

const ROLES = [
  { id: '1521237184835883089', name: 'ﾒ | Owner', color: [233, 30, 99] },
  { id: '1564654151021891734', name: 'Managment', color: [173, 20, 87] },
  { id: '1553552841094864896', name: 'Head of Staff', color: [230, 126, 34] },
  { id: '1553552697045811321', name: 'Senior Staff', color: [113, 54, 138] },
  { id: '1521237427631427586', name: 'Staff', color: [96, 125, 139] },
  { id: '1521237483583569980', name: 'Trial Staff', color: [96, 125, 139] },
];

function isAuthorized(header, secret) {
  if (!secret || secret.length < 32 || typeof header !== 'string') {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const supplied = Buffer.from(header);

  return expected.length === supplied.length
    && timingSafeEqual(expected, supplied);
}

export function registerRobloxRoles(app, client) {
  app.get('/roblox/roles/:robloxId', async (req, res) => {
    res.set('Cache-Control', 'no-store');

    const secret = process.env.ROBLOX_BRIDGE_SECRET;
    const apiKey = process.env.BLOXLINK_API_KEY;
    const guildId = process.env.DISCORD_GUILD_ID;

    if (!secret || secret.length < 32 || !apiKey || !guildId) {
      return res.status(503).json({ error: 'Bridge is not configured' });
    }

    if (!isAuthorized(req.get('Authorization'), secret)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { robloxId } = req.params;

    if (!/^[1-9]\d{0,19}$/.test(robloxId)) {
      return res.status(400).json({ error: 'Invalid Roblox UserId' });
    }

    if (!client.isReady()) {
      return res.status(503).json({ error: 'Discord bot is not ready' });
    }

    try {
      const response = await fetch(
        `https://api.blox.link/v4/public/guilds/${guildId}/roblox-to-discord/${robloxId}`,
        {
          headers: { Authorization: apiKey },
          signal: AbortSignal.timeout(10000),
        }
      );

      if (!response.ok) {
        // Chybu API nepovažujeme za potvrzení, že hráč nemá roli.
        const details = await response.json().catch(() => ({}));

console.warn(
  '[RobloxRoles] Bloxlink request failed:',
  response.status,
  details.error || details.message || 'No error description'
);
        return res.status(502).json({
          error: 'Bloxlink lookup failed',
          upstreamStatus: response.status,
        });
      }

      const data = await response.json();

      if (!Array.isArray(data.discordIDs)) {
        return res.status(502).json({
          error: 'Unexpected Bloxlink response',
        });
      }

      const discordIds = [...new Set(data.discordIDs)];

      if (discordIds.some(id =>
        typeof id !== 'string' || !/^\d{17,20}$/.test(id)
      )) {
        return res.status(502).json({ error: 'Invalid Discord IDs' });
      }

      if (discordIds.length === 0) {
        return res.json({ robloxId, linked: false, role: null });
      }

      // Více propojených účtů neslučujeme automaticky kvůli bezpečnosti.
      if (discordIds.length !== 1) {
        return res.status(409).json({
          error: 'Multiple linked Discord accounts; verification required',
        });
      }

      const guild = await client.guilds.fetch(guildId);
      let member;

      try {
        member = await guild.members.fetch({
          user: discordIds[0],
          force: true,
        });
      } catch (error) {
        if (Number(error.code) === 10007) {
          return res.json({
            robloxId,
            linked: true,
            inServer: false,
            role: null,
          });
        }
        throw error;
      }

      const role = ROLES.find(item => member.roles.cache.has(item.id));

      return res.json({
        robloxId,
        linked: true,
        inServer: true,
        role: role || null,
      });
    } catch {
      console.warn('[RobloxRoles] Role lookup failed');
      return res.status(502).json({ error: 'Role lookup unavailable' });
    }
  });
}
