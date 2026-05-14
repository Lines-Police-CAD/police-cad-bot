module.exports = async (client, interaction) => {
  // Only handle button / select-menu interactions here. Slash commands and
  // autocomplete are dispatched from the raw INTERACTION_CREATE WS handler
  // in structures/LinesPoliceCadBot.js, and would otherwise crash below
  // because they have no `customId`.
  if (!interaction.isMessageComponent || !interaction.isMessageComponent()) return;
  if (!interaction.customId) return;

  let GuildDB = await client.GetGuild(interaction.guildId);
  const interactionName = interaction.customId.split("-")[0];
  let interactionHandler = client.interactionHandlers.get(interactionName);
  if (!interactionHandler) return;

  interactionHandler.run(client, interaction, GuildDB);
};
