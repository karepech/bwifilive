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

    // Ambil isi file M3U dari URL
    const res = await fetch(ch.url);
    const text = await res.text();

    // Masukkan isi file .m3u ke output (bukan URL-nya)
    output += text.trim() + "\n";
  }

  fs.writeFileSync("live.m3u", output, { flag: "w" });
}

generateM3U();
