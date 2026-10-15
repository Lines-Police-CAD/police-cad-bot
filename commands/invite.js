const { EmbedBuilder } = require('discord.js');
const CommandOptions = require('../util/CommandOptionTypes').CommandOptionTypes;
const { getLpcUser, findOption } = require('../util/economy');
const { getCommunityName } = require('../util/communities');
const { apiRequest } = require('../util/api');
const {
  NOT_CONFIGURED_MESSAGE,
  inviteApiConfigured,
  EXPIRY_CHOICES,
  DEFAULT_EXPIRY,
  DEFAULT_MAX_USES,
  MIN_MAX_USES,
  MAX_MAX_USES,
  expiryLabel,
  expiryToIso,
  generateInviteCode,
  inviteJoinUrl,
  fetchInviteCodesPage,
  findInviteCodeByCode,
  remainingUsesLabel,
  expiresAtLabel,
  isInviteCodeUsable,
  creatorLabel,
} = require('../util/invites');

const LIST_PAGE_SIZE = 10;

/**
 * Turn an API failure into something the person reading it can act on.
 *
 * The permission rule lives in the API and nowhere else, so a 403 is reported,
 * not re-derived. 401 means the bot could not identify the caller at all, which
 * is a deployment problem rather than anything the user did wrong.
 */
function inviteApiErrorMessage(err, communityLabel) {
  const where = communityLabel ? `**${communityLabel}**` : 'your active community';
  switch (err && err.status) {
    case 401:
      return `The CAD could not tell who you are, so it would not act on your behalf. A bot admin needs to check the bot's API configuration.`;
    case 403:
      return `You need permission to manage members in ${where} to do that.`;
    case 404:
      return `${communityLabel ? `**${communityLabel}**` : 'That community'} could not be found. Run \`/set-active-community\` to pick one again.`;
    case 410:
      return `${where} is pending deletion, so its invite codes cannot be changed.`;
    default:
      return null;
  }
}

