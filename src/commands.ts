import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from '@discordjs/rest';
const { Routes } = require('discord-api-types/v9');

const commands = [
    new SlashCommandBuilder()
        .setName('start')
        .setDescription('ゲームを始めます')
        .addIntegerOption(option =>
            option.setName("参加者数の上限")
                .setDescription("参加者数がこの人数に達すると自動的にゲームが始まります。デフォルトは10人で、最大50人です。")
        ),
]
    .map(command => command.toJSON());

export default async function setupCommands(clientId: string, guildId: string, token: string) {
    const rest = new REST({ version: '9' }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}