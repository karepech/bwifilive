import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINALIZED: OFFLINE INCLUDED & H+3 SCHEDULE)
  - Fetches soccer events for TODAY, H+1, H+2, and H+3 from TheSportsDB.
  - Channels with upcoming events are moved to date groups (⚽ LIVE FOOTBALL YYYY-MM-DD).
  - All channels (offline/online) are included in the final M3U.
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

// Fungsi headOk sekarang tidak digunakan, tetapi kita biarkan untuk referensi
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

// Mengambil Jadwal Sepak Bola 4 Hari ke Depan (H+0 hingga H+3)
async function fetchUpcomingEvents() {
    let allEvents = [];
    
    // LOOP HINGGA H+3 (offset <= 3)
    for (let offset = 0; offset <= 3; offset++) {
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
          if (ln.includes(k) || lu.includes(k)) {
            return category; 
          }
        }
      }
    }
  }

  return null;
}

// Mencari Informasi Acara Live/Upcoming Sepak Bola yang Sesuai (H+3)
function getEventMatchInfo(channel, events, staticCategory) {
    const ln = channel.name.toLowerCase();
    const lu = channel.url.toLowerCase();
    let bestMatch = null;
    let bestOffset = Infinity; 
    
    if (!staticCategory || (!staticCategory.includes("LIGA") && !staticCategory.includes("FOOTBALL"))) {
        return null;
    }

    for (const ev of events) {
        const matchesTeams = (ev.home && (ln.includes(ev.home) || lu.includes(ev.home))) || 
                             (ev.away && (ln.includes(ev.away) || lu.includes(ev.away)));
        const matchesEventName = (ev.event && (ln.includes(ev.event) || lu.includes(ev.event)));
        const matchesLeague = (ev.league && (ln.includes(ev.league) || lu.includes(ev.league)));
        const matchesStaticLeague = staticCategory.toLowerCase().includes(ev.league);

        if (matchesTeams || matchesEventName || matchesLeague || matchesStaticLeague) {
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

        return { groupTitle: groupTitle, channelName: finalChannelName };
    }
    
    return null;
}


async function main() {
  console.log("Starting generate-live.js (NO OFFLINE CHECK, H+3)...");

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
  // onlineCount dihilangkan

  const output = ["#EXTM3U"];

  // =========================================================================
  // Inisialisasi Group Map dan Header Wajib (Football)
  // =========================================================================
  const categorizedChannels = new Map();
  
  // RENTANG H+0 HINGGA H+3
  const dateGroups = [getDateString(0), getDateString(1), getDateString(2), getDateString(3)]; 

  // 1. Inisialisasi grup dinamis untuk Football (akan diisi dengan saluran yang cocok)
  dateGroups.forEach(date => {
      categorizedChannels.set(`⚽ LIVE FOOTBALL ${date}`, []);
  });
  
  // 2. Inisialisasi semua grup statis (termasuk LIGA)
  for (const category of Object.keys(channelMap)) {
       categorizedChannels.set(category, []);
  }

  // =========================================================================
  // PROSES SALURAN (TANPA CEK ONLINE)
  // =========================================================================
  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let groupTitle = staticCategory; // Default adalah kategori statis
    let finalChannelName = ch.name;
    let isFootball = staticCategory.includes("LIGA") || staticCategory.includes("FOOTBALL");

    // Cek apakah saluran BOLA ini LIVE/UPCOMING H+3
    if (isFootball) {
        const eventMatch = getEventMatchInfo(ch, events, staticCategory);
        if (eventMatch) {
            // Jika LIVE/UPCOMING, pindah ke grup tanggal dinamis
            groupTitle = eventMatch.groupTitle; 
            finalChannelName = eventMatch.channelName;
        } 
        // Jika tidak, biarkan groupTitle = staticCategory
    }
    
    matchedCount++;
    // Cek headOk Dihapus
    // onlineCount Dihapus
    
    // Tambahkan saluran ke Map
    if (categorizedChannels.has(groupTitle)) {
        categorizedChannels.get(groupTitle).push({
            name: finalChannelName,
            url: ch.url,
            originalCategory: staticCategory
        });
    } else {
         categorizedChannels.set(groupTitle, [{ name: finalChannelName, url: ch.url, originalCategory: staticCategory }]);
    }
  }

  // =========================================================================
  // OUTPUT: Tuliskan ke live-auto.m3u
  // =========================================================================
  
  output.push("#EXTM3U");
  
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
      
      if (groupTitle.startsWith("⚽ LIVE FOOTBALL")) {
          // --- Grup Dinamis LIVE FOOTBALL ---
          if (channelsInGroup.length === 0) {
              // Tampilkan placeholder jika grup tanggal kosong
               output.push(`\n#EXTINF:-1 group-title="${groupTitle}",[NO MATCHES FOUND FOR THIS DATE]`);
               output.push("https://no.channel.available.today/offline.m3u8");
          } else {
              // Tulis grup LIVE FOOTBALL
              channelsInGroup.sort((a, b) => a.originalCategory.localeCompare(b.originalCategory));
              for (const ch of channelsInGroup) {
                  const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name} [LIVE/UPCOMING]`; // Tambahkan tag [LIVE/UPCOMING]
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
    // online field dihilangkan
    generatedAt: new Date().toISOString()
  };

  fs.writeFileSync("live-auto-stats.json", JSON.stringify(stats, null, 2));

  console.log("=== SUMMARY ===");
  console.log("Total unique channels:", unique.length);
  console.log("Matched (categories/schedule):", matchedCount);
  console.log("Generated live-auto.m3u with", matchedCount, "channels (including offline)");
  console.log("Stats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
