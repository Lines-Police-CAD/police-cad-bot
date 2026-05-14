const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const ObjectId = require("mongodb").ObjectId;
const { getFocusedOption } = require('../util/economy');

const STATUS_LABEL = {
  submitted: 'Submitted',
  in_review: 'In Review',
  scheduled: 'Scheduled',
  in_progress: 'In Progress',
  completed: 'Completed',
};

function truncateChoiceName(s) {
  s = String(s || '');
  return s.length > 100 ? `${s.slice(0, 97)}...` : s;
}

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
      autocomplete: true,
    },
  ],
  Autocomplete: {
    run: async (client, interaction) => {
      try {
        const user = await client.dbo
          .collection("users")
          .findOne({ "user.discord.id": interaction.member.user.id });
        if (!user || !user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) {
          return interaction.respond([]);
        }

        const communityID = user.user.lastAccessedCommunity.communityID;
        const focused = getFocusedOption(interaction.data.options);
        const input = ((focused && focused.value) || "").trim();

        const query = { "courtCase.communityID": communityID };
        if (input) {
          const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          query["courtCase.caseNumber"] = { $regex: escaped, $options: "i" };
        }

        const cases = await client.dbo
          .collection("courtcases")
          .find(query, { projection: { "courtCase.caseNumber": 1, "courtCase.status": 1, "courtCase.civilianName": 1, "courtCase.createdAt": 1 } })
          .sort({ "courtCase.createdAt": -1 })
          .limit(25)
          .toArray();

        const choices = cases
          .map((c) => {
            const d = c.courtCase || {};
            if (!d.caseNumber) return null;
            const status = STATUS_LABEL[d.status] || d.status || 'Unknown';
            const civilian = d.civilianName || 'Unknown';
            return {
              name: truncateChoiceName(`${d.caseNumber} · ${status} · ${civilian}`),
              value: String(d.caseNumber),
            };
          })
          .filter(Boolean);

        return interaction.respond(choices);
      } catch (err) {
        client.error(`/case autocomplete: ${err && err.message ? err.message : err}`);
        return interaction.respond([]);
      }
    },
  },
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

      let communityName = '';
      try {
        const community = await client.dbo
          .collection("communities")
          .findOne({ _id: ObjectId(communityID) }, { projection: { "community.name": 1 } });
        communityName = (community && community.community && community.community.name) || '';
      } catch (_) {}
      // Discord embed author name max is 256 chars; cap the community portion so the suffix always fits.
      const SUFFIX = ' Court Cases';
      const MAX_NAME = 60;
      const trimmed = communityName.length > MAX_NAME ? `${communityName.slice(0, MAX_NAME - 1).trimEnd()}…` : communityName;
      const authorName = trimmed ? `${trimmed}${SUFFIX}` : 'Court Cases';

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
        .setAuthor({ name: authorName, iconURL: client.config.IconURL, url: 'https://discord.gg/jgUW656v2t' })
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
