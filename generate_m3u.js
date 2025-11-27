import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

async function fetchM3U(url) {
  try {
    const res = await fetch(url);
    return await res.text();
  } catch (err) {
    console.log("Gagal mengambil:", url);
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
  const sourceList = [
    "https://bakulwifi.my.id/live.m3u",
    "https://bakulwifi.my.id/bw.m3u"
  ];

  let finalOutput = "#EXTM3U\n";
  let totalLive = 0;

  for (const url of sourceList) {
    console.log("Mengambil:", url);
    
    const rawM3U = await fetchM3U(url);
    const channels = await extractChannels(rawM3U);

    console.log("Total channel ditemukan:", channels.length);

    for (const ch of channels) {
      const live = await isChannelLive(ch.url);
      
      if (live) {
        finalOutput += `#EXTINF:-1 group-title="SPORT",${ch.name}\n${ch.url}\n`;
        totalLive++;
        console.log("ONLINE:", ch.name);
      } else {
        console.log("OFFLINE:", ch.name);
      }
    }
  }

  fs.writeFileSync("live.m3u", finalOutput);
  console.log("\nSelesai! Total channel LIVE:", totalLive);
}

generateM3U();
