import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (WITH STATS AND CATEGORIES)
  - Fetches today's soccer events from TheSportsDB
  - Fetches source M3U(s)
  - Extracts channels
  - Matches with schedule & channel-map (for category)
  - Checks channel status via HTTP HEAD
  - Writes live-auto.m3u (with group-title)
  - Writes live-auto-stats.json
*/

const SOURCE_M3US = [
  
  "https://bakulwifi.my.id/live.m3u"

];

function todaysDate() {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function fetchText(url) {
  try {
    const res = await fetch(url, { timeout: 15000 });
    if (!res.ok) return "";
    return await res.text();
  } catch (e) {
    console.log("fetchText error for", url, e.message);
    return "";
  }
}

async function headOk(url) {
  try {
    const res = await axios.head(url, { timeout: 7000 });
    return res.status === 200;
  } catch {
    return false;
  }
}

function extractChannelsFromM3U(m3u) {
  const lines = m3u.split(/\r?\n/);
  const channels = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith("#EXTINF")) {
      const namePart = l.split(",")[1] || l;
      const url = (lines[i + 1] || "").trim();
      if (url.startsWith("http")) {
        // Simpan baris extinf lama
        channels.push({ extinf: l, name: namePart.trim(), url });
      }
    }
  }
  return channels;
}

function loadChannelMap() {
  try {
    // Pastikan file ini ada di root folder
    const raw = fs.readFileSync("./channel-map.json", "utf8"); 
    return JSON.parse(raw);
  } catch (e) {
    console.log("channel-map.json missing or invalid, using empty map:", e.message);
    return {};
  }
}

async function fetchTodayEvents() {
  // Anda dapat mengganti ini dengan API-Sports.io jika sudah berlangganan dan menyiapkan kuncinya.
  // Untuk saat ini, kita tetap menggunakan TheSportsDB.
  const date = todaysDate();
  const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;
  const txt = await fetchText(url);
  if (!txt) return [];
  try {
    return JSON.parse(txt).events || [];
  } catch {
    return [];
  }
}

function buildEventKeywords(events) {
  const kw = new Set();
  events.forEach(ev => {
    if (ev.strEvent) kw.add(ev.strEvent.toLowerCase());
    if (ev.strHomeTeam) kw.add(ev.strHomeTeam.toLowerCase());
    if (ev.strAwayTeam) kw.add(ev.strAwayTeam.toLowerCase());
    if (ev.strLeague) kw.add(ev.strLeague.toLowerCase());
  });
  return Array.from(kw);
}

// FUNGSI INTI UNTUK MENDAPATKAN KATEGORI (MODIFIKASI UTAMA DI SINI)
function channelMatchesKeywords(channel, keywords, channelMap) {
  const ln = channel.name.toLowerCase();
  const lu = channel.url.toLowerCase();

  // 1. Cek kecocokan dengan JADWAL HARI INI (Tim/Liga)
  for (const k of keywords) {
    if (ln.includes(k) || lu.includes(k)) {
      return "FOOTBALL LIVE (Jadwal Harian)";
    }
  }

  // 2. Cek kecocokan dengan CHANNEL MAP (Kategori Lain)
  for (const category of Object.keys(channelMap)) {
    const categoryContent = channelMap[category];
    
    if (Array.isArray(categoryContent)) {
      // Kasus 1: Kategori standar (seperti MOTORSPORT atau UMUM & MULTISPORT) - nilainya adalah Array
      for (const kw of categoryContent) {
        if (typeof kw === 'string') {
          const k = kw.toLowerCase();
          if (ln.includes(k) || lu.includes(k)) {
            return category;
          }
        }
      }
    } else if (typeof categoryContent === 'object' && categoryContent !== null) {
      // Kasus 2: Kategori bersarang (seperti FOOTBALL LIVE) - nilainya adalah Objek filter liga
      for (const subCategory of Object.keys(categoryContent)) {
        const keywordsArray = categoryContent[subCategory];
        
        if (Array.isArray(keywordsArray)) {
          for (const kw of keywordsArray) {
            if (typeof kw === 'string') {
              const k = kw.toLowerCase();
              // Jika cocok, kita kembalikan KATEGORI UTAMA (misalnya, "FOOTBALL LIVE (Jadwal Harian)")
              if (ln.includes(k) || lu.includes(k)) {
                return category; 
              }
            }
          }
        }
      }
    }
  }

  return null; // Mengembalikan null jika tidak ada yang cocok
}


