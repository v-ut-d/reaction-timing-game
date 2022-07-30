import {
  Client,
  MessageComponentInteraction,
  Message,
  PartialMessage,
  PartialUser,
  User,
  Guild,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  ButtonBuilder
} from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Message,
    Partials.Reaction
  ]
});

import { config as dotenvconfig } from 'dotenv';
dotenvconfig();

import * as datefns from "date-fns";
import { utcToZonedTime } from "date-fns-tz";
import ja from 'date-fns/locale/ja'

function formatDateTZ(
  date: Date | number,
  format: string,
  options?: {
    locale?: Locale
    weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6
    firstWeekContainsDate?: number
    useAdditionalWeekYearTokens?: boolean
    useAdditionalDayOfYearTokens?: boolean
  }) {
  return datefns.format(utcToZonedTime(date, config.TZ), format, options);
}

import setupCommands from "./commands";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

import * as constantsconfig from "./config";

let config: constantsconfig.ConfigurationType;


interface DiscordMessageTree<T> {
  [guildId: string]: {
    [channelId: string]: {
      [messageId: string]: T
    }
  }
}

function getFromDiscordMessageTree<T>(tree: DiscordMessageTree<T>, message: Message | PartialMessage) {
  return message.guildId &&
    message.channelId &&
    tree[message.guildId] &&
    tree[message.guildId][message.channelId] &&
    tree[message.guildId][message.channelId][message.id]
}

function setToDiscordMessageTree<T>(tree: DiscordMessageTree<T>, message: Message | PartialMessage) {
  if (message.guildId && message.channelId) {
    tree[message.guildId] ??= {};
    tree[message.guildId][message.channelId] ??= {};
  }
}

interface ReactionTime {
  time: bigint,
  user: PartialUser | User
}
let reactionCache: DiscordMessageTree<ReactionTime[]> = {};

client.on("ready", async () => {
  console.log("Started!");
  const guilds = await client.guilds.fetch();
  guilds.forEach(guild => {
    client.user && process.env.DISCORD_BOT_TOKEN &&
      setupCommands(client.user.id, guild.id, process.env.DISCORD_BOT_TOKEN);
  })
});

client.on("messageReactionAdd", (reaction, user) => {
  const time = process.hrtime.bigint();
  if (user.bot) return;
  if (reaction.emoji.name !== config.reactEmoji) return;
  const reactionTimeArray = getFromDiscordMessageTree(reactionCache, reaction.message);
  if (reactionTimeArray) {
    reactionTimeArray.push({
      time,
      user: user
    });
  }
})

