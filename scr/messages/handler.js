import { findCommand } from "../plugins.js";

import { validateCommand } from "../utils/validation.js";

import {
  checkCommandAccess,
  isPrivileged,
  isOwnerMessage,
} from "../utils/access.js";

import {
  sendError,
  ackCommand,
} from "../utils/message.js";

import { validateGroupPermissions } from "../utils/group.js";

import { groupCache } from "../utils/cache.js";

import { getGroupSettings } from "../utils/groupSettings.js";

import { BOT_INFO } from "../config/constants.js";

import { t } from "../utils/i18n.js";

import logger from "../utils/logger.js";

import {
  systemLog,
  isLogGroupAsync,
} from "../utils/logGroup.js";

import { checkCommandFlag } from "../enterprise/flags.js";

import { evaluatePolicy } from "../enterprise/policy.js";

import { writeAudit } from "../enterprise/audit.js";

import {
  recordCommand,
  recordError,
} from "../enterprise/metrics.js";

import { kvGet } from "../database/botKv.js";

/* =========================================================
 * HELPERS
 * ========================================================= */

function safeString(value = "") {
  return value == null ? "" : String(value);
}

function normalizeNumber(number = "") {
  return safeString(number).replace(/[^0-9]/g, "");
}

function getCommandBody(message) {
  return safeString(message?.body).trim();
}

function isCommandBody(body) {
  const prefix = safeString(
    BOT_INFO?.PREFIX || "."
  );

  return Boolean(
    prefix &&
    body.startsWith(prefix)
  );
}

/* =========================================================
 * AUTO REACTION ENGINE
 *
 * Supports:
 * English
 * Roman Urdu
 * Roman English
 * Urdu
 * Arabic
 *
 * Uses:
 * - phrase matching
 * - word matching
 * - sentiment scoring
 * - paragraph/context scoring
 * - negation awareness
 * - media fallback
 *
 * Exactly ONE emoji is returned.
 * ========================================================= */

const AUTOREACT_KEY = "autoreact";

