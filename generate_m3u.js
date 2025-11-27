import fs from "fs";

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

  channels.forEach(ch => {
    output += `#EXTINF:-1 group-title="${ch.group}",${ch.name}\n`;
    output += `${ch.url}\n`;
  });

  fs.writeFileSync("live.m3u", output);
}

generateM3U();
