import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

async function fetchM3U(url) {
  try {
    const res = await fetch(url);
    return await res.text();
  } catch {
    return "";
  }
}

async function isChannelLive(url) {
  try {
    const res = await axios.head(url, { timeout: 5000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function extractChannels(m3uContent) {
  const lines = m3uContent.split("\n");
  const channels = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXTINF")) {
      const name = lines[i].split(",")[1].trim();
      const url = lines[i + 1]?.trim();

      if (url && url.startsWith("http")) {
        channels.push({ name, url });
      }
    }
  }

  return channels;
}

async function generateM3U() {
  const sources = [
    "https://bakulwifi.my.id/live.m3u"
  ];

  let output = "#EXTM3U\n";

  for (const src of sources) {
    const content = await fetchM3U(src);
    const channels = await extractChannels(content);

    for (const ch of channels) {
      const online = await isChannelLive(ch.url);

      if (online) {
        output += `#EXTINF:-1 group-title="SPORT",${ch.name}\n${ch.url}\n`;
      }
    }
  }

  fs.writeFileSync("live.m3u", output);
}

generateM3U();
