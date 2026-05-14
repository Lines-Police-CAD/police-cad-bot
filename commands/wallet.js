const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const { formatMoney, formatDuration, formatDueDate, getLpcUser, findOption, getFocusedOption } = require('../util/economy');

const STATUS_LABEL = {
  pending: 'Pending',
  contested: 'Contested',
  delinquent: 'Delinquent',
  paid: 'Paid',
  dismissed: 'Dismissed',
};

async function listUserCivilians(client, userId, communityId) {
  const res = await apiRequest(
    client,
    'GET',
    `/api/v2/civilians/user/${userId}?active_community_id=${encodeURIComponent(communityId)}&limit=50`
  );
  return (res && res.data) || [];
}

function civilianName(civ) {
  const d = (civ && civ.civilian) || {};
  return `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unnamed';
}

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
      description: "Civilian whose wallet to view (defaults to your only civilian)",
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
      const q = (focused.value || '').toLowerCase();
      try {
        const civs = await listUserCivilians(client, user._id.toString(), user.user.lastAccessedCommunity.communityID);
        const choices = civs
          .map((c) => ({ name: civilianName(c), value: c._id.toString() }))
          .filter((c) => !q || c.name.toLowerCase().includes(q))
          .slice(0, 25);
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

      await interaction.defer();

      try {
        let civilianId = (findOption(args, 'civilian') || {}).value || '';
        if (!civilianId) {
          const civs = await listUserCivilians(client, userId, communityId);
          if (civs.length === 0) {
            return interaction.editOriginal({ content: `You don't have any civilians in your active community.` });
          }
          if (civs.length > 1) {
            const names = civs.slice(0, 10).map((c) => `\`${civilianName(c)}\``).join(', ');
            return interaction.editOriginal({ content: `You have multiple civilians. Re-run \`/wallet\` and pick one: ${names}` });
          }
          civilianId = civs[0]._id.toString();
        }

        const [wallet, activeSession] = await Promise.all([
          apiRequest(client, 'GET', `/api/v2/economy/wallet/${civilianId}`),
          apiRequest(client, 'GET', `/api/v2/economy/session/active?civilianId=${encodeURIComponent(civilianId)}`).catch(() => null),
        ]);

        const recent = wallet.recentInbox || [];
        const pending = recent.filter((i) => i.status === 'pending' || i.status === 'delinquent' || i.status === 'contested');

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Wallet', iconURL: client.config.IconURL })
          .setTitle(formatMoney(wallet.balance))
          .addFields(
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
            return `• ${formatMoney(i.amount)} — ${i.title || i.type || 'Fine'} (${label}, due ${formatDueDate(i.dueAt)})`;
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
