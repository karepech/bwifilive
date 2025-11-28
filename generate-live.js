import fs from "fs";
import fetch from "node-fetch";
import axios from "axios";

/*
  generate-live.js (FINALIZED: DYNAMIC FOOTBALL + STATIC MULTI-SPORT)
  - Fetches soccer events for TODAY, H+1, and H+2 from TheSportsDB.
  - Groups ALL LIVE/UPCOMING FOOTBALL events by date (e.g., ⚽ LIVE FOOTBALL 2025-11-28).
  - All other sports channels are grouped by their static category (e.g., TENNIS & GOLF).
*/

const SOURCE_M3US = [
  
  "https://bakulwifi.my.id/live.m3u"

];

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

// Mengambil Jadwal Sepak Bola 3 Hari ke Depan (HARI INI, H+1, H+2)
async function fetchUpcomingEvents() {
    let allEvents = [];
    
    for (let offset = 0; offset <= 2; offset++) {
        const date = getDateString(offset);
        const url = `https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d=${date}&s=Soccer`;
        const txt = await fetchText(url);
        
        try {
            const events = (JSON.parse(txt).events || []).map(ev => ({
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
    return allEvents;
}


// Menentukan Kategori Statis (Semua Saluran non-bola dan Saluran Bola Statis)
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

// Mencari Informasi Acara Live/Upcoming Sepak Bola yang Sesuai
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
        // Match berdasarkan tim, event, atau liga
        const matchesTeams = (ev.home && (ln.includes(ev.home) || lu.includes(ev.home))) || 
                             (ev.away && (ln.includes(ev.away) || lu.includes(ev.away)));

        const matchesEventName = (ev.event && (ln.includes(ev.event) || lu.includes(ev.event)));
        const matchesLeague = (ev.league && (ln.includes(ev.league) || lu.includes(ev.league)));

        // Tambahan: Pastikan kecocokan juga relevan dengan liga di channelMap
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
        
        // Format Group Title: ⚽ LIVE FOOTBALL [Tanggal]
        const groupTitle = `⚽ LIVE FOOTBALL ${bestMatch.date}`;
        
        // Format Channel Name: [Liga - Waktu] Nama Pertandingan
        const finalChannelName = `${channel.name} | [${bestMatch.league}${timePart}] ${bestMatch.title}`;

        return { groupTitle: groupTitle, channelName: finalChannelName };
    }
    
    return null; 
}


async function main() {
  console.log("Starting generate-live.js (FINALIZED)...");

  const channelMap = loadChannelMap();
  const events = await fetchUpcomingEvents(); 
  
  let allChannels = [];
  for (const src of SOURCE_M3US) {
    const m3u = await fetchText(src);
    if (!m3u) continue;
    allChannels = allChannels.concat(extractChannelsFromM3U(m3u));
  }

  // Filter duplikat URL
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

  for (const ch of unique) {
    
    const staticCategory = getStaticCategory(ch, channelMap);
    
    if (!staticCategory) continue; 
    
    let groupTitle = staticCategory;
    let finalChannelName = ch.name;
    
    // Coba cari Event Match H+2 hanya jika itu saluran Bola
    if (staticCategory.includes("LIGA") || staticCategory.includes("FOOTBALL")) {
        const eventMatch = getEventMatchInfo(ch, events, staticCategory);
        if (eventMatch) {
            groupTitle = eventMatch.groupTitle; // Akan menjadi "⚽ LIVE FOOTBALL YYYY-MM-DD"
            finalChannelName = eventMatch.channelName;
        }
    }
    
    matchedCount++;

    const ok = await headOk(ch.url);
    if (!ok) {
      console.log("SKIP (offline):", ch.name);
      continue;
    }

    onlineCount++;
    
    const newExtinf = `#EXTINF:-1 group-title="${groupTitle}",${finalChannelName}`;
    
    output.push(newExtinf); 
    output.push(ch.url);
    console.log(`ADDED [${groupTitle}]:`, finalChannelName);
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
  console.log("Matched (channels):", matchedCount);
  console.log("Online (HTTP 200):", onlineCount);
  console.log("Generated live-auto.m3u with", onlineCount, "channels");
  console.log("Stats saved to live-auto-stats.json");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
