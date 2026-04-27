const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const ObjectId = require("mongodb").ObjectId;

const STATUS_LABEL = {
  submitted: 'Submitted',
  in_review: 'In Review',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
};

module.exports = {
  name: "case",
  description: "Look up a court case by its case number",
  usage: "<case_number>",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "case_number",
      description: "Case number, e.g. CC-2026-000042",
      value: "case_number",
      type: CommandOptions.String,
      required: true,
    },
  ],
  SlashCommand: {
    /**
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
     */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.send({ content: `You are not allowed to use the bot in this channel.` });
      }

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: "You don't have permission to use this command" });

      const user = await client.dbo.collection("users").findOne({ "user.discord.id": interaction.member.user.id });
      if (!user) return interaction.send({ content: `You are not logged in.` });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
        return interaction.send({ content: `You are not in an active community.` });
      }

      const communityID = user.user.lastAccessedCommunity.communityID;
      const rawInput = (args[0] && args[0].value ? args[0].value : "").trim();
      if (!rawInput) return interaction.send({ content: `Please provide a case number.` });

      // Case-insensitive exact match on caseNumber, scoped to the user's active community.
      const escaped = rawInput.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const query = {
        "courtCase.communityID": communityID,
        "courtCase.caseNumber": { $regex: `^${escaped}$`, $options: "i" },
      };

      const courtCase = await client.dbo.collection("courtcases").findOne(query);
      if (!courtCase) {
        return interaction.send({ content: `No case found with number \`${rawInput}\` in this community.` });
      }

      const d = courtCase.courtCase || {};
      const status = STATUS_LABEL[d.status] || d.status || 'Unknown';
      const itemCount = (d.contestedItems || []).length;
      const createdStr = d.createdAt ? new Date(d.createdAt).toLocaleDateString() : 'Unknown';
      const scheduledStr = d.scheduledDate
        ? new Date(d.scheduledDate).toLocaleString()
        : null;
      const judge = d.judgeName || 'Unassigned';

      const embed = new EmbedBuilder()
        .setColor('#38bdf8')
        .setTitle(`**${d.caseNumber || 'Court Case'}**`)
        .setURL('https://discord.gg/jgUW656v2t')
        .setAuthor({ name: 'LPS Court Cases', iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
        .setDescription(`Case Search Results`)
        .addFields(
          { name: '**Case #**', value: `\`${d.caseNumber || courtCase._id}\``, inline: true },
          { name: '**Status**', value: `\`${status}\``, inline: true },
          { name: '**Civilian**', value: `\`${d.civilianName || 'Unknown'}\``, inline: true },
          { name: '**Judge**', value: `\`${judge}\``, inline: true },
          { name: '**Items**', value: `\`${itemCount}\``, inline: true },
          { name: '**Created**', value: `\`${createdStr}\``, inline: true },
        );

      if (scheduledStr) embed.addFields({ name: '**Scheduled**', value: `\`${scheduledStr}\``, inline: true });
      if (d.judgeNotes) embed.addFields({ name: '**Judge Notes**', value: `\`${d.judgeNotes.substring(0, 1000)}\`` });

      interaction.send({ embeds: [embed] });
    },
  },
};
