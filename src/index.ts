import { Client, Intents, MessageActionRow, MessageButton, MessageComponentInteraction, Message, PartialMessage, PartialMessageReaction, PartialUser, TextBasedChannels, TextChannel, User, Guild, Interaction, CommandInteraction } from "discord.js";

const client = new Client({
  intents: [
    Intents.FLAGS.GUILDS,
    Intents.FLAGS.GUILD_MESSAGES,
    Intents.FLAGS.GUILD_MESSAGE_REACTIONS
  ],
  partials: ["MESSAGE", "REACTION"]
});

import { config as dotenvconfig } from 'dotenv';
dotenvconfig();

import * as datefns from "date-fns";
import ja from 'date-fns/locale/ja'

const joinEmoji = "912979606238294016";
const reactEmoji = "🔴";
const countDownEmoji = "<a:countdown:913632527686725722>";
const countDownEmoji2 = "<a:kaishimae:914348396318449705>";

const timeAdjustFactor = 334237733n;

import setupCommands from "./commands";

import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();


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
  if (reaction.emoji.name !== reactEmoji) return;
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
  if (!interaction.isCommand()) return;
  if (interaction.commandName === 'start') {
    if (!interaction.channel) return;
    const max_reaction = Math.min(interaction.options.getInteger("参加者数の上限") ?? 10, 50);
    const row_pri = new MessageActionRow()
      .addComponents(
        new MessageButton()
          .setCustomId('start')
          .setLabel('いますぐはじめる')
          .setStyle('SUCCESS'),
      )
      .addComponents(
        new MessageButton()
          .setCustomId('cancel')
          .setLabel('やめる')
          .setStyle('DANGER'),
      );

    await interaction.reply({ content: "ゲーム操作:", components: [row_pri], ephemeral: false });
    const message = await interaction.channel?.send({
      content:
        `${interaction.user.username}がゲームを始めました。\n参加する人は<:join:912979606238294016>で反応してください。`
    });
    if (message) {
      message.react("<:join:912979606238294016>");
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
    const res = await Promise.race([
      interaction.channel?.awaitMessageComponent({
        componentType: "BUTTON",
        time: timeout,
        filter: async function (i) {
          await i.deferUpdate();
          return i.user.id === interaction.user.id;
        }
      }),
      message?.awaitReactions({
        max: max_reaction,
        time: timeout,
        filter: function (reaction, user) {
          return reaction.emoji.id === joinEmoji && !user.bot
        }
      }),
    ]).catch(() => false);

    if (datefns.compareAsc(timeoutAt, new Date()) < 0) {
      await interaction.deleteReply();
      return;
    }


    const participants = await message?.reactions.cache.get(joinEmoji)?.users.fetch();

    !message?.deleted && await message?.delete();

    if (
      res &&
      !(res instanceof MessageComponentInteraction && res.customId === "cancel") &&
      participants &&
      participants.size >= 2) {
      const participantIds = participants.map(p => p.id).filter(id => id !== client.user?.id);
      const mentionString = getMentionString(participantIds);


      let mentionMessage: Message | undefined;
      let gameMessage: Message | undefined;
      if (datefns.compareAsc(tokenExpiresAt, new Date()) > 0) {
        //Before Expiration
        gameMessage =
          (await interaction.editReply({ content: "5秒後にカウントダウンを開始します", components: [] })) as Message;
        mentionMessage = (await interaction.followUp(mentionString)) as Message;
      } else {
        //After Expiration
        !interaction.ephemeral && await interaction.deleteReply().catch(() => false);
        mentionMessage = await interaction.channel.send(mentionString);
        gameMessage = await interaction.channel.send("5秒後にカウントダウンを開始します");
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
      `${nickname} ${datefns.format(day, "y/M/d")}\n` +
      res.map(record => {
        const timeStr = record.game.finishedAt
          ? datefns.format(record.game.finishedAt, " HH:mm:ss ", { locale: ja })
          : datefns.format(record.game.createdAt, "(HH:mm:ss)", { locale: ja });
        return `${timeStr} ${record.point}`
      }).join("\n")
    );
  } else if (interaction.commandName = "ranking") {
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
    if (day_start) commandInfo += datefns.format(day_start, "y/M/d", { locale: ja });
    if (day_end) commandInfo += " to " + datefns.format(datefns.subSeconds(day_end, 1), "y/M/d", { locale: ja });
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
          ? datefns.format(record.game.finishedAt, "yyyy/MM/dd HH:mm:ss ", { locale: ja })
          : datefns.format(record.game.createdAt, "(yyyy/MM/dd HH:mm:ss)", { locale: ja });

        return `${i + 1}位 ${nn} ${timeStr} ${record.point}`
      })
    );

    interaction.editReply(
      commandInfo + ResultArray.join("\n")
    );
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
    gamemessage.channel.send(countDownEmoji2.repeat(4));

  await new Promise(resolve => setTimeout(resolve, 5000))


  const before = process.hrtime.bigint();

  let after: bigint | undefined;

  await Promise.all([
    gamemessage.edit(countDownEmoji.repeat(4))
      .then(() => {
        after = process.hrtime.bigint();
      }),
    gamemessage.react(reactEmoji),
    (async () => {
      if (gamemessage.guildId && gamemessage.channelId) {
        setToDiscordMessageTree(reactionCache, gamemessage);
        reactionCache[gamemessage.guildId][gamemessage.channelId][gamemessage.id] = [];
      }
    })(),
    //これの正確性は結果に関係しない
    new Promise(resolve => setTimeout(resolve, 12000))
  ]);


  if (!after) return;


  console.log(after - before)
  //const zero = (before + after) / BigInt(2) + BigInt(5 * 1e9);
  const zero = after + BigInt(5 * 1e9) + timeAdjustFactor;

  await (await gamemessage_sub_promise).delete();

  const reactionTimeArray = getFromDiscordMessageTree(reactionCache, gamemessage)
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

client.login(process.env.DISCORD_BOT_TOKEN);

