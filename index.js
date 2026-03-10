require("dotenv").config();

const { Client } = require("discord.js-selfbot-v13");
const fs = require("fs");

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG = {
  token: process.env.DISCORD_TOKEN,   // Your account token (NOT a bot token)
  alertUserId: process.env.ALERT_USER_ID, // Your main account ID to DM alerts to
};

// ─── Storage ───────────────────────────────────────────────────────────────
const DB_PATH = "./keywords.json";
function loadDB() {
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, JSON.stringify({ keywords: [] }));
  return JSON.parse(fs.readFileSync(DB_PATH));
}
function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// ─── Cooldown (in memory) ──────────────────────────────────────────────────
const cooldowns = new Map();
const COOLDOWN_MS = 60 * 1000; // 60 seconds per keyword per channel

// ─── Client ────────────────────────────────────────────────────────────────
const client = new Client({ checkUpdate: false });

// ─── Ready ─────────────────────────────────────────────────────────────────
client.on("ready", () => {
  console.log(`✅ Selfbot running as ${client.user.tag}`);
  console.log(`👀 Watching ${client.guilds.cache.size} server(s)`);
  const db = loadDB();
  console.log(`🔑 Tracking ${db.keywords.length} keyword(s): ${db.keywords.join(", ") || "none yet"}`);
});

// ─── Message Handler ───────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  const db = loadDB();
  const content = message.content.toLowerCase();
  const isOwn = message.author.id === client.user.id;

  // ── Commands (only when YOU type them) ───────────────────────────────────
  if (isOwn) {

    if (message.content.startsWith("!addkeyword ")) {
      const keyword = message.content.slice(12).trim().toLowerCase();
      if (!keyword) return;
      if (db.keywords.includes(keyword)) {
        await message.channel.send(`⚠️ **${keyword}** is already tracked.`);
        return;
      }
      db.keywords.push(keyword);
      saveDB(db);
      await message.channel.send(`✅ Now tracking **${keyword}**. Total: **${db.keywords.length}** keyword(s).`);
      return;
    }

    // !bulkadd — add many keywords at once separated by commas
    // Example: !bulkadd seed phrase, private key, wallet drained, lost funds
    if (message.content.startsWith("!bulkadd ")) {
      const input = message.content.slice(9).trim().toLowerCase();
      const newKeywords = input.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (!newKeywords.length) {
        await message.channel.send("❌ Please provide keywords separated by commas.\nExample: `!bulkadd seed phrase, private key, wallet drained`");
        return;
      }
      const added = [];
      const skipped = [];
      for (const kw of newKeywords) {
        if (db.keywords.includes(kw)) {
          skipped.push(kw);
        } else {
          db.keywords.push(kw);
          added.push(kw);
        }
      }
      saveDB(db);
      let reply = "";
      if (added.length) reply += `✅ **Added ${added.length} keyword(s):**\n${added.map(k => `• \`${k}\``).join("\n")}\n\n`;
      if (skipped.length) reply += `⚠️ **Already tracked (skipped ${skipped.length}):**\n${skipped.map(k => `• \`${k}\``).join("\n")}\n\n`;
      reply += `📋 **Total keywords now: ${db.keywords.length}**`;
      await message.channel.send(reply);
      return;
    }

    if (message.content.startsWith("!removekeyword ")) {
      const keyword = message.content.slice(15).trim().toLowerCase();
      if (!db.keywords.includes(keyword)) {
        await message.channel.send(`❌ **${keyword}** not found in list.`);
        return;
      }
      db.keywords = db.keywords.filter(k => k !== keyword);
      saveDB(db);
      await message.channel.send(`✅ Removed **${keyword}**. Total: **${db.keywords.length}** keyword(s).`);
      return;
    }

    if (message.content === "!keywords") {
      if (!db.keywords.length) {
        await message.channel.send("📋 No keywords yet. Use `!addkeyword <word>` to add.");
        return;
      }
      await message.channel.send(`📋 **Tracked Keywords (${db.keywords.length}):**\n${db.keywords.map((k, i) => `${i + 1}. \`${k}\``).join("\n")}`);
      return;
    }

    if (message.content === "!clearkeywords") {
      db.keywords = [];
      saveDB(db);
      await message.channel.send("🗑️ All keywords cleared.");
      return;
    }

    if (message.content === "!servers") {
      const list = client.guilds.cache.map(g => `• **${g.name}** (${g.memberCount} members)`).join("\n");
      await message.channel.send(`🌐 **Servers I'm in (${client.guilds.cache.size}):**\n${list}`);
      return;
    }

    if (message.content === "!help") {
      await message.channel.send(
        "**📡 Selfbot Keyword Monitor Commands:**\n" +
        "`!addkeyword <word>` — Add a single keyword\n" +
        "`!bulkadd <word1>, <word2>, ...` — Add many keywords at once\n" +
        "`!removekeyword <word>` — Remove a keyword\n" +
        "`!keywords` — List all tracked keywords\n" +
        "`!clearkeywords` — Remove all keywords\n" +
        "`!servers` — List servers being monitored\n" +
        "`!help` — Show this message"
      );
      return;
    }

    return; // don't scan your own messages for keywords
  }

  // ── Keyword detection (other people's messages only) ──────────────────────
  if (!message.guild) return; // ignore DMs
  if (!db.keywords.length) return;

  const matched = db.keywords.filter(kw => content.includes(kw));
  if (!matched.length) return;

  for (const keyword of matched) {
    const cooldownKey = `${message.guild.id}-${message.channel.id}-${keyword}`;
    const lastAlert = cooldowns.get(cooldownKey) || 0;
    const now = Date.now();

    if (now - lastAlert < COOLDOWN_MS) continue;
    cooldowns.set(cooldownKey, now);

    // Send alert as a DM to your main account
    try {
      const alertUser = await client.users.fetch(CONFIG.alertUserId);
      await alertUser.send(
        `🚨 **Keyword Alert: \`${keyword}\`**\n\n` +
        `👤 **From:** ${message.author.tag}\n` +
        `🌐 **Server:** ${message.guild.name}\n` +
        `📢 **Channel:** #${message.channel.name}\n` +
        `🕐 **Time:** <t:${Math.floor(now / 1000)}:R>\n` +
        `🔗 **Jump:** ${message.url}\n\n` +
        `💬 **Message:**\n${message.content.slice(0, 1000)}`
      );
      console.log(`🚨 "${keyword}" spotted in ${message.guild.name} #${message.channel.name} by ${message.author.tag}`);
    } catch (err) {
      console.log("⚠️ Could not send alert DM:", err.message);
    }
  }
});

// ─── Error handling ────────────────────────────────────────────────────────
client.on("error", (err) => console.error("⚠️ Error:", err.message));
process.on("unhandledRejection", (err) => console.error("⚠️ Unhandled rejection:", err?.message ?? err));

// ─── Login ────────────────────────────────────────────────────────────────
client.login(CONFIG.token);
