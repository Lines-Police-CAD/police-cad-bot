const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const {
  getLpcUser,
  findOption,
  getFocusedOption,
  listApprovedCommunities,
  setActiveCommunityId,
} = require('../util/economy');

module.exports = {
  name: "set-active-community",
  description: "Switch which community is active for /search, /wallet, /inbox, /clock-in, and more.",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "community",
      description: "Community to make active (only approved communities are listed)",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.respond([]);
      const focused = getFocusedOption(interaction.data.options);
      if (!focused || focused.name !== 'community') return interaction.respond([]);
      try {
        const communities = await listApprovedCommunities(client, user._id.toString());
        const q = (focused.value || '').toString().toLowerCase();
        const choices = communities
          .map((c) => ({ name: String(c.name || 'Unnamed'), value: String(c._id) }))
          .filter((c) => !q || c.name.toLowerCase().includes(q))
          .slice(0, 25);
        return interaction.respond(choices);
      } catch (err) {
        client.error(`/set-active-community autocomplete: ${err.message}`);
        return interaction.respond([]);
      }
    },
  },
  SlashCommand: {
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: await client.noPermissionMessage(GuildDB.serverID), flags: (1 << 6) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });

      const userId = user._id.toString();
      const communityId = (findOption(args, 'community') || {}).value;
      if (!communityId)
        return interaction.send({ content: `Please pick a community.`, flags: (1 << 6) });

      await interaction.defer();

      let approved;
      try {
        approved = await listApprovedCommunities(client, userId);
      } catch (err) {
        client.error(`/set-active-community list error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to load your communities. Please try again.` });
      }

      const match = approved.find((c) => String(c._id) === String(communityId));
      if (!match)
        return interaction.editOriginal({ content: `That community isn't in your approved list. Pick one from the autocomplete options.` });

      try {
        await setActiveCommunityId(client, userId, communityId);

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Active Community Set', iconURL: client.config.IconURL })
          .setTitle(String(match.name || 'Unnamed'))
          .setDescription(`This is now your active community. \`/wallet\`, \`/inbox\`, \`/clock-in\`, and other commands will use it by default. Run \`/set-active-civilian\` to pick a default civilian within this community.`);

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        client.error(`/set-active-community error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to set active community. Please try again.` });
      }
    },
  },
};
