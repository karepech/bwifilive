import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINALIZED: MULTI-SPORT DYNAMIC GROUPING)
  - Fetches soccer events (as a proxy for all events).
  - Groups ALL matching channels by date (e.g., ⚽ LIVE FOOTBALL 2025-11-28).
  - Channels without upcoming events revert to static category.
*/

const SOURCE_M3US = [
  
  "https://bakulwifi.my.id/live.m3u"

];

// =======================================================
// HELPER FUNCTIONS
// =======================================================

function getDateString(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset); 
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

const EMOJI_MAP = {
    "LIGA": "⚽",
    "FOOTBALL": "⚽",
    "MOTORSPORT": "🏎️",
    "TENNIS": "🎾",
    "GOLF": "⛳",
    "BASKET": "🏀",
    "VOLI": "🏐",
    "MMA": "🥊", // Menggunakan tinju sebagai proksi untuk olahraga tempur
    "WRESTLING": "🤼‍♂️",
    "UMUM": "🌟"
};

function getEmoji(categoryName) {
    const upperName = categoryName.toUpperCase();
    for (const key in EMOJI_MAP) {
        if (upperName.includes(key)) {
            return EMOJI_MAP[key];
        }
    }
    return "🌐"; // Default emoji
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
        channels.push({ extinf: l, name: namePart.trim(), url });
      }
    }
  }
  return channels;
}

function loadChannelMap() {
  try {
    const raw = fs.readFileSync("./channel-map.json", "utf8"); 
    return JSON.parse(raw);
  } catch (e) {
    console.log("channel-map.json missing or invalid, using empty map:", e.message);
    return {};
  }
}

