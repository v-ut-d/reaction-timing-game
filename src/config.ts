import { PrismaClient } from ".prisma/client";
import EmojiRegex from "emoji-regex";




interface ConfigurationAttributes<T> {
    default: T,
    parser: (input: string) => T,
    inputModifier?: (input: string) => string | null,
    validator: (input: string) => boolean
}

export interface ConfigurationType {
    "joinEmoji": string
    "reactEmoji": string
    "countDownEmoji": string
    "kaishimaeEmoji": string
    "timeAdjustFactor": bigint
}

type Configuration = {
    [k in keyof ConfigurationType]: ConfigurationAttributes<ConfigurationType[k]>
}


const RetVal = (input: string) => input;

const configuration: Configuration = {
    "joinEmoji": {
        default: "👍",
        parser: RetVal,
        validator: EmojiValidator,
        inputModifier: EmojiModifier
    },
    "reactEmoji": {
        default: "🔴",
        parser: RetVal,
        validator: EmojiValidator,
        inputModifier: EmojiModifier
    },
    "countDownEmoji": {
        default: "⏬",
        parser: RetVal,
        validator: EmojiValidator,
        inputModifier: EmojiModifier
    },
    "kaishimaeEmoji": {
        default: "🔜",
        parser: RetVal,
        validator: EmojiValidator,
        inputModifier: EmojiModifier
    },
    "timeAdjustFactor": {
        default: 334237733n,
        parser: (input: string) => BigInt(input),
        validator: TimeAdjustFactorValidator
    }
}

export const configArray = Object.keys(configuration);

function EmojiValidator(value: string) {
    const emojiRegex = EmojiRegex();
    return /^<a?:(\w|\d)+:\d{18}>$/.test(value) || emojiRegex.test(value);
}
function EmojiModifier(input: string) {
    const emojiRegex = EmojiRegex();
    const emojiMatched = input.match(emojiRegex);
    if (emojiMatched) {
        return emojiMatched[0];
    } else {
        const match = input.match(/<a?:(\w|\d)+:(\d{18})>/);
        if (match) {
            return match[0];
        } else {
            const animatedMatched = input.match(/< *a *:/);
            const idMatched = input.match(/: *(\d{18})> */);
            const nameMatched = input.match(/: *((\w|\d)+) *:/);
            if (idMatched && nameMatched) {
                if (animatedMatched) {
                    return `<a:${nameMatched[1]}:${idMatched[1]}>`;
                } else {
                    return `<:${nameMatched[1]}:${idMatched[1]}>`;
                }
            } else {
                return null;
            }
        }
    }
}

export function getIdFromEmojiString(emoji: string) {
    const emojiRegex = EmojiRegex();
    if (emojiRegex.test(emoji)) {
        return emoji;
    } else {
        const match = emoji.match(/<a?:(\w|\d)+:(\d{18})>/);
        return match && match[2];
    }
}

function TimeAdjustFactorValidator(value: string) {
    return /\d+n/.test(value);
}

function validate(key: string, value: string) {
    if (isInConfigurationTypesKey(key)) {
        return configuration[key].validator(value);
    } else {
        return false;
    }
}

export function isInConfigurationTypesKey(arg: any): arg is keyof ConfigurationType {
    return arg in configuration;
}

export async function getConfig(prisma: PrismaClient) {
    let res: {
        [k in keyof ConfigurationType]?: any
    } = {};
    const dbres = await prisma.config.findMany({
        where: {
            OR: configArray.map(c => {
                return { key: c };
            })
        }
    });
    configArray.forEach(key => {
        if (isInConfigurationTypesKey(key)) {
            res[key] = configuration[key]["default"];
        }
    });
    dbres.forEach(r => {
        if (isInConfigurationTypesKey(r.key) && validate(r.key, r.value)) {
            res[r.key] = configuration[r.key].parser(r.value);
        }
    });
    return res as ConfigurationType;
}

export async function setConfig(prisma: PrismaClient, key: string, value: string) {
    let _value = value;
    if (isInConfigurationTypesKey(key)) {
        const modifier = configuration[key].inputModifier;
        if (modifier) {
            _value = modifier(_value) ?? _value;
        }
    }
    if (!validate(key, _value)) return Promise.reject(new Error("Validation failed"));
    return await prisma.config.upsert({
        where: {
            key: key
        },
        update: {
            value: _value
        },
        create: {
            key: key,
            value: value
        }
    });

}

