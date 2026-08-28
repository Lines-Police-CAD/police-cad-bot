const { EmbedBuilder } = require('discord.js');
const { apiRequest } = require('../util/api');

// Launch countdown, shared with the website and the mobile app. The date comes
// from the API rather than a constant here so a slipped launch is corrected in
// one place for every surface.

// Matches the fallbacks in police-cad/lib/countdown.ts and
// police-cad-app/utils/countdown.js. Used only if the API is unreachable.
const FALLBACK = {
  title: 'Grand Theft Auto VI',
  subtitle: 'Back to Vice City.',
  launchDate: '2026-11-19',
  launchesAt: '2026-11-18T23:00:00Z',
  mode: 'localMidnight',
  postLaunchHours: 72,
};

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// The website and the app both read the device clock, so they can resolve
// "midnight local time" exactly. The bot runs on a server and cannot, so it
// deliberately works at day precision instead of rendering an absolute
// timestamp that would be wrong for nearly everyone.
//
// Midnight UTC on the launch date is the reference point: it is within a day
// of every viewer's own local midnight, which is all the day count needs.
function referenceInstant(c) {
  const m = DATE_ONLY.exec(String(c.launchDate || ''));
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0));
  // instant mode has no launchDate to work from, and its stored moment is the
  // real one for everybody.
  if (c.launchesAt) {
    const at = new Date(c.launchesAt);
    if (!isNaN(at.getTime())) return at;
  }
  return null;
}

// "November 19, 2026". Date-only, so it reads the same for every viewer.
function prettyDate(launchDate) {
  const m = DATE_ONLY.exec(String(launchDate || ''));
  if (!m) return null;
  return `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}`;
}

module.exports = {
  name: "gta6",
  description: "See how long until Grand Theft Auto VI launches",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [],
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
     */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      await interaction.defer({ flags: (1 << 6) });

      let countdown = FALLBACK;
      try {
        const list = await apiRequest(client, 'GET', '/api/v1/countdowns?surface=bot');
        if (Array.isArray(list)) {
          const found = list.find((c) => c && c.slug === 'gta6' && c.active !== false);
          if (found) countdown = found;
        }
      } catch (err) {
        // The date is decoration, not a transaction. Fall back rather than
        // telling someone the countdown is broken.
        client.error(`gta6 countdown lookup failed, using fallback: ${err.message}`);
      }

      const reference = referenceInstant(countdown);
      if (!reference) {
        return interaction.editOriginal({ content: `No launch date is set right now.` });
      }

      const now = Date.now();
      const postLaunchMs = (countdown.postLaunchHours > 0 ? countdown.postLaunchHours : 72) * 3600000;

      if (now >= reference.getTime()) {
        if (now - reference.getTime() >= postLaunchMs) {
          return interaction.editOriginal({ content: `${countdown.title} is out. Go play it.` });
        }
        const out = new EmbedBuilder()
          .setColor('#ff2d8e')
          .setAuthor({ name: 'Countdown', iconURL: client.config.IconURL })
          .setTitle(countdown.title)
          .setDescription('**Out now.**');
        return interaction.editOriginal({ embeds: [out] });
      }

      const days = Math.max(0, Math.ceil((reference.getTime() - now) / 86400000));

      const embed = new EmbedBuilder()
        .setColor('#ff2d8e')
        .setAuthor({ name: 'Countdown', iconURL: client.config.IconURL })
        .setTitle(countdown.title)
        .setDescription(countdown.subtitle || null)
        .addFields({ name: '**Days to go**', value: `\`${days}\``, inline: true });

      if (countdown.mode === 'instant') {
        // A synchronized worldwide unlock does have one true moment, and
        // Discord renders it in each viewer's own timezone. Only correct here.
        const unix = Math.floor(reference.getTime() / 1000);
        embed.addFields({ name: '**Launches**', value: `<t:${unix}:F>`, inline: true });
      } else {
        // Staggered regional unlock. Naming the date and saying "midnight your
        // local time" is exactly as precise as the bot can honestly be.
        embed.addFields({
          name: '**Launches**',
          value: `${prettyDate(countdown.launchDate)} at midnight, your local time`,
          inline: true,
        });
      }

      return interaction.editOriginal({ embeds: [embed] });
    },
  },
};
