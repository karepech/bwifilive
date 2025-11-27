import fs from "fs";
import fetch from "node-fetch";

async function generateM3U() {
  const channels = [
    {
      name: "Live Bola 1",
      url: "https://bakulwifi.my.id/live.m3u",
      group: "SPORT"
    },
    {
      name: "Live Bola 2",
      url: "https://bakulwifi.my.id/bw.m3u",
      group: "SPORT"
    }
  ];

  let output = "#EXTM3U\n";

  for (const ch of channels) {
    output += `#EXTINF:-1 group-title="${ch.group}",${ch.name}\n`;

    const res = await fetch(ch.url);
    const finalUrl = res.url; // URL setelah redirect

    output += `${finalUrl}\n`;
  }

  fs.writeFileSync("live.m3u", output);
}

generateM3U();
