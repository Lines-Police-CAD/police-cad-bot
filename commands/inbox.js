const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const { formatMoney, formatDueDate, getLpcUser, findOption, getFocusedOption, civilianAutocomplete } = require('../util/economy');

const STATUS_LABEL = {
  pending: 'Pending',
  contested: 'Contested',
  delinquent: 'Delinquent',
  paid: 'Paid',
  dismissed: 'Dismissed',
};

module.exports = {
  name: "inbox",
  description: "List your fines, fees, and other financial items",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "civilian",
      description: "Civilian whose inbox to view",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "status",
      description: "Filter by status (default: pending)",
      type: CommandOptions.String,
      required: false,
      choices: [
        { name: "Pending", value: "pending" },
        { name: "Contested", value: "contested" },
        { name: "Delinquent", value: "delinquent" },
        { name: "Paid", value: "paid" },
        { name: "All", value: "all" },
      ],
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
        client.error(`/inbox autocomplete: ${err.message}`);
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

      const communityId = user.user.lastAccessedCommunity.communityID;
      const civilianId = (findOption(args, 'civilian') || {}).value;
      const status = (findOption(args, 'status') || {}).value || 'pending';

      if (!civilianId)
        return interaction.send({ content: `Please pick a civilian.`, flags: (1 << 6) });

      await interaction.defer();

      try {
        const path = `/api/v2/economy/inbox?civilianId=${encodeURIComponent(civilianId)}&communityId=${encodeURIComponent(communityId)}&limit=25` +
          (status === 'all' ? '' : `&status=${encodeURIComponent(status)}`);
        const res = await apiRequest(client, 'GET', path);
        const items = (res && res.data) || [];

        if (items.length === 0) {
          return interaction.editOriginal({ content: `No items found for status \`${status}\`.` });
        }

        const lines = items.slice(0, 10).map((i) => {
          const label = STATUS_LABEL[i.status] || i.status;
          const idShort = String(i._id || '').slice(-6);
          const title = i.title || i.type || 'Item';
          return `• \`${idShort}\` — ${formatMoney(i.amount)} — ${title} (${label}, due ${formatDueDate(i.dueAt)})`;
        });

        const totalCount = (res && res.totalCount) || items.length;
        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Inbox', iconURL: client.config.IconURL })
          .setTitle(`${totalCount} ${status === 'all' ? 'item(s)' : status + ' item(s)'}`)
          .setDescription(lines.join('\n'))
          .setFooter({ text: `Use /pay-fine or /contest-fine with the full ID (or pick from autocomplete).` });

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        client.error(`/inbox error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to load inbox. Please try again.` });
      }
    },
  },
};