async function main() {
  console.log("Starting generate-live.js (WITH CATEGORIES)...");

  const channelMap = loadChannelMap();
  const events = await fetchTodayEvents();
  console.log("Events today:", events.length);

  const keywords = buildEventKeywords(events);

  let allChannels = [];

  for (const src of SOURCE_M3US) {
    console.log("Fetching:", src);
    const m3u = await fetchText(src);
    if (!m3u) continue;
    const chs = extractChannelsFromM3U(m3u);
    console.log("Channels found:", chs.length);
    allChannels = allChannels.concat(chs);
  }

  console.log("Total channels fetched:", allChannels.length);

  const uniqueSet = new Set();
  const unique = [];

  for (const c of allChannels) {
    if (!uniqueSet.has(c.url)) {
      unique.push(c);
      uniqueSet.add(c.url);
    }
  }

  console.log("Total unique channels:", unique.length);

  let matchedCount = 0;
  let onlineCount = 0;

  const output = ["#EXTM3U"];

  for (const ch of unique) {
    // Tangkap nama kategori (bisa string kategori atau null)
    const category = channelMatchesKeywords(ch, keywords, channelMap);
    
    // Perubahan di sini: Jika category adalah 'FOOTBALL LIVE (Jadwal Harian)',
    // kita perlu mencari sub-kategori yang sesuai untuk group-title yang lebih spesifik.

    let groupTitle = category; 
    
    // Jika tidak ada kategori yang cocok atau bukan kategori utama yang kita modifikasi, lanjutkan.
    if (!category) continue; 
    
    // Jika kategorinya adalah FOOTBALL LIVE, kita cari sub-filternya
    if (category === "FOOTBALL LIVE (Jadwal Harian)" && typeof channelMap[category] === 'object') {
        const ln = ch.name.toLowerCase();
        const lu = ch.url.toLowerCase();
        
        for (const subCategory of Object.keys(channelMap[category])) {
             const keywordsArray = channelMap[category][subCategory];
             if (Array.isArray(keywordsArray)) {
                for (const kw of keywordsArray) {
                    if (typeof kw === 'string') {
                        const k = kw.toLowerCase();
                        if (ln.includes(k) || lu.includes(k)) {
                            groupTitle = subCategory; // Gunakan nama sub-kategori sebagai group-title
                            break; 
                        }
                    }
                }
             }
            if (groupTitle !== category) break; // Jika sub-kategori ditemukan, keluar dari loop sub-kategori
        }
    }
    
    matchedCount++;

    const ok = await headOk(ch.url);
    if (!ok) {
      console.log("SKIP (offline):", ch.name);
      continue;
    }

    onlineCount++;
    
    // Gunakan groupTitle yang mungkin telah dispesifikasi (misal: "Liga Inggris (EPL) - Global")
    const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name}`;
    
    output.push(newExtinf); 
    output.push(ch.url);
    console.log(`ADDED [${groupTitle}]:`, ch.name);
  }

  fs.writeFileSync("live-auto.m3u", output.join("\n") + "\n");

  // ====== WRITE STATS FILE ======
  const stats = {
    fetched: allChannels.length,
    unique: unique.length,
    matched: matchedCount,
    online: onlineCount,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync("live-auto-stats.json", JSON.stringify(stats, null, 2));

  console.log("=== SUMMARY ===");
  console.log("Matched (keywords):", matchedCount);
  console.log("Online (HTTP 200):", onlineCount);
  console.log("Generated live-auto.m3u with", onlineCount, "channels");
  console.log("Stats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
