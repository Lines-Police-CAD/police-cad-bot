const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  formatMoney,
  getLpcUser,
  findOption,
  getFocusedOption,
  civilianAutocomplete,
  listClockableDepartments,
  resolveCivilianId,
  lookupCivilianName,
  isCommunityEconomyEnabled,
} = require('../util/economy');

const NO_DEPT_HELP = `You don't have any departments you can clock into. This usually means you aren't an approved member of any economy-enabled department, or your community's economy is turned off. Ask your community admin to confirm your membership and that the department has economy enabled.`;

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
      description: "Override your active civilian for this shift",
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

      try {
        if (focused.name === 'department') {
          const q = (focused.value || '').toLowerCase();
          const depts = await listClockableDepartments(client, communityId, userId);
          const choices = depts
            .map((d) => ({ name: d.name || 'Unnamed Department', value: String(d._id) }))
            .filter((c) => !q || c.name.toLowerCase().includes(q))
            .slice(0, 25);
          return interaction.respond(choices);
        }
        if (focused.name === 'civilian') {
          const choices = await civilianAutocomplete(client, userId, communityId, focused.value);
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
      const explicitId = (findOption(args, 'civilian') || {}).value || '';

      if (!departmentId)
        return interaction.send({ content: `Please pick a department to clock into.`, flags: (1 << 6) });

      await interaction.defer();

      if (!(await isCommunityEconomyEnabled(client, communityId))) {
        return interaction.editOriginal({ content: `Economy is not enabled in your community. Ask your community admin to enable this.` });
      }

      const eligible = await listClockableDepartments(client, communityId, userId);
      if (eligible.length === 0) {
        return interaction.editOriginal({ content: NO_DEPT_HELP });
      }
      if (!eligible.some((d) => String(d._id) === departmentId)) {
        return interaction.editOriginal({ content: NO_DEPT_HELP });
      }

      const civilianId = await resolveCivilianId(client, userId, communityId, explicitId);
      if (!civilianId) {
        return interaction.editOriginal({ content: `No civilian selected. Run \`/set-active-civilian\` or pass \`civilian:\` on this command.` });
      }

      try {
        const session = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/clock-in?userId=${encodeURIComponent(userId)}`,
          { communityId, departmentId, civilianId },
        );

        const rate = session.payRateSnapshot ? `${formatMoney(session.payRateSnapshot)}/hr` : 'unknown';
        const civName = (await lookupCivilianName(client, session.civilianId)) || 'Unknown';
        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Clocked In', iconURL: client.config.IconURL })
          .setTitle(session.departmentName || 'On Duty')
          .addFields(
            { name: '**Civilian**', value: `\`${civName}\``, inline: true },
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
          return interaction.editOriginal({ content: NO_DEPT_HELP });
        if (msg.includes('(404)'))
          return interaction.editOriginal({ content: `Department not found.` });
        return interaction.editOriginal({ content: `Failed to clock in. Please try again.` });
      }
    },
  },
};
