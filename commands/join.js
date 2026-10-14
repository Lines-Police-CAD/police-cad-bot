const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { getLpcUser, findOption } = require('../util/economy');
const { apiRequest } = require('../util/api');
const { NOT_CONFIGURED_MESSAGE, inviteApiConfigured } = require('../util/invites');

module.exports = {
  name: "join",
  description: "Join a community with an invite code",
  usage: "<code>",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "code",
      description: "The invite code you were given",
      value: "code",
      type: CommandOptions.String,
      required: true,
    },
  ],
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
    */
    run: async (client, interaction, args, { GuildDB }) => {
      // Private: an invite code in a channel is an invite code for everyone who
      // can read that channel.
      await interaction.defer({ flags: (1 << 6) });

      if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.editOriginal({ content: `You are not allowed to use the bot in this channel.` });
      }

      let useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.editOriginal({ content: await client.noPermissionMessage(GuildDB.serverID) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.editOriginal({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.` });

      if (!inviteApiConfigured(client)) return interaction.editOriginal({ content: NOT_CONFIGURED_MESSAGE });

      const userId = user._id.toString();
      const code = String((findOption(args, 'code') || {}).value || '').trim();
      if (!code) return interaction.editOriginal({ content: `Give the invite code you were sent.` });

      // The joining account is the caller's own linked LPC account: the API
      // takes it from the identified caller, not from anything in the body.
      let result;
      try {
        result = await apiRequest(
          client,
          'POST',
          `/api/v1/community/join?userId=${encodeURIComponent(userId)}`,
          { inviteCode: code },
        );
      } catch (err) {
        client.error(`/join: ${err.message}`);
        const status = err && err.status;
        if (status === 400) {
          return interaction.editOriginal({ content: `\`${code}\` is not a code you can use. It may have expired, run out of uses, or been revoked. Ask whoever invited you for a new one.` });
        }
        if (status === 403) {
          return interaction.editOriginal({ content: `You are banned from that community, so an invite code will not let you back in. Contact its admins if you think that is a mistake.` });
        }
        if (status === 401) {
          return interaction.editOriginal({ content: `The CAD could not tell who you are, so it would not join you to anything. A bot admin needs to check the bot's API configuration.` });
        }
        if (status === 404) {
          return interaction.editOriginal({ content: `That code points at a community that no longer exists.` });
        }
        if (status === 410) {
          return interaction.editOriginal({ content: `That community is pending deletion, so it cannot be joined.` });
        }
        return interaction.editOriginal({ content: `Could not join with that code right now. Please try again in a moment.` });
      }

      const community = (result && result.community) || {};
      const name = community.name || 'that community';

      const embed = new EmbedBuilder()
        .setColor('#38bdf8')
        .setAuthor({ name: 'Community Joined', iconURL: client.config.IconURL })
        .setTitle(String(name))
        .setDescription(`You are now a member. Run \`/set-active-community\` and pick **${name}** to use it with \`/search\`, \`/wallet\`, \`/clock-in\` and the rest.`);
      if (community.imageLink) embed.setThumbnail(community.imageLink);

      return interaction.editOriginal({ embeds: [embed] });
    },
  },
};
