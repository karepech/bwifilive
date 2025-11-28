import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINAL: H+2 Schedule, ALL CHANNELS STATIC GROUPING, Global Duplication Naming)
  - Fetches soccer events for TODAY, H+1, and H+2 for match detail suffix.
  - Channels remain in their static broad category (FOOTBALL, BOXING, etc.).
  - Duplicate channel names across the entire playlist are renamed: "ChannelName -1", "ChannelName -2", etc.
*/

const SOURCE_M3US = [
  
  "https://bakulwifi.my.id/live.m3u",
  "https://bakulwifi.my.id/nyolong.m3u"
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

// Mencari Informasi Acara Live/Upcoming Sepak Bola (H+2) untuk Suffix Nama
function getEventMatchInfo(channel, events) {
    const ln = channel.name.toLowerCase();
    const lu = channel.url.toLowerCase();
    let bestMatch = null;
    let bestOffset = Infinity; 
    
    for (const ev of events) {
        const matchesTeams = (ev.home && (ln.includes(ev.home) || lu.includes(ev.home))) || 
                             (ev.away && (ln.includes(ev.away) || lu.includes(ev.away)));
        const matchesEventName = (ev.event && (ln.includes(ev.event) || lu.includes(ev.event)));
        const matchesLeague = (ev.league && (ln.includes(ev.league) || lu.includes(ev.league)));
        
        if (matchesTeams || matchesEventName || matchesLeague) {
            if (ev.offset <= bestOffset) { 
                bestOffset = ev.offset;
                bestMatch = ev;
            }
        }
    }
    
    if (bestMatch) {
        const timePart = bestMatch.time ? ` (${bestMatch.time.substring(0, 5)} WIB)` : '';
        const datePart = bestMatch.date;
        const status = bestMatch.offset === 0 ? "LIVE TODAY" : datePart;
        
        // Format Detail: | [Status/Tanggal - Liga - Waktu] Pertandingan
        const suffix = ` | [${status} - ${bestMatch.league}${timePart}] ${bestMatch.title}`;

        return { suffix: suffix, isLive: bestMatch.offset === 0 };
    }
    
    return null;
}


async function main() {
  console.log("Starting generate-live.js (STATIC CATEGORY & GLOBAL DUPLICATION)...");
  
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
  
  const processedChannels = [];

  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let finalChannelName = ch.name;
    let isLive = false;
    
    // Hanya sematkan detail jadwal untuk saluran Bola (kategori yang mengandung FOOTBALL)
    if (staticCategory.includes("FOOTBALL")) {
        const eventMatchInfo = getEventMatchInfo(ch, events);
        
        if (eventMatchInfo) {
            finalChannelName += eventMatchInfo.suffix;
            isLive = eventMatchInfo.isLive;
        }
    }
    
    matchedCount++;
    
    // Simpan saluran ke list sementara
    processedChannels.push({
        name: finalChannelName,
        url: ch.url,
        groupTitle: staticCategory, // Group Title selalu statis
        isLive: isLive
    });
  }

  // =========================================================================
  // TAHAP 2: PENOMORAN NAMA DUPLIKAT GLOBAL
  // =========================================================================
  
  const nameCountMap = new Map();
  const finalOutputChannels = [];

  for (const ch of processedChannels) {
      // Base name di sini adalah NAMA SALURAN ASLI sebelum penomoran duplikat
      // Kita hapus suffix jadwal untuk mendapatkan nama saluran dasarnya (untuk penomoran)
      const baseNameKey = ch.name.split(' | ')[0]; 
      
      const count = nameCountMap.get(baseNameKey) || 0;
      nameCountMap.set(baseNameKey, count + 1);

      let displayName = ch.name;
      
      // Jika count > 0, artinya ini adalah duplikat kedua, ketiga, dst.
      if (count > 0) {
          // Tambahkan penomoran di akhir NAMA SALURAN ASLI
          let suffixJadwal = '';
          const suffixMatch = ch.name.match(/ \| \[.*\] .*/);
          if (suffixMatch) {
              suffixJadwal = suffixMatch[0];
          }

          displayName = `${baseNameKey} -${count}${suffixJadwal}`; 
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
  // TAHAP 3: OUTPUT AKHIR
  // =========================================================================
  
  const outputMap = new Map();
  
  // Masukkan semua saluran ke dalam Map berdasarkan Group Title statisnya
  for (const ch of finalOutputChannels) {
      if(!outputMap.has(ch.groupTitle)) {
          outputMap.set(ch.groupTitle, []);
      }
      outputMap.get(ch.groupTitle).push(ch);
  }


  output.push("#EXTM3U");
  
  // Urutkan grup secara alfabetis
  const sortedGroups = Array.from(outputMap.keys()).sort();

  for (const groupTitle of sortedGroups) {
      const channelsInGroup = outputMap.get(groupTitle);
      
      if (channelsInGroup.length > 0) {
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

  console.log("=== SUMMARY ===\nTotal unique channels:", unique.length, "\nMatched (categories/schedule):", matchedCount, "\nGenerated live-auto.m3u with", finalOutputChannels.length, "channels (including offline)\nStats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