client.on('interactionCreate', async interaction => {
  const tokenExpiresAt = datefns.addMinutes(new Date(), 15);
  if (!interaction.inCachedGuild() || !interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'start') {
    if (!interaction.channel) return;
    const max_reaction = Math.min(interaction.options.getInteger("参加者数の上限") ?? 4, 4);
    const row_pri = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder()
          .setCustomId('start')
          .setLabel('いますぐはじめる')
          .setStyle(ButtonStyle.Success),
      )
      .addComponents(
        new ButtonBuilder()
          .setCustomId('cancel')
          .setLabel('やめる')
          .setStyle(ButtonStyle.Danger),
      )

    await interaction.reply({ content: "ゲーム操作:", components: [row_pri], ephemeral: false });
    const nickname = getDisplayName(interaction.guild, interaction.user.id);
    const message = await interaction.channel?.send({
      content:
        `${nickname}がゲームを始めました。\n参加する人は${config.joinEmoji}で反応してください。`
    });
    if (message) {
      message.react(config.joinEmoji);
    }


    const createResult = prisma.guild.upsert({
      where: { id: interaction.guildId },
      update: { id: interaction.guildId },
      create: { id: interaction.guildId }
    }).then(() =>
      prisma.game.create({
        data: {
          startedBy: interaction.user.id,
          guildId: interaction.guildId
        }
      })
    );

    const timeout = 2 * 24 * 3600 * 1000;//2 days
    const timeoutAt = datefns.addMilliseconds(new Date(), timeout);

    const reply = await interaction.fetchReply();
    const res = await Promise.race([
      interaction.channel?.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: timeout,
        filter: async function (i) {
          if (i.message.id !== reply.id) {
            return false;
          }
          if (i.user.id === interaction.user.id) {
            return true;
          } else {
            await i.reply({ content: "このゲームを始めた人しか操作できません。", ephemeral: true })
              .catch(() => { });
            return false;
          }
        }
      }),
      message?.awaitReactions({
        max: max_reaction,
        time: timeout,
        filter: function (reaction, user) {
          return reaction.emoji.toString() === config.joinEmoji && !user.bot
        }
      }),
    ]).catch(() => false);

    if (datefns.compareAsc(timeoutAt, new Date()) < 0) {
      await interaction.deleteReply();
      return;
    }

    const joinEmojiId = constantsconfig.getIdFromEmojiString(config.joinEmoji);
    const participants =
      joinEmojiId &&
      await message?.reactions.cache.get(joinEmojiId)?.users.fetch();

    message?.deletable && await message?.delete();

    if (
      res &&
      !(res instanceof MessageComponentInteraction && res.customId === "cancel") &&
      participants &&
      participants.size >= 2) {
      const participantIds = participants.map(p => p.id).filter(id => id !== client.user?.id);
      const mentionString = getMentionString(participantIds);

      const messageString = `5秒後にカウントダウンを開始します。0になった瞬間に${config.reactEmoji}でリアクションしてください。注意:${config.kaishimaeEmoji}はスマホでは機能しません。`;

      let mentionMessage: Message | undefined;
      let gameMessage: Message | undefined;
      if (datefns.compareAsc(tokenExpiresAt, new Date()) > 0) {
        //Before Expiration
        gameMessage =
          (await interaction.editReply({ content: messageString, components: [] })) as Message;
        mentionMessage = (await interaction.followUp(mentionString)) as Message;
      } else {
        //After Expiration
        !interaction.ephemeral && await interaction.deleteReply().catch(() => false);
        mentionMessage = await interaction.channel.send(mentionString);
        gameMessage = await interaction.channel.send(messageString);
      }

      setTimeout(() => {
        mentionMessage?.delete();
      }, 5000);

      const resultString = await game((await createResult).id, gameMessage);

      if (resultString) {
        if (datefns.compareAsc(tokenExpiresAt, new Date()) > 0) {
          await interaction.editReply({ content: resultString, components: [] })
        } else {
          await gameMessage.edit(resultString)
        }
      } else {
        if (datefns.compareAsc(tokenExpiresAt, new Date()) > 0) {
          await interaction.deleteReply();
        } else {
          await gameMessage.delete();
        }
      }
    } else {
      !interaction.ephemeral && await interaction.deleteReply().catch(() => false);
    }


  } else if (interaction.commandName === "points") {
    const user = interaction.options.getUser("ユーザー", true);
    const date = interaction.options.getString("日付", true);
    let day = new Date();
    try {
      day = datefns.parse(date, "y/M/d", new Date(), { locale: ja });
    } catch {
      interaction.reply({
        content: "日付の形式が違います。2022/01/01ではなく、2022/1/1のような形式になっていますか？",
        ephemeral: true
      });
      return;
    }
    await interaction.deferReply();
    const res = await prisma.point.findMany({
      where: {
        userId: user.id,
        game: {
          finishedAt: {
            gte: day,
            lte: datefns.addDays(day, 1)
          },
          guild: {
            id: interaction.guildId
          }
        }
      },
      orderBy: {
        game: {
          finishedAt: "asc"
        }
      },
      select: {
        point: true,
        game: {
          select: {
            finishedAt: true,
            createdAt: true
          }
        }
      }
    });
    const nickname = getDisplayName(interaction.guild, user.id);
    interaction.editReply(
      `${nickname} ${formatDateTZ(day, "y/M/d")}\n` +
      res.map(record => {
        const timeStr = record.game.finishedAt
          ? formatDateTZ(record.game.finishedAt, " HH:mm:ss ", { locale: ja })
          : formatDateTZ(record.game.createdAt, "(HH:mm:ss)", { locale: ja });
        return `${timeStr} ${record.point}`
      }).join("\n")
    );
  } else if (interaction.commandName === "ranking") {
    const rank = interaction.options.getInteger("順位", false) ?? 1;
    const user = interaction.options.getUser("ユーザー", false) ?? undefined;
    const date_start = interaction.options.getString("日付ここから", false);
    const date_end = interaction.options.getString("日付ここまで", false);
    let day_start: Date | undefined = undefined;
    let day_end: Date | undefined = undefined;
    try {
      if (date_start) {
        day_start = datefns.parse(date_start, "y/M/d", new Date(), { locale: ja });
        if (date_end) {
          day_end = datefns.parse(date_end, "y/M/d", new Date(), { locale: ja });
          day_end = datefns.addDays(day_end, 1);
        } else {
          day_end = datefns.addDays(day_start, 1);
        }
      }
    } catch {
      interaction.reply({
        content: "日付の形式が違います。2022/01/01ではなく、2022/1/1のような形式になっていますか？",
        ephemeral: true
      });
      return;
    }
    await interaction.deferReply();
    const res = await prisma.point.findMany({
      where: {
        userId: user?.id,
        game: {
          finishedAt: {
            gte: day_start,
            lte: day_end
          },
          guild: {
            id: interaction.guildId
          }
        }
      },
      orderBy: {
        point: "desc"
      },
      select: {
        userId: true,
        point: true,
        game: {
          select: {
            finishedAt: true,
            createdAt: true
          }
        }
      },
      skip: rank - 1,
      take: 10
    });

    const nickname = user && getDisplayName(interaction.guild, user.id);
    let commandInfo = `Ranking `;
    if (nickname) commandInfo += nickname + " ";
    if (day_start) commandInfo += formatDateTZ(day_start, "y/M/d", { locale: ja });
    if (day_end) commandInfo += " to " + formatDateTZ(datefns.subSeconds(day_end, 1), "y/M/d", { locale: ja });
    commandInfo += ":\n";

    const ResultArray = await Promise.all(
      res.map(async (record, i) => {
        let nn: string | undefined;
        if (!user) {
          const u = await interaction.guild?.members.fetch(record.userId);
          nn = u?.displayName;
        }
        if (!nn) nn = "";

        const timeStr = record.game.finishedAt
          ? formatDateTZ(record.game.finishedAt, "yyyy/MM/dd HH:mm:ss ", { locale: ja })
          : formatDateTZ(record.game.createdAt, "(yyyy/MM/dd HH:mm:ss)", { locale: ja });

        return `${i + rank}位 ${nn} ${timeStr} ${record.point}`
      })
    );

    interaction.editReply(
      commandInfo + ResultArray.join("\n")
    );

  } else if (interaction.commandName === "config") {
    const key = interaction.options.getString("設定項目", true);
    const value = interaction.options.getString("値", false);
    if (value) {
      if (
        process.env.BOT_ADMIN_USER?.split(",")
          .some(userid => userid.length >= 16 && userid.length <= 19 && userid === interaction.user.id)) {
        await interaction.deferReply();
        const before = config[key as keyof constantsconfig.ConfigurationType];
        constantsconfig.setConfig(prisma, key, value)
          .then(async () => {
            config = await constantsconfig.getConfig(prisma);
            const after = config[key as keyof constantsconfig.ConfigurationType];
            await interaction.editReply(`設定を変更しました。 ${key}: ${before} -> ${after}`)
          })
          .catch(async err => {
            if (err instanceof Error && err.message !== "Validation failed") {
              console.log(err);
            }
            await interaction.editReply(`設定の変更に失敗しました。 ${key}: ${before} -> ${value}`);
          });
      } else {
        await interaction.reply({
          content: "環境変数で設定したユーザーのみが設定を変更できます",
          ephemeral: true
        });
      }
    } else {
      if (constantsconfig.isInConfigurationTypesKey(key)) {
        await interaction.reply(`${key}:${config[key]}`);
      } else {
        await interaction.reply({ content: "そのような設定項目は存在しません", ephemeral: true });
      }
    }
  }
});

