import { Channel } from "diagnostics_channel";
import { Client, Intents, MessageActionRow, MessageButton, MessageComponentInteraction, Message, PartialMessage, PartialMessageReaction, PartialUser, TextBasedChannels, TextChannel, User } from "discord.js";

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

const joinEmoji = "912979606238294016";
const reactEmoji = "🔴";

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
  const reactionTimeArray = getFromDiscordMessageTree(reactionCache, reaction.message);
  if (reactionTimeArray) {
    reactionTimeArray.push({
      time,
      user: user
    });
  }
})

client.on('interactionCreate', async interaction => {
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

    await interaction.reply({ content: "ゲーム操作:", components: [row_pri], ephemeral: true });
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
          createdAt: new Date(),
          guildId: interaction.guildId
        }
      })
    );

    const timeout = 2 * 24 * 3600 * 1000;//2 days
    const res = await Promise.race([
      interaction.channel?.awaitMessageComponent({
        componentType: "BUTTON",
        time: timeout,
        filter: function (i) {
          i.deferUpdate();
          return i.user.id === interaction.user.id;
        }
      }),
      message?.awaitReactions({
        max: max_reaction,
        time: timeout,
        filter: function (reaction) {
          return reaction.emoji.id === joinEmoji
        }
      }),
    ]).catch(() => false);
    const participants = await message?.reactions.cache.get(joinEmoji)?.users.fetch();
    if (
      !res ||
      (res !== true && res instanceof MessageComponentInteraction &&
        res.customId === "cancel") ||
      !participants ||
      participants.size <= 1
    ) {
      interaction.deleteReply().catch(() => false);
      !message?.deleted && message?.delete();
      return;
    }
    const participantIds = participants.map(p => p.id).filter(id => id !== client.user?.id);


    await game((await createResult).id, interaction.channel, participantIds);


  }
});

function getPoint(time: bigint) {
  return Number(BigInt(1e10) / AbsBigInt(time));
}

function AbsBigInt(i: bigint) {
  return i > 0 ? i : -i;
}


async function game(dbgameid: number, channel: TextBasedChannels, participantIds: string[]) {
  let messagecontent = participantIds.reduce((c, p) => c + `<@${p}>`, "");
  const mentionmessage = await channel.send(messagecontent);

  prisma.game.update({
    where: {
      id: dbgameid
    },
    data: {
      startedAt: new Date(),
    }
  });

  const gamemessage = await channel.send("5秒後にカウントダウンを開始します");
  await new Promise(resolve => setTimeout(resolve, 5000));
  gamemessage.react(reactEmoji);
  if (gamemessage.guildId && gamemessage.channelId) {
    setToDiscordMessageTree(reactionCache, gamemessage);
    reactionCache[gamemessage.guildId][gamemessage.channelId][gamemessage.id] = [];
  }
  for (let current = 5; current > 0; current--) {
    gamemessage.edit(current.toString());
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const zero_before = process.hrtime.bigint();
  await gamemessage.edit("0");
  const zero_after = process.hrtime.bigint();
  for (let current = -1; current > -5; current--) {
    gamemessage.edit(current.toString());
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  gamemessage.edit("-5");

  //'0'の送信前後の時刻を平均する
  const zero = (zero_after + zero_before) / BigInt(2);
  const reactionTimeArray = getFromDiscordMessageTree(reactionCache, gamemessage)
  if (!reactionTimeArray) return;
  const diffed: ReactionTime[] = reactionTimeArray.map(reactionTime => {
    return {
      time: reactionTime.time - zero,
      user: reactionTime.user
    };
  });
  let diffwithnodupe: { [k: string]: ReactionTime } = {};
  diffed.forEach(reactionTime => {
    if (!diffwithnodupe[reactionTime.user.id]) {
      diffwithnodupe[reactionTime.user.id] = reactionTime;
    }
  })
  let resultMessage = "";
  Object.values(diffwithnodupe)
    .sort((a, b) => {
      return AbsBigInt(a.time) > AbsBigInt(b.time) ? 1 : -1;
    })
    .forEach((reactionTime, i) => {
      const nickname =
        gamemessage.guild?.members.cache.get(reactionTime.user.id)?.nickname
        ?? reactionTime.user.username;
      let time = AbsBigInt(reactionTime.time).toString().padStart(10, "0");
      const otime = time.substr(0, time.length - 9) + "." + time.substr(time.length - 9, 5);
      resultMessage += `${i + 1}位: ${nickname ?? ""} ${otime} ${getPoint(reactionTime.time)}\n`;

      prisma.point.create({
        data: {
          userId: reactionTime.user.id,
          point: getPoint(reactionTime.time),
          rawTimeNS: reactionTime.time,
          gameId: dbgameid,
          algorithmVersion: 1
        }
      });
    });

  prisma.game.update({
    where: {
      id: dbgameid
    },
    data: {
      finishedAt: new Date(),
    }
  });

  gamemessage.edit(resultMessage);
  mentionmessage.delete();
}

if (process.env.DISCORD_BOT_TOKEN == undefined) {
  console.log("DISCORD_BOT_TOKENが設定されていません。");
  process.exit(0);
}

client.login(process.env.DISCORD_BOT_TOKEN);

