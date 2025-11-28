import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINAL & STABIL: STATIC CATEGORIES & GLOBAL DUPLICATION)
  - Removed all dynamic date/schedule logic (H+0, H+1, TheSportsDB).
  - Only performs static categorization and global duplicate naming.
*/

// HANYA MASUKKAN SUMBER M3U YANG ANDA INGINKAN DI SINI.
const SOURCE_M3US = [
  "https://bakulwifi.my.id/live.m3u",
  "https://donzcompany.shop/donztelevision/donztelevision.php",
  "https://beww.pl/fifa.m3u",
  "https://raw.githubusercontent.com/mimipipi22/lalajo/refs/heads/main/playlist25",
  "https://pastebin.com/raw/faZ6xjCu",
  // URL yang sering bermasalah (Google Drive, Blogspot) telah dihapus dari daftar ini.
  "http://bit.ly/kopinyaoke" 
];

// =======================================================
// HELPER FUNCTIONS
// =======================================================

async function fetchText(url) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) {
        console.log(`Error: Failed to fetch ${url}. Status: ${res.status}`);
        return "";
    }
    return await res.text();
  } catch (e) {
    console.log(`fetchText error for ${url}: ${e.message}`);
    return "";
  }
}

function extractChannelsFromM3U(m3u) {
  const lines = m3u.split(/\r?\n/);
  const channels = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("#EXTINF")) {
      const nameMatch = l.match(/,(.*)$/);
      const namePart = nameMatch ? nameMatch[1].trim() : l;

      const url = (lines[i + 1] || "").trim();
      if (url.startsWith("http")) {
        channels.push({ extinf: l, name: namePart, url });
      }
    }
  }
  return channels;
}

function loadChannelMap() {
  try {
    // Memuat channel-map.json secara lokal
    const raw = fs.readFileSync("./channel-map.json", "utf8"); 
    return JSON.parse(raw);
  } catch (e) {
    console.log("channel-map.json missing or invalid, using empty map:", e.message);
    return {};
  }
}

function getStaticCategory(channel, channelMap) {
  const ln = channel.name.toLowerCase();
  const lu = channel.url.toLowerCase();
  
  for (const category of Object.keys(channelMap)) {
    const keywordsArray = channelMap[category];
    
    if (Array.isArray(keywordsArray)) {
      for (const kw of keywordsArray) {
        if (typeof kw === 'string') {
          const k = kw.toLowerCase();
          
          // Membersihkan penomoran duplikat sementara di nama saluran untuk pencocokan yang bersih
          const cleanLn = ln.replace(/ -[0-9]+$/, '').trim(); 
          
          if (cleanLn.includes(k) || lu.includes(k)) {
            return category; 
          }
        }
      }
    }
  }

  return null;
}


async function main() {
  console.log("Starting generate-live.js (FINAL & STABIL)...");
  
  const output = []; 
  
  const channelMap = loadChannelMap();
  
  let allChannels = [];
  for (const src of SOURCE_M3US) {
    console.log(`Fetching from: ${src}`);
    const m3u = await fetchText(src);
    if (!m3u) continue;
    allChannels = allChannels.concat(extractChannelsFromM3U(m3u));
  }

  // Filter duplikat berdasarkan URL
  const uniqueSet = new Set();
  const unique = allChannels.filter(c => {
    if (!uniqueSet.has(c.url)) {
      uniqueSet.add(c.url);
      return true;
    }
    return false;
  });

  let matchedCount = 0;

  // =========================================================================
  // TAHAP 1: PEMETAAN KE KATEGORI STATIS
  // =========================================================================
  
  const processedChannels = [];

  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    matchedCount++;
    
    processedChannels.push({
        name: ch.name,
        url: ch.url,
        groupTitle: staticCategory, // Group Title adalah kategori statis (FOOTBALL, BASKET, dll)
    });
  }

  // =========================================================================
  // TAHAP 2: PENOMORAN NAMA DUPLIKAT GLOBAL & FINAL GROUPING
  // =========================================================================
  
  const nameCountMap = new Map();
  const outputMap = new Map();
  
  for (const ch of processedChannels) {
      // Dapatkan nama saluran asli (tanpa duplikat/suffix) sebagai base key
      const baseNameKey = ch.name; 
      
      const count = nameCountMap.get(baseNameKey) || 0;
      nameCountMap.set(baseNameKey, count + 1);

      let displayName = ch.name;
      
      // Penomoran duplikat global
      if (count > 0) {
          displayName = `${baseNameKey} -${count}`; 
      }
      
      ch.name = displayName;
      
      // Masukkan ke Map berdasarkan kategori statis
      if (!outputMap.has(ch.groupTitle)) {
          outputMap.set(ch.groupTitle, []);
      }
      outputMap.get(ch.groupTitle).push(ch);
  }
  
  // =========================================================================
  // TAHAP 3: TULIS OUTPUT AKHIR
  // =========================================================================
  
  output.push("#EXTM3U");
  
  // Urutkan grup secara alfabetis
  const sortedGroups = Array.from(outputMap.keys()).sort();

  for (const groupTitle of sortedGroups) {
      const channelsInGroup = outputMap.get(groupTitle);
      
      if (channelsInGroup.length > 0) {
          // Tuliskan header grup
          output.push(`\n#EXTINF:-1 group-title=\"${groupTitle}\",--- ${groupTitle} ---`);
          output.push("https://separator.channel.available/offline.m3u8");

          // Urutkan saluran di dalam grup berdasarkan nama
          channelsInGroup.sort((a, b) => a.name.localeCompare(b.name));
          for (const ch of channelsInGroup) {
              const newExtinf = `#EXTINF:-1 group-title=\"${groupTitle}\",${ch.name}`;
              output.push(newExtinf); 
              output.push(ch.url);
          }
      }
  }

  fs.writeFileSync("live-auto.m3u", output.join("\n") + "\n");
  
  const stats = {
    fetched: allChannels.length,
    unique: unique.length,
    matched: matchedCount,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync("live-auto-stats.json", JSON.stringify(stats, null, 2));

  console.log("=== SUMMARY ===\nTotal unique channels:", unique.length, "\nMatched (categories):", matchedCount, "\nGenerated live-auto.m3u\nStats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
