const { EmbedBuilder } = require("discord.js");
require("moment-duration-format");

module.exports = {
  name: "stats",
  description: "Displays current Bot statistics",
  usage: "",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [],
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
     */
    run: async (client, interaction, args, { GuildDB }) => {
      if (
        GuildDB.customChannelStatus == true &&
        !GuildDB.allowedChannels.includes(interaction.channel_id)
      ) {
        return interaction.send({
          content: `You are not allowed to use the bot in this channel.`,
        });
      }

      await interaction.defer();

      let totalGuilds = client.guilds.cache.size;
      let totalMembers = client.guilds.cache.reduce(
        (acc, g) => acc + (g.memberCount ?? 0),
        0,
      );

      if (client.shard) {
        try {
          const guildCounts =
            await client.shard.fetchClientValues("guilds.cache.size");
          totalGuilds = guildCounts.reduce((a, b) => a + b, 0);

          const memberCounts = await client.shard.broadcastEval((c) =>
            c.guilds.cache.reduce((acc, g) => acc + (g.memberCount ?? 0), 0),
          );
          totalMembers = memberCounts.reduce((a, b) => a + b, 0);
        } catch (err) {
          if (err?.code === "ShardingInProcess") {
          } else {
            throw err;
          }
        }
      }

      const stats = new EmbedBuilder()
        .setColor("#0099ff")
        .setTitle("Current LPC-Bot Statistics")
        .setURL(client.config.SupportServer)
        .setDescription(
          `**Servers** : \`${totalGuilds}\`\n**Users** : \`${totalMembers}\``,
        );

      await interaction.editOriginal({ embeds: [stats] });
    },
  },
};
