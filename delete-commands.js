// delete-commands.js
const { REST, Routes } = require('discord.js');
const { clientId, token } = require('./config.json');

const rest = new REST({ version: '10' }).setToken(token);

// ギルドIDを直接指定
const guildId = '1404236535733158018'; 

rest.put(Routes.applicationGuildCommands(clientId, guildId), [])
  .then(() => console.log('Successfully deleted all guild commands.'))
  .catch(console.error);
