const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { apiRequest } = require('../util/api');
const {
  formatMoney,
  getLpcUser,
  findOption,
  getFocusedOption,
  civilianAutocomplete,
  communityCivilianAutocomplete,
  resolveCivilianId,
  lookupCivilianName,
  isCommunityEconomyEnabled,
} = require('../util/economy');

const MAX_AMOUNT_DOLLARS = 10_000;
const MAX_MESSAGE_CHARS = 140;

// Best-effort DM the recipient that money landed. Wrapped in its own try so a
// closed-DM / unlinked-discord recipient never breaks the transfer itself.
//
// Includes the *recipient civilian's* name so users with multiple civilians
// in a community know which wallet got hit — otherwise the DM only names
// the sender, which is useless when you have 10 alts.
async function dmRecipient(client, recipientCivilianId, { senderName, recipientName, amountCents, memo, balanceAfter }) {
  try {
    const ObjectId = require('mongodb').ObjectId;
    let oid;
    try { oid = new ObjectId(recipientCivilianId); } catch (_) { return; }
    const civ = await client.dbo.collection('civilians').findOne({ _id: oid });
    const userId = civ && civ.civilian && civ.civilian.userID;
    if (!userId) return;
    let userOid;
    try { userOid = new ObjectId(userId); } catch (_) { return; }
    const userDoc = await client.dbo.collection('users').findOne({ _id: userOid });
    const discordId = userDoc && userDoc.user && userDoc.user.discord && userDoc.user.discord.id;
    if (!discordId) return;
    const discordUser = await client.users.fetch(discordId);
    if (!discordUser) return;
    const embed = new EmbedBuilder()
      .setColor('#34d399')
      .setAuthor({ name: `Money received → ${recipientName || 'your civilian'}`, iconURL: client.config.IconURL })
      .setTitle(`+${formatMoney(amountCents)} from ${senderName}`)
      .addFields(
        { name: '**To**', value: `\`${recipientName || 'Civilian'}\``, inline: true },
        { name: '**New balance**', value: `\`${formatMoney(balanceAfter)}\``, inline: true },
      );
    if (memo) {
      embed.addFields({ name: '**Note**', value: `_"${memo.slice(0, 1024)}"_` });
    }
    await discordUser.send({ embeds: [embed] });
  } catch (err) {
    // DMs blocked, recipient hasn't linked Discord, etc. Non-fatal.
    if (client.error) client.error(`send-money recipient DM failed: ${err.message}`);
  }
}

