const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const { formatMoney, getLpcUser, findOption, getFocusedOption } = require('../util/economy');

function civilianName(civ) {
  const d = (civ && civ.civilian) || {};
  return `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unnamed';
}

async function listUserCivilians(client, userId, communityId) {
  const res = await apiRequest(
    client,
    'GET',
    `/api/v2/civilians/user/${userId}?active_community_id=${encodeURIComponent(communityId)}&limit=50`
  );
  return (res && res.data) || [];
}

async function listUserDepartments(client, communityId, userId) {
  const res = await apiRequest(
    client,
    'GET',
    `/api/v2/community/${communityId}/my-departments?userId=${encodeURIComponent(userId)}&limit=50`
  );
  return (res && res.data) || [];
}

module.exports = {
  name: "clock-in",
  description: "Start an on-duty shift to earn pay",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "department",
      description: "Department to clock into",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "civilian",
      description: "Civilian to clock in as (optional)",
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
      const userId = user._id.toString();
      const communityId = user.user.lastAccessedCommunity.communityID;
      const focused = getFocusedOption(interaction.data.options);
      if (!focused) return interaction.respond([]);
      const q = (focused.value || '').toLowerCase();

      try {
        if (focused.name === 'department') {
          const depts = await listUserDepartments(client, communityId, userId);
          const choices = depts
            .map((d) => ({ name: d.name || 'Unnamed Department', value: String(d._id) }))
            .filter((c) => !q || c.name.toLowerCase().includes(q))
            .slice(0, 25);
          return interaction.respond(choices);
        }
        if (focused.name === 'civilian') {
          const civs = await listUserCivilians(client, userId, communityId);
          const choices = civs
            .map((c) => ({ name: civilianName(c), value: c._id.toString() }))
            .filter((c) => !q || c.name.toLowerCase().includes(q))
            .slice(0, 25);
          return interaction.respond(choices);
        }
        return interaction.respond([]);
      } catch (err) {
        client.error(`/clock-in autocomplete: ${err.message}`);
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
      const departmentId = (findOption(args, 'department') || {}).value;
      const civilianId = (findOption(args, 'civilian') || {}).value || '';

      if (!departmentId)
        return interaction.send({ content: `Please pick a department to clock into.`, flags: (1 << 6) });

      await interaction.defer();

      try {
        const body = { communityId, departmentId };
        if (civilianId) body.civilianId = civilianId;

        const session = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/clock-in?userId=${encodeURIComponent(userId)}`,
          body,
        );

        const rate = session.payRateSnapshot ? `${formatMoney(session.payRateSnapshot)}/hr` : 'unknown';
        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Clocked In', iconURL: client.config.IconURL })
          .setTitle(session.departmentName || 'On Duty')
          .addFields(
            { name: '**Pay Rate**', value: `\`${rate}\``, inline: true },
            { name: '**Mode**', value: `\`${session.payoutMode || 'on_clockout'}\``, inline: true },
            { name: '**Max Session**', value: `\`${session.maxSessionMinutes || 120}m\``, inline: true },
          );

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        client.error(`/clock-in error: ${msg}`);
        // Surface the common "already on duty" 409 case clearly.
        if (msg.includes('(409)'))
          return interaction.editOriginal({ content: `You already have an active shift. Use \`/clock-out\` first.` });
        if (msg.includes('(403)'))
          return interaction.editOriginal({ content: `You don't have access to that department, or its economy is disabled.` });
        if (msg.includes('(404)'))
          return interaction.editOriginal({ content: `Department not found.` });
        return interaction.editOriginal({ content: `Failed to clock in. Please try again.` });
      }
    },
  },
};
