require('dotenv').config({ path: __dirname + '/.env' });
const EventSource = require('eventsource');
const fs = require('fs');
const path = require('path');
const Discord = require('discord.js');
const zip = require('cross-zip');

const client = new Discord.Client({
  intents: [
    "Guilds"
  ]
});

let pendingForReady = [];

client.login(process.env.DISCORD_TOKEN).then(() => {
  console.log("Logged in");
  for (let i = 0; i < pendingForReady.length; i++) {
    pendingForReady[i]();
  }
  pendingForReady.length = 0;
});

function makeSureSent(cb) {
  if (client.readyAt) {
    cb();
  } else {
    pendingForReady.push(cb);
  }
}

function mkdir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

async function download(u, p) {
  try {
    mkdir(path.parse(p).dir);

    let r = await fetch(u, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0"
      }
    });

    await fs.promises.writeFile(path.resolve(p), Buffer.from(await r.arrayBuffer()));
  } catch { };
}

mkdir("./temp");

const events = new EventSource("https://explorer.sikayetvar.com/live");

events.addEventListener("complaint", (event) => {
  const json = JSON.parse(event.data);
  json.forEach((complaint) => {
    handleComplaint(complaint);
  });
});

async function handleComplaint(complaint) {
  console.log(complaint);
  const tempFolder = path.join(__dirname, "temp", `${complaint.id}`);
  mkdir(tempFolder);

  await fs.promises.writeFile(path.join(tempFolder, "complaint.json"), JSON.stringify(complaint, null, 2));

  let firstImagePath;
  for (let i = 0; i < complaint.attachments.length; i++) {
    const atc = complaint.attachments[i];
    console.log("Downloading attachment", i + 1, "of", complaint.attachments.length, "for complaint", complaint.id);
    let atcPath = path.join(tempFolder, atc.url.split("/").pop())
    await download(`https://files.sikayetvar.com/complaint${atc.url}`, atcPath);
    if (!firstImagePath && atc.mimeType == "photo") firstImagePath = atcPath;
  }

  const zipPath = path.join(tempFolder, "complaint.zip");
  await new Promise(r => zip.zip(tempFolder, zipPath, r));

  makeSureSent(async () => {
    /** @type {import("discord.js").GuildTextBasedChannel} */
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);

    const imgExt = firstImagePath ? path.extname(firstImagePath) : null;
    const title = complaint.title ? `${complaint.title} ${complaint.relatedCompanies.map(i => i.name).join(" ")}`.toLowerCase() : "No title";
    await channel.send({
      content: title,
      files: [
        new Discord.AttachmentBuilder(zipPath).setName("complaint.zip"),
        firstImagePath ? new Discord.AttachmentBuilder(firstImagePath, { name: `image${imgExt}` }) : null
      ].filter(Boolean),
      embeds: [{
        color: 0x03e4b5,
        title: complaint.title,
        description: complaint.body.slice(0, 2000),
        image: firstImagePath ? { url: `attachment://image${imgExt}` } : undefined,
        author: {
          name: complaint.member.shortName,
          icon_url: `https://files.sikayetvar.com${complaint.member.picture}`,
          url: `https://www.sikayetvar.com${complaint.member.url}`
        },
        timestamp: complaint.complainTime,
        fields: [
          complaint.attachments.length ? {
            name: "Attachments",
            value: complaint.attachments.map((a, i) => `[Attachment ${i + 1}](https://files.sikayetvar.com/complaint${a.url})`).join("\n"),
            inline: true
          } : undefined,
          complaint.relatedCompanies.length ? {
            name: "Related Companies",
            value: complaint.relatedCompanies.map(c => `[${c.name}](https://www.sikayetvar.com/${c.url})`).join(", "),
            inline: true
          } : undefined,
          complaint.grayListedWords.length ? {
            name: "Gray Listed Words",
            value: complaint.grayListedWords.join(", "),
            inline: true
          } : undefined,
          complaint.undefinedWords.length ? {
            name: "Undefined Words",
            value: complaint.undefinedWords.join(", "),
            inline: true
          } : undefined,
        ].filter(Boolean),
        footer: {
          text: `Id: ${complaint.id} | Has ${complaint.attachments.length} attachments.`
        }
      }]
    });

    await fs.promises.rm(tempFolder, { recursive: true });
  });
}