const { EmbedBuilder } = require('discord.js');
const { apiRequest } = require('../util/api');

// Launch countdown, shared with the website and the mobile app. The date comes
// from the API rather than a constant here so a slipped launch is corrected in
// one place for every surface.
//
// Discord renders <t:UNIX:R> and <t:UNIX:F> in each viewer's own timezone, so
// the localization the other surfaces have to compute is free here.

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

// The bot runs on a server, so it cannot know a viewer's timezone. In
// localMidnight mode it anchors the relative timestamp to the storefront
// instant and says plainly that the real unlock is local midnight, rather than
// implying one synchronized worldwide moment.
function anchorInstant(c) {
  if (c.launchesAt) {
    const at = new Date(c.launchesAt);
    if (!isNaN(at.getTime())) return at;
  }
  const m = DATE_ONLY.exec(String(c.launchDate || ''));
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 0, 0, 0));
}

function daysBetween(fromMs, toMs) {
  return Math.max(0, Math.ceil((toMs - fromMs) / 86400000));
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

      const anchor = anchorInstant(countdown);
      if (!anchor) {
        return interaction.editOriginal({ content: `No launch date is set right now.` });
      }

      const unix = Math.floor(anchor.getTime() / 1000);
      const now = Date.now();
      const postLaunchMs = (countdown.postLaunchHours > 0 ? countdown.postLaunchHours : 72) * 3600000;
      const launched = now >= anchor.getTime();

      if (launched && now - anchor.getTime() >= postLaunchMs) {
        return interaction.editOriginal({ content: `${countdown.title} is out. Go play it.` });
      }

      const embed = new EmbedBuilder()
        .setColor('#ff2d8e')
        .setAuthor({ name: 'Countdown', iconURL: client.config.IconURL })
        .setTitle(countdown.title);

      if (launched) {
        embed.setDescription(`**Out now.** Launched <t:${unix}:R>.`);
      } else {
        const days = daysBetween(now, anchor.getTime());
        embed
          .setDescription(countdown.subtitle || null)
          .addFields(
            { name: '**Days to go**', value: `\`${days}\``, inline: true },
            { name: '**Launches**', value: `<t:${unix}:R>`, inline: true },
            { name: '**Your local time**', value: `<t:${unix}:F>`, inline: false },
          );

        if (countdown.mode !== 'instant') {
          embed.setFooter({
            text: 'Consoles unlock at local midnight, so your exact moment depends on your region.',
          });
        }
      }

      return interaction.editOriginal({ embeds: [embed] });
    },
  },
};
