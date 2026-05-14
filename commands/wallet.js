const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  formatMoney,
  formatDuration,
  formatDueDate,
  getLpcUser,
  findOption,
  getFocusedOption,
  civilianAutocomplete,
  resolveCivilianId,
  lookupCivilianName,
  isCommunityEconomyEnabled,
  formatInboxItemLabel,
} = require('../util/economy');

const STATUS_LABEL = {
  pending: 'Pending',
  contested: 'Contested',
  delinquent: 'Delinquent',
  paid: 'Paid',
  dismissed: 'Dismissed',
};

module.exports = {
  name: "wallet",
  description: "View your civilian's balance, active shift, and pending fines",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "civilian",
      description: "Override your active civilian for this run",
      type: CommandOptions.String,
      required: false,
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
        client.error(`/wallet autocomplete: ${err.message}`);
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
      const explicitId = (findOption(args, 'civilian') || {}).value || '';

      await interaction.defer();

      try {
        if (!(await isCommunityEconomyEnabled(client, communityId))) {
          return interaction.editOriginal({ content: `Economy is not enabled in your community. Ask your community admin to enable this.` });
        }

        const civilianId = await resolveCivilianId(client, userId, communityId, explicitId);
        if (!civilianId) {
          return interaction.editOriginal({ content: `No civilian selected. Run \`/set-active-civilian\` or pass \`civilian:\` on this command.` });
        }

        const [wallet, activeSession, civName] = await Promise.all([
          apiRequest(client, 'GET', `/api/v2/economy/wallet/${civilianId}`),
          apiRequest(client, 'GET', `/api/v2/economy/session/active?civilianId=${encodeURIComponent(civilianId)}`).catch(() => null),
          lookupCivilianName(client, civilianId),
        ]);

        const recent = wallet.recentInbox || [];
        const pending = recent.filter((i) => i.status === 'pending' || i.status === 'delinquent' || i.status === 'contested');

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Wallet', iconURL: client.config.IconURL })
          .setTitle(formatMoney(wallet.balance))
          .addFields(
            { name: '**Civilian**', value: `\`${civName || 'Unknown'}\``, inline: true },
            { name: '**Pending Items**', value: `\`${pending.length}\``, inline: true },
          );

        if (activeSession && activeSession.status === 'active') {
          const elapsed = Date.now() - new Date(activeSession.startedAt).getTime();
          embed.addFields(
            { name: '**Active Shift**', value: `\`${activeSession.departmentName || 'Unknown dept'}\``, inline: true },
            { name: '**On Duty For**', value: `\`${formatDuration(elapsed)}\``, inline: true },
          );
        } else {
          embed.addFields({ name: '**Active Shift**', value: '`Off duty`', inline: true });
        }

        if (pending.length > 0) {
          const lines = pending.slice(0, 5).map((i) => {
            const label = STATUS_LABEL[i.status] || i.status;
            return `• ${formatInboxItemLabel(i)} — ${label}, due ${formatDueDate(i.dueAt)}`;
          });
          embed.addFields({ name: '**Recent Pending**', value: lines.join('\n') });
        }

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        client.error(`/wallet error: ${err.message}`);
        return interaction.editOriginal({ content: `Failed to load wallet. Please try again.` });
      }
    },
  },
};
