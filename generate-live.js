import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINALIZED: OFFLINE INCLUDED, H+2 SCHEDULE, & DUPLICATE NAMING - FIX ReferenceError)
  - Fetches soccer events for TODAY, H+1, and H+2 from TheSportsDB (Total 3 days).
  - All channels (offline/online) are included in the final M3U.
  - Duplicate channel names across the entire playlist are renamed: "ChannelName -1", "ChannelName -2", etc.
*/

const SOURCE_M3US = [
  
  "https://bakulwifi.my.id/live.m3u"
  // Tambahkan URL sumber M3U lainnya di sini jika diperlukan
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
    const raw = fs.readFileSync("./channel-map.json", "utf8"); 
    return JSON.parse(raw);
  } catch (e) {
    console.log("channel-map.json missing or invalid, using empty map:", e.message);
    return {};
  }
}

// Mengambil Jadwal Sepak Bola 3 Hari ke Depan (H+0 hingga H+2)
async function fetchUpcomingEvents() {
    let allEvents = [];
    
    // LOOP HINGGA H+2 (offset <= 2)
    for (let offset = 0; offset <= 2; offset++) {
        const date = getDateString(offset);
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;
        const txt = await fetchText(url);
        
        try {
            const events = (JSON.parse(txt).events || []).map(ev => ({
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
            // Error parsing diabaikan
        }
    }
    return allEvents;
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

// Mencari Informasi Acara Live/Upcoming Sepak Bola yang Sesuai (H+2)
function getEventMatchInfo(channel, events) {
    const ln = channel.name.toLowerCase();
    const lu = channel.url.toLowerCase();
    let bestMatch = null;
    let bestOffset = Infinity; 
    
    // Saluran non-bola tidak akan memiliki match info di sini
    
    for (const ev of events) {
        const matchesTeams = (ev.home && (ln.includes(ev.home) || lu.includes(ev.home))) || 
                             (ev.away && (ln.includes(ev.away) || lu.includes(ev.away)));
        const matchesEventName = (ev.event && (ln.includes(ev.event) || lu.includes(ev.event)));
        const matchesLeague = (ev.league && (ln.includes(ev.league) || lu.includes(ev.league)));
        
        // Asumsi: Semua saluran yang masuk ke sini relevan dengan bola berdasarkan staticCategory
        
        if (matchesTeams || matchesEventName || matchesLeague) {
            if (ev.offset <= bestOffset) { 
                bestOffset = ev.offset;
                bestMatch = ev;
            }
        }
    }
    
    if (bestMatch) {
        const timePart = bestMatch.time ? ` (${bestMatch.time.substring(0, 5)} WIB)` : '';
        
        const groupTitle = `⚽ LIVE FOOTBALL ${bestMatch.date}`;
        const finalChannelName = `${channel.name} | [${bestMatch.league}${timePart}] ${bestMatch.title}`;

        return { groupTitle: groupTitle, channelName: finalChannelName, isLive: bestMatch.offset === 0 };
    }
    
    return null;
}


async function main() {
  console.log("Starting generate-live.js (STATIC CATEGORY & GLOBAL DUPLICATION)...");
  
  // FIX: Deklarasi variabel output di dalam fungsi main
  const output = []; 

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

  // =========================================================================
  // TAHAP 1: PEMETAAN DAN PENYEMATAN DETAIL JADWAL KE NAMA SALURAN
  // =========================================================================
  
  const categorizedChannels = new Map();
  
  // List untuk mencatat saluran yang berhasil diproses
  const processedChannels = [];

  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let groupTitle = staticCategory; 
    let finalChannelName = ch.name;
    let isLive = false;
    
    // Coba sematkan detail jadwal (H+2) ke nama saluran
    const eventMatchInfo = getEventMatchInfo(ch, events);
    
    if (eventMatchInfo) {
        groupTitle = eventMatchInfo.groupTitle; // ⚽ LIVE FOOTBALL YYYY-MM-DD
        finalChannelName = eventMatchInfo.channelName;
        isLive = eventMatchInfo.isLive;
    }
    
    matchedCount++;
    
    // Simpan saluran ke list sementara
    processedChannels.push({
        name: finalChannelName,
        url: ch.url,
        groupTitle: groupTitle,
        originalCategory: staticCategory,
        isLive: isLive
    });
  }

  // =========================================================================
  // TAHAP 2: PENOMORAN NAMA DUPLIKAT GLOBAL
  // =========================================================================
  
  // Hitung frekuensi nama saluran dasar (misal: BEIN SPORTS 1 | [SUFFIX])
  const nameCountMap = new Map();
  const finalOutputChannels = [];

  for (const ch of processedChannels) {
      // Gunakan nama yang sudah disematkan info jadwal sebagai base key
      const nameKey = ch.name; 
      const count = nameCountMap.get(nameKey) || 0;
      nameCountMap.set(nameKey, count + 1);

      let displayName = ch.name;
      
      // Jika count > 0, artinya ini adalah duplikat kedua, ketiga, dst.
      if (count > 0) {
          displayName = `${displayName} -${count}`; 
      }
      
      // Tambahkan tag [LIVE] jika sedang live hari ini (H+0)
      if (ch.isLive) {
          displayName = `${displayName} [LIVE]`;
      }
      
      finalOutputChannels.push({
          ...ch,
          name: displayName
      });
  }
  
  // =========================================================================
  // TAHAP 3: OUTPUT AKHIR (Semua di Grup Statis, dengan Football Pindah ke Grup Tanggal)
  // =========================================================================
  
  // Atur kembali saluran ke dalam Map berdasarkan Group Title final
  const finalCategorizedChannels = new Map();
  
  // Inisialisasi semua grup yang mungkin
  const dateGroups = [getDateString(0), getDateString(1), getDateString(2)]; 
  dateGroups.forEach(date => {
      finalCategorizedChannels.set(`⚽ LIVE FOOTBALL ${date}`, []);
  });
  for (const category of Object.keys(channelMap)) {
       finalCategorizedChannels.set(category, []);
  }

  for (const ch of finalOutputChannels) {
      // Masukkan ke grup yang sudah ditentukan (groupTitle bisa statis atau dinamis)
      finalCategorizedChannels.get(ch.groupTitle).push(ch);
  }


  output.push("#EXTM3U");
  
  const sortedGroups = Array.from(finalCategorizedChannels.keys()).sort((a, b) => {
      // Prioritas 1: Grup LIVE FOOTBALL (Tanggal) di atas, diurutkan berdasarkan tanggal
      if (a.startsWith("⚽ LIVE FOOTBALL") && b.startsWith("⚽ LIVE FOOTBALL")) {
          return a.localeCompare(b);
      }
      if (a.startsWith("⚽ LIVE FOOTBALL")) return -1; 
      if (b.startsWith("⚽ LIVE FOOTBALL")) return 1;
      
      // Prioritas 2: Grup Statis (diurutkan secara alfabetis)
      return a.localeCompare(b);
  });

  for (const groupTitle of sortedGroups) {
      const channelsInGroup = finalCategorizedChannels.get(groupTitle);
      
      if (groupTitle.startsWith("⚽ LIVE FOOTBALL")) {
          // --- Grup Dinamis LIVE FOOTBALL ---
          if (channelsInGroup.length === 0) {
               // Tampilkan placeholder jika grup tanggal kosong
               output.push(`\n#EXTINF:-1 group-title="${groupTitle}",[NO MATCHES FOUND FOR THIS DATE]`);
               output.push("https://no.channel.available.today/offline.m3u8");
          } else {
              // Tulis grup LIVE FOOTBALL (sudah termasuk penomoran dan tag [LIVE/UPCOMING])
              // Urutkan saluran di dalam grup berdasarkan kategori statis aslinya (misal LIGA INGGRIS, LALIGA)
              channelsInGroup.sort((a, b) => a.originalCategory.localeCompare(b.originalCategory));
              for (const ch of channelsInGroup) {
                  const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name}`;
                  output.push(newExtinf); 
                  output.push(ch.url);
              }
          }
      } else if (channelsInGroup.length > 0) {
          // --- Grup Statis (LIGA dan NON-BOLA) ---
          channelsInGroup.sort((a, b) => a.name.localeCompare(b.name));
          for (const ch of channelsInGroup) {
              const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name}`;
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

  console.log("=== SUMMARY ===");
  console.log("Total unique channels:", unique.length);
  console.log("Matched (categories/schedule):", matchedCount);
  console.log("Generated live-auto.m3u with", finalOutputChannels.length, "channels (including offline)");
  console.log("Stats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