function normalizeReactionText(text = "") {
  return safeString(text)
    .toLowerCase()
    .normalize("NFKC")
    .replace(
      /[\u064B-\u065F\u0670\u06D6-\u06ED]/g,
      ""
    )
    .replace(/[ًٌٍَُِّْـ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------------------------------
 * Reaction categories
 * --------------------------------------------------------- */

const REACTION_CATEGORIES = {
  accident: {
    phrases: [
      "accident","crash","crashed","injured","injury","hurt","got hurt","got injured","road accident","car accident","bike accident","traffic accident","collision","hit","death",
      "hadsa","haadsa","hadsay","accident ho gaya","hadsa ho gaya","gir gaya","gir gya","chot lag gai","chot lag gayi","zakhmi","zakhm","takkar","takkar ho gai","gari ka accident","gaari ka accident","bike ka accident","gaari takra gai","maut","mout","mar gaya","mar gya","mar gayi","inteqal","wafat",
      "حادثہ","حادثہ ہو گیا","حادثے","زخمی","چوٹ","چوٹ لگ گئی","زخم","ٹکر","ٹکر ہو گئی","گاڑی کا حادثہ","موٹر سائیکل سے گر گیا","سڑک کا حادثہ","گر گیا","گر گئی","مر گیا","مر گئی","انتقال","موت","فوت","وفات","قتل ہو گیا","قتل ہو گئے","ٹوٹ گئی","کرنٹ لگ گیا","جل گیا"
    ],
    emojis: ["😬","🥺","🖤","😢","😔"]
  },

  greeting: {
    phrases: [
      "hello","hi","hey","greetings","welcome","good morning","good afternoon","good evening","how are you","nice to meet you","nice to see you",
      "salam","salaam","aoa","assalamualaikum","assalam o alaikum","assalamualaikum wa rahmatullah","assalam o alaikum wa rahmatullah","kya haal hai","kia haal hai","kaisay ho","kaise ho","kesi ho","kaisi ho","kya haal chaal hai","haal chaal","khairiyat","subah bakhair","shaam bakhair",
      "السلام علیکم","سلام","آداب","وعلیکم السلام","السلام علیکم ورحمۃ اللہ","کیا حال ہے","کیا حال چال ہے","کیسے ہو","کیسی ہو","خیریت","صبح بخیر","شام بخیر"
    ],
    emojis: ["♥️","👍","🌹","💝","😊","🤝"]
  },

  funny: {
    phrases: [
      "haha","hahaha","lol","lmao","funny","hilarious","joke","joking","kidding","comedy","made me laugh","so funny","that's funny","laughing",
      "mazaq","mazak","mazaaq","maza aa gaya","bohat maza aya","hansi aa gai","hans raha hun","hans rahi hun","hansna","funny hai","bara funny","kya mazaq hai","mazaq kar raha hun","mazaq kar rahi hun","mazaq tha","mazaak tha","joke tha","joke kar raha hun","joke kar rahi hun","hasi mazaq","hans hans ke","hansi nahi ruk rahi",
      "ہاہاہا","ہنسی","مذاق","مذاق تھا","مزاح","مزاحیہ","لطیفہ","ہنسی آ گئی","مستی","حرامی","بہت مزہ آیا","مذاق کر رہا ہوں","کمینہ","مذاق کر رہی ہوں","ہنسی نہیں رک رہی"
    ],
    emojis: ["🫂","✨","🙂","👍","💯","🤍"]
  },

  amazing: {
    phrases: [
      "awesome","amazing","excellent","fantastic","great","wonderful","brilliant","incredible","impressive","perfect","superb","stunning","extraordinary",
      "zabardast","kamaal","kamal","shandar","shaandaar","lajawab","lajawaab","behtareen","bohat acha","bohat achha","kamaal kar diya","zabardast hai","kya baat hai","wah kya baat hai","wah","wah wah","dil khush kar diya","dil jeet liya","chha gaye","chaa gaye","kia khoob","kya khoob","umda","umdah","be-misaal","bemisaal","dhansu",
      "زبردست","کمال","شاندار","لاجواب","بہترین","بہت اچھا","بہت خوب","کیا بات ہے","واہ","واہ واہ","دل خوش کر دیا","دل جیت لیا","چھا گئے","عمدہ","بے مثال","شاندار کام"
    ],
    emojis: ["💝","😇","🙂","👍","🌹","🌟"]
  },

  agree: {
    phrases: [
      "i agree","agree","agreed","exactly","absolutely","definitely","true","that's true","correct","right","you're right","so true","totally","indeed","100%","facts","no doubt","of course",
      "bilkul","bilkul sahi","sahi kaha","theek kaha","thik kaha","bilkul theek","bilkul durust","durust kaha","sahi baat","baat sahi hai","ye sahi hai","han bilkul","haan bilkul","ji bilkul","jee bilkul","bilkul haan","main agree karta hun","main agree karti hun","sahih hai","sach hai","baat to sahi hai",
      "بالکل","بالکل صحیح","صحیح کہا","ٹھیک کہا","بالکل ٹھیک","درست کہا","درست","صحیح بات","بات صحیح ہے","یہ صحیح ہے","ہاں بالکل","جی بالکل","بالکل ہاں","سچ ہے","بات تو صحیح ہے"
    ],
    emojis: ["💯","👍","💖","🙂","🤝","🎀"]
  },

  love: {
    phrases: [
      "love","i love you","love you","lovely","loving","cute","adorable","beautiful","gorgeous","sweetheart","darling","dear","my love","my dear","miss you","missing you","so cute","very cute","love this",
      "pyar","pyaar","mohabbat","muhabbat","ishq","jaan","meri jaan","jaanu","pyari","pyara","bohat pyara","bohat pyari","kitna pyara","kitni pyari","dilruba","haseen","khoobsurat","khoobsurat hai","dil ke qareeb","dil mein ho","tumse pyar hai","tum se pyaar hai","pyaar karta hun","pyaar karti hun","miss karta hun","miss karti hun","yaad aa rahi hai",
      "پیار","محبت","عشق","جان","میری جان","جانو","پیارا","پیاری","بہت پیارا","بہت پیاری","خوبصورت","حسیں","دلربا","دل کے قریب","تم سے پیار ہے","تم سے محبت ہے","پیار کرتا ہوں","پیار کرتی ہوں","یاد آ رہی ہے"
    ],
    emojis: ["😍","💞","♥️","❣️","💟"]
  },

  thanks: {
    phrases: [
      "thanks","thank you","thank u","thx","tysm","thanks a lot","thank you so much","much appreciated","appreciate it","grateful","thanks brother","thanks bro","thank you brother","thank you bro",
      "shukriya","bohat shukriya","bahut shukriya","dil se shukriya","shukriya ji","shukriya bhai","bohat meherbani","bahut meherbani","mehrbani","meharbani","aap ka shukriya","apka shukriya","tumhara shukriya","dil se thanks","thanks bhai","thanks bro",
      "شکریہ","بہت شکریہ","دل سے شکریہ","شکریہ جی","شکریہ بھائی","بہت مہربانی","مہربانی","آپ کا شکریہ","آپ کا بہت شکریہ","تمہارا شکریہ","تہہ دل سے شکریہ"
    ],
    emojis: ["♥️","🫶","😇","🌹","👍","🤍","🤝"]
  },

  islamic: {
    phrases: [
      "amen","ameen","inshallah","in sha Allah","mashallah","masha Allah","alhamdulillah","subhanallah","Allah bless you","pray for me","dua","prayer","Allah","blessed","blessings","jazakallah","jazak Allah","jazakallah khair","ramadan",
      "Allah pak","Allah hafiz","dua karo","dua karna","duaon mein yaad rakhna","Allah khair","Allah barkat de","Allah hifazat kare","Allah salamat rakhe","Allah kamyab kare","Allah khush rakhe","Allah naseeb acha kare","Allah madad kare","Allah reham kare","Allah maaf kare",
      "آمین","ان شاء اللّٰه","ما شاء اللّٰه","الحمدللہ","سبحان اللّٰه","اللہ","اللّٰه پاک","دعا","دعا کرو","دعاؤں میں یاد رکھنا","اللّٰه خیر کرے","اللّٰه برکت دے","اللّٰه حفاظت کرے","اللّٰه سلامت رکھے","اللّٰه کامیاب کرے","رمضان","اللّٰه خوش رکھے","اللّٰه نصیب اچھا کرے","یااللّٰه","اللّٰه مدد","اللّٰه رحم کرے","اللّٰه معاف کرے","جزاک اللّٰه","جزاک اللّٰه خیر"
    ],
    emojis: ["👍","♥️","🌹","😇","💞","🫶","💝"]
  },

  sad: {
    phrases: [
      "sad","sadness","upset","unhappy","depressed","hurt","hurting","pain","sorry","sorrow","lonely","loneliness","crying","cry","tears","heartbroken","broken heart","feeling bad","feeling down","disappointed","miss you","missing you","i miss you","not okay","not well","bad day","feeling alone",
      "dukhi","dukh","udaas","udas","afsos","takleef","dard","dil dukha","dil dukhi","dil toot gaya","dil tootna","ro raha hun","ro rahi hun","rona","aansu","ansoo","aansu aa gaye","bohat dukh hua","bohat afsos","akela","akeli","tanha","tanhai","mayoos","mayoosi","pareshan","pareshaan","gham","ghamgeen","yaad aa rahi hai","yaad aa raha hai","miss kar raha hun","miss kar rahi hun",
      "اداس","دکھی","دکھ","افسوس","تکلیف","درد","دل دکھا","دل دکھی","دل ٹوٹ گیا","رونا","رو رہا ہوں","رو رہی ہوں","آنسو","آنسو آ گئے","بہت دکھ ہوا","بہت افسوس","اکیلا","اکیلی","تنہا","تنہائی","مایوس","مایوسی","پریشان","غم","غمگین","یاد آ رہی ہے","یاد آ رہا ہے"
    ],
    emojis: ["🖤","🥹","🥀","🙂","🍂","♥️"]
  },

  surprise: {
    phrases: [
      "wow","omg","oh my god","really","seriously","unbelievable","no way","what","wow really","are you serious","for real","is that true","can't believe it","unexpected","surprising","surprise","shocked","shocking","oh wow",
      "sachi","sachii","waqai","kya baat hai","kya baat","kya","kyaaa","ye kya","yeh kya","aisa kya","sach mein","sach main","yaqeen nahi aa raha","yakeen nahi aa raha","yaqeen nahi hota","ye kaise","yeh kaise","oh ho","oho","wah","arre wah","arey wah","haye","kya scene hai",
      "واقعی","سچ میں","سچی","کیا بات ہے","کیا","یہ کیا","ایسا کیا","یقین نہیں آ رہا","یقین نہیں ہوتا","یہ کیسے","اوہو","واہ","ارے واہ","ہائے","ہائے اللہ"
    ],
    emojis: ["💖","🥹","👍","🙃","✨","💯","👌"]
  },

  congratulations: {
    phrases: [
      "congratulations","congratulation","congrats","well done","good job","great job","nice work","excellent work","proud of you","happy for you","you did it","success","successful","achievement","celebrate","celebration","best wishes","many congratulations",
      "mubarak","mubarak ho","bohat mubarak","bahut mubarak","bohat bohat mubarak","mubarakbad","mubarak baad","dil se mubarak","khush ho jao","kamyabi mubarak","kamyab ho gaye","kamyabi par mubarak","jeet mubarak","shadi mubarak","nayi job mubarak","birthday mubarak","result mubarak","pass ho gaye","pass hone par mubarak",
      "مبارک","مبارک ہو","بہت مبارک","بہت بہت مبارک","مبارکباد","دل سے مبارک","کامیابی مبارک","کامیاب ہو گئے","کامیابی پر مبارک","جیت مبارک","شادی مبارک","نئی نوکری مبارک","سالگرہ مبارک","نتیجہ مبارک","پاس ہو گئے"
    ],
    emojis: ["🎉","♥️","🥳","💝","😇","🌹","👍"]
  },

  goodMorning: {
    phrases: [
      "good morning","morning","gm","g morning","morning everyone","morning guys","good morning everyone","good morning guys","have a nice day","have a great day","beautiful morning","lovely morning","morning wishes","morning greetings",
      "subah bakhair","subah ba khair","subha bakhair","subha ba khair","subah ka salam","subha ka salam","subah mubarak","subha mubarak","achi subah","pyari subah","khubsurat subah","khair mubarak","aaj ki subah","subah ho gayi",
      "صبح بخیر","صبح باخیر","صبح کا سلام","صبح مبارک","اچھی صبح","پیاری صبح","خوبصورت صبح","آج کی صبح","صبح ہو گئی"
    ],
    emojis: ["💖","🌻","♥️","😊","🥂","🤝"]
  },

  goodNight: {
    phrases: [
      "good night","gn","gnight","night","goodnight","good night everyone","good night guys","sleep well","sweet dreams","have a good night","have a peaceful night","night everyone","night guys","see you tomorrow","good night all",
      "shab bakhair","shab ba khair","raat bakhair","raat ba khair","achi neend","achi raat","pur sukoon raat","sukoon bhari raat","meethi neend","meethay khwab","khwab achay aayen","araam se sona","araam se so","so jao","ab sone ja raha hun","ab sone ja rahi hun","kal milte hain",
      "شب بخیر","شب باخیر","رات بخیر","رات باخیر","اچھی نیند","اچھی رات","پُرسکون رات","سکون بھری رات","میٹھی نیند","میٹھے خواب","آرام سے سونا","آرام سے سو","سو جاؤ","کل ملتے ہیں"
    ],
    emojis: ["💖","👍","😊","♥️","😴","🩵"]
  },

  goodbye: {
    phrases: [
      "bye","goodbye","bye bye","see you","see ya","see you later","see you soon","see you tomorrow","take care","farewell","gotta go","i have to go","leaving now","talk to you later","until next time",
      "Allah hafiz","Allah hafez","khuda hafiz","khuda hafez","phir milenge","phir milain ge","phir milte hain","baad mein milte hain","baad mein baat hoti hai","chalta hun","chalti hun","main chalta hun","main chalti hun","jana hai","mujhe jana hai","ab chalta hun","ab chalti hun","apna khayal rakhna","khayal rakhna",
      "اللہ حافظ","خدا حافظ","پھر ملیں گے","پھر ملتے ہیں","بعد میں ملتے ہیں","بعد میں بات ہوتی ہے","چلتا ہوں","چلتی ہوں","مجھے جانا ہے","اب چلتا ہوں","اب چلتی ہوں","اپنا خیال رکھنا","خیال رکھنا"
    ],
    emojis: ["👍","🪷","🫶","❤️","🤲"]
  }
};

/* =========================================================
 * EXACT FALLBACK POOLS
 * ========================================================= */

const GENERAL_REACTIONS = [
  "♥️", "✨", "🌹", "🥀", "🍃", "💕", "💯", "🤍",
  "💝", "💖", "🩵", "💞", "🤎", "🦋", "💙", "🎀",
  "💌", "💚", "💗", "🌻", "💓", "🍂", "💛", "👍",
  "❣️", "🫶", "🧡", "🫰", "💟", "💜", "😇", "❤️"
];

const MEDIA_REACTIONS = [
  "♥️", "👍", "⭐", "🩵", "🪄", "🎁", "💝", "🪷",
  "💖", "🎉", "💙", "💜", "🤎", "🤍", "🩷", "💫",
  "💗", "💞", "🌺", "💌", "💟", "😍", "💦", "❤️",
  "🫅", "🧡", "💐", "💛", "🦅", "💚", "🙂", "🌟",
  "🦋", "🍁", "💓", "🥂", "💕", "☕", "🎀", "💥",
  "🎊", "🌹", "💸", "👑", "✨", "🌻", "🍂", "🫶",
  "🍷", "🫰", "💯", "🍃", "❣️"
];

const EMOJI_FAMILIES = [
  {
    emojis: [
      "🤣", "😂", "🤭", "😆", "😄", "😅", "😹", "😛",
      "😜", "🤡", "🤪", "😝", "😀", "👻", "😃", "🤥", "😁"
    ],
    reaction: "😁"
  },

  {
    emojis: [
      "😔", "☹️", "😞", "😩", "😢", "💔", "😿", "😭",
      "😪", "😥", "😕", "😓", "🥺", "😫", "🤕", "😣",
      "🫥", "😐", "😑", "🙎", "😖", "🙍", "😦"
    ],
    reaction: "🥺"
  },

  {
    emojis: [
      "🕌", "🕋", "☪️", "👳", "🛐", "🧕", "🤲", "📿"
    ],
    reactions: ["🫶", "♥️", "🌹"]
  },

  {
    emojis: [
      "😍", "💕", "♥️", "💑", "💘", "💖", "😘", "❤️",
      "🥰", "💗", "💝", "❤️‍🩹", "💟", "💞", "💜",
      "💓", "😚", "💋", "❣️"
    ],
    reactions: ["😍", "♥️", "❣️"]
  },
  {
    emojis: [
      "😡", "👿", "😠", "🤬", "👺", "😤", "😾", "🙎",
      "🖕", "👹", "😫", "👊", "😣", "🤜", "😈"
    ],
    reactions: ["🥹", "🧐"]
  }
];

/* =========================================================
 * MESSAGE TEXT EXTRACTION
 * ========================================================= */

function getReactionText(message) {
  const values = [
    message?.body,
    message?.text,
    message?.caption,
    message?.message?.conversation,
    message?.message?.extendedTextMessage?.text,
    message?.message?.imageMessage?.caption,
    message?.message?.videoMessage?.caption,
    message?.quoted?.body,
  ];

  return values
    .map(safeString)
    .map((x) => x.trim())
    .filter(Boolean)
    .join(" ");
}

/* =========================================================
 * MESSAGE TYPE
 * ========================================================= */

function getMessageType(message) {
  const direct = safeString(
    message?.messageTypeKey ||
    message?.type
  ).toLowerCase();

  if (direct) {
    if (
      direct.includes("sticker")
    ) {
      return "sticker";
    }

    if (
      direct.includes("audio") ||
      direct.includes("ptt") ||
      direct.includes("voice")
    ) {
      return "audio";
    }

    if (
      direct.includes("image") ||
      direct.includes("photo")
    ) {
      return "image";
    }

    if (
      direct.includes("video")
    ) {
      return "video";
    }

    if (
      direct.includes("document")
    ) {
      return "document";
    }
  }

  const raw =
    message?.rawMessage ||
    message?.originalMessage ||
    message?.message ||
    {};

  const content =
    raw?.message ||
    raw;

  const keys = Object.keys(
    content || {}
  ).map((x) => x.toLowerCase());

  if (
    keys.some((x) =>
      x.includes("sticker")
    )
  ) {
    return "sticker";
  }

  if (
    keys.some((x) =>
      x.includes("audio")
    )
  ) {
    return "audio";
  }

  if (
    keys.some((x) =>
      x.includes("image")
    )
  ) {
    return "image";
  }

  if (
    keys.some((x) =>
      x.includes("video")
    )
  ) {
    return "video";
  }

  if (
    keys.some((x) =>
      x.includes("document")
    )
  ) {
    return "document";
  }

  return "text";
}

/* =========================================================
 * AUTO REACTION MATCH HELPERS
 * ========================================================= */

function reactionPhraseMatches(text, phrases = []) {
  let count = 0;

  for (const phrase of phrases) {
    const p = normalizeReactionText(phrase);
    if (!p) continue;

    if (text.includes(p)) {
      count++;
    }
  }

  return count;
}

function reactionEmojiFamily(text) {
  for (const family of EMOJI_FAMILIES) {
    if (
      family.emojis.some((emoji) =>
        text.includes(emoji)
      )
    ) {
      return family;
    }
  }

  return null;
}

/* =========================================================
 * PICK RANDOM
 * ========================================================= */

function randomItem(array) {
  if (!Array.isArray(array) || array.length === 0) {
    return null;
  }

  return array[
    Math.floor(Math.random() * array.length)
  ];
}

/* =========================================================
 * SMART REACTION
 * ========================================================= */

function getAutoReaction(message) {
  const text = normalizeReactionText(
    getReactionText(message)
  );

  const type = getMessageType(message);

  /*
   * MEDIA WITHOUT CAPTION
   *
   * image / video / sticker / audio / voice
   * always use MEDIA_REACTIONS.
   */
  if (!text) {
    if (
      type === "image" ||
      type === "video" ||
      type === "sticker" ||
      type === "audio"
    ) {
      return randomItem(MEDIA_REACTIONS);
    }

    return randomItem(GENERAL_REACTIONS);
  }

  /*
   * 1. TEXT / CAPTION CATEGORY MATCH
   *
   * Category matching ALWAYS has priority over
   * emoji-family matching.
   */
  for (const data of Object.values(REACTION_CATEGORIES)) {
    if (
      reactionPhraseMatches(
        text,
        data.phrases || []
      ) > 0
    ) {
      return randomItem(data.emojis);
    }
  }

  /*
   * 2. NO WORD MATCH -> EMOJI FAMILY MATCH
   */
  const emojiFamily = reactionEmojiFamily(text);

  if (emojiFamily) {
    if (emojiFamily.reaction) {
      return emojiFamily.reaction;
    }

    return randomItem(
      emojiFamily.reactions
    );
  }

  /*
   * 3. NO TEXT / EMOJI MATCH
   *
   * Captioned image/video and normal text
   * use GENERAL_REACTIONS.
   */
  return randomItem(GENERAL_REACTIONS);
}



/* =========================================================
 * SMART REACTION
 * ========================================================= */

/* =========================================================
 * SHOULD AUTO REACT
 * ========================================================= */

function shouldAutoReact(message) {
  if (!message) {
    return false;
  }

  /* NEVER react to our own messages */
  if (
    message?.key?.fromMe === true
  ) {
    return false;
  }

  /* NEVER react to bot-generated messages */
  if (
    message?.isBotMessage === true
  ) {
    return false;
  }

  /* Owner messages */
  if (
    isOwnerMessage(message)
  ) {
    return false;
  }

  const jid =
    safeString(
      message?.from ||
      message?.key?.remoteJid
    );

  if (!jid) {
    return false;
  }

  /* WhatsApp status */
  if (
    jid ===
    "status@broadcast"
  ) {
    return false;
  }

  /* Broadcast */
  if (
    jid.includes(
      "broadcast"
    )
  ) {
    return false;
  }

  /* No key = no safe reaction */
  if (
    !message?.key
  ) {
    return false;
  }

  return true;
}

/* =========================================================
 * AUTO REACTION EXECUTOR
 * ========================================================= */

async function handleAutoReaction(
  message,
  conn,
  sessionId = "default"
) {
  try {
    if (
      !shouldAutoReact(
        message
      )
    ) {
      return;
    }

    const storedMode =
      await kvGet(
        `${AUTOREACT_KEY}:${sessionId}`
      );

    /*
     * Backward compatibility:
     * true -> on
     * false/null/undefined -> off
     */
    const mode =
      storedMode === true
        ? "on"
        : storedMode === false ||
          storedMode == null
          ? "off"
          : String(storedMode).toLowerCase();

    if (
      mode !== "on" &&
      mode !== "group" &&
      mode !== "private"
    ) {
      return;
    }

    const jid =
      message?.from ||
      message?.key?.remoteJid;

    if (!jid) {
      return;
    }

    const isGroup =
      jid.endsWith("@g.us");

    if (
      mode === "group" &&
      !isGroup
    ) {
      return;
    }

    if (
      mode === "private" &&
      isGroup
    ) {
      return;
    }

    const reaction =
      getAutoReaction(
        message
      );

    if (!reaction) {
      return;
    }

    await conn.sendMessage(
      jid,
      {
        react: {
          text: reaction,
          key: message.key,
        },
      }
    );

  } catch (error) {
    try {
      logger.debug?.(
        `[AutoReact] ${
          error?.message ||
          error
        }`
      );
    } catch {}
  }
}

/* =========================================================
 * AUDIT ACTIONS
 * ========================================================= */

const AUDIT_ACTIONS = new Set([
  "mode",
  "sudo",
  "broadcast",
  "setlog",
  "createlog",
  "setup",
  "groupsetup",
  "backup",
  "role",
  "flag",
  "policy",
  "audit",
  "metrics",
]);

/* =========================================================
 * COMMAND NAME
 * ========================================================= */

function commandNameSafe(message) {
  const body =
    getCommandBody(message);

  if (!body) {
    return "unknown";
  }

  const prefix =
    safeString(
      BOT_INFO?.PREFIX || "."
    );

  let command = body;

  if (
    prefix &&
    body.startsWith(prefix)
  ) {
    command = body
      .slice(prefix.length)
      .trim();
  }

  return (
    command.split(/\s+/)[0] ||
    "unknown"
  );
}

/* =========================================================
 * MESSAGE HANDLER
 * ========================================================= */

export async function messageHandler(
  params
) {
  const message =
    params?.message;

  const conn =
    params?.conn;

  const sessionId =
    params?.sessionId || "default";

  try {

    /* =====================================================
     * BASIC VALIDATION
     * ===================================================== */

    if (
      !message ||
      !conn
    ) {
      return;
    }

    /* =====================================================
     * BOT MESSAGE CHECK
     *
     * IMPORTANT:
     * fromMe commands MUST continue.
     * ===================================================== */

    if (
      message?.isBotMessage === true &&
      message?.key?.fromMe !== true
    ) {
      return;
    }

    /* =====================================================
     * AUTO REACTION
     *
     * Runs before command processing.
     *
     * Own messages are automatically skipped.
     * Public user commands can also receive a reaction.
     * ===================================================== */

    handleAutoReaction(
      message,
      conn,
      sessionId
    ).catch(() => {});

    /* =====================================================
     * BODY
     * ===================================================== */

    const body =
      getCommandBody(message);

    /* =====================================================
     * MEDIA-ONLY MESSAGE
     *
     * Reaction has already been handled above.
     * No command processing needed.
     * ===================================================== */

    if (!body) {
      return;
    }

    /* =====================================================
     * COMMAND CHECK
     * ===================================================== */

    const isCommand =
      isCommandBody(body);

    /* =====================================================
     * NOT A COMMAND
     * ===================================================== */

    if (!isCommand) {
      return;
    }

    /* =====================================================
     * DEBUG
     * ===================================================== */

    try {
      logger.debug?.(
        `[CMD DEBUG] body=${JSON.stringify(
          body
        )} prefix=${JSON.stringify(
          BOT_INFO?.PREFIX
        )} fromMe=${Boolean(
          message?.key?.fromMe
        )}`
      );
    } catch {}

    console.log(
      "🔥 COMMAND RECEIVED:",
      body,
      "fromMe:",
      Boolean(
        message?.key?.fromMe
      )
    );

    /* =====================================================
     * FIND COMMAND
     * ===================================================== */

    const command =
      findCommand(body);

    if (!command) {
      console.log(
        "❌ COMMAND NOT FOUND:",
        body
      );
      return;
    }

    /* =====================================================
     * COMMAND NAME
     * ===================================================== */

    const name =
      safeString(
        command.patternName
      ).toLowerCase();

    console.log(
      "✅ COMMAND FOUND:",
      name
    );

    try {
      logger.debug?.(
        `[CMD DEBUG] command=${
          name || "unknown"
        }`
      );
    } catch {}

    /* =====================================================
     * PRIVILEGED
     * ===================================================== */

    const privileged =
      await isPrivileged(
        message,
        conn
      );

    console.log(
      "🔐 PRIVILEGED:",
      privileged
    );

    /* =====================================================
     * ACCESS
     * ===================================================== */

    const access =
      await checkCommandAccess(
        message,
        command,
        conn
      );

    console.log(
      "🔐 ACCESS:",
      access
    );

    if (
      !access ||
      access.allowed !== true
    ) {

      const silent =
        access?.silent === true;

      console.log(
        "⛔ COMMAND ACCESS DENIED:",
        name,
        access
      );

      if (silent) {
        return;
      }

      await sendError(
        conn,
        message.from,
        access?.reason ||
          "OWNER_ONLY"
      );

      return;
    }

    /* =====================================================
     * FEATURE FLAG
     * ===================================================== */

    const flagCheck =
      await checkCommandFlag(
        name
      );

    if (
      !flagCheck?.ok
    ) {

      if (
        flagCheck?.flag ===
          "maintenance" &&
        privileged
      ) {

        // Privileged user may continue.

      } else if (
        flagCheck?.flag ===
        "maintenance"
      ) {

        await sendError(
          conn,
          message.from,
          "🛠 Bot is in *maintenance mode*. Try again later."
        );

        return;

      } else {

        await sendError(
          conn,
          message.from,
          `⚠️ Feature *${
            flagCheck?.flag ||
            "unknown"
          }* is disabled.`
        );

        return;
      }
    }

    /* =====================================================
     * POLICY
     * ===================================================== */

    const policy =
      await evaluatePolicy(
        message,
        command,
        {
          privileged,
        }
      );

    if (
      !policy?.ok
    ) {

      const msgs = {
        QUIET_HOURS:
          "🌙 Quiet hours — try again later.",

        RATE_LIMIT:
          "⏳ Slow down — rate limit hit.",

        MEDIA_DISABLED:
          "⚠️ Media commands are disabled by policy.",

        BROADCAST_BLOCKED:
          "⚠️ Broadcast is blocked by policy.",
      };

      await sendError(
        conn,
        message.from,
        msgs[
          policy?.reason
        ] ||
          policy?.reason ||
          "Command blocked by policy."
      );

      return;
    }

    /* =====================================================
     * GROUP DISABLED PLUGINS
     * ===================================================== */

    if (
      message.isGroup &&
      command.patternName
    ) {

      const settings =
        await getGroupSettings(
          message.from
        );

      const disabled =
        Array.isArray(
          settings?.disabledPlugins
        )
          ? settings.disabledPlugins
          : [];

      if (
        disabled.includes(
          name
        ) &&
        !privileged
      ) {

        await sendError(
          conn,
          message.from,
          await t(
            "PLUGIN_DISABLED"
          )
        );

        return;
      }
    }

    /* =====================================================
     * LOGGER
     * ===================================================== */

    try {
      logger.command(
        name || "unknown",
        message.sender,
        message.isGroup
          ? message.from
          : null
      );
    } catch {}

    /* =====================================================
     * COMMAND VALIDATION
     * ===================================================== */

    const validation =
      await validateCommand(
        message,
        command,
        conn
      );

    if (
      !validation?.valid
    ) {

      await sendError(
        conn,
        message.from,
        validation?.error ||
          "Command validation failed."
      );

      return;
    }

    /* =====================================================
     * GROUP PERMISSIONS
     * ===================================================== */

    if (
      message.isGroup &&
      (
        command.adminOnly ||
        command.botAdminRequired
      )
    ) {

      let groupMetadata =
        groupCache.get(
          message.from
        );

      if (!groupMetadata) {

        groupMetadata =
          await conn.groupMetadata(
            message.from
          );

        groupCache.set(
          message.from,
          groupMetadata
        );
      }

      const groupValidation =
        validateGroupPermissions(
          message,
          groupMetadata,
          {
            adminOnly:
              command.adminOnly,

            botAdminRequired:
              command.botAdminRequired,
          },
          conn
        );

      if (
        !groupValidation?.valid
      ) {

        await sendError(
          conn,
          message.from,
          groupValidation?.error ||
            "Group permission denied."
        );

        return;
      }
    }

    /* =====================================================
     * ACK
     * ===================================================== */

    try {

      await ackCommand(
        conn,
        message
      );

    } catch (error) {

      try {
        logger.debug?.(
          `[ACK] ${
            error?.message ||
            error
          }`
        );
      } catch {}
    }

    /* =====================================================
     * METRICS
     * ===================================================== */

    try {
      recordCommand(
        name || "unknown"
      );
    } catch {}

    /* =====================================================
     * EXECUTE COMMAND
     * ===================================================== */

    if (
      typeof command.function !==
      "function"
    ) {

      throw new Error(
        `Command "${name}" has no executable function`
      );
    }

    console.log(
      "🚀 EXECUTING COMMAND:",
      name
    );

    await command.function(
      message,
      conn,
      sessionId
    );

    console.log(
      "✅ COMMAND EXECUTED:",
      name
    );

    /* =====================================================
     * AUDIT
     * ===================================================== */

    if (
      AUDIT_ACTIONS.has(name)
    ) {

      writeAudit({
        action:
          `cmd.${name}`,

        actor:
          message.sender,

        chat:
          message.from,

        meta: {
          body:
            body.slice(
              0,
              120
            ),
        },
      }).catch(
        () => {}
      );
    }

  } catch (error) {

    /* =====================================================
     * HANDLER ERROR
     * ===================================================== */

    console.error(
      "❌ MESSAGE HANDLER ERROR:",
      error?.message ||
        error
    );

    console.error(
      error?.stack || ""
    );

    try {
      recordError();
    } catch {}

    const where =
      `${commandNameSafe(
        message
      )} @ ${
        message?.from ||
        "?"
      }`;

    try {

      await systemLog(
        "error",
        `Handler crash: ${where}`,
        error
      );

    } catch {}

    let inLog = false;

    try {

      inLog =
        await isLogGroupAsync(
          message?.from
        );

    } catch {

      inLog = false;
    }

    try {

      if (
        message?.from &&
        inLog
      ) {

        await sendError(
          conn,
          message.from,
          `Handler error: ${
            error?.message ||
            "unknown"
          } (see log above)`
        );

      } else if (
        message?.from
      ) {

        await sendError(
          conn,
          message.from,
          await t("FAILED")
        );
      }

    } catch (sendErr) {

      try {
        recordError();
      } catch {}

      try {

        await systemLog(
          "error",
          "Failed to send user-safe error",
          sendErr
        );

      } catch {}
    }
  }
}