// Mengambil Jadwal Sepak Bola 3 Hari ke Depan (Asumsi ini mewakili data live event)
async function fetchUpcomingEvents() {
    let allEvents = [];
    
    // Kita panggil API untuk 3 hari (H+0, H+1, H+2)
    for (let offset = 0; offset <= 2; offset++) {
        const date = getDateString(offset);
        // API ini hanya untuk Soccer, jadi kita anggap semua event yang cocok di bawah ini adalah event bola
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`; 
        const txt = await fetchText(url);
        
        try {
            const events = (JSON.parse(txt).events || []).map(ev => ({
                // Kita tambahkan tag Sport Type (S) untuk membantu kecocokan
                sport: "Soccer", 
                event: ev.strEvent ? ev.strEvent.toLowerCase() : '',
                title: ev.strEvent, 
                home: ev.strHomeTeam ? ev.strHomeTeam.toLowerCase() : '',
                away: ev.strAwayTeam ? ev.strAwayTeam.toLowerCase() : '',
                league: ev.strLeague ? ev.strLeague.toLowerCase() : '',
                time: ev.strTime || '', 
                date: date, 
                offset: offset 
            }));
            allEvents = allEvents.concat(events);
        } catch (e) {
            // console.log(`Error parsing events for ${date}:`, e.message);
        }
    }
    
    // *** Placeholder untuk Non-Soccer Events (ASUMSI DATA SUDAH ADA DARI API LAIN) ***
    // Tambahkan event dummy untuk demonstrasi agar kategori lain bisa masuk ke grup tanggal
    // Contoh:
    /*
    allEvents.push({
        sport: "Tennis", event: "wimbledon final", title: "Wimbledon Final: Player X vs Player Y",
        home: "player x", away: "player y", league: "Wimbledon", time: "14:00",
        date: getDateString(1), offset: 1
    });
    */
    
    return allEvents;
}


// Mencari Informasi Acara Live/Upcoming yang Sesuai (untuk semua olahraga)
function getEventMatchInfo(channel, events, staticCategory) {
    const ln = channel.name.toLowerCase();
    const lu = channel.url.toLowerCase();
    let bestMatch = null;
    let bestOffset = Infinity; 
    
    for (const ev of events) {
        // Match berdasarkan tim, event, atau liga
        const matchesTeams = (ev.home && (ln.includes(ev.home) || lu.includes(ev.home))) || 
                             (ev.away && (ln.includes(ev.away) || lu.includes(ev.away)));
        const matchesEventName = (ev.event && (ln.includes(ev.event) || lu.includes(ev.event)));
        const matchesLeague = (ev.league && (ln.includes(ev.league) || lu.includes(ev.league)));
        
        // Match berdasarkan kategori statis dan jenis olahraga
        const matchesSportType = staticCategory.toUpperCase().includes(ev.sport.toUpperCase());

        if ((matchesTeams || matchesEventName || matchesLeague) && matchesSportType) {
            if (ev.offset <= bestOffset) { 
                bestOffset = ev.offset;
                bestMatch = ev;
            }
        }
    }
    
    if (bestMatch) {
        const timePart = bestMatch.time ? ` (${bestMatch.time.substring(0, 5)} WIB)` : '';
        const emoji = getEmoji(staticCategory);
        
        // Format Group Title: [EMOJI] LIVE [KATEGORI STATIS] [Tanggal]
        const groupTitle = `${emoji} LIVE ${staticCategory.toUpperCase()} ${bestMatch.date}`;
        
        // Format Channel Name: [Liga/Kompetisi - Waktu] Nama Pertandingan
        const finalChannelName = `${channel.name} | [${bestMatch.league}${timePart}] ${bestMatch.title}`;

        return { groupTitle: groupTitle, channelName: finalChannelName };
    }
    
    return null; 
}


// Mendapatkan Kategori Statis
function getStaticCategory(channel, channelMap) {
  const ln = channel.name.toLowerCase();
  const lu = channel.url.toLowerCase();
  
  for (const category of Object.keys(channelMap)) {
    const keywordsArray = channelMap[category];
    
    if (Array.isArray(keywordsArray)) {
      for (const kw of keywordsArray) {
        if (typeof kw === 'string') {
          const k = kw.toLowerCase();
          if (ln.includes(k) || lu.includes(k)) {
            return category; 
          }
        }
      }
    }
  }

  return null;
}


async function main() {
  console.log("Starting generate-live.js (MULTI-SPORT DYNAMIC)...");

  const channelMap = loadChannelMap();
  const events = await fetchUpcomingEvents(); 
  
  let allChannels = [];
  for (const src of SOURCE_M3US) {
    const m3u = await fetchText(src);
    if (!m3u) continue;
    allChannels = allChannels.concat(extractChannelsFromM3U(m3u));
  }

  const uniqueSet = new Set();
  const unique = allChannels.filter(c => {
    if (!uniqueSet.has(c.url)) {
      uniqueSet.add(c.url);
      return true;
    }
    return false;
  });

  let matchedCount = 0;
  let onlineCount = 0;

  const output = ["#EXTM3U"];

  // =========================================================================
  // Inisialisasi Group Map dan Header Wajib (Football)
  // =========================================================================
  const categorizedChannels = new Map();
  const dateGroups = [getDateString(0), getDateString(1), getDateString(2)];

  // Inisialisasi grup dinamis untuk semua tanggal H+2 (hanya untuk Sepak Bola karena keterbatasan API)
  dateGroups.forEach(date => {
      categorizedChannels.set(`⚽ LIVE FOOTBALL ${date}`, []);
  });
  
  // Inisialisasi grup statis lainnya
  for (const category of Object.keys(channelMap)) {
       // Hanya inisialisasi kategori non-bola/liga statis di Map
      if (!category.includes("LIGA") && !category.includes("FOOTBALL")) {
          categorizedChannels.set(category, []);
      }
  }

  // =========================================================================
  // PROSES SALURAN
  // =========================================================================
  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let matchInfo = null;

    // Coba temukan event dinamis (Sepak Bola) yang cocok
    if (staticCategory.includes("LIGA") || staticCategory.includes("FOOTBALL")) {
        matchInfo = getEventMatchInfo(ch, events, staticCategory);
    }
    
    let groupTitle;
    let finalChannelName = ch.name;

    if (matchInfo) {
        // Jika cocok dengan event dinamis (Sepak Bola)
        groupTitle = matchInfo.groupTitle; 
        finalChannelName = matchInfo.channelName;
    } else {
        // Jika tidak ada event dinamis yang cocok (termasuk saluran non-bola)
        groupTitle = staticCategory;
    }
    
    matchedCount++;

    const ok = await headOk(ch.url);
    if (!ok) {
      // console.log("SKIP (offline):", ch.name);
      continue;
    }

    onlineCount++;
    
    // Tambahkan saluran ke Map
    if (categorizedChannels.has(groupTitle)) {
        categorizedChannels.get(groupTitle).push({
            name: finalChannelName,
            url: ch.url,
            originalCategory: staticCategory // Untuk sorting di dalam grup
        });
    } else {
         // Saluran non-bola yang tidak terinisialisasi (misalnya event dinamis non-bola, jika ada)
         categorizedChannels.set(groupTitle, [{ name: finalChannelName, url: ch.url, originalCategory: staticCategory }]);
    }
  }

  // =========================================================================
  // OUTPUT: Tuliskan ke live-auto.m3u
  // =========================================================================
  
  // Dapatkan daftar Group Title unik dari Map
  const sortedGroups = Array.from(categorizedChannels.keys()).sort((a, b) => {
      // Prioritas 1: Grup LIVE FOOTBALL selalu di atas, diurutkan berdasarkan tanggal
      if (a.startsWith("⚽ LIVE FOOTBALL") && b.startsWith("⚽ LIVE FOOTBALL")) {
          return a.localeCompare(b);
      }
      if (a.startsWith("⚽ LIVE FOOTBALL")) return -1; 
      if (b.startsWith("⚽ LIVE FOOTBALL")) return 1;
      
      // Prioritas 2: Grup Statis (diurutkan secara alfabetis)
      return a.localeCompare(b);
  });

  for (const groupTitle of sortedGroups) {
      const channelsInGroup = categorizedChannels.get(groupTitle);
      
      // Khusus untuk grup dinamis (LIVE FOOTBALL)
      if (groupTitle.startsWith("⚽ LIVE FOOTBALL")) {
          if (channelsInGroup.length === 0) {
              // Jika kosong, tampilkan header placeholder
               output.push(`\n#EXTINF:-1 group-title="${groupTitle}",[NO MATCHES FOUND FOR THIS DATE]`);
               output.push("https://no.channel.available.today/offline.m3u8");
          } else {
              // Jika ada saluran, urutkan berdasarkan kategori statis aslinya (misal LIGA INGGRIS, LALIGA)
              channelsInGroup.sort((a, b) => a.originalCategory.localeCompare(b.originalCategory));
              for (const ch of channelsInGroup) {
                  const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name}`;
                  output.push(newExtinf); 
                  output.push(ch.url);
              }
          }
      } else if (channelsInGroup.length > 0) {
          // Tuliskan grup statis non-bola jika tidak kosong
          for (const ch of channelsInGroup) {
              const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name}`;
              output.push(newExtinf); 
              output.push(ch.url);
          }
      }
  }

  fs.writeFileSync("live-auto.m3u", output.join("\n") + "\n");
  
  // ... (kode stats tetap sama)
  const stats = {
    fetched: allChannels.length,
    unique: unique.length,
    matched: matchedCount,
    online: onlineCount,
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync("live-auto-stats.json", JSON.stringify(stats, null, 2));

  console.log("=== SUMMARY ===");
  console.log("Matched (channels):", matchedCount);
  console.log("Online (HTTP 200):", onlineCount);
  console.log("Generated live-auto.m3u with", onlineCount, "channels");
  console.log("Stats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
