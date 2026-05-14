const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const {
  getLpcUser,
  findOption,
  getFocusedOption,
  civilianAutocomplete,
  setActiveCivilianId,
  lookupCivilianName,
} = require('../util/economy');

module.exports = {
  name: "set-active-civilian",
  description: "Pick a default civilian for /wallet, /inbox, /clock-in, /pay-fine, /contest-fine",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "civilian",
      description: "Civilian to set as your active one for this community",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user || !user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
        return interaction.respond([]);
      }
      const focused = getFocusedOption(interaction.data.options);
      if (!focused || focused.name !== 'civilian') return interaction.respond([]);
      try {
        const choices = await civilianAutocomplete(
          client,
          user._id.toString(),
          user.user.lastAccessedCommunity.communityID,
          focused.value,
        );
        return interaction.respond(choices);
      } catch (err) {
        client.error(`/set-active-civilian autocomplete: ${err.message}`);
        return interaction.respond([]);
      }
    },
  },
  SlashCommand: {
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command", flags: (1 << 6) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID)
        return interaction.send({ content: `You must join a community to use this command.`, flags: (1 << 6) });

      const userId = user._id.toString();
      const communityId = user.user.lastAccessedCommunity.communityID;
      const civilianId = (findOption(args, 'civilian') || {}).value;
      if (!civilianId)
        return interaction.send({ content: `Please pick a civilian.`, flags: (1 << 6) });

      await interaction.defer();

      try {
        await setActiveCivilianId(client, userId, communityId, civilianId);
        const civName = (await lookupCivilianName(client, civilianId)) || 'Unknown';

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Active Civilian Set', iconURL: client.config.IconURL })
          .setTitle(civName)
          .setDescription(`Future \`/wallet\`, \`/inbox\`, \`/clock-in\`, \`/pay-fine\`, and \`/contest-fine\` will default to this civilian. Pass \`civilian:\` on any command to override for that run.`);

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        client.error(`/set-active-civilian error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to save active civilian. Please try again.` });
      }
    },
  },
};
