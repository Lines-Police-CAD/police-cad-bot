const { startHeartbeat } = require("../util/heartbeat");

module.exports = async (client) => {
  (client.Ready = true),
    client.user.setActivity(
      client.config.Presence.name, 
      client.config.Presence.type
    )
  client.log(`Successfully Logged in as ${client.user.tag}`); // You can change the text if you want, but DO NOT REMOVE "client.user.tag"
  client.log(`Ready to serve in ${client.channels.cache.size} channels on ${client.guilds.cache.size} servers, for a total of ${client.users.cache.size} users.`)
  client.RegisterSlashCommands();

  // Health heartbeat. Started here, once this shard's gateway is up, so we
  // never beat before the bot can actually serve commands. Each shard is its
  // own process, so each one runs its own interval. Wrapped because nothing
  // about monitoring may stop the bot from coming up.
  try {
    startHeartbeat(client);
  } catch (err) {
    client.error(`Failed to start heartbeat: ${err}`);
  }
};