function getPoint(time: bigint) {
  let absed = AbsBigInt(time);
  if (absed === BigInt(0)) absed = BigInt(1);
  return Number(BigInt(1e10) / absed);
}

function AbsBigInt(i: bigint) {
  return i > 0 ? i : -i;
}

function getDisplayName(guild: Guild | null, userId: string) {
  return guild?.members.cache.get(userId)?.displayName;
}

function getMentionString(participantIds: string[]) {
  return participantIds.reduce((c, p) => c + `<@${p}>`, "");
}


async function game(dbgameid: number, gamemessage: Message) {
  await prisma.game.update({
    where: {
      id: dbgameid
    },
    data: {
      startedAt: new Date(),
    }
  });

  const gamemessage_sub_promise =
    gamemessage.channel.send(config.kaishimaeEmoji.repeat(4));


  await new Promise(resolve => setTimeout(resolve, 5000));

  const reactMessage_promise =
    gamemessage.channel.send(formatDateTZ(new Date(), "Pp", { locale: ja }));

  const before = process.hrtime.bigint();

  let after: bigint | undefined;

  await Promise.all([
    gamemessage.edit(config.countDownEmoji.repeat(4))
      .then(() => {
        after = process.hrtime.bigint();
      }),
    reactMessage_promise.then(msg => msg.react(config.reactEmoji)),
    (async () => {
      const reactMessage = await reactMessage_promise;
      if (reactMessage.guildId && reactMessage.channelId) {
        setToDiscordMessageTree(reactionCache, reactMessage);
        reactionCache[reactMessage.guildId][reactMessage.channelId][reactMessage.id] = [];
      }
    })(),
    //これの正確性は結果に関係しない
    new Promise(resolve => setTimeout(resolve, 12000))
  ]);


  if (!after) return;


  console.log(after - before)
  //const zero = (before + after) / BigInt(2) + BigInt(5 * 1e9);
  const zero = after + BigInt(5 * 1e9) + config.timeAdjustFactor;


  await (await gamemessage_sub_promise).delete();
  await (await reactMessage_promise).delete();

  const reactionTimeArray = getFromDiscordMessageTree(reactionCache, await reactMessage_promise);

  if (!reactionTimeArray) return;
  const diffed: ReactionTime[] = reactionTimeArray.map(reactionTime => {
    return {
      time: reactionTime.time - zero,
      user: reactionTime.user
    };
  });
  let diffdeduped: { [k: string]: ReactionTime } = {};
  diffed.forEach(reactionTime => {
    if (!diffdeduped[reactionTime.user.id]) {
      diffdeduped[reactionTime.user.id] = reactionTime;
    }
  })
  let resultMessage = "";
  let dbPromiseArray: Promise<unknown>[] = [];
  Object.values(diffdeduped)
    .sort((a, b) => {
      return AbsBigInt(a.time) > AbsBigInt(b.time) ? 1 : -1;
    })
    .forEach((reactionTime, i) => {
      const nickname = getDisplayName(gamemessage.guild, reactionTime.user.id);
      let time = AbsBigInt(reactionTime.time).toString().padStart(10, "0");
      const otime = time.substr(0, time.length - 9) + "." + time.substr(time.length - 9, 5);
      resultMessage += `${i + 1}位: ${nickname ?? ""} ${otime} ${getPoint(reactionTime.time)}\n`;

      dbPromiseArray.push(
        prisma.point.create({
          data: {
            userId: reactionTime.user.id,
            point: getPoint(reactionTime.time),
            rawTimeNS: reactionTime.time,
            gameId: dbgameid,
            algorithmVersion: 1
          }
        })
      );
    });
  await Promise.all(dbPromiseArray);
  await prisma.game.update({
    where: {
      id: dbgameid
    },
    data: {
      finishedAt: new Date(),
    }
  });
  return resultMessage;
}

if (process.env.DISCORD_BOT_TOKEN == undefined) {
  console.log("DISCORD_BOT_TOKENが設定されていません。");
  process.exit(0);
}

constantsconfig.getConfig(prisma)
  .then(_config => config = _config)
  .then(() => {
    client.login(process.env.DISCORD_BOT_TOKEN);
  })

