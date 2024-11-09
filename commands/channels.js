const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: "channels",
  description: "View a list of allowed channels",
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
     * @param {import("discord.js").MessageCreate} message
     * @param {string[]} args
     * @param {*} param3
    */
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.send({ content: `You are not allowed to use the bot in this channel.` });
      }

      if (!GuildDB.customChannelStatus) {
        return interaction.send({ content: 'There are no channels set for the bot.' });
      }

      let channels = ``;
      for (let i = 0; i < GuildDB.allowedChannels.length; i++) {
        if (!client.exists(GuildDB.allowedChannels[i])) continue;
        else channels += `\n<#${GuildDB.allowedChannels[i]}>`;
      }
      let channelsEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setDescription('**Allowed Channels to use the Bot**')
        .addFields(
          { name: `There are currently ${GuildDB.allowedChannels.length} allowed channels.`, value: `Channels:${channels}`, inline: true },
        )
        .setFooter({ text: 'LPS Website Support', iconURL: client.config.IconURL, proxyIconURL: 'https://discord.gg/jgUW656v2t' })
      return interaction.send({ embeds: [channelsEmbed] });      
    },
  },
}