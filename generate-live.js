import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINALIZED: DYNAMIC FOOTBALL + ALL STATIC CATEGORIES)
  - Fetches soccer events for TODAY, H+1, and H+2 from TheSportsDB.
  - Channels with upcoming events are moved to date groups (⚽ LIVE FOOTBALL YYYY-MM-DD).
  - Channels without upcoming events (non-live) remain in their static league group (LIGA INGGRIS (EPL)).
  - All non-football channels remain in their static group (TENNIS & GOLF, etc.).
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

async function fetchUpcomingEvents() {
    let allEvents = [];
    
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
            // Error parsing diabaikan karena API tidak selalu mengembalikan data
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

// Fungsi ini MENGEMBALIKAN NULL jika saluran BOLA TIDAK cocok dengan jadwal H+2
function getEventMatchInfo(channel, events, staticCategory) {
    const ln = channel.name.toLowerCase();
    const lu = channel.url.toLowerCase();
    let bestMatch = null;
    let bestOffset = Infinity; 
    
    // Hanya proses jika saluran ini cocok dengan kategori Bola
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
    
    // Jika tidak ada event H+2 yang cocok, kembalikan null
    return null;
}


async function main() {
  console.log("Starting generate-live.js (FINAL)...");

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

  // 1. Inisialisasi grup dinamis untuk Football (akan diisi dengan saluran yang cocok)
  dateGroups.forEach(date => {
      categorizedChannels.set(`⚽ LIVE FOOTBALL ${date}`, []);
  });
  
  // 2. Inisialisasi semua grup statis (termasuk LIGA)
  for (const category of Object.keys(channelMap)) {
       categorizedChannels.set(category, []);
  }

  // =========================================================================
  // PROSES SALURAN
  // =========================================================================
  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let groupTitle = staticCategory; // Default adalah kategori statis
    let finalChannelName = ch.name;
    let isFootball = staticCategory.includes("LIGA") || staticCategory.includes("FOOTBALL");

    // Cek apakah saluran BOLA ini LIVE/UPCOMING H+2
    if (isFootball) {
        const eventMatch = getEventMatchInfo(ch, events, staticCategory);
        if (eventMatch) {
            // Jika LIVE/UPCOMING, pindah ke grup tanggal dinamis
            groupTitle = eventMatch.groupTitle; 
            finalChannelName = eventMatch.channelName;
        } else {
            // Jika TIDAK LIVE/UPCOMING, biarkan di groupTitle = staticCategory
            // Inilah yang memastikan semua saluran liga tetap tampil!
        }
    }
    
    matchedCount++;

    const ok = await headOk(ch.url);
    if (!ok) {
      // console.log("SKIP (offline):", ch.name);
      continue;
    }

    onlineCount++;
    
    // Tambahkan saluran ke Map (baik itu grup tanggal dinamis atau grup statis liga/lainnya)
    if (categorizedChannels.has(groupTitle)) {
        categorizedChannels.get(groupTitle).push({
            name: finalChannelName,
            url: ch.url,
            originalCategory: staticCategory
        });
    } else {
         // Fallback jika ada kategori baru yang tidak terinisialisasi
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
              // Tulis grup LIVE FOOTBALL dengan saluran yang dipindahkan
              channelsInGroup.sort((a, b) => a.originalCategory.localeCompare(b.originalCategory));
              for (const ch of channelsInGroup) {
                  const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${ch.name}`;
                  output.push(newExtinf); 
                  output.push(ch.url);
              }
          }
      } else if (channelsInGroup.length > 0) {
          // --- Grup Statis (LIGA dan NON-BOLA) ---
          // Tulis grup Statis (termasuk Liga yang sedang kosong karena salurannya pindah ke grup tanggal)
          
          // Urutkan saluran di dalam grup statis secara alfabetis
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