module.exports = {
  name: "send-money",
  description: "Send money to another civilian in your community",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "recipient",
      description: "The civilian to send money to",
      type: CommandOptions.String,
      required: true,
      autocomplete: true,
    },
    {
      name: "amount",
      description: `Amount in dollars (max $${MAX_AMOUNT_DOLLARS.toLocaleString()})`,
      type: CommandOptions.Float,
      required: true,
      min_value: 0.01,
      max_value: MAX_AMOUNT_DOLLARS,
    },
    {
      name: "message",
      description: `Optional note (max ${MAX_MESSAGE_CHARS} chars)`,
      type: CommandOptions.String,
      required: false,
      max_length: MAX_MESSAGE_CHARS,
    },
    {
      name: "from",
      description: "Send from a specific civilian (defaults to your active one)",
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

      if (focused.name === 'from') {
        try {
          const choices = await civilianAutocomplete(client, userId, communityId, focused.value);
          return interaction.respond(choices);
        } catch (err) {
          client.error(`/send-money from autocomplete: ${err.message}`);
          return interaction.respond([]);
        }
      }
      if (focused.name === 'recipient') {
        // Resolve the sender civilian so we can exclude them from the
        // recipient picker (matches the server-side self-send guard).
        const explicitFrom = (findOption(interaction.data.options, 'from') || {}).value || '';
        const senderCivId = await resolveCivilianId(client, userId, communityId, explicitFrom).catch(() => null);
        try {
          const choices = await communityCivilianAutocomplete(client, communityId, focused.value, senderCivId);
          return interaction.respond(choices);
        } catch (err) {
          client.error(`/send-money recipient autocomplete: ${err.message}`);
          return interaction.respond([]);
        }
      }
      return interaction.respond([]);
    },
  },
  SlashCommand: {
    run: async (client, interaction, args, { GuildDB }) => {
      if (GuildDB.customChannelStatus == true && !GuildDB.allowedChannels.includes(interaction.channel_id))
        return interaction.send({ content: `You are not allowed to use the bot in this channel.`, flags: (1 << 6) });

      const useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.send({ content: await client.noPermissionMessage(GuildDB.serverID), flags: (1 << 6) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.send({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.`, flags: (1 << 6) });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID)
        return interaction.send({ content: `You must join a community to use this command.`, flags: (1 << 6) });

      const userId = user._id.toString();
      const communityId = user.user.lastAccessedCommunity.communityID;

      const recipientId = (findOption(args, 'recipient') || {}).value;
      const amountDollars = Number((findOption(args, 'amount') || {}).value);
      const message = ((findOption(args, 'message') || {}).value || '').trim();
      const explicitFrom = (findOption(args, 'from') || {}).value || '';

      if (!recipientId) return interaction.send({ content: `Pick a recipient.`, flags: (1 << 6) });
      if (!Number.isFinite(amountDollars) || amountDollars <= 0)
        return interaction.send({ content: `Amount must be a positive number.`, flags: (1 << 6) });
      if (amountDollars > MAX_AMOUNT_DOLLARS)
        return interaction.send({ content: `Single transfer max is $${MAX_AMOUNT_DOLLARS.toLocaleString()}.`, flags: (1 << 6) });
      if (message.length > MAX_MESSAGE_CHARS)
        return interaction.send({ content: `Message must be ${MAX_MESSAGE_CHARS} characters or fewer.`, flags: (1 << 6) });

      // Convert dollars → cents up-front to avoid float drift past the boundary.
      const amountCents = Math.round(amountDollars * 100);

      await interaction.defer({ flags: (1 << 6) }); // ephemeral

      try {
        if (!(await isCommunityEconomyEnabled(client, communityId))) {
          return interaction.editOriginal({ content: `Economy is not enabled in your community. Ask your community admin to enable this.` });
        }

        const fromCivilianId = await resolveCivilianId(client, userId, communityId, explicitFrom);
        if (!fromCivilianId)
          return interaction.editOriginal({ content: `No civilian selected. Run \`/set-active-civilian\` or pass \`from:\` on this command.` });
        if (fromCivilianId === recipientId)
          return interaction.editOriginal({ content: `You can't send money to yourself.` });

        const res = await apiRequest(
          client,
          'POST',
          `/api/v2/economy/transfer?userId=${encodeURIComponent(userId)}`,
          {
            fromCivilianId,
            toCivilianId: recipientId,
            amountCents,
            message,
          },
        );

        const recipientName =
          res.recipientName ||
          (await lookupCivilianName(client, recipientId)) ||
          'Recipient';
        const senderName =
          res.senderName ||
          (await lookupCivilianName(client, fromCivilianId)) ||
          'Civilian';

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Money sent', iconURL: client.config.IconURL })
          .setTitle(`${formatMoney(amountCents)} → ${recipientName}`)
          .addFields(
            { name: '**From**', value: `\`${senderName}\``, inline: true },
            { name: '**New balance**', value: `\`${formatMoney(res.fromBalanceAfter)}\``, inline: true },
          );
        if (message) embed.addFields({ name: '**Note**', value: `_"${message}"_` });

        // Fire-and-forget recipient DM so a slow/blocked DM doesn't make the
        // command feel sluggish. The transfer itself already succeeded.
        dmRecipient(client, recipientId, {
          senderName,
          recipientName,
          amountCents,
          memo: message,
          balanceAfter: res.toBalanceAfter,
        });

        return interaction.editOriginal({ embeds: [embed] });
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        client.error(`/send-money error: ${msg}`);
        if (msg.includes('(402)'))
          return interaction.editOriginal({ content: `Insufficient balance — you can't send more than what's in your wallet.` });
        if (msg.includes('(403)')) {
          if (/disabled/i.test(msg))
            return interaction.editOriginal({ content: `Economy is disabled in this community.` });
          return interaction.editOriginal({ content: `You can only send money from a civilian you own.` });
        }
        if (msg.includes('(400)')) {
          if (/same active community/i.test(msg))
            return interaction.editOriginal({ content: `That civilian isn't in your active community.` });
          if (/yourself/i.test(msg))
            return interaction.editOriginal({ content: `You can't send money to yourself.` });
          return interaction.editOriginal({ content: `Invalid transfer request.` });
        }
        if (msg.includes('(404)'))
          return interaction.editOriginal({ content: `Civilian not found.` });
        return interaction.editOriginal({ content: `Transfer failed. Please try again.` });
      }
    },
  },
};
