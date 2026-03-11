require("dotenv").config();

const { Client } = require("discord.js-selfbot-v13");
const fs = require("fs");

// ─── Config ────────────────────────────────────────────────────────────────
const CONFIG = {
  token: process.env.DISCORD_TOKEN,
  alertChannelId: process.env.ALERT_CHANNEL_ID, // Channel ID to post alerts
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
  console.log(`📢 Alerts → channel ${CONFIG.alertChannelId || "NOT SET"}`);
});

// ─── Message Handler ───────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  const db = loadDB();
  const content = message.content.toLowerCase();
  const isOwn = message.author.id === client.user.id;

  // ── Commands (only when YOU type them) ───────────────────────────────────
  if (isOwn) {

    // !addkeyword
    if (message.content.startsWith("!addkeyword ")) {
      const keyword = message.content.slice(12).trim().toLowerCase();
      if (!keyword) return;
      if (db.keywords.includes(keyword)) {
        await message.channel.send(`Already tracking: ${keyword}`);
        return;
      }
      db.keywords.push(keyword);
      saveDB(db);
      await message.channel.send(`Tracking: ${keyword} | Total: ${db.keywords.length}`);
      return;
    }

    // !bulkadd
    if (message.content.startsWith("!bulkadd ")) {
      const input = message.content.slice(9).trim().toLowerCase();
      const newKeywords = input.split(",").map(k => k.trim()).filter(k => k.length > 0);
      if (!newKeywords.length) {
        await message.channel.send("No keywords found. Separate with commas.");
        return;
      }
      const added = [];
      const skipped = [];
      for (const kw of newKeywords) {
        if (db.keywords.includes(kw)) skipped.push(kw);
        else { db.keywords.push(kw); added.push(kw); }
      }
      saveDB(db);
      await message.channel.send(`Added: ${added.length} | Skipped: ${skipped.length} | Total: ${db.keywords.length}`);
      return;
    }

    // !removekeyword
    if (message.content.startsWith("!removekeyword ")) {
      const keyword = message.content.slice(15).trim().toLowerCase();
      if (!db.keywords.includes(keyword)) {
        await message.channel.send(`Not found: ${keyword}`);
        return;
      }
      db.keywords = db.keywords.filter(k => k !== keyword);
      saveDB(db);
      await message.channel.send(`Removed: ${keyword} | Total: ${db.keywords.length}`);
      return;
    }

    // !keywords
    if (message.content === "!keywords") {
      if (!db.keywords.length) {
        await message.channel.send("No keywords yet. Use !addkeyword to add.");
        return;
      }
      const lines = db.keywords.map((k, i) => (i + 1) + ". " + k);
      const chunks = [];
      let current = "Keywords (" + db.keywords.length + " total):\n";
      for (const line of lines) {
        if ((current + line + "\n").length > 1900) { chunks.push(current); current = ""; }
        current += line + "\n";
      }
      if (current) chunks.push(current);
      for (const chunk of chunks) await message.channel.send(chunk);
      return;
    }

    // !clearkeywords
    if (message.content === "!clearkeywords") {
      db.keywords = [];
      saveDB(db);
      await message.channel.send("All keywords cleared.");
      return;
    }

    // !servers
    if (message.content === "!servers") {
      const list = client.guilds.cache.map(g => `${g.name} (${g.memberCount})`).join("\n");
      await message.channel.send(`Servers (${client.guilds.cache.size}):\n${list}`);
      return;
    }

    // !setchannel — shows the current channel ID to set as alert channel
    if (message.content === "!setchannel") {
      await message.channel.send(
        `Add this to Railway Variables:\nALERT_CHANNEL_ID=${message.channel.id}\nThen redeploy.`
      );
      return;
    }

    // !help
    if (message.content === "!help") {
      await message.channel.send(
        "Commands:\n" +
        "!addkeyword <word> — Add one keyword\n" +
        "!bulkadd <w1>, <w2>... — Add many at once\n" +
        "!removekeyword <word> — Remove a keyword\n" +
        "!keywords — List all keywords\n" +
        "!clearkeywords — Remove all keywords\n" +
        "!servers — List monitored servers\n" +
        "!setchannel — Get this channel ID for alerts\n" +
        "!help — Show this message"
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

    const alertText =
      `KEYWORD: ${keyword}\n` +
      `From: ${message.author.tag}\n` +
      `Server: ${message.guild.name}\n` +
      `Channel: #${message.channel.name}\n` +
      `Jump: ${message.url}\n\n` +
      `Message: ${message.content.slice(0, 800)}`;

    console.log(`ALERT: "${keyword}" in ${message.guild.name} by ${message.author.tag}`);

    // Send to alert channel
    if (CONFIG.alertChannelId) {
      try {
        const alertChannel = await client.channels.fetch(CONFIG.alertChannelId);
        if (alertChannel) {
          await alertChannel.send(alertText);
          console.log(`Alert sent to channel ${CONFIG.alertChannelId}`);
        }
      } catch (err) {
        console.log("Alert channel error:", err.message);
      }
    } else {
      console.log("No ALERT_CHANNEL_ID set in environment variables.");
    }
  }
});

// ─── Error handling ────────────────────────────────────────────────────────
client.on("error", (err) => console.error("Error:", err.message));
process.on("unhandledRejection", (err) => console.error("Unhandled:", err?.message ?? err));

// ─── Login ────────────────────────────────────────────────────────────────
client.login(CONFIG.token);