module.exports = {
  name: "invite",
  description: "Create, list and revoke invite codes for your active community",
  usage: "[opt]",
  permissions: {
    channel: ["VIEW_CHANNEL", "SEND_MESSAGES", "EMBED_LINKS"],
    member: [],
  },
  options: [
    {
      name: "create",
      description: "Create an invite code for your active community",
      value: "create",
      type: CommandOptions.SubCommand,
      options: [
        {
          name: "expires_in",
          description: `How long the code stays valid (default ${expiryLabel(DEFAULT_EXPIRY)})`,
          value: "expires_in",
          type: CommandOptions.String,
          required: false,
          choices: EXPIRY_CHOICES,
        },
        {
          name: "max_uses",
          description: `How many people can join with it, ${MIN_MAX_USES} to ${MAX_MAX_USES} (default ${DEFAULT_MAX_USES})`,
          value: "max_uses",
          type: CommandOptions.Integer,
          required: false,
          min_value: MIN_MAX_USES,
          max_value: MAX_MAX_USES,
        },
      ],
    },
    {
      name: "list",
      description: "Show your active community's invite codes",
      value: "list",
      type: CommandOptions.SubCommand,
      options: [
        {
          name: "page",
          description: "Which page of codes to show (default 1)",
          value: "page",
          type: CommandOptions.Integer,
          required: false,
          min_value: 1,
        },
      ],
    },
    {
      name: "delete",
      description: "Revoke an invite code so it can no longer be used",
      value: "delete",
      type: CommandOptions.SubCommand,
      options: [
        {
          name: "code",
          description: "The invite code to revoke",
          value: "code",
          type: CommandOptions.String,
          required: true,
        },
      ],
    },
  ],
  SlashCommand: {
    /**
     *
     * @param {require("../structures/LinesPoliceCadBot")} client
     * @param {import("discord.js").Message} message
     * @param {string[]} args
     * @param {*} param3
    */
    run: async (client, interaction, args, { GuildDB }) => {
      // Invite codes are a way into the community, so a reply is private to the
      // person who asked. Posting one into a channel hands it to everyone who
      // can read that channel.
      await interaction.defer({ flags: (1 << 6) });

      if (GuildDB.customChannelStatus==true&&!GuildDB.allowedChannels.includes(interaction.channel_id)) {
        return interaction.editOriginal({ content: `You are not allowed to use the bot in this channel.` });
      }

      let useCommand = await client.verifyUseCommand(GuildDB.serverID, interaction.member.roles);
      if (!useCommand) return interaction.editOriginal({ content: await client.noPermissionMessage(GuildDB.serverID) });

      const user = await getLpcUser(client, interaction.member.user.id);
      if (!user) return interaction.editOriginal({ content: `You are not logged in. Go to https://linespolice-cad.com/ to login, and connect your Discord account.` });
      if (!user.user.lastAccessedCommunity || !user.user.lastAccessedCommunity.communityID) return interaction.editOriginal({ content: `You are not in an active community. Run \`/set-active-community\` to pick one.` });

      if (!inviteApiConfigured(client)) return interaction.editOriginal({ content: NOT_CONFIGURED_MESSAGE });

      const userId = user._id.toString();
      const communityId = user.user.lastAccessedCommunity.communityID;
      const communityLabel = await getCommunityName(client, communityId);
      const where = communityLabel ? `**${communityLabel}**` : 'your active community';
      const subcommand = args[0] && args[0].name;
      const subOptions = (args[0] && args[0].options) || [];

      if (subcommand === "create") {
        const expiresIn = (findOption(subOptions, 'expires_in') || {}).value || DEFAULT_EXPIRY;
        const rawMaxUses = (findOption(subOptions, 'max_uses') || {}).value;
        // Discord enforces min_value/max_value, but an out-of-range value that
        // somehow arrives is refused by name rather than quietly clamped.
        const maxUses = rawMaxUses === undefined || rawMaxUses === null || rawMaxUses === ''
          ? DEFAULT_MAX_USES
          : Number(rawMaxUses);
        if (!Number.isInteger(maxUses) || maxUses < MIN_MAX_USES || maxUses > MAX_MAX_USES) {
          return interaction.editOriginal({ content: `\`max_uses\` must be a whole number between ${MIN_MAX_USES} and ${MAX_MAX_USES}.` });
        }

        const expiresAt = expiryToIso(expiresIn);

        // A generated code can collide with one that already exists, which the
        // API reports as a conflict. Retry with a fresh code rather than making
        // the user run the command again.
        let created = null;
        let code = null;
        let lastErr = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          code = generateInviteCode();
          try {
            created = await apiRequest(
              client,
              'POST',
              `/api/v1/community/${encodeURIComponent(communityId)}/add-invite-code?userId=${encodeURIComponent(userId)}`,
              { code, maxUses, expiresAt },
            );
            break;
          } catch (err) {
            lastErr = err;
            if (err && err.status === 409) continue;
            break;
          }
        }

        if (!created) {
          client.error(`/invite create: ${lastErr && lastErr.message}`);
          const known = inviteApiErrorMessage(lastErr, communityLabel);
          if (known) return interaction.editOriginal({ content: known });
          return interaction.editOriginal({ content: `Could not create an invite code right now. Please try again in a moment.` });
        }

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Invite Code Created', iconURL: client.config.IconURL })
          .setTitle(code)
          .setDescription(`Share this code to invite people to ${where}. They can run \`/join ${code}\` here, or open the link below.`)
          .addFields(
            { name: `**Expires**`, value: expiresAt ? expiresAtLabel(expiresAt) : 'Never', inline: true },
            { name: `**Max uses**`, value: `\`${maxUses}\``, inline: true },
            { name: `**Link**`, value: inviteJoinUrl(client, code), inline: false },
          )
          .setFooter({ text: 'Only you can see this. Run /invite delete to revoke it early.' });

        return interaction.editOriginal({ embeds: [embed] });
      }

      if (subcommand === "list") {
        const page = Number((findOption(subOptions, 'page') || {}).value) || 1;

        let result;
        try {
          result = await fetchInviteCodesPage(client, communityId, userId, page, LIST_PAGE_SIZE);
        } catch (err) {
          client.error(`/invite list: ${err.message}`);
          const known = inviteApiErrorMessage(err, communityLabel);
          if (known) return interaction.editOriginal({ content: known });
          return interaction.editOriginal({ content: `Could not load invite codes right now. Please try again in a moment.` });
        }

        const { inviteCodes, pagination, expiredCount } = result;
        const totalCount = Number(pagination.totalCount) || 0;
        const totalPages = Number(pagination.totalPages) || 0;

        if (!inviteCodes.length) {
          if (totalCount > 0 && page > 1) {
            return interaction.editOriginal({ content: `There is no page ${page}. ${where} has ${totalPages} ${totalPages === 1 ? 'page' : 'pages'} of invite codes.` });
          }
          return interaction.editOriginal({ content: `${where} has no invite codes. Run \`/invite create\` to make one.` });
        }

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Invite Codes', iconURL: client.config.IconURL })
          .setTitle(communityLabel || 'Your active community');

        for (const inviteCode of inviteCodes) {
          const createdBy = creatorLabel(inviteCode);
          const status = isInviteCodeUsable(inviteCode) ? 'Active' : 'Not usable';
          embed.addFields({
            name: `**${inviteCode.code}**`,
            value: [
              `Status: ${status}`,
              `Expires: ${expiresAtLabel(inviteCode.expiresAt)}`,
              `Uses left: ${remainingUsesLabel(inviteCode)}`,
              `Created by: ${createdBy}`,
            ].join('\n'),
            inline: false,
          });
        }

        const footer = [];
        if (totalPages > 1) footer.push(`Page ${pagination.currentPage || page} of ${totalPages}`);
        footer.push(`${totalCount} total`);
        if (expiredCount) footer.push(`${expiredCount} expired`);
        embed.setFooter({ text: footer.join(' · ') });

        return interaction.editOriginal({ embeds: [embed] });
      }

      if (subcommand === "delete") {
        const typed = String((findOption(subOptions, 'code') || {}).value || '').trim();
        if (!typed) return interaction.editOriginal({ content: `Give the invite code you want to revoke.` });

        let match;
        try {
          match = await findInviteCodeByCode(client, communityId, userId, typed);
        } catch (err) {
          client.error(`/invite delete lookup: ${err.message}`);
          const known = inviteApiErrorMessage(err, communityLabel);
          if (known) return interaction.editOriginal({ content: known });
          return interaction.editOriginal({ content: `Could not look up that invite code right now. Please try again in a moment.` });
        }

        if (!match || !match._id) {
          return interaction.editOriginal({ content: `No invite code \`${typed.toUpperCase()}\` in ${where}. Run \`/invite list\` to see the codes it has.` });
        }

        try {
          await apiRequest(
            client,
            'DELETE',
            `/api/v1/invite-code/${encodeURIComponent(String(match._id))}?userId=${encodeURIComponent(userId)}`,
          );
        } catch (err) {
          client.error(`/invite delete: ${err.message}`);
          if (err && err.status === 404) {
            return interaction.editOriginal({ content: `\`${match.code}\` has already been revoked.` });
          }
          const known = inviteApiErrorMessage(err, communityLabel);
          if (known) return interaction.editOriginal({ content: known });
          return interaction.editOriginal({ content: `Could not revoke that invite code right now. Please try again in a moment.` });
        }

        const embed = new EmbedBuilder()
          .setColor('#38bdf8')
          .setAuthor({ name: 'Invite Code Revoked', iconURL: client.config.IconURL })
          .setTitle(String(match.code || typed.toUpperCase()))
          .setDescription(`This code no longer works for ${where}. Anyone who already joined with it stays a member.`);

        return interaction.editOriginal({ embeds: [embed] });
      }

      return interaction.editOriginal({ content: `Pick \`create\`, \`list\` or \`delete\`.` });
    },
  },
};
