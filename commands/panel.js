// commands/panel.js
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rolepanel')
    .setDescription('ロール付与パネルを設置します。')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('パネルに表示するメッセージを入力してください。')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const message = interaction.options.getString('message');

    const roleIds = [
      'ここにロールID1',
      'ここにロールID2',
      'ここにロールID3',
    ];

    const roles = roleIds.map(id => interaction.guild.roles.cache.get(id)).filter(role => role);

    const embed = new EmbedBuilder()
      .setColor('Purple')
      .setTitle('ロール選択パネル')
      .setDescription(message)
      .addFields(
        roles.map(role => ({
          name: role.name,
          value: `✅  \`!roll ${role.name}\` `
        }))
      );

    const row = new ActionRowBuilder().addComponents(
      roles.map(role =>
        new ButtonBuilder()
          .setCustomId(`role_button_${role.id}`)
          .setLabel(role.name)
          .setStyle(ButtonStyle.Primary)
      )
    );

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });
  },

  async buttonHandler(interaction) {
    const [_, __, roleId] = interaction.customId.split('_');
    const member = interaction.member;
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role) {
      return interaction.reply({
        content: '❌ 指定されたロールが見つかりません。',
        ephemeral: true
      });
    }

    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId);
      return interaction.reply({
        content: `✅ ロール **${role.name}** を外しました。`,
        ephemeral: true
      });
    } else {
      await member.roles.add(roleId);
      return interaction.reply({
        content: `✅ ロール **${role.name}** を付与しました。`,
        ephemeral: true
      });
    }
  }
};
