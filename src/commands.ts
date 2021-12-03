import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from '@discordjs/rest';
const { Routes } = require('discord-api-types/v9');

import { configArray } from "./config";

const commands = [
    new SlashCommandBuilder()
        .setName('start')
        .setDescription('ゲームを始めます')
        .addIntegerOption(option =>
            option.setName("参加者数の上限")
                .setDescription("参加者数がこの人数に達すると自動的にゲームが始まります。最大4人です。")
        ),
    new SlashCommandBuilder()
        .setName('points')
        .setDescription('指定の年月日の指定のユーザの得点を時系列で表示します。')
        .addUserOption(option =>
            option.setName("ユーザー")
                .setDescription("得点を表示するユーザーを指定してください。")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("日付")
                .setDescription("日付を 年(西暦)/月/日 の形式で入力してください。ゼロ埋めは不要です(01→1)")
                .setRequired(true)
        ),
    new SlashCommandBuilder()
        .setName("ranking")
        .setDescription("ランキングを表示します。'日付ここから'から'日付ここまで'までの範囲で集計します。")
        .addIntegerOption(option =>
            option.setName("順位")
                .setDescription("表示する最高の順位です。この順位以下の10件が表示されます。デフォルトは1です。")
        )
        .addUserOption(option =>
            option.setName("ユーザー")
                .setDescription("得点を表示するユーザーです。指定しないと全員分表示します。")
        )
        .addStringOption(option =>
            option.setName("日付ここから")
                .setDescription("日付は 年(西暦)/月/日 の形式で入力してください。指定しないと全期間について集計します。")
        )
        .addStringOption(option =>
            option.setName("日付ここまで")
                .setDescription("日付は 年(西暦)/月/日 の形式で入力してください。指定しないと全期間について集計します。")
        ),
    new SlashCommandBuilder()
        .setName("config")
        .setDescription("設定を表示・変更します。なお、変更ができるのは環境変数で設定したユーザーに限られます。")
        .addStringOption(option =>
            option.setName("設定項目")
                .setDescription("表示・変更する項目を選んでください")
                .addChoices(configArray.map(c => [c, c]))
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("値")
                .setDescription("設定項目を変更する場合は、設定する値を入力してください。")
        )

]
    .map(command => command.toJSON());

export default async function setupCommands(clientId: string, guildId: string, token: string) {
    const rest = new REST({ version: '9' }).setToken(token);
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
}
